import { createHash, timingSafeEqual } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { galleryCollections, galleryDrawings, galleryShareDrawings, galleryShareSessions, galleryShares, members } from "@/db/schema";
import { consumeGalleryInterval, consumeGalleryRateLimit } from "@/lib/gallery/rate-limit";
import { GALLERY_PUBLIC_IP_REQUESTS_PER_MINUTE, GALLERY_PUBLIC_SESSION_REQUESTS_PER_MINUTE, publicAccessIsValid } from "@/lib/gallery/rules";
import { galleryNow } from "@/lib/gallery/clock";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const DUMMY_HASH = "0".repeat(64);

export function galleryCredentialHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function validGalleryCredential(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value) && Buffer.from(value, "base64url").length === 32
    && Buffer.from(value, "base64url").toString("base64url") === value;
}

export function verifyGalleryCredentialHash(storedHash: string | null | undefined, suppliedHash: string) {
  const expected = storedHash && /^[0-9a-f]{64}$/u.test(storedHash) ? storedHash : DUMMY_HASH;
  const matches = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(suppliedHash, "hex"));
  return Boolean(storedHash) && matches;
}

function readCookie(header: string | null, name: string) {
  const entry = header?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return null; }
}

function publicSessionToken(request: Request) {
  const secureToken = readCookie(request.headers.get("cookie"), "__Host-fu_gallery_session");
  if (secureToken) return secureToken;
  const url = new URL(request.url);
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  return localHttp ? readCookie(request.headers.get("cookie"), "fu_gallery_session_dev") : null;
}

export async function limitPublicEntry(request: Request, tokenHash?: string) {
  const ip = ipAddress(request) ?? "unknown";
  const ipHash = galleryCredentialHash(ip);
  if (!await consumeGalleryRateLimit(`public-entry-ip-${ipHash}`, 10, 10 * 60_000)) return false;
  if (tokenHash && !await consumeGalleryRateLimit(`public-entry-token-${tokenHash}`, 5, 60_000)) return false;
  return true;
}

export async function authorizePublicSession(request: Request, options: { countRequest?: boolean; countInterval?: boolean } = {}) {
  const token = publicSessionToken(request);
  const tokenHash = token && validGalleryCredential(token) ? galleryCredentialHash(token) : null;
  const ip = ipAddress(request) ?? "unknown";
  const ipHash = galleryCredentialHash(ip);
  if (options.countRequest !== false && !await consumeGalleryRateLimit(`public-read-ip-${ipHash}`, GALLERY_PUBLIC_IP_REQUESTS_PER_MINUTE, 60_000)) return { kind: "rate-limited" as const, retryAfter: 60 };

  const [row] = tokenHash ? await getDb().select({
    sessionId: galleryShareSessions.id,
    sessionHash: galleryShareSessions.sessionHash,
    sessionExpiresAt: galleryShareSessions.expiresAt,
    sessionRevokedAt: galleryShareSessions.revokedAt,
    shareId: galleryShares.id,
    familyId: galleryShares.familyId,
    shareExpiresAt: galleryShares.expiresAt,
    shareRevokedAt: galleryShares.revokedAt,
    creatorArchivedAt: members.archivedAt,
    collectionArchivedAt: galleryCollections.archivedAt,
  }).from(galleryShareSessions)
    .innerJoin(galleryShares, and(eq(galleryShareSessions.shareId, galleryShares.id), eq(galleryShareSessions.familyId, galleryShares.familyId)))
    .innerJoin(members, eq(galleryShares.createdByMemberId, members.id))
    .leftJoin(galleryCollections, eq(galleryShares.collectionId, galleryCollections.id))
    .where(eq(galleryShareSessions.sessionHash, tokenHash)).limit(1) : [];

  if (!verifyGalleryCredentialHash(row?.sessionHash, tokenHash ?? DUMMY_HASH)) return { kind: "unavailable" as const };
  if (!row || !publicAccessIsValid({
    share: { expiresAt: row.shareExpiresAt, revokedAt: row.shareRevokedAt, creatorArchivedAt: row.creatorArchivedAt },
    session: { expiresAt: row.sessionExpiresAt, revokedAt: row.sessionRevokedAt },
    collectionArchivedAt: row.collectionArchivedAt,
  }, galleryNow())) return { kind: "unavailable" as const };

  if (options.countRequest !== false && (!await consumeGalleryRateLimit(`public-read-session-${row.sessionId}`, GALLERY_PUBLIC_SESSION_REQUESTS_PER_MINUTE, 60_000)
    || !await consumeGalleryRateLimit("public-read-global", 300, 60_000)
    || (options.countInterval !== false && !await consumeGalleryInterval("public-read-global", 200)))) return { kind: "rate-limited" as const, retryAfter: 1 };

  return { kind: "authorized" as const, sessionId: row.sessionId, shareId: row.shareId, familyId: row.familyId, expiresAt: row.shareExpiresAt };
}

export async function revalidatePublicSession(request: Request, expectedShareId: string, expectedDrawingId?: string) {
  const token = publicSessionToken(request);
  if (!token || !validGalleryCredential(token)) return null;
  const sessionHash = galleryCredentialHash(token);
  return getDb().transaction(async tx => {
    const [share] = await tx.select().from(galleryShares).where(eq(galleryShares.id, expectedShareId)).for("share").limit(1);
    if (!share) return null;
    const [session] = await tx.select().from(galleryShareSessions).where(and(
      eq(galleryShareSessions.shareId, expectedShareId), eq(galleryShareSessions.familyId, share.familyId),
      eq(galleryShareSessions.sessionHash, sessionHash),
    )).for("share").limit(1);
    if (!session || !verifyGalleryCredentialHash(session.sessionHash, sessionHash)) return null;
    const [creator] = await tx.select({ archivedAt: members.archivedAt }).from(members).where(and(
      eq(members.id, share.createdByMemberId), eq(members.familyId, share.familyId),
    )).limit(1);
    const [collection] = share.collectionId ? await tx.select({ archivedAt: galleryCollections.archivedAt }).from(galleryCollections).where(and(
      eq(galleryCollections.id, share.collectionId), eq(galleryCollections.familyId, share.familyId),
    )).limit(1) : [undefined];
    if (!creator || !publicAccessIsValid({
      share: { expiresAt: share.expiresAt, revokedAt: share.revokedAt, creatorArchivedAt: creator.archivedAt },
      session: { expiresAt: session.expiresAt, revokedAt: session.revokedAt },
      collectionArchivedAt: collection?.archivedAt,
    }, galleryNow())) return null;
    if (expectedDrawingId) {
      const [includedDrawing] = await tx.select({ id: galleryDrawings.id }).from(galleryShareDrawings).innerJoin(galleryDrawings, and(
        eq(galleryShareDrawings.drawingId, galleryDrawings.id), eq(galleryShareDrawings.familyId, galleryDrawings.familyId),
      )).where(and(
        eq(galleryShareDrawings.shareId, expectedShareId), eq(galleryShareDrawings.familyId, share.familyId),
        eq(galleryShareDrawings.drawingId, expectedDrawingId), eq(galleryDrawings.status, "ready"),
        isNull(galleryShareDrawings.invalidatedAt), isNull(galleryDrawings.archivedAt),
      )).for("share").limit(1);
      if (!includedDrawing) return null;
    }
    return { shareId: share.id, familyId: share.familyId, expiresAt: share.expiresAt };
  });
}
