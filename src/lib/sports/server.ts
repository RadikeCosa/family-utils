import { and, eq, gte, isNull, lt, or, asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getDb, getPool } from "@/db";
import { members, sportsComments, sportsEvents, sportsFights } from "@/db/schema";
import { getMemberContext, type MemberContext } from "@/lib/auth/context";
import { sportsEnabled, sportsNowDay, sportsTodayInterval, footballEventInput, ufcCardInput, commentInput, isSportsContext, isSportsDate, SPORTS_UUID, isRiverMatch } from "./rules";

class SportsError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new SportsError(status, code, message); }
function errorResponse(error: unknown) {
  if (error instanceof SportsError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error("sports_request_failed", { code: error && typeof error === "object" && "code" in error ? error.code : "unknown" });
  return NextResponse.json({ error: "No se pudo completar. Conservamos los datos escritos.", code: "UNAVAILABLE" }, { status: 500 });
}
export function sportsUnavailable() { return NextResponse.json({ error: "No encontrado.", code: "NOT_FOUND" }, { status: 404 }); }

async function activeActor(tx: PoolClient, actor: MemberContext) {
  const { rows: [member] } = await tx.query("SELECT m.id, m.role FROM members m JOIN member_devices d ON d.member_id=m.id WHERE m.id=$1 AND m.family_id=$2 AND d.auth_user_id=$3 AND m.archived_at IS NULL AND d.revoked_at IS NULL", [actor.memberId, actor.familyId, actor.authUser.id]);
  if (!member) fail(403, "NO_ACCESS", "Tu acceso a la familia ya no está disponible.");
  return member as { id: string; role: "administrator" | "member" };
}
async function requireActor(headers: Headers) {
  const actor = await getMemberContext(headers);
  if (!actor) fail(403, "NO_ACCESS", "Ingresá a tu familia.");
  return actor;
}
function requireAdmin(member: { role: string }) {
  if (member.role !== "administrator") fail(403, "NO_ACCESS", "Solo un administrador puede administrar Deportes.");
}
async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Return the same input error for malformed JSON. */ }
  fail(400, "INVALID", "Revisá los datos ingresados.");
}
function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) fail(403, "NO_ACCESS", "Origen no permitido.");
}
async function record(tx: PoolClient, actor: MemberContext, entityType: string, entityId: string, action: string, metadata: unknown) {
  await tx.query('INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after") VALUES($1,$2,$3,$4,$5,$6::jsonb)', [actor.familyId, actor.memberId, entityType, entityId, action, JSON.stringify(metadata)]);
}

export async function readSportsPage(request: Request) {
  if (!sportsEnabled()) return sportsUnavailable();
  try {
    const actor = await requireActor(request.headers);
    return NextResponse.json(await loadSportsData(actor), { headers: { "Cache-Control": "no-store", Vary: "Cookie" } });
  } catch (error) { return errorResponse(error); }
}

export async function loadSportsData(actor: MemberContext) {
    const day = sportsNowDay();
    const interval = sportsTodayInterval(day);
    const db = getDb();
    const football = await db.select().from(sportsEvents).where(and(
      eq(sportsEvents.familyId, actor.familyId),
      eq(sportsEvents.kind, "football_match"),
      or(eq(sportsEvents.eventDate, day), and(gte(sportsEvents.startsAt, interval.startsAt), lt(sportsEvents.startsAt, interval.endsAt))),
    )).orderBy(asc(sportsEvents.startsAt), asc(sportsEvents.title));
    const [card] = await db.select().from(sportsEvents).where(and(eq(sportsEvents.familyId, actor.familyId), eq(sportsEvents.kind, "ufc_card"), eq(sportsEvents.isCurrent, true))).limit(1);
    const fights = card ? await db.select().from(sportsFights).where(and(eq(sportsFights.familyId, actor.familyId), eq(sportsFights.eventId, card.id))).orderBy(asc(sportsFights.boutOrder)) : [];
    const familyMembers = await db.select({ id:members.id, name:members.name }).from(members).where(and(eq(members.familyId,actor.familyId),isNull(members.archivedAt))).orderBy(asc(members.createdAt));
    const riverIds = football.filter((event) => isRiverMatch(event.firstParticipant, event.secondParticipant)).map((event) => event.id);
    const priorRiverThreads = riverIds.length ? await db.select({ eventId: sportsComments.contextEventId, contextDate: sportsComments.contextDate })
      .from(sportsComments).where(and(eq(sportsComments.familyId, actor.familyId), eq(sportsComments.contextKind, "river_match"), isNull(sportsComments.retiredAt), or(...riverIds.map((id) => eq(sportsComments.contextEventId, id))))) : [];
    const riverThreadDates = Object.fromEntries(riverIds.map((id) => {
      const dates = [...new Set(priorRiverThreads.filter((entry) => entry.eventId === id).map((entry) => entry.contextDate!).filter(Boolean))].sort();
      return [id, dates[0] ?? football.find((event) => event.id === id)!.eventDate];
    }));
    const priorDates = Object.fromEntries(riverIds.map((id) => [id, [...new Set(priorRiverThreads.filter((entry) => entry.eventId === id && entry.contextDate !== riverThreadDates[id]).map((entry) => entry.contextDate!).filter(Boolean))].sort().reverse()]));
    return { familyId: actor.familyId, currentMemberId: actor.memberId, role: actor.role, day, football, card: card ?? null, fights, members:familyMembers, riverThreadDates, priorRiverThreadDates: priorDates };
}

export async function createSportsEvent(request: Request) {
  if (!sportsEnabled()) return sportsUnavailable();
  let tx: PoolClient | undefined;
  try {
    checkOrigin(request);
    const actor = await requireActor(request.headers);
    const body = await parseBody(request);
    tx = await getPool().connect(); await tx.query("BEGIN");
    const member = await activeActor(tx, actor); requireAdmin(member);
    if (body.kind === "football_match") {
      const input = footballEventInput(body);
      if (!input) fail(400, "INVALID", "Completá equipos, competencia y una fecha válida. La hora y el canal son opcionales.");
      const { rows: [event] } = await tx.query("INSERT INTO sports_events(family_id,kind,title,competition,first_participant,second_participant,event_date,starts_at,channel,status,result,manually_edited,created_by_member_id,updated_by_member_id) VALUES($1,'football_match',$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$11) RETURNING id", [actor.familyId,input.title,input.competition,input.firstParticipant,input.secondParticipant,input.eventDate,input.startsAt,input.channel,input.status,input.result,actor.memberId]);
      await record(tx,actor,"sports_event",event.id,"created",input);
      await tx.query("COMMIT"); return NextResponse.json({ id: event.id }, { status: 201 });
    }
    if (body.kind === "ufc_card") {
      const input = ufcCardInput(body);
      if (!input) fail(400, "INVALID", "Completá el evento y al menos una pelea; elegí exactamente una estelar.");
      const { rows: [previous] } = await tx.query("SELECT id FROM sports_events WHERE family_id=$1 AND kind='ufc_card' AND is_current=true FOR UPDATE", [actor.familyId]);
      if (previous) {
        await tx.query("UPDATE sports_events SET is_current=false,card_status='finalized',updated_by_member_id=$1,updated_at=now() WHERE id=$2", [actor.memberId,previous.id]);
        await record(tx,actor,"sports_event",previous.id,"finalized",{ reason:"new_card_published" });
      }
      const { rows: [event] } = await tx.query("INSERT INTO sports_events(family_id,kind,title,event_date,preliminary_starts_at,main_card_starts_at,card_status,is_current,manually_edited,prediction_close_mode,created_by_member_id,updated_by_member_id) VALUES($1,'ufc_card',$2,$3,$4,$5,'upcoming',true,true,NULL,$6,$6) RETURNING id", [actor.familyId,input.title,input.eventDate,input.preliminaryStartsAt,input.mainCardStartsAt,actor.memberId]);
      for (const fight of input.fights) await tx.query("INSERT INTO sports_fights(family_id,event_id,bout_order,first_fighter,second_fighter,bout_block,is_main_event) VALUES($1,$2,$3,$4,$5,$6,$7)", [actor.familyId,event.id,fight.boutOrder,fight.firstFighter,fight.secondFighter,fight.boutBlock,fight.isMainEvent]);
      await record(tx,actor,"sports_event",event.id,"created",{ ...input, fights: input.fights });
      await tx.query("COMMIT"); return NextResponse.json({ id:event.id },{ status:201 });
    }
    fail(400,"INVALID","Tipo de evento inválido.");
  } catch (error) { if (tx) await tx.query("ROLLBACK"); return errorResponse(error); }
  finally { tx?.release(); }
}

export async function updateSportsEvent(request: Request, eventId: string) {
  if (!sportsEnabled()) return sportsUnavailable();
  let tx: PoolClient | undefined;
  try {
    checkOrigin(request);
    const actor = await requireActor(request.headers);
    if (!SPORTS_UUID.test(eventId)) fail(400,"INVALID","Identificador inválido.");
    const body = await parseBody(request);
    tx = await getPool().connect(); await tx.query("BEGIN");
    const member = await activeActor(tx,actor); requireAdmin(member);
    const { rows: [current] } = await tx.query("SELECT * FROM sports_events WHERE id=$1 AND family_id=$2 FOR UPDATE", [eventId,actor.familyId]);
    if (!current) fail(404,"NOT_FOUND","No encontramos este evento.");
    if (current.kind === "football_match") {
      const input = footballEventInput(body);
      if (!input) fail(400,"INVALID","Completá equipos, competencia y una fecha válida.");
      await tx.query("UPDATE sports_events SET title=$1,competition=$2,first_participant=$3,second_participant=$4,event_date=$5,starts_at=$6,channel=$7,status=$8,result=$9,manually_edited=true,updated_by_member_id=$10,updated_at=now() WHERE id=$11 AND family_id=$12", [input.title,input.competition,input.firstParticipant,input.secondParticipant,input.eventDate,input.startsAt,input.channel,input.status,input.result,actor.memberId,eventId,actor.familyId]);
      await record(tx,actor,"sports_event",eventId,"edited",input);
    } else {
      if (!current.is_current) fail(409,"FINALIZED","La cartelera ya finalizó; publicá otra para reemplazarla.");
      const input = ufcCardInput(body);
      if (!input) fail(400,"INVALID","Completá el evento y al menos una pelea; elegí exactamente una estelar.");
      await tx.query("UPDATE sports_events SET title=$1,event_date=$2,preliminary_starts_at=$3,main_card_starts_at=$4,manually_edited=true,updated_by_member_id=$5,updated_at=now() WHERE id=$6 AND family_id=$7", [input.title,input.eventDate,input.preliminaryStartsAt,input.mainCardStartsAt,actor.memberId,eventId,actor.familyId]);
      await tx.query("DELETE FROM sports_fights WHERE event_id=$1 AND family_id=$2", [eventId,actor.familyId]);
      for (const fight of input.fights) await tx.query("INSERT INTO sports_fights(family_id,event_id,bout_order,first_fighter,second_fighter,bout_block,is_main_event) VALUES($1,$2,$3,$4,$5,$6,$7)", [actor.familyId,eventId,fight.boutOrder,fight.firstFighter,fight.secondFighter,fight.boutBlock,fight.isMainEvent]);
      await record(tx,actor,"sports_event",eventId,"edited",{ ...input, fights: input.fights });
    }
    await tx.query("COMMIT"); return NextResponse.json({ id:eventId });
  } catch (error) { if (tx) await tx.query("ROLLBACK"); return errorResponse(error); }
  finally { tx?.release(); }
}

export async function readSportsComments(request: Request) {
  if (!sportsEnabled()) return sportsUnavailable();
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const contextKind = url.searchParams.get("contextKind");
    const contextDate = url.searchParams.get("contextDate");
    const eventId = url.searchParams.get("eventId");
    if (!isSportsContext(contextKind) || (contextKind === "football_day" && !isSportsDate(contextDate)) || (contextKind === "river_match" && (!isSportsDate(contextDate) || !eventId || !SPORTS_UUID.test(eventId))) || (contextKind === "ufc_card" && (!eventId || !SPORTS_UUID.test(eventId)))) fail(400,"INVALID","Conversación inválida.");
    const base = [eq(sportsComments.familyId,actor.familyId),eq(sportsComments.contextKind,contextKind),isNull(sportsComments.retiredAt)];
    if (contextDate) base.push(eq(sportsComments.contextDate,contextDate));
    else base.push(isNull(sportsComments.contextDate));
    if (eventId) base.push(eq(sportsComments.contextEventId,eventId));
    else base.push(isNull(sportsComments.contextEventId));
    const comments = await getDb().select({ id:sportsComments.id,authorMemberId:sportsComments.authorMemberId,body:sportsComments.body,version:sportsComments.version,createdAt:sportsComments.createdAt,updatedAt:sportsComments.updatedAt }).from(sportsComments).where(and(...base)).orderBy(asc(sportsComments.createdAt));
    const priorDates = contextKind === "river_match" ? await getDb().selectDistinct({ contextDate:sportsComments.contextDate }).from(sportsComments).where(and(eq(sportsComments.familyId,actor.familyId),eq(sportsComments.contextKind,"river_match"),eq(sportsComments.contextEventId,eventId!),isNull(sportsComments.retiredAt))) : [];
    return NextResponse.json({ comments, priorDates: priorDates.map((entry) => entry.contextDate).filter((day): day is string => !!day && day !== contextDate).sort().reverse() },{ headers:{ "Cache-Control":"no-store", Vary:"Cookie" } });
  } catch (error) { return errorResponse(error); }
}

export async function mutateSportsComment(request: Request, commentId?: string) {
  if (!sportsEnabled()) return sportsUnavailable();
  let tx: PoolClient | undefined;
  try {
    checkOrigin(request);
    const actor = await requireActor(request.headers);
    if (commentId && !SPORTS_UUID.test(commentId)) fail(400,"INVALID","Identificador inválido.");
    const body = await parseBody(request);
    tx = await getPool().connect(); await tx.query("BEGIN");
    const member = await activeActor(tx,actor);
    if (!commentId) {
      const text = commentInput(body.body);
      const contextKind = body.contextKind;
      const contextDate = typeof body.contextDate === "string" ? body.contextDate : null;
      const contextEventId = typeof body.contextEventId === "string" ? body.contextEventId : null;
      if (!text || !isSportsContext(typeof contextKind === "string" ? contextKind : null)) fail(400,"INVALID","Escribí un comentario de hasta 2.000 caracteres.");
      if (contextKind === "football_day" && (!isSportsDate(contextDate) || contextEventId !== null)) fail(400,"INVALID","Conversación inválida.");
      if (contextKind === "river_match" && (!isSportsDate(contextDate) || !contextEventId || !SPORTS_UUID.test(contextEventId))) fail(400,"INVALID","Conversación inválida.");
      if (contextKind === "ufc_card" && (contextDate !== null || !contextEventId || !SPORTS_UUID.test(contextEventId))) fail(400,"INVALID","Conversación inválida.");
      if (contextKind !== "football_day") {
        const { rows:[event] } = await tx.query("SELECT id,first_participant,second_participant FROM sports_events WHERE id=$1 AND family_id=$2 AND kind=$3" , [contextEventId,actor.familyId,contextKind === "ufc_card" ? "ufc_card" : "football_match"]);
        if (!event) fail(404,"NOT_FOUND","No encontramos este evento.");
        if (contextKind === "river_match" && !isRiverMatch(event.first_participant,event.second_participant)) fail(400,"INVALID","La conversación por partido es solo para River.");
        if (contextKind === "ufc_card") {
          const { rows:[card] } = await tx.query("SELECT id FROM sports_events WHERE id=$1 AND family_id=$2 AND is_current=true AND card_status='upcoming'",[contextEventId,actor.familyId]);
          if (!card) fail(404,"NOT_FOUND","No encontramos esta cartelera vigente.");
        }
      }
      const { rows:[comment] } = await tx.query("INSERT INTO sports_comments(family_id,author_member_id,context_kind,context_event_id,context_date,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version", [actor.familyId,actor.memberId,contextKind,contextEventId,contextDate,text]);
      await record(tx,actor,"sports_comment",comment.id,"created",{ contextKind,contextEventId,contextDate });
      await tx.query("COMMIT"); return NextResponse.json({ id:comment.id,version:comment.version },{ status:201 });
    }
    const { rows:[previous] } = await tx.query("SELECT * FROM sports_comments WHERE id=$1 AND family_id=$2 AND retired_at IS NULL FOR UPDATE",[commentId,actor.familyId]);
    if (!previous) fail(404,"NOT_FOUND","No encontramos este comentario.");
    const action = body.action;
    if (action === "retire") {
      if (previous.author_member_id !== actor.memberId && member.role !== "administrator") fail(403,"NO_ACCESS","Solo el autor o un administrador puede retirar este comentario.");
      if (body.expectedVersion !== previous.version) fail(409,"CONFLICT","El comentario cambió. Actualizá antes de volver a intentarlo.");
      await tx.query("UPDATE sports_comments SET retired_at=now(),retired_by_member_id=$1,version=version+1,updated_at=now() WHERE id=$2 AND family_id=$3",[actor.memberId,commentId,actor.familyId]);
      await record(tx,actor,"sports_comment",commentId,"retired",{ contextKind:previous.context_kind });
      await tx.query("COMMIT"); return NextResponse.json({ id:commentId,retired:true });
    }
    if (action !== "edit" || previous.author_member_id !== actor.memberId) fail(403,"NO_ACCESS","Solo podés editar tus propios comentarios.");
    if (body.expectedVersion !== previous.version) fail(409,"CONFLICT","El comentario cambió. Actualizá antes de volver a intentarlo.");
    const text = commentInput(body.body);
    if (!text) fail(400,"INVALID","Escribí un comentario de hasta 2.000 caracteres.");
    await tx.query("UPDATE sports_comments SET body=$1,version=version+1,updated_at=now() WHERE id=$2 AND family_id=$3",[text,commentId,actor.familyId]);
    await record(tx,actor,"sports_comment",commentId,"edited",{ contextKind:previous.context_kind });
    await tx.query("COMMIT"); return NextResponse.json({ id:commentId,version:previous.version+1 });
  } catch (error) { if (tx) await tx.query("ROLLBACK"); return errorResponse(error); }
  finally { tx?.release(); }
}
