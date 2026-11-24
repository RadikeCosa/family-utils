import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { families, galleryDrawings } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { galleryEnabled } from "@/lib/gallery/config";
import { galleryQuotaAllows, galleryUploadInput } from "@/lib/gallery/rules";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  const input = galleryUploadInput(body as Record<string, unknown>);
  if (!input) return NextResponse.json({ error: "INVALID_IMAGE" }, { status: 400 });

  const id = randomUUID();
  const extension = input.type === "image/png" ? "png" : "jpg";
  const pendingPath = `gallery/pending/${id}.${extension}`;
  try {
    const created = await getDb().transaction(async (tx) => {
      await tx.select({ id: families.id }).from(families).where(eq(families.id, actor.familyId)).for("update");
      const [usage] = await tx.select({
        bytes: sql<number>`coalesce(sum(case when ${galleryDrawings.displayPath} is not null then coalesce(${galleryDrawings.displayBytes},0) + coalesce(${galleryDrawings.thumbnailBytes},0) else greatest(${galleryDrawings.originalBytes}, coalesce(${galleryDrawings.displayBytes},0) + coalesce(${galleryDrawings.thumbnailBytes},0)) end),0)::bigint`,
      }).from(galleryDrawings).where(eq(galleryDrawings.familyId, actor.familyId));
      if (!galleryQuotaAllows(Number(usage?.bytes ?? 0), 0, input.bytes)) return false;
      await tx.insert(galleryDrawings).values({
        id,
        familyId: actor.familyId,
        authorMemberId: actor.memberId,
        originalName: input.name,
        originalBytes: input.bytes,
        sourceMimeType: input.type,
        pendingPath,
      });
      return true;
    });
    if (!created) return NextResponse.json({ error: "QUOTA_EXCEEDED" }, { status: 413 });
    return NextResponse.json({ drawingId: id, pathname: pendingPath, maximumSizeInBytes: input.bytes }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "UNAVAILABLE" }, { status: 503 });
  }
}
