import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { galleryCollections, galleryGuestSessions, galleryInvitations } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { galleryEnabled } from "@/lib/gallery/config";
import { canManageGallery } from "@/lib/gallery/rules";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ collectionId: string; invitationId: string }> }) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { collectionId, invitationId } = await context.params;
  const result = await getDb().transaction(async tx => {
    const [collection] = await tx.select({ ownerMemberId: galleryCollections.ownerMemberId }).from(galleryCollections).where(and(
      eq(galleryCollections.id, collectionId), eq(galleryCollections.familyId, actor.familyId), isNull(galleryCollections.archivedAt),
    )).limit(1);
    if (!collection || !canManageGallery(actor.role, actor.memberId, collection.ownerMemberId)) return false;
    const now = new Date();
    const [revoked] = await tx.update(galleryInvitations).set({ revokedAt: now }).where(and(
      eq(galleryInvitations.id, invitationId), eq(galleryInvitations.collectionId, collectionId), isNull(galleryInvitations.revokedAt),
    )).returning({ id: galleryInvitations.id });
    if (!revoked) return false;
    await tx.update(galleryGuestSessions).set({ revokedAt: now }).where(and(eq(galleryGuestSessions.invitationId, invitationId), isNull(galleryGuestSessions.revokedAt)));
    return true;
  });
  if (!result) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
