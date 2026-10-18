import { getPool } from "@/db";
import { createAuth } from "@/lib/auth/server";
import { championsEnabled } from "./config";
import { privateHeaders, reject, sportsActor, sportsBody, sportsResponseError } from "./request";

export async function readChampionsSwitch(request: Request) {
  const c = await getPool().connect();
  try {
    const actor = await sportsActor(request, true);
    await c.query("BEGIN");
    const { rows: [row] } = await c.query<{ enabled: boolean }>(
      "SELECT public.sports_champions_enabled($1,true) AS enabled",
      [actor.familyId],
    );
    await c.query("COMMIT");
    return Response.json({ enabled: row?.enabled === true, effective: championsEnabled() && row?.enabled === true }, { headers: privateHeaders });
  } catch (error) {
    await c.query("ROLLBACK");
    const response = sportsResponseError(error);
    for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    return response;
  } finally { c.release(); }
}

export async function writeChampionsSwitch(request: Request) {
  const c = await getPool().connect();
  try {
    await sportsActor(request, true);
    const body = await sportsBody(request);
    if (typeof body.enabled !== "boolean") reject(400, "Indicá si Champions queda habilitado.");
    if (body.enabled && !championsEnabled()) reject(409, "Habilitá primero Deportes, la agenda y SPORTS_CHAMPIONS_ENABLED.");
    await c.query("BEGIN");
    const session = await createAuth().api.getSession({ headers: request.headers });
    if (!session) reject(403, "Ingresá a tu familia.");
    const { rows: [row] } = await c.query<{ enabled: boolean }>(
      "SELECT public.sports_champions_set_enabled($1,$2) AS enabled",
      [session.session.token, body.enabled],
    );
    await c.query("COMMIT");
    return Response.json({ enabled: row.enabled, effective: championsEnabled() && row.enabled }, { headers: privateHeaders });
  } catch (error) {
    await c.query("ROLLBACK");
    const response = sportsResponseError(error);
    for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    return response;
  } finally { c.release(); }
}
