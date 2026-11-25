import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, galleryShareSessions, galleryShares } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { gallerySharesEnabled } from "@/lib/gallery/config";
import { galleryNow } from "@/lib/gallery/clock";
import { canManageGallery, UUID_PATTERN } from "@/lib/gallery/rules";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function DELETE(request: Request, context: { params: Promise<{ shareId: string }> }) {
  if (!gallerySharesEnabled()) return new NextResponse(null, { status: 404, headers });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  const { shareId } = await context.params;
  if (!UUID_PATTERN.test(shareId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers });
  const result = await getDb().transaction(async tx => {
    const [share] = await tx.select({
      id: galleryShares.id, familyId: galleryShares.familyId, createdByMemberId: galleryShares.createdByMemberId,
      collectionId: galleryShares.collectionId, collectionOwnerMemberId: galleryShares.collectionOwnerMemberId,
    }).from(galleryShares).where(and(eq(galleryShares.id, shareId), eq(galleryShares.familyId, actor.familyId)))
      .for("update").limit(1);
    if (!share) return false;
    if (share.collectionId && !canManageGallery(actor.role, actor.memberId, share.collectionOwnerMemberId ?? "")) return false;
    const now = galleryNow();
    const [revoked] = await tx.update(galleryShares).set({ revokedAt: now }).where(and(
      eq(galleryShares.id, shareId), isNull(galleryShares.revokedAt),
    )).returning({ id: galleryShares.id });
    if (!revoked) return false;
    await tx.update(galleryShareSessions).set({ revokedAt: now }).where(and(eq(galleryShareSessions.shareId, shareId), isNull(galleryShareSessions.revokedAt)));
    await tx.insert(auditEvents).values({
      familyId: share.familyId, actorMemberId: actor.memberId, entityType: "gallery_share", entityId: share.id,
      action: "revoked", after: { scope: share.collectionId ? "collection" : "gallery", reason: "member_request" },
    });
    return true;
  });
  if (!result) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers });
  return NextResponse.json({ ok: true }, { headers });
}
