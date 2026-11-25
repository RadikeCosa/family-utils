import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { galleryCollections, galleryDrawings, galleryShareDrawings, galleryShares } from "@/db/schema";
import { gallerySharesEnabled } from "@/lib/gallery/config";
import { authorizePublicSession, revalidatePublicSession } from "@/lib/gallery/public-access";
import { galleryNow } from "@/lib/gallery/clock";
import { GALLERY_SHARE_PAGE_SIZE, UUID_PATTERN } from "@/lib/gallery/rules";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const unavailable = () => NextResponse.json({ error: "LINK_UNAVAILABLE" }, { status: 410, headers });

export async function GET(request: Request, context: { params: Promise<{ shareId: string }> }) {
  if (!gallerySharesEnabled()) return new NextResponse(null, { status: 404, headers });
  try {
    const access = await authorizePublicSession(request);
    if (access.kind === "rate-limited") return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...headers, "Retry-After": String(access.retryAfter) } });
    if (access.kind !== "authorized") return unavailable();
    const { shareId } = await context.params;
    if (!UUID_PATTERN.test(shareId) || access.shareId !== shareId) return unavailable();
    const cursorValue = new URL(request.url).searchParams.get("cursor");
    const after = cursorValue === null ? -1 : Number(cursorValue);
    if (!Number.isSafeInteger(after) || after < -1 || after > 200) return NextResponse.json({ error: "INVALID_CURSOR" }, { status: 400, headers });
    const [share] = await getDb().select({ id: galleryShares.id, familyId: galleryShares.familyId, title: galleryCollections.title })
      .from(galleryShares).leftJoin(galleryCollections, eq(galleryShares.collectionId, galleryCollections.id))
      .where(and(eq(galleryShares.id, shareId), eq(galleryShares.familyId, access.familyId), gt(galleryShares.expiresAt, galleryNow()), isNull(galleryShares.revokedAt)))
      .limit(1);
    if (!share) return unavailable();
    const db = getDb();
    const [total] = await db.select({ value: count() }).from(galleryShareDrawings).innerJoin(galleryDrawings, and(
      eq(galleryShareDrawings.drawingId, galleryDrawings.id), eq(galleryShareDrawings.familyId, galleryDrawings.familyId),
    )).where(and(eq(galleryShareDrawings.shareId, shareId), isNull(galleryShareDrawings.invalidatedAt), eq(galleryDrawings.status, "ready"), isNull(galleryDrawings.archivedAt)));
    const rows = await db.select({ id: galleryDrawings.id, width: galleryDrawings.width, height: galleryDrawings.height, version: galleryDrawings.version, position: galleryShareDrawings.position })
      .from(galleryShareDrawings).innerJoin(galleryDrawings, and(
        eq(galleryShareDrawings.drawingId, galleryDrawings.id), eq(galleryShareDrawings.familyId, galleryDrawings.familyId),
      )).where(and(
        eq(galleryShareDrawings.shareId, shareId), gt(galleryShareDrawings.position, after), isNull(galleryShareDrawings.invalidatedAt),
        eq(galleryDrawings.status, "ready"), isNull(galleryDrawings.archivedAt),
      )).orderBy(asc(galleryShareDrawings.position)).limit(GALLERY_SHARE_PAGE_SIZE + 1);
    const hasMore = rows.length > GALLERY_SHARE_PAGE_SIZE;
    const drawings = rows.slice(0, GALLERY_SHARE_PAGE_SIZE).map(row => ({
      id: row.id, width: row.width, height: row.height, version: row.version, position: row.position,
      thumbnailUrl: `/api/gallery/public/shares/${shareId}/images/${row.id}?variant=thumbnail&v=${row.version}`,
      displayUrl: `/api/gallery/public/shares/${shareId}/images/${row.id}?variant=display&v=${row.version}`,
    }));
    if (!await revalidatePublicSession(request, shareId)) return unavailable();
    return NextResponse.json({
      share: { title: share.title ?? "Galería familiar", expiresAt: access.expiresAt.toISOString(), serverNow: galleryNow().toISOString() },
      drawings, total: Number(total?.value ?? 0), nextCursor: hasMore ? String(drawings.at(-1)?.position) : null,
    }, { headers });
  } catch {
    return NextResponse.json({ error: "TEMPORARILY_UNAVAILABLE" }, { status: 503, headers: { ...headers, "Retry-After": "2" } });
  }
}
