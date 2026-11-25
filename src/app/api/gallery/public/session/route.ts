import { NextResponse } from "next/server";
import { gallerySharesEnabled } from "@/lib/gallery/config";
import { authorizePublicSession } from "@/lib/gallery/public-access";
import { galleryNow } from "@/lib/gallery/clock";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request) {
  if (!gallerySharesEnabled()) return new NextResponse(null, { status: 404, headers });
  try {
    const access = await authorizePublicSession(request);
    if (access.kind === "rate-limited") return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...headers, "Retry-After": String(access.retryAfter) } });
    if (access.kind !== "authorized") return NextResponse.json({ error: "LINK_UNAVAILABLE" }, { status: 410, headers });
    return NextResponse.json({ shareId: access.shareId, expiresAt: access.expiresAt.toISOString(), serverNow: galleryNow().toISOString() }, { headers });
  } catch {
    return NextResponse.json({ error: "TEMPORARILY_UNAVAILABLE" }, { status: 503, headers: { ...headers, "Retry-After": "2" } });
  }
}
