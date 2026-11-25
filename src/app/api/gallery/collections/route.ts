import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { galleryCollections, galleryCollectionDrawings, galleryDrawings, galleryGuestSessions, galleryInvitations } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { galleryEnabled } from "@/lib/gallery/config";
import { canManageGallery } from "@/lib/gallery/rules";

export const runtime = "nodejs";

function cleanText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length <= maximum ? cleaned : null;
}

export async function GET(request: Request) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const rows = await getDb().select({
    id: galleryCollections.id,
    ownerMemberId: galleryCollections.ownerMemberId,
    title: galleryCollections.title,
    description: galleryCollections.description,
    version: galleryCollections.version,
    updatedAt: galleryCollections.updatedAt,
    drawingCount: sql<number>`count(distinct ${galleryDrawings.id})::int`,
    activeInvitationCount: sql<number>`count(distinct case when ${galleryInvitations.revokedAt} is null and ((${galleryInvitations.redeemedAt} is null and ${galleryInvitations.expiresAt} > now()) or (${galleryInvitations.redeemedAt} is not null and ${galleryGuestSessions.expiresAt} > now() and ${galleryGuestSessions.revokedAt} is null)) then ${galleryInvitations.id} end)::int`,
  }).from(galleryCollections)
    .leftJoin(galleryCollectionDrawings, eq(galleryCollectionDrawings.collectionId, galleryCollections.id))
    .leftJoin(galleryDrawings, and(eq(galleryDrawings.id, galleryCollectionDrawings.drawingId), eq(galleryDrawings.status, "ready"), isNull(galleryDrawings.archivedAt)))
    .leftJoin(galleryInvitations, eq(galleryInvitations.collectionId, galleryCollections.id))
    .leftJoin(galleryGuestSessions, eq(galleryGuestSessions.invitationId, galleryInvitations.id))
    .where(and(eq(galleryCollections.familyId, actor.familyId), isNull(galleryCollections.archivedAt)))
    .groupBy(galleryCollections.id)
    .orderBy(desc(galleryCollections.updatedAt), desc(galleryCollections.id));
  const collections = rows.filter(row => canManageGallery(actor.role, actor.memberId, row.ownerMemberId));
  const covers = collections.length ? await getDb().select({
    collectionId: galleryCollectionDrawings.collectionId,
    drawingId: galleryDrawings.id,
    version: galleryDrawings.version,
  }).from(galleryCollectionDrawings)
    .innerJoin(galleryDrawings, and(eq(galleryDrawings.id, galleryCollectionDrawings.drawingId), eq(galleryDrawings.familyId, galleryCollectionDrawings.familyId), eq(galleryDrawings.status, "ready"), isNull(galleryDrawings.archivedAt)))
    .where(inArray(galleryCollectionDrawings.collectionId, collections.map(item => item.id)))
    .orderBy(asc(galleryCollectionDrawings.createdAt), asc(galleryCollectionDrawings.drawingId)) : [];
  const coverMap = new Map<string, string[]>();
  for (const cover of covers) {
    const urls = coverMap.get(cover.collectionId) ?? [];
    if (urls.length < 3) urls.push(`/api/gallery/drawings/${cover.drawingId}?variant=thumbnail&v=${cover.version}`);
    coverMap.set(cover.collectionId, urls);
  }
  return NextResponse.json({ collections: collections.map(collection => ({ ...collection, coverUrls: coverMap.get(collection.id) ?? [] })) }, {
    headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}

export async function POST(request: Request) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  const input = body as Record<string, unknown>;
  const title = cleanText(input.title, 120);
  const description = cleanText(input.description ?? "", 500);
  if (!title || !title.length || description === null) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  const [collection] = await getDb().insert(galleryCollections).values({
    familyId: actor.familyId,
    ownerMemberId: actor.memberId,
    title,
    description,
  }).returning({ id: galleryCollections.id, title: galleryCollections.title, description: galleryCollections.description, version: galleryCollections.version });
  return NextResponse.json({ collection }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
