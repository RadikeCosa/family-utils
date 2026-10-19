import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getPool } from "@/db";
import { sportsFeatures } from "./config";
import { SPORTS_UUID } from "./rules";
import { parseRiverInsights } from "./river-insights-rules";
import { activeSportsActor, privateHeaders, reject, sportsActor, sportsBody, sportsResponseError } from "./request";
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" && !(value instanceof Date) ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function signature(encoded: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) reject(503, "No está configurada la validación de importaciones.");
  return createHmac("sha256", secret).update(`river-insights:${encoded}`).digest("base64url");
}
function readToken(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 4000) reject(409, "Volvé a validar el contenido.");
  const [encoded, signed, ...extra] = raw.split(".");
  if (!encoded || !signed || extra.length) reject(409, "La vista previa no es válida.");
  const a = Buffer.from(signed), b = Buffer.from(signature(encoded));
  if (a.length !== b.length || !timingSafeEqual(a, b)) reject(409, "La vista previa no es válida.");
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString());
    if (!value || !Number.isFinite(value.expires) || value.expires < Date.now()) reject(409, "La vista previa venció. Volvé a validarla.");
    return value;
  } catch { reject(409, "Volvé a validar el contenido."); }
}
export async function importRiverInsights(request: Request) {
  if (!sportsFeatures().agenda) return Response.json({ error: "No encontrado." }, { status: 404, headers: privateHeaders });
  try {
    const actor = await sportsActor(request, true), input = await sportsBody(request);
    if (input.mode !== "preview" && input.mode !== "import") reject(400, "Elegí vista previa o confirmación.");
    const bundle = parseRiverInsights(input.bundle);
    if (!bundle) reject(400, "Revisá el partido, las secciones, sus fuentes HTTPS y las fechas de revisión.");
    const token = input.mode === "import" ? readToken(input.token) : null;
    if (token && (token.familyId !== actor.familyId || token.memberId !== actor.memberId || token.bundleHash !== hash(bundle))) reject(409, "El archivo cambió. Volvé a validarlo.");
    const tx = await getPool().connect();
    try {
      await tx.query("BEGIN");
      await activeSportsActor(tx, actor, true);
      const event = (await tx.query("SELECT id,title,status,updated_at FROM sports_events WHERE family_id=$1 AND id=$2 AND kind='football_match' AND football_category='river' AND hidden=false FOR UPDATE", [actor.familyId, bundle.eventId])).rows[0];
      if (!event) reject(404, "No encontramos ese partido de River en la familia.");
      const previous = (await tx.query("SELECT statistics,curiosities,updated_at FROM sports_river_insights WHERE family_id=$1 AND event_id=$2", [actor.familyId,bundle.eventId])).rows[0] ?? null;
      const before = previous ? {statistics:previous.statistics,curiosities:previous.curiosities} : {statistics:null,curiosities:null};
      const state = hash({event,previous});
      if(token && token.state !== state) reject(409,"Los datos cambiaron. Volvé a validar el contenido.");
      const after = { statistics: bundle.statistics ?? before.statistics, curiosities: bundle.curiosities ?? before.curiosities };
      const changed = hash(before) !== hash(after);
      if(input.mode === "import" && changed) {
        await tx.query("INSERT INTO sports_river_insights(family_id,event_id,statistics,curiosities,updated_by_member_id) VALUES($1,$2,$3::jsonb,$4::jsonb,$5) ON CONFLICT(event_id) DO UPDATE SET statistics=excluded.statistics,curiosities=excluded.curiosities,updated_by_member_id=excluded.updated_by_member_id,updated_at=now()",[actor.familyId,bundle.eventId,JSON.stringify(after.statistics),JSON.stringify(after.curiosities),actor.memberId]);
        await tx.query("INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,\"after\") VALUES($1,$2,'sports_river_insights',$3,'curated_insights_imported',$4::jsonb)",[actor.familyId,actor.memberId,bundle.eventId,JSON.stringify({before,after})]);
      }
      await tx.query("COMMIT");
      const payload = Buffer.from(JSON.stringify({ familyId: actor.familyId, memberId: actor.memberId, bundleHash: hash(bundle), state, expires: Date.now()+15*60000 })).toString("base64url");
      return Response.json({ eventId: event.id, title: event.title, before, after, changed, ...(input.mode === "preview" ? { token: `${payload}.${signature(payload)}` } : {}) }, { headers: privateHeaders });
    } catch (e) { await tx.query("ROLLBACK"); throw e; } finally { tx.release(); }
  } catch (e) { return sportsResponseError(e); }
}
export async function riverInsightsTemplate(request: Request) {
  if (!sportsFeatures().agenda) return Response.json({error:"No encontrado."},{status:404});
  try {
    const actor = await sportsActor(request, true), id = new URL(request.url).searchParams.get("event");
    if (!id || !SPORTS_UUID.test(id)) reject(400, "Elegí un partido de River.");
    const event = (await getPool().query("SELECT id,title,first_participant,second_participant FROM sports_events WHERE family_id=$1 AND id=$2 AND football_category='river' AND kind='football_match' AND hidden=false",[actor.familyId,id])).rows[0];
    if (!event) reject(404,"No encontramos ese partido de River en la familia.");
    return Response.json({version:1,eventId:id,title:event.title,homeTeam:event.first_participant,awayTeam:event.second_participant,statistics:{items:[],source:"",checkedAt:new Date().toISOString()},curiosities:{items:[],source:"",checkedAt:new Date().toISOString()}}, {headers:privateHeaders});
  } catch(e) { return sportsResponseError(e); }
}
