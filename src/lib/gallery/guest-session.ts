import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { galleryCollections, galleryGuestSessions, galleryInvitations } from "@/db/schema";
import { guestSessionIsValid } from "@/lib/gallery/rules";
import { consumeGalleryInterval, consumeGalleryRateLimit } from "@/lib/gallery/rate-limit";

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

function cookieValue(header: string | null, name: string) {
  const entry = header?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

export async function authorizeGalleryGuest(request: Request, collectionId?: string) {
  const token = cookieValue(request.headers.get("cookie"), "fu_gallery_guest");
  if (!token || token.length < 32 || token.length > 100) return null;
  const [row] = await getDb().select({
    sessionId: galleryGuestSessions.id,
    sessionExpiresAt: galleryGuestSessions.expiresAt,
    sessionRevokedAt: galleryGuestSessions.revokedAt,
    familyId: galleryGuestSessions.familyId,
    collectionId: galleryGuestSessions.collectionId,
    invitationExpiresAt: galleryInvitations.expiresAt,
    invitationRedeemedAt: galleryInvitations.redeemedAt,
    invitationRevokedAt: galleryInvitations.revokedAt,
    collectionArchivedAt: galleryCollections.archivedAt,
  }).from(galleryGuestSessions)
    .innerJoin(galleryInvitations, eq(galleryGuestSessions.invitationId, galleryInvitations.id))
    .innerJoin(galleryCollections, eq(galleryGuestSessions.collectionId, galleryCollections.id))
    .where(and(
      eq(galleryGuestSessions.sessionHash, sha256(token)),
      ...(collectionId ? [eq(galleryGuestSessions.collectionId, collectionId)] : []),
    )).limit(1);
  if (!row || !guestSessionIsValid({
    session: { expiresAt: row.sessionExpiresAt, revokedAt: row.sessionRevokedAt },
    invitation: { expiresAt: row.invitationExpiresAt, redeemedAt: row.invitationRedeemedAt, revokedAt: row.invitationRevokedAt },
    collectionArchivedAt: row.collectionArchivedAt,
  })) return null;
  const now = Date.now();
  if (!await consumeGalleryRateLimit(`read-session-${row.sessionId}`, 120, 60_000, now)
    || !await consumeGalleryRateLimit("read-global-minute", 300, 60_000, now)
    || !await consumeGalleryInterval("read-global", 200, now)) return { ...row, rateLimited: true };
  return { ...row, rateLimited: false };
}
