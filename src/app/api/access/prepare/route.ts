import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { authUser, memberDevices } from "@/db/schema";
import { createAuth } from "@/lib/auth/server";
import { accessPepper, enforceAccessAttemptLimit, opaqueBucketKey, recordCodeAttempt } from "@/lib/access/rate-limit";
import { accessDeviceSetCookie } from "@/lib/access/device-limit";
import { getMemberContext } from "@/lib/auth/context";

export const runtime = "nodejs";
const genericError = { error: "No se pudo preparar el acceso. Volvé a intentar desde la app." };

async function cleanupAbandonedIdentities(pepper: string) {
  const cleanupKey = opaqueBucketKey(pepper, "anonymous-cleanup", "daily");
  if (!(await recordCodeAttempt(cleanupKey, 1, 24 * 60))) return;
  await getDb().execute(sql`
    WITH stale AS (
      SELECT ${authUser.id} AS id
      FROM ${authUser}
      WHERE ${authUser.isAnonymous} = true
        AND ${authUser.createdAt} < now() - interval '1 hour'
        AND NOT EXISTS (
          SELECT 1 FROM ${memberDevices}
          WHERE ${memberDevices.authUserId} = ${authUser.id}
        )
      ORDER BY ${authUser.createdAt}
      LIMIT 100
    )
    DELETE FROM ${authUser}
    USING stale
    WHERE ${authUser.id} = stale.id
  `);
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json(genericError, { status: 403 });
  let pepper: string;
  try { pepper = accessPepper(); }
  catch { return NextResponse.json({ error: "El acceso no está configurado." }, { status: 503 }); }

  const limit = await enforceAccessAttemptLimit({ headers: request.headers, endpoint: "prepare", secret: pepper });
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    if (limit.shouldSetCookie) response.headers.append("Set-Cookie", accessDeviceSetCookie(limit.deviceCookie));
    return response;
  };
  if (!limit.allowed) return respond(genericError, 429);

  const auth = createAuth();
  const existingSession = await auth.api.getSession({ headers: request.headers });
  if (existingSession) {
    if (!existingSession.user.isAnonymous || await getMemberContext(request.headers)) {
      return respond({ error: "Cerrá la sesión actual antes de preparar el acceso de otro integrante." }, 409);
    }
    return respond({ ok: true });
  }

  try { await cleanupAbandonedIdentities(pepper); }
  catch { /* Session preparation still works if the bounded cleanup is temporarily unavailable. */ }

  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const signInRequest = new Request(new URL("/api/auth/sign-in/anonymous", request.url), { method: "POST", headers, body: "{}" });
  const response = await auth.handler(signInRequest);
  if (!response.ok) return NextResponse.json(genericError, { status: 503 });
  const result = respond({ ok: true });
  for (const cookie of response.headers.getSetCookie()) result.headers.append("Set-Cookie", cookie);
  return result;
}
