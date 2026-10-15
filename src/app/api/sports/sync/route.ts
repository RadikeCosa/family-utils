import { getMemberContext } from "@/lib/auth/context";
import { sportsEnabled } from "@/lib/sports/config";
export const runtime = "nodejs";
// Curated imports are the only supported update path in this release.
export async function POST(request: Request) {
  if (!sportsEnabled())
    return Response.json(
      { error: "Deportes está desactivado." },
      { status: 404 },
    );
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Origen no permitido." }, { status: 403 });
  if (!(await getMemberContext(request.headers)))
    return Response.json({ error: "Ingresá a tu familia." }, { status: 403 });
  return Response.json(
    { status: "Automatización desactivada", categories: [] },
    { headers: { "Cache-Control": "no-store", Vary: "Cookie" } },
  );
}
