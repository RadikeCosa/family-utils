import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { galleryDrawings } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { galleryEnabled } from "@/lib/gallery/config";
import { UUID_PATTERN, GALLERY_MAX_INPUT_BYTES } from "@/lib/gallery/rules";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  let body: HandleUploadBody;
  try { body = await request.json() as HandleUploadBody; } catch { return NextResponse.json({ error: "INVALID" }, { status: 400 }); }
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const actor = await getMemberContext(request.headers);
        if (!actor) throw new Error("Not authorized");
        let payload: unknown;
        try { payload = JSON.parse(clientPayload ?? "{}"); } catch { throw new Error("Invalid upload payload"); }
        const drawingId = payload && typeof payload === "object" && "drawingId" in payload ? payload.drawingId : null;
        if (typeof drawingId !== "string" || !UUID_PATTERN.test(drawingId)) throw new Error("Invalid drawing");
        const [drawing] = await getDb().select({ id: galleryDrawings.id, path: galleryDrawings.pendingPath, bytes: galleryDrawings.originalBytes, mime: galleryDrawings.sourceMimeType })
          .from(galleryDrawings)
          .where(and(
            eq(galleryDrawings.id, drawingId),
            eq(galleryDrawings.familyId, actor.familyId),
            eq(galleryDrawings.authorMemberId, actor.memberId),
            eq(galleryDrawings.status, "pending"),
            eq(galleryDrawings.pendingPath, pathname),
            gt(galleryDrawings.createdAt, new Date(Date.now() - 10 * 60 * 1000)),
          )).limit(1);
        if (!drawing || !drawing.path || drawing.bytes > GALLERY_MAX_INPUT_BYTES) throw new Error("Upload reservation expired");
        return {
          allowedContentTypes: [drawing.mime],
          maximumSizeInBytes: drawing.bytes,
          validUntil: Date.now() + 5 * 60 * 1000,
          tokenPayload: JSON.stringify({ drawingId, familyId: actor.familyId, memberId: actor.memberId }),
        };
      },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "UPLOAD_NOT_AUTHORIZED" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
}
