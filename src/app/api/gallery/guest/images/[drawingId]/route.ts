import { get } from "@vercel/blob";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { galleryCollectionDrawings, galleryDrawings } from "@/db/schema";
import { galleryEnabled } from "@/lib/gallery/config";
import { authorizeGalleryGuest } from "@/lib/gallery/guest-session";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ drawingId: string }> }) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const guest = await authorizeGalleryGuest(request);
  if (!guest) return new NextResponse(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (guest.rateLimited) return new NextResponse(null, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "1" } });
  const { drawingId } = await context.params;
  const variant = new URL(request.url).searchParams.get("variant");
  if (variant !== "display" && variant !== "thumbnail") return new NextResponse(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  const [drawing] = await getDb().select({
    version: galleryDrawings.version,
    path: variant === "display" ? galleryDrawings.displayPath : galleryDrawings.thumbnailPath,
  }).from(galleryDrawings).innerJoin(galleryCollectionDrawings, and(
    eq(galleryCollectionDrawings.drawingId, galleryDrawings.id), eq(galleryCollectionDrawings.collectionId, guest.collectionId),
  )).where(and(eq(galleryDrawings.id, drawingId), eq(galleryDrawings.status, "ready"), isNull(galleryDrawings.archivedAt))).limit(1);
  if (!drawing?.path) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const blob = await get(drawing.path, { access: "private" });
  if (!blob || blob.statusCode !== 200) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new NextResponse(blob.stream, { headers: {
    "Cache-Control": "private, no-store", "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  } });
}
