import { sportsFeatures } from "./config";
import { and, eq, gte, isNull, or, asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getDb, getPool } from "@/db";
import { members, sportsComments, sportsEvents, sportsFights, sportsFormations, sportsWeeks } from "@/db/schema";
import { getMemberContext, type MemberContext } from "@/lib/auth/context";
import { sportsEnabled, sportsNowDay, sportsWeek, selectRiverEvent, selectUfcEvent, formationInput, footballEventInput, ufcCardInput, commentInput, isSportsContext, isSportsDate, SPORTS_UUID, isRiverMatch } from "./rules";

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
    return NextResponse.json(await loadSportsData(actor, new URL(request.url).searchParams.get("event")), { headers: { "Cache-Control": "no-store", Vary: "Cookie" } });
  } catch (error) { return errorResponse(error); }
}

export async function loadSportsData(
  actor: MemberContext,
  selectedId: string | null = null,
) {
  const features = sportsFeatures();
  const now = new Date();
  const day = sportsNowDay(now);
  const week = sportsWeek(now);
  const db = getDb();
  const [events, familyMembers, weeks] = await Promise.all([
    db
      .select()
      .from(sportsEvents)
      .where(
        and(
          eq(sportsEvents.familyId, actor.familyId),
          eq(sportsEvents.hidden, false),
          ...(features.agenda ? [] : [isNull(sportsEvents.sourceAbsentAt)]),
          ...(features.agenda
            ? []
            : [
                or(
                  isNull(sportsEvents.eventDate),
                  gte(sportsEvents.eventDate, week.start),
                ),
              ]),
        ),
      ),
    db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(
        and(eq(members.familyId, actor.familyId), isNull(members.archivedAt)),
      )
      .orderBy(asc(members.createdAt)),
    db
      .select()
      .from(sportsWeeks)
      .where(
        and(
          eq(sportsWeeks.familyId, actor.familyId),
          eq(sportsWeeks.weekStart, week.start),
        ),
      ),
  ]);
  const noUfcEvent = weeks[0]?.noUfcEvent ?? false;
  const ordered = [...events].sort(
    (a, b) =>
      (a.eventDate ?? "9999").localeCompare(b.eventDate ?? "9999") ||
      a.id.localeCompare(b.id),
  );
  const availableCards = ordered.filter(
    (event) =>
      event.kind === "ufc_card" &&
      !(
        noUfcEvent &&
        event.eventDate! >= week.start &&
        event.eventDate! <= week.end
      ),
  );
  const availableRiver = ordered.filter(
    (event) =>
      event.kind === "football_match" &&
      isRiverMatch(event.firstParticipant, event.secondParticipant),
  );
  const upcoming = (event: (typeof events)[number]) =>
    !event.sourceAbsentAt &&
    event.status !== "completed" &&
    event.status !== "cancelled" &&
    (!event.eventDate || event.eventDate >= day);
  const selected = features.agenda
    ? [...availableRiver, ...availableCards].find(
        (event) => event.id === selectedId,
      )
    : null;
  const river =
    selected?.kind === "football_match"
      ? selected
      : features.agenda
        ? (availableRiver.find(upcoming) ?? availableRiver.at(-1) ?? null)
        : selectRiverEvent(
            events.filter((event) => event.kind === "football_match"),
            now,
          );
  const card =
    selected?.kind === "ufc_card"
      ? selected
      : features.agenda
        ? (availableCards.find(upcoming) ?? availableCards.at(-1) ?? null)
        : noUfcEvent
          ? null
          : selectUfcEvent(
              events.filter((event) => event.kind === "ufc_card"),
              now,
            );
  const [fights, formations] = await Promise.all([
    card
      ? db
          .select({
            id: sportsFights.id,
            familyId: sportsFights.familyId,
            eventId: sportsFights.eventId,
            boutOrder: sportsFights.boutOrder,
            firstFighter: sportsFights.firstFighter,
            secondFighter: sportsFights.secondFighter,
            boutBlock: sportsFights.boutBlock,
            isMainEvent: sportsFights.isMainEvent,
            result: sportsFights.result,
            externalReference: sportsFights.externalReference,
          })
          .from(sportsFights)
          .where(
            and(
              eq(sportsFights.familyId, actor.familyId),
              eq(sportsFights.eventId, card.id),
              isNull(sportsFights.removedAt),
            ),
          )
          .orderBy(asc(sportsFights.boutOrder))
      : [],
    river
      ? db
          .select({
            id: sportsFormations.id,
            memberId: sportsFormations.memberId,
            eventId: sportsFormations.eventId,
            body: sportsFormations.body,
            updatedAt: sportsFormations.updatedAt,
          })
          .from(sportsFormations)
          .where(
            and(
              eq(sportsFormations.familyId, actor.familyId),
              eq(sportsFormations.eventId, river.id),
            ),
          )
          .orderBy(asc(sportsFormations.updatedAt))
      : [],
  ]);
  return {
    familyId: actor.familyId,
    currentMemberId: actor.memberId,
    role: actor.role,
    day,
    week,
    noUfcEvent,
    football: river ? [river] : [],
    card,
    fights,
    formations,
    members: familyMembers,
    riverThreadDates: {},
    priorRiverThreadDates: {},
    features,
    ...(features.agenda
      ? { agenda: events, selectedEventId: selected?.id ?? null }
      : {}),
  };
}

async function clearNoUfcEvent(tx: PoolClient, actor: MemberContext, eventDate: string) {
  const week = sportsWeek(new Date(`${eventDate}T12:00:00Z`));
  await tx.query("UPDATE sports_weeks SET no_ufc_event=false,updated_by_member_id=$1,updated_at=now() WHERE family_id=$2 AND week_start=$3", [actor.memberId, actor.familyId, week.start]);
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
      if (!input) fail(400, "INVALID", "Completá los equipos y el torneo. La fecha, hora y cancha pueden quedar a confirmar.");
      const { rows: [event] } = await tx.query("INSERT INTO sports_events(family_id,kind,title,competition,first_participant,second_participant,event_date,starts_at,channel,status,result,manually_edited,created_by_member_id,updated_by_member_id) VALUES($1,'football_match',$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$11) RETURNING id", [actor.familyId,input.title,input.competition,input.firstParticipant,input.secondParticipant,input.eventDate,input.startsAt,input.channel,input.status,input.result,actor.memberId]);
      await tx.query("UPDATE sports_events SET venue=$1 WHERE id=$2 AND family_id=$3", [input.venue, event.id, actor.familyId]);
      await record(tx,actor,"sports_event",event.id,"created",input);
      await tx.query("COMMIT"); return NextResponse.json({ id: event.id }, { status: 201 });
    }
    if (body.kind === "ufc_card") {
      const input = ufcCardInput(body);
      if (!input) fail(400, "INVALID", "Completá el evento y al menos una pelea; elegí exactamente una estelar.");
      await clearNoUfcEvent(tx, actor, input.eventDate);
      const { rows: [event] } = await tx.query("INSERT INTO sports_events(family_id,kind,title,event_date,early_preliminaries_starts_at,preliminary_starts_at,main_card_starts_at,card_status,is_current,manually_edited,prediction_close_mode,created_by_member_id,updated_by_member_id) VALUES($1,'ufc_card',$2,$3,$4,$5,$6,'upcoming',true,true,NULL,$7,$7) RETURNING id", [actor.familyId,input.title,input.eventDate,input.earlyPreliminariesStartsAt,input.preliminaryStartsAt,input.mainCardStartsAt,actor.memberId]);
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
    if (body.action === "reset_field") {
      const fieldMap:Record<string,{column:string;key:string}>={title:{column:"title",key:"title"},competition:{column:"competition",key:"competition"},firstParticipant:{column:"first_participant",key:"firstParticipant"},secondParticipant:{column:"second_participant",key:"secondParticipant"},eventDate:{column:"event_date",key:"eventDate"},startsAt:{column:"starts_at",key:"startsAt"},venue:{column:"venue",key:"venue"},channel:{column:"channel",key:"channel"},status:{column:"status",key:"status"},result:{column:"result",key:"result"},earlyPreliminariesStartsAt:{column:"early_preliminaries_starts_at",key:"earlyPreliminariesStartsAt"},preliminaryStartsAt:{column:"preliminary_starts_at",key:"preliminaryStartsAt"},mainCardStartsAt:{column:"main_card_starts_at",key:"mainCardStartsAt"}};
      const field=typeof body.field==="string"?fieldMap[body.field]:undefined;const automatic=current.automatic_data??{};if(!field||automatic[field.key]===undefined)fail(400,"INVALID","No se puede recuperar el dato automático.");
      const overrides=(current.manual_overrides??[]).filter((key:string)=>key!==field.key);await tx.query(`UPDATE sports_events SET ${field.column}=$1,manual_overrides=$2,manually_edited=$3,updated_by_member_id=$4,updated_at=now() WHERE id=$5 AND family_id=$6`,[automatic[field.key],JSON.stringify(overrides),overrides.length>0||current.manual_fights,actor.memberId,eventId,actor.familyId]);await record(tx,actor,"sports_event",eventId,"reset_automatic_field",{field:field.key});await tx.query("COMMIT");return NextResponse.json({id:eventId,field:field.key});
    }
    if(body.action==="reset_fights"){
      if(current.kind!=="ufc_card"||!Array.isArray(current.automatic_fights))fail(400,"INVALID","No hay una cartelera automática para recuperar.");
      const input=ufcCardInput({title:current.title,eventDate:current.event_date,fights:current.automatic_fights});if(!input)fail(409,"CONFLICT","La cartelera automática guardada ya no es válida.");
      await tx.query("DELETE FROM sports_fights WHERE event_id=$1 AND family_id=$2",[eventId,actor.familyId]);for(const fight of input.fights)await tx.query("INSERT INTO sports_fights(family_id,event_id,bout_order,first_fighter,second_fighter,bout_block,is_main_event) VALUES($1,$2,$3,$4,$5,$6,$7)",[actor.familyId,eventId,fight.boutOrder,fight.firstFighter,fight.secondFighter,fight.boutBlock,fight.isMainEvent]);
      const overrides=current.manual_overrides??[];await tx.query("UPDATE sports_events SET manual_fights=false,manually_edited=$1,updated_by_member_id=$2,updated_at=now() WHERE id=$3 AND family_id=$4",[overrides.length>0,actor.memberId,eventId,actor.familyId]);await record(tx,actor,"sports_event",eventId,"reset_automatic_fights",{});await tx.query("COMMIT");return NextResponse.json({id:eventId,fightsReset:true});
    }
    if (body.action === "hide") {
      await tx.query("UPDATE sports_events SET hidden=true,manually_edited=true,updated_by_member_id=$1,updated_at=now() WHERE id=$2 AND family_id=$3", [actor.memberId,eventId,actor.familyId]);
      await record(tx,actor,"sports_event",eventId,"hidden",{});
      await tx.query("COMMIT");
      return NextResponse.json({ id: eventId, hidden: true });
    }
    const protectedTables = (
      await tx.query(
        "SELECT to_regclass('public.sports_predictions') IS NOT NULL AS ufc,to_regclass('public.sports_football_results') IS NOT NULL AS football",
      )
    ).rows[0];
    const hasUfcData =
      current.kind === "ufc_card" &&
      protectedTables.ufc &&
      (
        await tx.query(
          "SELECT 1 WHERE EXISTS(SELECT 1 FROM sports_predictions WHERE event_id=$1 AND family_id=$2) OR EXISTS(SELECT 1 FROM sports_fight_results WHERE event_id=$1 AND family_id=$2) OR EXISTS(SELECT 1 FROM sports_block_closures WHERE event_id=$1 AND family_id=$2)",
          [eventId, actor.familyId],
        )
      ).rowCount! > 0;
    const hasFootballData =
      current.kind === "football_match" &&
      protectedTables.football &&
      (
        await tx.query(
          "SELECT 1 FROM sports_football_results WHERE event_id=$1 AND family_id=$2",
          [eventId, actor.familyId],
        )
      ).rowCount! > 0;
    if (
      (sportsFeatures().ufc && current.kind === "ufc_card") ||
      hasUfcData ||
      hasFootballData
    )
      fail(
        409,
        "CONFLICT",
        "Actualizá este evento mediante el importador curado; sus resultados y cierres están protegidos.",
      );
    if (current.kind === "football_match") {
      const input = footballEventInput(body);
      if (!input) fail(400,"INVALID","Completá los equipos y el torneo; revisá la fecha y el horario si los ingresaste.");
      const values:Record<string,unknown>={title:input.title,competition:input.competition,firstParticipant:input.firstParticipant,secondParticipant:input.secondParticipant,eventDate:input.eventDate,startsAt:input.startsAt?.toISOString()??null,channel:input.channel,status:input.status,result:input.result,venue:input.venue};const previous=current.automatic_data??{};const overrides=Object.keys(values).filter(key=>previous[key]!==undefined&&String(previous[key]??"")!==String(values[key]??""));
      await tx.query("UPDATE sports_events SET title=$1,competition=$2,first_participant=$3,second_participant=$4,event_date=$5,starts_at=$6,channel=$7,status=$8,result=$9,venue=$10,manual_overrides=$11,manually_edited=$12,updated_by_member_id=$13,updated_at=now() WHERE id=$14 AND family_id=$15", [input.title,input.competition,input.firstParticipant,input.secondParticipant,input.eventDate,input.startsAt,input.channel,input.status,input.result,input.venue,JSON.stringify(overrides),overrides.length>0||!current.source_provider,actor.memberId,eventId,actor.familyId]);
      await record(tx,actor,"sports_event",eventId,"edited",input);
    } else {

      const input = ufcCardInput(body);
      if (!input) fail(400,"INVALID","Completá el evento y al menos una pelea; elegí exactamente una estelar.");
      await clearNoUfcEvent(tx, actor, input.eventDate);
      const values:Record<string,unknown>={title:input.title,eventDate:input.eventDate,earlyPreliminariesStartsAt:input.earlyPreliminariesStartsAt?.toISOString()??null,preliminaryStartsAt:input.preliminaryStartsAt?.toISOString()??null,mainCardStartsAt:input.mainCardStartsAt?.toISOString()??null};const previous=current.automatic_data??{};const overrides=Object.keys(values).filter(key=>previous[key]!==undefined&&String(previous[key]??"")!==String(values[key]??""));
      await tx.query("UPDATE sports_events SET title=$1,event_date=$2,early_preliminaries_starts_at=$3,preliminary_starts_at=$4,main_card_starts_at=$5,manual_overrides=$6,manual_fights=true,manually_edited=true,updated_by_member_id=$7,updated_at=now() WHERE id=$8 AND family_id=$9", [input.title,input.eventDate,input.earlyPreliminariesStartsAt,input.preliminaryStartsAt,input.mainCardStartsAt,JSON.stringify(overrides),actor.memberId,eventId,actor.familyId]);
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
    if (!isSportsContext(contextKind) || (contextKind === "football_day" && !isSportsDate(contextDate)) || (contextKind === "river_match" && ((contextDate !== null && !isSportsDate(contextDate)) || !eventId || !SPORTS_UUID.test(eventId))) || (contextKind === "ufc_card" && (!eventId || !SPORTS_UUID.test(eventId)))) fail(400,"INVALID","Conversación inválida.");
    const base = [eq(sportsComments.familyId,actor.familyId),eq(sportsComments.contextKind,contextKind),isNull(sportsComments.retiredAt)];
    if (contextDate) base.push(eq(sportsComments.contextDate,contextDate));
    else if (contextKind !== "river_match") base.push(isNull(sportsComments.contextDate));
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
      let contextDate = typeof body.contextDate === "string" ? body.contextDate : null;
      const contextEventId = typeof body.contextEventId === "string" ? body.contextEventId : null;
      if (!text || !isSportsContext(typeof contextKind === "string" ? contextKind : null)) fail(400,"INVALID","Escribí un comentario de hasta 2.000 caracteres.");
      if (contextKind === "football_day" && (!isSportsDate(contextDate) || contextEventId !== null)) fail(400,"INVALID","Conversación inválida.");
      if (contextKind === "river_match" && ((contextDate !== null && !isSportsDate(contextDate)) || !contextEventId || !SPORTS_UUID.test(contextEventId))) fail(400,"INVALID","Conversación inválida.");
      if (contextKind === "ufc_card" && (contextDate !== null || !contextEventId || !SPORTS_UUID.test(contextEventId))) fail(400,"INVALID","Conversación inválida.");
      if (contextKind !== "football_day") {
        const { rows:[event] } = await tx.query("SELECT id,first_participant,second_participant FROM sports_events WHERE id=$1 AND family_id=$2 AND kind=$3" , [contextEventId,actor.familyId,contextKind === "ufc_card" ? "ufc_card" : "football_match"]);
        if (!event) fail(404,"NOT_FOUND","No encontramos este evento.");
        if (contextKind === "river_match" && !isRiverMatch(event.first_participant,event.second_participant)) fail(400,"INVALID","La conversación por partido es solo para River.");
        if (contextKind === "river_match" && !contextDate) contextDate = sportsNowDay();
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


export async function saveSportsFormation(request: Request, eventId: string) {
  if (!sportsEnabled()) return sportsUnavailable();
  let tx: PoolClient | undefined;
  try {
    checkOrigin(request);
    const actor = await requireActor(request.headers);
    if (!SPORTS_UUID.test(eventId)) fail(400,"INVALID","Identificador inválido.");
    const body = request.method === "DELETE" ? null : formationInput((await parseBody(request)).body);
    if (request.method !== "DELETE" && !body) fail(400,"INVALID","Escribí una formación de hasta 500 caracteres.");
    tx = await getPool().connect(); await tx.query("BEGIN");
    await activeActor(tx, actor);
    const { rows: [event] } = await tx.query("SELECT first_participant,second_participant FROM sports_events WHERE family_id=$1 AND id=$2 AND kind='football_match' FOR UPDATE", [actor.familyId,eventId]);
    if (!event || !isRiverMatch(event.first_participant,event.second_participant)) fail(404,"NOT_FOUND","No encontramos este partido de River.");
    if (request.method === "DELETE") {
      await tx.query("DELETE FROM sports_formations WHERE family_id=$1 AND event_id=$2 AND member_id=$3", [actor.familyId,eventId,actor.memberId]);
    } else {
      await tx.query("INSERT INTO sports_formations(family_id,event_id,member_id,body) VALUES($1,$2,$3,$4) ON CONFLICT(family_id,event_id,member_id) DO UPDATE SET body=excluded.body,updated_at=now()", [actor.familyId,eventId,actor.memberId,body]);
    }
    await record(tx,actor,"sports_formation",eventId,request.method === "DELETE" ? "deleted" : "saved",{});
    await tx.query("COMMIT");
    return NextResponse.json({ saved: request.method !== "DELETE" });
  } catch (error) { if (tx) await tx.query("ROLLBACK"); return errorResponse(error); }
  finally { tx?.release(); }
}

export async function setSportsWeek(request: Request) {
  if (!sportsEnabled()) return sportsUnavailable();
  let tx: PoolClient | undefined;
  try {
    checkOrigin(request);
    const actor = await requireActor(request.headers);
    const body = await parseBody(request);
    if (typeof body.noUfcEvent !== "boolean") fail(400,"INVALID","Elegí si hay evento esta semana.");
    tx = await getPool().connect(); await tx.query("BEGIN");
    requireAdmin(await activeActor(tx, actor));
    const week = sportsWeek();
    await tx.query("INSERT INTO sports_weeks(family_id,week_start,no_ufc_event,updated_by_member_id) VALUES($1,$2,$3,$4) ON CONFLICT(family_id,week_start) DO UPDATE SET no_ufc_event=excluded.no_ufc_event,updated_by_member_id=excluded.updated_by_member_id,updated_at=now()", [actor.familyId,week.start,body.noUfcEvent,actor.memberId]);
    await record(tx,actor,"sports_week",actor.familyId,"edited",{ weekStart: week.start, noUfcEvent: body.noUfcEvent });
    await tx.query("COMMIT");
    return NextResponse.json({ weekStart: week.start, noUfcEvent: body.noUfcEvent });
  } catch (error) { if (tx) await tx.query("ROLLBACK"); return errorResponse(error); }
  finally { tx?.release(); }
}
