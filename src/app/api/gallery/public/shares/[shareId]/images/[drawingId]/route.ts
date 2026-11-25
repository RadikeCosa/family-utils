import { get } from "@vercel/blob";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { galleryDrawings, galleryShareDrawings } from "@/db/schema";
import { gallerySharesEnabled } from "@/lib/gallery/config";
import { authorizePublicSession, revalidatePublicSession } from "@/lib/gallery/public-access";
import { UUID_PATTERN } from "@/lib/gallery/rules";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const unavailable = () => new NextResponse(null, { status: 410, headers });

export async function GET(request: Request, context: { params: Promise<{ shareId: string; drawingId: string }> }) {
  if (!gallerySharesEnabled()) return new NextResponse(null, { status: 404, headers });
  try {
    const access = await authorizePublicSession(request);
    if (access.kind === "rate-limited") return new NextResponse(null, { status: 429, headers: { ...headers, "Retry-After": String(access.retryAfter) } });
    if (access.kind !== "authorized") return unavailable();
    const { shareId, drawingId } = await context.params;
    if (!UUID_PATTERN.test(shareId) || !UUID_PATTERN.test(drawingId) || access.shareId !== shareId) return unavailable();
    const variant = new URL(request.url).searchParams.get("variant");
    if (variant !== "display" && variant !== "thumbnail") return unavailable();
    const [drawing] = await getDb().select({ path: variant === "display" ? galleryDrawings.displayPath : galleryDrawings.thumbnailPath })
      .from(galleryShareDrawings).innerJoin(galleryDrawings, and(
        eq(galleryShareDrawings.drawingId, galleryDrawings.id), eq(galleryShareDrawings.familyId, galleryDrawings.familyId),
      )).where(and(
        eq(galleryShareDrawings.shareId, shareId), eq(galleryShareDrawings.familyId, access.familyId),
        eq(galleryShareDrawings.drawingId, drawingId), isNull(galleryShareDrawings.invalidatedAt),
        eq(galleryDrawings.status, "ready"), isNull(galleryDrawings.archivedAt),
      )).limit(1);
    if (!drawing?.path) return unavailable();
    const blob = await get(drawing.path, { access: "private" });
    if (!blob || blob.statusCode !== 200) return unavailable();
    const revalidated = await revalidatePublicSession(request, shareId, drawingId);
    if (!revalidated) {
      await blob.stream.cancel().catch(() => undefined);
      return unavailable();
    }
    return new NextResponse(blob.stream, { headers: { ...headers, "Content-Type": "image/webp" } });
  } catch {
    return new NextResponse(null, { status: 503, headers: { ...headers, "Retry-After": "2" } });
  }
}
