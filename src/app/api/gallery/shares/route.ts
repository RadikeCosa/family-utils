import { randomBytes } from "node:crypto";
import { and, asc, count, eq, gt, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, families, galleryCollections, galleryCollectionDrawings, galleryDrawings, galleryShareDrawings, galleryShareSessions, galleryShares } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { gallerySharesEnabled } from "@/lib/gallery/config";
import { galleryCredentialHash } from "@/lib/gallery/public-access";
import { galleryNow } from "@/lib/gallery/clock";
import { canManageGallery, galleryShareExpiry, GALLERY_MAX_ACTIVE_SHARES_PER_FAMILY, GALLERY_MAX_SHARE_ITEMS, UUID_PATTERN } from "@/lib/gallery/rules";

export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request) {
  if (!gallerySharesEnabled()) return new NextResponse(null, { status: 404, headers });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  const now = galleryNow();
  const rows = await getDb().select({
    id: galleryShares.id, createdByMemberId: galleryShares.createdByMemberId, collectionId: galleryShares.collectionId,
    collectionOwnerMemberId: galleryShares.collectionOwnerMemberId, collectionTitle: galleryCollections.title,
    expiresAt: galleryShares.expiresAt, revokedAt: galleryShares.revokedAt, createdAt: galleryShares.createdAt,
    totalDrawings: sql<number>`count(distinct ${galleryShareDrawings.drawingId})::int`, activeDrawings: sql<number>`count(distinct ${galleryShareDrawings.drawingId}) filter (where ${galleryShareDrawings.invalidatedAt} is null)::int`,
    activeSessions: sql<number>`count(distinct ${galleryShareSessions.id}) filter (where ${galleryShareSessions.revokedAt} is null and ${galleryShareSessions.expiresAt} > ${now})::int`,
  }).from(galleryShares)
    .leftJoin(galleryCollections, eq(galleryShares.collectionId, galleryCollections.id))
    .leftJoin(galleryShareDrawings, eq(galleryShareDrawings.shareId, galleryShares.id))
    .leftJoin(galleryShareSessions, eq(galleryShareSessions.shareId, galleryShares.id))
    .where(eq(galleryShares.familyId, actor.familyId))
    .groupBy(galleryShares.id, galleryCollections.title)
    .orderBy(sql`${galleryShares.createdAt} DESC`);
  const shares = rows.filter(row => !row.collectionId || canManageGallery(actor.role, actor.memberId, row.collectionOwnerMemberId ?? ""))
    .map(row => ({ ...row, active: !row.revokedAt && row.expiresAt > now }));
  return NextResponse.json({ shares }, { headers });
}

export async function POST(request: Request) {
  if (!gallerySharesEnabled()) return new NextResponse(null, { status: 404, headers });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID" }, { status: 400, headers }); }
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const collectionId = input.collectionId === null || input.collectionId === undefined ? null : input.collectionId;
  const duration = input.duration ?? "24h";
  const expiresAt = galleryShareExpiry(duration, galleryNow());
  if (!expiresAt || (collectionId !== null && (typeof collectionId !== "string" || !UUID_PATTERN.test(collectionId)))) {
    return NextResponse.json({ error: "INVALID" }, { status: 400, headers });
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = galleryCredentialHash(token);
  const db = getDb();
  const result = await db.transaction(async tx => {
    await tx.select({ id: families.id }).from(families).where(eq(families.id, actor.familyId)).for("update").limit(1);
    const now = galleryNow();
    const [active] = await tx.select({ value: count() }).from(galleryShares).where(and(
      eq(galleryShares.familyId, actor.familyId), isNull(galleryShares.revokedAt), gt(galleryShares.expiresAt, now),
    ));
    if (Number(active?.value ?? 0) >= GALLERY_MAX_ACTIVE_SHARES_PER_FAMILY) return { error: "SHARE_LIMIT" as const };

    let collectionOwnerMemberId: string | null = null;
    let drawingRows: { id: string; authorMemberId: string }[];
    if (collectionId) {
      const [collection] = await tx.select({ id: galleryCollections.id, ownerMemberId: galleryCollections.ownerMemberId }).from(galleryCollections)
        .where(and(eq(galleryCollections.id, collectionId), eq(galleryCollections.familyId, actor.familyId), isNull(galleryCollections.archivedAt)))
        .for("update").limit(1);
      if (!collection || !canManageGallery(actor.role, actor.memberId, collection.ownerMemberId)) return { error: "NOT_FOUND" as const };
      collectionOwnerMemberId = collection.ownerMemberId;
      drawingRows = await tx.select({ id: galleryDrawings.id, authorMemberId: galleryDrawings.authorMemberId }).from(galleryCollectionDrawings)
        .innerJoin(galleryDrawings, and(eq(galleryCollectionDrawings.drawingId, galleryDrawings.id), eq(galleryCollectionDrawings.familyId, galleryDrawings.familyId)))
        .where(and(eq(galleryCollectionDrawings.collectionId, collection.id), eq(galleryDrawings.status, "ready"), isNull(galleryDrawings.archivedAt)))
        .orderBy(asc(galleryCollectionDrawings.createdAt), asc(galleryCollectionDrawings.drawingId)).for("share");
    } else {
      drawingRows = await tx.select({ id: galleryDrawings.id, authorMemberId: galleryDrawings.authorMemberId }).from(galleryDrawings)
        .where(and(eq(galleryDrawings.familyId, actor.familyId), eq(galleryDrawings.status, "ready"), isNull(galleryDrawings.archivedAt)))
        .orderBy(asc(galleryDrawings.createdAt), asc(galleryDrawings.id)).for("share");
    }
    if (drawingRows.length > GALLERY_MAX_SHARE_ITEMS) return { error: "SELECTION_LIMIT" as const };
    if (drawingRows.length === 0) return { error: "EMPTY_SELECTION" as const };
    const [share] = await tx.insert(galleryShares).values({
      familyId: actor.familyId, createdByMemberId: actor.memberId, collectionId,
      collectionOwnerMemberId, tokenHash, expiresAt,
    }).returning({ id: galleryShares.id });
    await tx.insert(galleryShareDrawings).values(drawingRows.map((drawing, position) => ({
      shareId: share.id, familyId: actor.familyId, drawingId: drawing.id, authorMemberId: drawing.authorMemberId, position,
    })));
    await tx.insert(auditEvents).values({
      familyId: actor.familyId, actorMemberId: actor.memberId, entityType: "gallery_share", entityId: share.id,
      action: "created", after: { scope: collectionId ? "collection" : "gallery", drawingCount: drawingRows.length, expiresAt: expiresAt.toISOString() },
    });
    return { id: share.id, drawingCount: drawingRows.length };
  });
  if ("error" in result) {
    const status = result.error === "NOT_FOUND" ? 404 : result.error === "SHARE_LIMIT" || result.error === "EMPTY_SELECTION" ? 409 : result.error === "SELECTION_LIMIT" ? 413 : 400;
    return NextResponse.json({ error: result.error }, { status, headers });
  }
  const url = new URL("/galeria/compartida", process.env.BETTER_AUTH_URL ?? request.url);
  url.hash = new URLSearchParams({ token }).toString();
  return NextResponse.json({ id: result.id, url: url.toString(), expiresAt: expiresAt.toISOString(), drawingCount: result.drawingCount }, { status: 201, headers });
}
