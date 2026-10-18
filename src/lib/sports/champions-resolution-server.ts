import { getPool } from "@/db";
import { activeSportsActor, privateHeaders, reject, sportsActor, sportsBody, sportsResponseError } from "./request";
import { championsEnabled } from "./config";
import { familyChampionsEnabled } from "./champions-switch";
import { SPORTS_UUID } from "./rules";

const officialSource = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && ["uefa.com", "www.uefa.com", "es.uefa.com"].includes(url.hostname);
  } catch { return false; }
};

export async function resolveChampionsSuspension(request: Request, eventId: string) {
  if (!championsEnabled()) return Response.json({ error: "No encontrado." }, { status: 404, headers: privateHeaders });
  if (!SPORTS_UUID.test(eventId)) return Response.json({ error: "No encontramos este partido." }, { status: 404, headers: privateHeaders });
  const c = await getPool().connect();
  try {
    const actor = await sportsActor(request, true);
    await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await activeSportsActor(c, actor, true);
    if (!(await familyChampionsEnabled(c, actor.familyId))) reject(404, "No encontrado.");
    const body = await sportsBody(request);
    const event = (await c.query<{ id:string; round_id:string|null; status:string; title:string; starts_at:Date|null }>(
      "SELECT id,round_id,status,title,starts_at FROM sports_events WHERE id=$1 AND family_id=$2 AND football_category='champions' AND kind='football_match' FOR UPDATE",
      [eventId, actor.familyId],
    )).rows[0];
    if (!event || !event.round_id) reject(404, "No encontramos este partido.");
    if (event.status !== "suspended") reject(409, "Solo se pueden resolver partidos suspendidos.");
    await c.query("SELECT public.sports_football_materialize_close($1,$2,$3,$4)", [actor.familyId,eventId,event.starts_at,event.status]);
    const existing = (await c.query("SELECT event_id FROM sports_football_resolutions WHERE event_id=$1 AND family_id=$2", [eventId, actor.familyId])).rowCount;
    if (existing) reject(409, "Este partido ya tiene una resolución administrativa.");

    const now = (await c.query<{ now:Date }>("SELECT clock_timestamp() AS now")).rows[0].now;
    let kind: "official_result" | "void_for_prode";
    let after: Record<string, unknown>;
    if (body.action === "official_result") {
      if (["partial", "extraTime", "penalties", "aggregate"].some(key => key in body))
        reject(400, "Solo se admite un resultado definitivo a los 90 minutos; no se admiten marcadores parciales, alargue ni penales.");
      if (typeof body.homeGoals !== "number" || typeof body.awayGoals !== "number" || !Number.isInteger(body.homeGoals) || !Number.isInteger(body.awayGoals) || body.homeGoals < 0 || body.homeGoals > 99 || body.awayGoals < 0 || body.awayGoals > 99)
        reject(400, "Indicá el resultado definitivo a los 90 minutos; no se admiten marcadores parciales.");
      if (!officialSource(body.source) || typeof body.checkedAt !== "string" || !Number.isFinite(Date.parse(body.checkedAt)) || Date.parse(body.checkedAt) > now.getTime() + 600000 || Date.parse(body.checkedAt) < now.getTime() - 30 * 86400000)
        reject(400, "Indicá una fuente oficial UEFA y la fecha de verificación.");
      kind = "official_result";
      await c.query("INSERT INTO sports_football_results(event_id,family_id,home_goals,away_goals,source,checked_at,updated_by_member_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [eventId, actor.familyId, body.homeGoals, body.awayGoals, body.source, body.checkedAt, actor.memberId]);
      await c.query("UPDATE sports_events SET status='completed',updated_at=clock_timestamp(),updated_by_member_id=$2 WHERE id=$1", [eventId, actor.memberId]);
      await c.query("INSERT INTO sports_football_resolutions(event_id,family_id,kind,source,actor_member_id) VALUES($1,$2,'official_result',$3,$4)", [eventId, actor.familyId, body.source, actor.memberId]);
      after = { kind, homeGoals: body.homeGoals, awayGoals: body.awayGoals, source: body.source, checkedAt: body.checkedAt, period: "90_minutes" };
    } else if (body.action === "void_for_prode") {
      if (typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 500)
        reject(400, "Indicá el motivo de anulación para el prode (5 a 500 caracteres).");
      kind = "void_for_prode";
      await c.query("INSERT INTO sports_football_resolutions(event_id,family_id,kind,reason,actor_member_id) VALUES($1,$2,'void_for_prode',$3,$4)",
        [eventId, actor.familyId, body.reason.trim(), actor.memberId]);
      after = { kind, reason: body.reason.trim(), sportingStatus: "suspended" };
    } else reject(400, "Elegí un resultado oficial o una anulación para el prode.");

    await c.query(`INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after")
      VALUES($1,$2,'sports_champions_resolution',$3,$4,$5::jsonb)`, [actor.familyId, actor.memberId, eventId, kind, JSON.stringify(after)]);
    await c.query("COMMIT");
    return Response.json({ resolved: true, changed: true, eventId, kind }, { headers: privateHeaders });
  } catch (error) {
    await c.query("ROLLBACK");
    if (error && typeof error === "object" && "code" in error && ["23505", "40001", "40P01"].includes(String(error.code)))
      return Response.json({ error: "El partido cambió mientras se resolvía. Actualizá la jornada y revisá su estado." }, { status: 409, headers: privateHeaders });
    const response = sportsResponseError(error);
    for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    return response;
  } finally { c.release(); }
}
