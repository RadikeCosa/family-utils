import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, families, galleryCollections, galleryCollectionDrawings, galleryDrawings, galleryGuestSessions, galleryInvitations, galleryShareSessions, galleryShares } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { galleryEnabled } from "@/lib/gallery/config";
import { galleryNow } from "@/lib/gallery/clock";
import { canManageGallery } from "@/lib/gallery/rules";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ collectionId: string }> }) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { collectionId } = await context.params;
  const [collection] = await getDb().select().from(galleryCollections).where(and(
    eq(galleryCollections.id, collectionId), eq(galleryCollections.familyId, actor.familyId), isNull(galleryCollections.archivedAt),
  )).limit(1);
  if (!collection || !canManageGallery(actor.role, actor.memberId, collection.ownerMemberId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const drawings = await getDb().select({
    id: galleryDrawings.id,
    authorMemberId: galleryDrawings.authorMemberId,
    width: galleryDrawings.width,
    height: galleryDrawings.height,
    version: galleryDrawings.version,
  }).from(galleryCollectionDrawings).innerJoin(galleryDrawings, eq(galleryDrawings.id, galleryCollectionDrawings.drawingId))
    .where(and(eq(galleryCollectionDrawings.collectionId, collectionId), eq(galleryDrawings.status, "ready"), isNull(galleryDrawings.archivedAt)))
    .orderBy(galleryCollectionDrawings.createdAt);
  return NextResponse.json({
    collection: { id: collection.id, ownerMemberId: collection.ownerMemberId, title: collection.title, description: collection.description, version: collection.version },
    drawings: drawings.map(drawing => ({ ...drawing,
      displayUrl: `/api/gallery/drawings/${drawing.id}?variant=display&v=${drawing.version}`,
      thumbnailUrl: `/api/gallery/drawings/${drawing.id}?variant=thumbnail&v=${drawing.version}`,
    })),
  }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ collectionId: string }> }) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { collectionId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  const input = body as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : null;
  const description = typeof input.description === "string" ? input.description.trim() : null;
  if ((title !== null && (title.length < 1 || title.length > 120)) || (description !== null && description.length > 500) || (title === null && description === null)) {
    return NextResponse.json({ error: "INVALID" }, { status: 400 });
  }
  const result = await getDb().transaction(async tx => {
    await tx.select({ id: families.id }).from(families).where(eq(families.id, actor.familyId)).for("update").limit(1);
    const [collection] = await tx.select().from(galleryCollections).where(and(
      eq(galleryCollections.id, collectionId), eq(galleryCollections.familyId, actor.familyId), isNull(galleryCollections.archivedAt),
    )).for("update").limit(1);
    if (!collection || !canManageGallery(actor.role, actor.memberId, collection.ownerMemberId)) return { error: "NOT_FOUND" as const };
    const [active] = await tx.select({ id: galleryInvitations.id }).from(galleryInvitations).leftJoin(galleryGuestSessions, eq(galleryGuestSessions.invitationId, galleryInvitations.id)).where(and(
      eq(galleryInvitations.collectionId, collectionId), isNull(galleryInvitations.revokedAt),
      or(
        and(isNull(galleryInvitations.redeemedAt), gt(galleryInvitations.expiresAt, new Date())),
        and(gt(galleryGuestSessions.expiresAt, galleryNow()), isNull(galleryGuestSessions.revokedAt)),
      ),
    )).limit(1);
    if (active && input.confirmExposure !== true) return { error: "CONFIRM_EXPOSURE" as const };
    const [updated] = await tx.update(galleryCollections).set({
      ...(title !== null ? { title } : {}), ...(description !== null ? { description } : {}),
      version: sql`${galleryCollections.version} + 1`, updatedAt: new Date(),
    }).where(eq(galleryCollections.id, collectionId)).returning({ id: galleryCollections.id, version: galleryCollections.version });
    await tx.update(families).set({ galleryRevision: sql`${families.galleryRevision} + 1`, updatedAt: new Date() }).where(eq(families.id, actor.familyId));
    return { updated };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.error === "NOT_FOUND" ? 404 : 409 });
  return NextResponse.json({ collection: result.updated }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ collectionId: string }> }) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { collectionId } = await context.params;
  const result = await getDb().transaction(async tx => {
    await tx.select({ id: families.id }).from(families).where(eq(families.id, actor.familyId)).for("update").limit(1);
    const [collection] = await tx.select().from(galleryCollections).where(and(
      eq(galleryCollections.id, collectionId), eq(galleryCollections.familyId, actor.familyId), isNull(galleryCollections.archivedAt),
    )).for("update").limit(1);
    if (!collection || !canManageGallery(actor.role, actor.memberId, collection.ownerMemberId)) return false;
    const now = galleryNow();
    await tx.update(galleryCollections).set({ archivedAt: now, version: sql`${galleryCollections.version} + 1`, updatedAt: now }).where(eq(galleryCollections.id, collectionId));
    await tx.update(galleryInvitations).set({ revokedAt: now }).where(and(eq(galleryInvitations.collectionId, collectionId), isNull(galleryInvitations.revokedAt)));
    await tx.update(galleryGuestSessions).set({ revokedAt: now }).where(and(eq(galleryGuestSessions.collectionId, collectionId), isNull(galleryGuestSessions.revokedAt)));
    const linkedShares = await tx.select({ id: galleryShares.id, familyId: galleryShares.familyId }).from(galleryShares).where(and(
      eq(galleryShares.collectionId, collectionId), isNull(galleryShares.revokedAt),
    ));
    if (linkedShares.length) {
      await tx.update(galleryShares).set({ revokedAt: now }).where(and(
        eq(galleryShares.collectionId, collectionId), isNull(galleryShares.revokedAt),
      ));
      for (const share of linkedShares) {
        await tx.update(galleryShareSessions).set({ revokedAt: now }).where(and(eq(galleryShareSessions.shareId, share.id), isNull(galleryShareSessions.revokedAt)));
        await tx.insert(auditEvents).values({ familyId: share.familyId, actorMemberId: actor.memberId, entityType: "gallery_share", entityId: share.id, action: "revoked", after: { scope: "collection", reason: "collection_archived" } });
      }
    }
    await tx.update(families).set({ galleryRevision: sql`${families.galleryRevision} + 1`, updatedAt: now }).where(eq(families.id, actor.familyId));
    return true;
  });
  if (!result) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
