import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { galleryCollections, galleryCollectionDrawings, galleryDrawings } from "@/db/schema";
import { galleryEnabled } from "@/lib/gallery/config";
import { authorizeGalleryGuest } from "@/lib/gallery/guest-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const guest = await authorizeGalleryGuest(request);
  if (!guest) return NextResponse.json({ error: "SESSION_UNAVAILABLE" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (guest.rateLimited) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "1" } });
  const [collection] = await getDb().select({ title: galleryCollections.title, description: galleryCollections.description })
    .from(galleryCollections).where(and(eq(galleryCollections.id, guest.collectionId), isNull(galleryCollections.archivedAt))).limit(1);
  if (!collection) return NextResponse.json({ error: "SESSION_UNAVAILABLE" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const rows = await getDb().select({ id: galleryDrawings.id, width: galleryDrawings.width, height: galleryDrawings.height, version: galleryDrawings.version })
    .from(galleryCollectionDrawings).innerJoin(galleryDrawings, eq(galleryCollectionDrawings.drawingId, galleryDrawings.id))
    .where(and(eq(galleryCollectionDrawings.collectionId, guest.collectionId), eq(galleryDrawings.status, "ready"), isNull(galleryDrawings.archivedAt)))
    .orderBy(asc(galleryCollectionDrawings.createdAt), asc(galleryDrawings.id));
  return NextResponse.json({ collection, drawings: rows.map(row => ({
    id: row.id, width: row.width, height: row.height, version: row.version,
    thumbnailUrl: `/api/gallery/guest/images/${row.id}?variant=thumbnail&v=${row.version}`,
    displayUrl: `/api/gallery/guest/images/${row.id}?variant=display&v=${row.version}`,
  })) }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
