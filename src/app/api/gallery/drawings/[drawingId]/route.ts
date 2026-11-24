import { get } from "@vercel/blob";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { families, galleryDrawings } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { galleryEnabled } from "@/lib/gallery/config";
import { canManageGallery } from "@/lib/gallery/rules";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ drawingId: string }> }) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { drawingId } = await context.params;
  const variant = new URL(request.url).searchParams.get("variant");
  if (variant !== "display" && variant !== "thumbnail") return NextResponse.json({ error: "INVALID" }, { status: 400 });
  const [drawing] = await getDb().select({
    version: galleryDrawings.version,
    path: variant === "display" ? galleryDrawings.displayPath : galleryDrawings.thumbnailPath,
    bytes: variant === "display" ? galleryDrawings.displayBytes : galleryDrawings.thumbnailBytes,
  }).from(galleryDrawings).where(and(
    eq(galleryDrawings.id, drawingId),
    eq(galleryDrawings.familyId, actor.familyId),
    eq(galleryDrawings.status, "ready"),
    isNull(galleryDrawings.archivedAt),
  )).limit(1);
  if (!drawing?.path) return new NextResponse(null, { status: 404 });
  const etag = `"gallery-image-${drawingId}-${variant}-${drawing.version}-${drawing.bytes}"`;
  const headers = {
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Cookie",
  };
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  const blob = await get(drawing.path, { access: "private" });
  if (!blob || blob.statusCode !== 200) return new NextResponse(null, { status: 404 });
  return new NextResponse(blob.stream, { headers });
}

export async function PATCH(request: Request, context: { params: Promise<{ drawingId: string }> }) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID" }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof (body as { archived?: unknown }).archived !== "boolean") {
    return NextResponse.json({ error: "INVALID" }, { status: 400 });
  }
  const { drawingId } = await context.params;
  const [drawing] = await getDb().select({ id: galleryDrawings.id, authorMemberId: galleryDrawings.authorMemberId, status: galleryDrawings.status })
    .from(galleryDrawings).where(and(eq(galleryDrawings.id, drawingId), eq(galleryDrawings.familyId, actor.familyId))).limit(1);
  if (!drawing || !canManageGallery(actor.role, actor.memberId, drawing.authorMemberId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const archived = (body as { archived: boolean }).archived;
  if ((archived && drawing.status !== "ready") || (!archived && drawing.status !== "archived")) return NextResponse.json({ error: "CONFLICT" }, { status: 409 });
  await getDb().transaction(async (tx) => {
    await tx.update(galleryDrawings).set({
      status: archived ? "archived" : "ready",
      archivedAt: archived ? new Date() : null,
      version: sql`${galleryDrawings.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(galleryDrawings.id, drawing.id));
    await tx.update(families).set({ galleryRevision: sql`${families.galleryRevision} + 1`, updatedAt: new Date() }).where(eq(families.id, actor.familyId));
  });
  return NextResponse.json({ drawingId, archived }, { headers: { "Cache-Control": "private, no-store" } });
}
