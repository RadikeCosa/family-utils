import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { families, galleryDrawings } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { galleryEnabled } from "@/lib/gallery/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const db = getDb();
  const [family] = await db.select({ revision: families.galleryRevision }).from(families).where(eq(families.id, actor.familyId)).limit(1);
  if (!family) return NextResponse.json({ error: "UNAVAILABLE" }, { status: 503 });
  const etag = `"gallery-${family.revision}"`;
  const headers = { "Cache-Control": "private, no-cache", ETag: etag, "Vary": "Cookie" };
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  const rows = await db.select({
    id: galleryDrawings.id,
    authorMemberId: galleryDrawings.authorMemberId,
    width: galleryDrawings.width,
    height: galleryDrawings.height,
    version: galleryDrawings.version,
    createdAt: galleryDrawings.createdAt,
  }).from(galleryDrawings).where(and(
    eq(galleryDrawings.familyId, actor.familyId),
    eq(galleryDrawings.status, "ready"),
    isNull(galleryDrawings.archivedAt),
  )).orderBy(desc(galleryDrawings.createdAt), desc(galleryDrawings.id));
  return NextResponse.json({ items: rows.map(row => ({
    ...row,
    displayUrl: `/api/gallery/drawings/${row.id}?variant=display&v=${row.version}`,
    thumbnailUrl: `/api/gallery/drawings/${row.id}?variant=thumbnail&v=${row.version}`,
  })) }, { headers });
}
