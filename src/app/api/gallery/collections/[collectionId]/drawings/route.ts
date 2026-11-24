import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { families, galleryCollections, galleryCollectionDrawings, galleryDrawings, galleryGuestSessions, galleryInvitations } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { galleryEnabled } from "@/lib/gallery/config";
import { canManageGallery, GALLERY_MAX_COLLECTION_ITEMS, UUID_PATTERN } from "@/lib/gallery/rules";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ collectionId: string }> }) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { collectionId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  const input = body as Record<string, unknown>;
  const drawingIds = input.drawingIds;
  if ((input.action !== "add" && input.action !== "remove") || !Array.isArray(drawingIds)
    || drawingIds.length < 1 || drawingIds.length > GALLERY_MAX_COLLECTION_ITEMS
    || drawingIds.some(id => typeof id !== "string" || !UUID_PATTERN.test(id))
    || new Set(drawingIds).size !== drawingIds.length) {
    return NextResponse.json({ error: "INVALID" }, { status: 400 });
  }

  const result = await getDb().transaction(async tx => {
    const [collection] = await tx.select().from(galleryCollections).where(and(
      eq(galleryCollections.id, collectionId), eq(galleryCollections.familyId, actor.familyId), isNull(galleryCollections.archivedAt),
    )).for("update").limit(1);
    if (!collection || !canManageGallery(actor.role, actor.memberId, collection.ownerMemberId)) return { error: "NOT_FOUND" as const };
    const now = new Date();

    if (input.action === "add") {
      const drawings = await tx.select({ id: galleryDrawings.id }).from(galleryDrawings).where(and(
        inArray(galleryDrawings.id, drawingIds as string[]),
        eq(galleryDrawings.familyId, actor.familyId),
        eq(galleryDrawings.authorMemberId, collection.ownerMemberId),
        eq(galleryDrawings.status, "ready"),
        isNull(galleryDrawings.archivedAt),
      ));
      if (drawings.length !== drawingIds.length) return { error: "INVALID_DRAWINGS" as const };
      const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(galleryCollectionDrawings).where(eq(galleryCollectionDrawings.collectionId, collectionId));
      const [existing] = await tx.select({ value: sql<number>`count(*)::int` }).from(galleryCollectionDrawings).where(and(
        eq(galleryCollectionDrawings.collectionId, collectionId), inArray(galleryCollectionDrawings.drawingId, drawingIds as string[]),
      ));
      const added = drawingIds.length - Number(existing?.value ?? 0);
      if (Number(count?.value ?? 0) + added > GALLERY_MAX_COLLECTION_ITEMS) return { error: "COLLECTION_FULL" as const };
      if (added > 0) {
        const [activeInvitation] = await tx.select({ id: galleryInvitations.id }).from(galleryInvitations).leftJoin(galleryGuestSessions, eq(galleryGuestSessions.invitationId, galleryInvitations.id)).where(and(
          eq(galleryInvitations.collectionId, collectionId), isNull(galleryInvitations.revokedAt),
          or(
            and(isNull(galleryInvitations.redeemedAt), gt(galleryInvitations.expiresAt, now)),
            and(gt(galleryGuestSessions.expiresAt, now), isNull(galleryGuestSessions.revokedAt)),
          ),
        )).limit(1);
        if (activeInvitation && input.confirmExposure !== true) return { error: "CONFIRM_EXPOSURE" as const };
      }
      await tx.insert(galleryCollectionDrawings).values((drawingIds as string[]).map(drawingId => ({
        familyId: actor.familyId, ownerMemberId: collection.ownerMemberId, collectionId, drawingId,
      }))).onConflictDoNothing();
    } else {
      await tx.delete(galleryCollectionDrawings).where(and(
        eq(galleryCollectionDrawings.collectionId, collectionId), inArray(galleryCollectionDrawings.drawingId, drawingIds as string[]),
      ));
    }
    await tx.update(galleryCollections).set({ version: sql`${galleryCollections.version} + 1`, updatedAt: now }).where(eq(galleryCollections.id, collectionId));
    await tx.update(families).set({ galleryRevision: sql`${families.galleryRevision} + 1`, updatedAt: now }).where(eq(families.id, actor.familyId));
    return { ok: true as const };
  });
  if ("error" in result) {
    const status = result.error === "NOT_FOUND" ? 404 : result.error === "CONFIRM_EXPOSURE" ? 409 : result.error === "COLLECTION_FULL" ? 413 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
