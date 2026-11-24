import { createHash, randomBytes } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import { and, eq, gt, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { galleryCollections, galleryGuestSessions, galleryInvitations } from "@/db/schema";
import { galleryEnabled } from "@/lib/gallery/config";
import { createGuestSessionExpiry, invitationIsRedeemable } from "@/lib/gallery/rules";
import { consumeGalleryRateLimit } from "@/lib/gallery/rate-limit";

export const runtime = "nodejs";

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

export async function POST(request: Request) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const ip = ipAddress(request) ?? "unknown";
  if (!await consumeGalleryRateLimit(`redeem-ip-${digest(ip)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "600", "Cache-Control": "no-store" } });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID" }, { status: 400 }); }
  const token = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).token : null;
  if (typeof token !== "string" || token.length < 32 || token.length > 100) return NextResponse.json({ error: "INVALID_LINK" }, { status: 400 });
  const tokenHash = digest(token);
  if (!await consumeGalleryRateLimit(`redeem-token-${tokenHash}`, 5, 60 * 1000)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
  }
  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = createGuestSessionExpiry();
  const db = getDb();
  const result = await db.transaction(async tx => {
    const [invitation] = await tx.select().from(galleryInvitations).innerJoin(galleryCollections, and(
      eq(galleryInvitations.collectionId, galleryCollections.id), isNull(galleryCollections.archivedAt),
    )).where(and(eq(galleryInvitations.tokenHash, tokenHash), isNull(galleryInvitations.redeemedAt), isNull(galleryInvitations.revokedAt), gt(galleryInvitations.expiresAt, new Date())))
      .for("update").limit(1);
    if (!invitation || !invitationIsRedeemable({ expiresAt: invitation.gallery_invitations.expiresAt, redeemedAt: invitation.gallery_invitations.redeemedAt, revokedAt: invitation.gallery_invitations.revokedAt })) return false;
    const changed = await tx.update(galleryInvitations).set({ redeemedAt: new Date() }).where(and(
      eq(galleryInvitations.id, invitation.gallery_invitations.id), isNull(galleryInvitations.redeemedAt), isNull(galleryInvitations.revokedAt), gt(galleryInvitations.expiresAt, new Date()),
    )).returning({ id: galleryInvitations.id });
    if (changed.length !== 1) return false;
    await tx.insert(galleryGuestSessions).values({
      familyId: invitation.gallery_invitations.familyId,
      collectionId: invitation.gallery_invitations.collectionId,
      invitationId: invitation.gallery_invitations.id,
      sessionHash: digest(sessionToken),
      expiresAt,
    });
    return true;
  });
  if (!result) return NextResponse.json({ error: "LINK_UNAVAILABLE" }, { status: 410, headers: { "Cache-Control": "no-store" } });
  const response = NextResponse.json({ ok: true, expiresAt }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  response.cookies.set("fu_gallery_guest", sessionToken, { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "strict", path: "/api/gallery/guest", expires: expiresAt });
  return response;
}
