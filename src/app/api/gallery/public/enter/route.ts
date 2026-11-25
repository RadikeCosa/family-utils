import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { galleryCollections, galleryShareSessions, galleryShares, members } from "@/db/schema";
import { gallerySharesEnabled } from "@/lib/gallery/config";
import { galleryNow } from "@/lib/gallery/clock";
import { galleryCredentialHash, limitPublicEntry, validGalleryCredential, verifyGalleryCredentialHash } from "@/lib/gallery/public-access";

export const runtime = "nodejs";
const unavailable = () => NextResponse.json({ error: "LINK_UNAVAILABLE" }, { status: 410, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

export async function POST(request: Request) {
  if (!gallerySharesEnabled()) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const token = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).token : null;
  const wellFormed = validGalleryCredential(token);
  const tokenHash = wellFormed ? galleryCredentialHash(token) : undefined;
  try {
    if (!await limitPublicEntry(request, tokenHash)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "600", "Referrer-Policy": "no-referrer" } });
    const sessionToken = randomBytes(32).toString("base64url");
    const result = await getDb().transaction(async tx => {
      const [share] = tokenHash ? await tx.select().from(galleryShares).where(eq(galleryShares.tokenHash, tokenHash)).for("update").limit(1) : [];
      const hashMatches = verifyGalleryCredentialHash(share?.tokenHash, tokenHash ?? "0".repeat(64));
      if (!share || !hashMatches) return null;
      const now = galleryNow();
      const [creator] = await tx.select({ archivedAt: members.archivedAt }).from(members).where(and(
        eq(members.id, share.createdByMemberId), eq(members.familyId, share.familyId),
      )).limit(1);
      const [collection] = share.collectionId ? await tx.select({ archivedAt: galleryCollections.archivedAt }).from(galleryCollections).where(and(
        eq(galleryCollections.id, share.collectionId), eq(galleryCollections.familyId, share.familyId),
      )).limit(1) : [undefined];
      if (!creator || creator.archivedAt || (share.collectionId && (!collection || collection.archivedAt))
        || share.revokedAt || share.expiresAt.getTime() <= now.getTime()) return null;
      await tx.insert(galleryShareSessions).values({
        familyId: share.familyId, shareId: share.id, sessionHash: galleryCredentialHash(sessionToken), expiresAt: share.expiresAt,
      });
      return { shareId: share.id, expiresAt: share.expiresAt, serverNow: now };
    });
    if (!result) return unavailable();
    const secure = new URL(request.url).protocol === "https:";
    const cookieName = secure ? "__Host-fu_gallery_session" : "fu_gallery_session_dev";
    const response = NextResponse.json({ ok: true, shareId: result.shareId, expiresAt: result.expiresAt.toISOString(), serverNow: result.serverNow.toISOString() }, {
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
    response.cookies.set(cookieName, sessionToken, {
      httpOnly: true, secure, sameSite: "lax", path: "/", expires: result.expiresAt,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "TEMPORARILY_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2", "Referrer-Policy": "no-referrer" } });
  }
}
