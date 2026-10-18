import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { sportsFeatures } from "./config";
import { activeSportsActor, privateHeaders, reject, sportsActor, sportsBody, sportsResponseError } from "./request";
import { parseUfcOddsBundle } from "./ufc-dashboard-rules";
import { SPORTS_UUID } from "./rules";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function signed(payload: Record<string, unknown>) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) reject(503, "No está configurada la validación de importaciones.");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return encoded + "." + createHmac("sha256", secret).update(encoded).digest("base64url");
}
function verify(token: unknown) {
  if (typeof token !== "string" || token.length > 30000) reject(409, "Volvé a revisar la vista previa.");
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length) reject(409, "La vista previa no es válida.");
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString()); }
  catch { reject(409, "La vista previa no es válida."); }
  const expected = signed(payload).split(".")[1];
  const left = Buffer.from(signature), right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right) || typeof payload.expires !== "number" || payload.expires < Date.now()) reject(409, "La vista previa venció. Volvé a validarla.");
  return payload;
}
async function stateFor(tx: PoolClient, familyId: string, eventId: string) {
  const { rows: [event] } = await tx.query(
    "SELECT id,title,kind,event_date,early_preliminaries_starts_at,preliminary_starts_at,main_card_starts_at,hidden,source_absent_at FROM sports_events WHERE id=$1 AND family_id=$2 FOR UPDATE",
    [eventId,familyId],
  );
  if (!event || event.kind !== "ufc_card" || event.hidden || event.source_absent_at) reject(400, "No encontramos esa cartelera activa en la familia.");
  const { rows: fights } = await tx.query(
    "SELECT id,first_fighter,second_fighter,bout_order FROM sports_fights WHERE family_id=$1 AND event_id=$2 ORDER BY bout_order,id",
    [familyId,eventId],
  );
  const { rows: odds } = await tx.query(
    "SELECT fight_id,first_decimal_odds,second_decimal_odds,bookmaker,source,reference_at FROM sports_ufc_odds WHERE family_id=$1 AND event_id=$2 ORDER BY fight_id FOR UPDATE",
    [familyId,eventId],
  );
  return { event,fights,odds,state: hash({event,fights,odds}) };
}

export async function ufcOddsTemplate(request: Request) {
  if (!sportsFeatures().ufc) return Response.json({ error: "No encontrado." }, { status: 404 });
  try {
    const actor = await sportsActor(request,true);
    const tx = await getPool().connect();
    try {
      await tx.query("BEGIN");
      await activeSportsActor(tx,actor,true);
      const { rows: cards } = await tx.query(
        "SELECT id,title,event_date::text AS event_date,COALESCE(early_preliminaries_starts_at,preliminary_starts_at,main_card_starts_at) AS first_start FROM sports_events WHERE family_id=$1 AND kind='ufc_card' AND hidden=false AND source_absent_at IS NULL ORDER BY event_date DESC LIMIT 20",
        [actor.familyId],
      );
      const events = [];
      for (const card of cards) {
        const { rows: fights } = await tx.query("SELECT id,first_fighter,second_fighter FROM sports_fights WHERE family_id=$1 AND event_id=$2 ORDER BY bout_order,id",[actor.familyId,card.id]);
        const beforeStart = card.first_start ? new Date(new Date(card.first_start).getTime()-60000).getTime() : Date.now()-60000;
        const referenceAt = new Date(Math.min(Date.now()-60000,beforeStart)).toISOString();
        events.push({ eventId: card.id,title: card.title,eventDate: card.event_date,firstStart: card.first_start,
          bookmaker: "Completar casa de apuestas",referenceAt,
          fights: fights.map((fight) => ({ fightId:fight.id,firstFighter:fight.first_fighter,secondFighter:fight.second_fighter,firstOdds:null,secondOdds:null })) });
      }
      await tx.query("COMMIT");
      return Response.json({version:1,status:"template",source:"https://example.com/fuente-verificada",events},{headers:privateHeaders});
    } catch (error) { await tx.query("ROLLBACK"); throw error; }
    finally { tx.release(); }
  } catch (error) { return sportsResponseError(error); }
}

export async function importUfcOdds(request: Request) {
  if (!sportsFeatures().ufc) return Response.json({ error: "No encontrado." }, { status: 404 });
  let tx: PoolClient | undefined;
  try {
    const actor = await sportsActor(request,true);
    const body = await sportsBody(request);
    if (body.mode !== "preview" && body.mode !== "import") reject(400,"Elegí vista previa o confirmación.");
    if (body.bundle && typeof body.bundle === "object" && "status" in body.bundle && body.bundle.status === "template") reject(400,"La plantilla es solo una guía. Completá cuotas y fuente verificables antes de validarla.");
    const bundle = parseUfcOddsBundle(body.bundle);
    if (!bundle) reject(400,"El archivo de cuotas no es válido.");
    if (bundle.events.some((event) => !SPORTS_UUID.test(event.eventId) || event.fights.some((fight) => !SPORTS_UUID.test(fight.fightId)))) reject(400,"El archivo contiene identificadores de pelea o cartelera inválidos.");
    let sourceUrl: URL;
    try { sourceUrl = new URL(bundle.source); } catch { reject(400,"La fuente debe ser una URL verificable."); }
    if (sourceUrl.protocol !== "https:") reject(400,"La fuente debe usar HTTPS.");
    tx = await getPool().connect();
    await tx.query("BEGIN");
    await activeSportsActor(tx,actor,true);
    const preview = body.mode === "import" ? verify(body.token) : null;
    if (preview && (preview.familyId !== actor.familyId || preview.memberId !== actor.memberId || preview.bundleHash !== hash(bundle))) reject(409,"El archivo cambió. Volvé a validarlo.");
    const states: Record<string,string> = {};
    const changes = [];
    for (const entry of bundle.events) {
      const current = await stateFor(tx,actor.familyId,entry.eventId);
      const eventStart = current.event.early_preliminaries_starts_at ?? current.event.preliminary_starts_at ?? current.event.main_card_starts_at;
      if (!eventStart || Date.parse(entry.referenceAt) >= new Date(eventStart).getTime()) reject(400,"La cuota debe tener una fecha anterior al inicio del primer bloque.");
      if (preview && (!preview.states || typeof preview.states !== "object" || (preview.states as Record<string,string>)[entry.eventId] !== current.state)) reject(409,"Las cuotas o la cartelera cambiaron. Volvé a revisar.");
      const fightIds = new Set(current.fights.map((fight: {id:string}) => fight.id));
      if (!entry.fights.length) reject(400,"Incluí al menos una pelea con cuotas.");
      for (const fight of entry.fights) if (!fightIds.has(fight.fightId)) reject(400,"Una pelea no pertenece a la cartelera seleccionada.");
      states[entry.eventId] = current.state;
      changes.push({eventId:entry.eventId,title:current.event.title,bookmaker:entry.bookmaker,referenceAt:entry.referenceAt,fights:entry.fights.length,changed:true});
      if (body.mode === "import") {
        for (const fight of entry.fights) await tx.query(
          "INSERT INTO sports_ufc_odds(family_id,event_id,fight_id,first_decimal_odds,second_decimal_odds,bookmaker,source,reference_at,updated_by_member_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(fight_id) DO UPDATE SET first_decimal_odds=excluded.first_decimal_odds,second_decimal_odds=excluded.second_decimal_odds,bookmaker=excluded.bookmaker,source=excluded.source,reference_at=excluded.reference_at,updated_by_member_id=excluded.updated_by_member_id,updated_at=now()",
          [actor.familyId,entry.eventId,fight.fightId,fight.firstOdds,fight.secondOdds,entry.bookmaker,bundle.source,entry.referenceAt,actor.memberId]);
        await tx.query("INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,\"after\") VALUES($1,$2,'sports_ufc_odds',$3,'curated_odds_imported',$4::jsonb)",
          [actor.familyId,actor.memberId,entry.eventId,JSON.stringify({source:bundle.source,bookmaker:entry.bookmaker,referenceAt:entry.referenceAt,fights:entry.fights})]);
      }
    }
    await tx.query("COMMIT");
    if (body.mode === "preview") return Response.json({events:changes,token:signed({familyId:actor.familyId,memberId:actor.memberId,bundleHash:hash(bundle),states,expires:Date.now()+15*60000})},{headers:privateHeaders});
    return Response.json({imported:changes.length,events:changes},{headers:privateHeaders});
  } catch (error) {
    if (tx) await tx.query("ROLLBACK");
    return sportsResponseError(error);
  } finally { tx?.release(); }
}
