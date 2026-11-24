import { createHash } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { and, eq, ne, sql } from "drizzle-orm";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { families, galleryDrawings } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { galleryEnabled } from "@/lib/gallery/config";
import { canManageGallery, GALLERY_MAX_PIXELS, GALLERY_STORAGE_BUDGET_BYTES } from "@/lib/gallery/rules";

export const runtime = "nodejs";
export const maxDuration = 60;

async function removeBlob(path: string | null) {
  if (!path) return true;
  try { await del(path); return true; } catch { return false; }
}

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

const storageBytes = sql<number>`coalesce(sum(case
  when ${galleryDrawings.displayPath} is not null then coalesce(${galleryDrawings.displayBytes},0) + coalesce(${galleryDrawings.thumbnailBytes},0) + case when ${galleryDrawings.pendingPath} is null then 0 else ${galleryDrawings.originalBytes} end
  else greatest(${galleryDrawings.originalBytes}, coalesce(${galleryDrawings.displayBytes},0) + coalesce(${galleryDrawings.thumbnailBytes},0))
end),0)::bigint`;

export async function POST(request: Request, context: { params: Promise<{ drawingId: string }> }) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { drawingId } = await context.params;
  const db = getDb();
  const [drawing] = await db.select().from(galleryDrawings).where(and(
    eq(galleryDrawings.id, drawingId),
    eq(galleryDrawings.familyId, actor.familyId),
  )).limit(1);
  if (!drawing || !canManageGallery(actor.role, actor.memberId, drawing.authorMemberId)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (drawing.status === "ready") return NextResponse.json({ drawingId, ready: true }, { headers: { "Cache-Control": "private, no-store" } });
  if (drawing.status !== "pending" || !drawing.pendingPath) return NextResponse.json({ error: "UPLOAD_NOT_PENDING" }, { status: 409 });

  let pendingPath = drawing.pendingPath;
  try {
    const original = await get(pendingPath, { access: "private" });
    if (!original || original.statusCode !== 200) return NextResponse.json({ error: "UPLOAD_NOT_FOUND" }, { status: 409 });
    const source = await readStream(original.stream);
    if (source.byteLength !== drawing.originalBytes || source.byteLength > 25 * 1024 * 1024) {
      await removeBlob(pendingPath);
      await db.delete(galleryDrawings).where(eq(galleryDrawings.id, drawing.id));
      return NextResponse.json({ error: "UPLOAD_SIZE_MISMATCH" }, { status: 422 });
    }

    const image = sharp(source, { limitInputPixels: GALLERY_MAX_PIXELS, failOn: "error" });
    const metadata = await image.metadata();
    const expectedFormat = drawing.sourceMimeType === "image/png" ? "png" : "jpeg";
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height || metadata.width * metadata.height > GALLERY_MAX_PIXELS) {
      await removeBlob(pendingPath);
      await db.delete(galleryDrawings).where(eq(galleryDrawings.id, drawing.id));
      return NextResponse.json({ error: "INVALID_IMAGE" }, { status: 422 });
    }

    const sha256 = createHash("sha256").update(source).digest("hex");
    const [duplicate] = await db.select().from(galleryDrawings).where(and(
      eq(galleryDrawings.familyId, actor.familyId),
      eq(galleryDrawings.originalSha256, sha256),
      ne(galleryDrawings.id, drawing.id),
    )).limit(1);
    if (duplicate) {
      await db.transaction(async (tx) => {
        if (duplicate.status === "archived" || duplicate.archivedAt) {
          await tx.update(galleryDrawings).set({ status: "ready", archivedAt: null, version: sql`${galleryDrawings.version} + 1`, updatedAt: new Date() })
            .where(eq(galleryDrawings.id, duplicate.id));
          await tx.update(families).set({ galleryRevision: sql`${families.galleryRevision} + 1`, updatedAt: new Date() }).where(eq(families.id, actor.familyId));
        }
        await tx.delete(galleryDrawings).where(eq(galleryDrawings.id, drawing.id));
      });
      await removeBlob(pendingPath);
      return NextResponse.json({ drawingId: duplicate.id, duplicate: true, restored: duplicate.status === "archived" || Boolean(duplicate.archivedAt) }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const display = await sharp(source, { limitInputPixels: GALLERY_MAX_PIXELS, failOn: "error" })
      .rotate().toColourspace("srgb")
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .webp({ lossless: true, effort: 4 }).toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(source, { limitInputPixels: GALLERY_MAX_PIXELS, failOn: "error" })
      .rotate().toColourspace("srgb")
      .resize({ width: 384, height: 384, fit: "inside", withoutEnlargement: true })
      .webp({ lossless: true, effort: 4 }).toBuffer({ resolveWithObject: true });
    const width = display.info.width;
    const height = display.info.height;
    const displayPath = `gallery/${drawing.id}/display.webp`;
    const thumbnailPath = `gallery/${drawing.id}/thumbnail.webp`;

    const reserved = await db.transaction(async (tx) => {
      await tx.select({ id: families.id }).from(families).where(eq(families.id, actor.familyId)).for("update");
      const [usage] = await tx.select({ bytes: storageBytes }).from(galleryDrawings).where(eq(galleryDrawings.familyId, actor.familyId));
      const replaces = Number(usage?.bytes ?? 0) - drawing.originalBytes + display.data.byteLength + thumbnail.data.byteLength;
      if (replaces > GALLERY_STORAGE_BUDGET_BYTES) return false;
      const updated = await tx.update(galleryDrawings).set({
        status: "processing", originalSha256: sha256, width, height,
        displayBytes: display.data.byteLength, thumbnailBytes: thumbnail.data.byteLength,
        updatedAt: new Date(),
      }).where(and(eq(galleryDrawings.id, drawing.id), eq(galleryDrawings.status, "pending"))).returning({ id: galleryDrawings.id });
      return updated.length === 1;
    });
    if (!reserved) {
      await removeBlob(pendingPath);
      await db.delete(galleryDrawings).where(eq(galleryDrawings.id, drawing.id));
      return NextResponse.json({ error: "QUOTA_EXCEEDED" }, { status: 413 });
    }

    try {
      await put(displayPath, display.data, { access: "private", addRandomSuffix: false, contentType: "image/webp", cacheControlMaxAge: 60 * 60 * 24 * 30 });
      await put(thumbnailPath, thumbnail.data, { access: "private", addRandomSuffix: false, contentType: "image/webp", cacheControlMaxAge: 60 * 60 * 24 * 30 });
      await db.transaction(async (tx) => {
        const updated = await tx.update(galleryDrawings).set({ status: "ready", displayPath, thumbnailPath, version: sql`${galleryDrawings.version} + 1`, updatedAt: new Date() })
          .where(and(eq(galleryDrawings.id, drawing.id), eq(galleryDrawings.status, "processing"))).returning({ id: galleryDrawings.id });
        if (updated.length !== 1) throw new Error("Drawing state changed during finalization");
        await tx.update(families).set({ galleryRevision: sql`${families.galleryRevision} + 1`, updatedAt: new Date() }).where(eq(families.id, actor.familyId));
      });
    } catch {
      await Promise.all([removeBlob(displayPath), removeBlob(thumbnailPath)]);
      await db.update(galleryDrawings).set({ status: "pending", originalSha256: null, displayBytes: null, thumbnailBytes: null, width: null, height: null, updatedAt: new Date() })
        .where(eq(galleryDrawings.id, drawing.id));
      return NextResponse.json({ error: "PROCESSING_FAILED" }, { status: 503 });
    }

    if (await removeBlob(pendingPath)) {
      await db.update(galleryDrawings).set({ pendingPath: null, updatedAt: new Date() }).where(eq(galleryDrawings.id, drawing.id));
      pendingPath = "";
    }
    return NextResponse.json({ drawingId: drawing.id, ready: true }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "PROCESSING_FAILED" }, { status: 503 });
  }
}
