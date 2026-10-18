import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getPool } from "@/db";
import { sportsFeatures } from "./config";
import { SPORTS_UUID } from "./rules";
import { parseRiverLineup } from "./river-lineup-rules";
import { activeSportsActor, privateHeaders, reject, sportsActor, sportsBody, sportsResponseError } from "./request";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function signature(encoded: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) reject(503, "No está configurada la validación de importaciones.");
  return createHmac("sha256", secret).update(`river-lineup:${encoded}`).digest("base64url");
}
function readToken(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 4000) reject(409, "Volvé a validar la formación.");
  const [encoded, signed, ...extra] = raw.split(".");
  if (!encoded || !signed || extra.length) reject(409, "La vista previa no es válida.");
  const a = Buffer.from(signed), b = Buffer.from(signature(encoded));
  if (a.length !== b.length || !timingSafeEqual(a, b)) reject(409, "La vista previa no es válida.");
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString());
    if (!value || !Number.isFinite(value.expires) || value.expires < Date.now()) reject(409, "La vista previa venció. Volvé a validarla.");
    return value;
  } catch { reject(409, "Volvé a validar la formación."); }
}
export async function importRiverLineup(request: Request) {
  if (!sportsFeatures().agenda) return Response.json({ error: "No encontrado." }, { status: 404, headers: privateHeaders });
  try {
    const actor = await sportsActor(request, true), input = await sportsBody(request);
    if (input.mode !== "preview" && input.mode !== "import") reject(400, "Elegí vista previa o confirmación.");
    const bundle = parseRiverLineup(input.bundle);
    if (!bundle) reject(400, "Revisá el partido, el texto (hasta 4.000 caracteres), la fuente HTTPS y la fecha de revisión.");
    const token = input.mode === "import" ? readToken(input.token) : null;
    if (token && (token.familyId !== actor.familyId || token.memberId !== actor.memberId || token.bundleHash !== hash(bundle))) reject(409, "El archivo cambió. Volvé a validarlo.");
    const tx = await getPool().connect();
    try {
      await tx.query("BEGIN");
      await activeSportsActor(tx, actor, true);
      const event = (await tx.query("SELECT id,title,status,updated_at FROM sports_events WHERE family_id=$1 AND id=$2 AND kind='football_match' AND football_category='river' AND hidden=false FOR UPDATE", [actor.familyId, bundle.eventId])).rows[0];
      if (!event) reject(404, "No encontramos ese partido de River en la familia.");
      const before = (await tx.query("SELECT body,source,checked_at AS \"checkedAt\",updated_by_member_id,updated_at FROM sports_river_lineups WHERE family_id=$1 AND event_id=$2", [actor.familyId, bundle.eventId])).rows[0] ?? null;
      const state = hash({ event, before });
      if (token && token.state !== state) reject(409, "Los datos cambiaron. Volvé a validar la formación.");
      const changed = !before || before.body !== bundle.body || before.source !== bundle.source || new Date(before.checkedAt).toISOString() !== bundle.checkedAt;
      const after = { body: bundle.body, source: bundle.source, checkedAt: bundle.checkedAt };
      if (input.mode === "import" && changed) {
        await tx.query("INSERT INTO sports_river_lineups(family_id,event_id,body,source,checked_at,updated_by_member_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id) DO UPDATE SET body=excluded.body,source=excluded.source,checked_at=excluded.checked_at,updated_by_member_id=excluded.updated_by_member_id,updated_at=now()", [actor.familyId,bundle.eventId,bundle.body,bundle.source,bundle.checkedAt,actor.memberId]);
        await tx.query("INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,\"after\") VALUES($1,$2,'sports_river_lineup',$3,'curated_lineup_imported',$4::jsonb)", [actor.familyId,actor.memberId,bundle.eventId,JSON.stringify({ before, after })]);
      }
      await tx.query("COMMIT");
      const payload = Buffer.from(JSON.stringify({ familyId: actor.familyId, memberId: actor.memberId, bundleHash: hash(bundle), state, expires: Date.now()+15*60000 })).toString("base64url");
      return Response.json({ eventId: event.id, title: event.title, before, after, changed, ...(input.mode === "preview" ? { token: `${payload}.${signature(payload)}` } : {}) }, { headers: privateHeaders });
    } catch (e) { await tx.query("ROLLBACK"); throw e; } finally { tx.release(); }
  } catch (e) { return sportsResponseError(e); }
}
export async function riverLineupTemplate(request: Request) {
  if (!sportsFeatures().agenda) return Response.json({error:"No encontrado."},{status:404});
  try {
    const actor = await sportsActor(request, true), id = new URL(request.url).searchParams.get("event");
    if (!id || !SPORTS_UUID.test(id)) reject(400, "Elegí un partido de River.");
    const event = (await getPool().query("SELECT id,title,first_participant,second_participant FROM sports_events WHERE family_id=$1 AND id=$2 AND football_category='river' AND kind='football_match' AND hidden=false",[actor.familyId,id])).rows[0];
    if (!event) reject(404,"No encontramos ese partido de River en la familia.");
    return Response.json({version:1,eventId:id,title:event.title,homeTeam:event.first_participant,awayTeam:event.second_participant,body:"",source:"",checkedAt:new Date().toISOString()}, {headers:privateHeaders});
  } catch(e) { return sportsResponseError(e); }
}
