import { sportsFeatures } from "./config";
import { freezeClosedBlocks, type UfcEventRow } from "./predictions-server";
import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { getMemberContext } from "@/lib/auth/context";
import { sportsNowDay, sportsWeek } from "./rules";
import { normalizeSportsAlias } from "./sync-rules";
import { parseSportsCuratedBundle, sportsBundleSummary, type CuratedEvent, type SportsCuratedBundle } from "./import-rules";

type Actor = { familyId: string; memberId: string; authUser: { id: string } };
type EventRow = Record<string, unknown> & {
  id: string;
  kind: string;
  football_category: string | null;
  title: string;
  competition: string | null;
  first_participant: string | null;
  second_participant: string | null;
  event_date: string;
  starts_at: Date | null;
  venue: string | null;
  channel: string | null;
  status: string;
  manual_overrides: unknown;
  early_preliminaries_starts_at: Date | null;
  preliminary_starts_at: Date | null;
  main_card_starts_at: Date | null;
  manual_fights: boolean;
};
type FightRow = { first_fighter_id?:string; second_fighter_id?:string; id: string; first_fighter: string; second_fighter: string; bout_block: string; is_main_event: boolean };
class ImportError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new ImportError(status, message); };
function errorResponse(error: unknown) {
  if (error instanceof ImportError) return Response.json({ error: error.message }, { status: error.status });
  console.error("sports_curated_import_failed", { code: error && typeof error === "object" && "code" in error ? error.code : "unknown" });
  return Response.json({ error: "No se pudo importar. Los datos anteriores se conservaron para esta categoría." }, { status: 500 });
}
async function requestActor(request: Request): Promise<Actor> {
  const actorResult = await getMemberContext(request.headers);
  if (actorResult === null) throw new ImportError(403, "Ingresá a tu familia.");
  const actor = actorResult;
  const { rows: [member] } = await getPool().query(
    "SELECT m.id FROM members m JOIN member_devices d ON d.member_id=m.id WHERE m.id=$1 AND m.family_id=$2 AND d.auth_user_id=$3 AND m.archived_at IS NULL AND d.revoked_at IS NULL AND m.role='administrator'",
    [actor.memberId, actor.familyId, actor.authUser.id],
  );
  if (!member) fail(403, "Solo un administrador puede importar datos deportivos.");
  return actor as Actor;
}
function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) fail(403, "Origen no permitido.");
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function stableName(value: unknown) { return typeof value === "string" ? normalizeSportsAlias(value) : ""; }
function equivalentRiver(existing: EventRow, item: CuratedEvent) {
  if (item.kind !== "football_match") return false;
  const data = item.payload;
  return existing.competition === data.competition
    && stableName(existing.first_participant) === stableName(data.firstParticipant)
    && stableName(existing.second_participant) === stableName(data.secondParticipant);
}
function mainPair(fights: Array<{ firstFighter: string; secondFighter: string; isMainEvent: boolean }>) {
  const main = fights.find(fight => fight.isMainEvent);
  return main ? [stableName(main.firstFighter), stableName(main.secondFighter)].sort().join("|") : "";
}
function overrideKeys(current: EventRow) { return Array.isArray(current.manual_overrides) ? current.manual_overrides.filter((key: unknown): key is string => typeof key === "string") : []; }
function applyOverrides<T extends Record<string, unknown>>(values: T, overrides: string[], fields: string[]): T {
  const result = { ...values };
  for (const field of fields) if (overrides.includes(field)) delete result[field];
  return result;
}

async function findOrInsertEvent(
  tx: PoolClient,
  familyId: string,
  memberId: string,
  item: CuratedEvent,
  bundle: SportsCuratedBundle,
) {
  const day = item.payload.eventDate!;
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `sports-curated:${familyId}:${item.kind}`,
  ]);
  const ufcIntegrityEnabled =
    sportsFeatures().ufc ||
    (
      await tx.query(
        "SELECT to_regclass('public.sports_predictions') IS NOT NULL AS enabled",
      )
    ).rows[0].enabled === true;
  if (item.kind === "football_match") {
    const linked = await tx.query("SELECT e.football_category FROM sports_football_event_sources s JOIN sports_events e ON e.id=s.event_id AND e.family_id=s.family_id WHERE s.family_id=$1 AND s.provider=$2 AND s.external_id=$3",[familyId,item.sourceProvider,item.externalReference]);
    if (linked.rows.some(row=>row.football_category === "champions")) fail(409,"La referencia pertenece a Champions; no se modificó River.");
  }
  const { rows: exactRows } = await tx.query(
    "SELECT *,event_date::text AS event_date FROM sports_events WHERE family_id=$1 AND kind=$2 AND source_provider=$3 AND external_reference=$4 FOR UPDATE",
    [familyId, item.kind, item.sourceProvider, item.externalReference],
  );
  let current = exactRows[0] as EventRow | undefined;
  if (current?.football_category === "champions") fail(409, "La referencia pertenece a Champions; no se modificó River.");
  if (!current) {
    const { rows: nearby } = await tx.query(
      "SELECT *,event_date::text AS event_date FROM sports_events WHERE family_id=$1 AND kind=$2 AND (kind='ufc_card' OR football_category='river') AND source_provider=$3 AND event_date BETWEEN ($4::date - 7) AND ($4::date + 7) FOR UPDATE",
      [familyId, item.kind, item.sourceProvider, day],
    );
    let equivalent: EventRow[] = [];
    if (item.kind === "football_match")
      equivalent = nearby.filter((row) => equivalentRiver(row, item));
    else {
      const incomingMain = mainPair(item.payload.fights);
      for (const row of nearby) {
        if (ufcIntegrityEnabled) {
          const { rows: closed } = await tx.query(
            "SELECT 1 FROM sports_block_closures WHERE family_id=$1 AND event_id=$2 LIMIT 1",
            [familyId, row.id],
          );
          if (closed.length) continue;
        }
        const { rows: fights } = await tx.query(
          "SELECT first_fighter,second_fighter,is_main_event FROM sports_fights WHERE family_id=$1 AND event_id=$2",
          [familyId, row.id],
        );
        const existingMain = mainPair(
          fights.map(
            (fight: {
              first_fighter: string;
              second_fighter: string;
              is_main_event: boolean;
            }) => ({
              firstFighter: fight.first_fighter,
              secondFighter: fight.second_fighter,
              isMainEvent: fight.is_main_event,
            }),
          ),
        );
        if (incomingMain && existingMain === incomingMain) equivalent.push(row);
      }
    }
    if (equivalent.length > 1)
      fail(
        409,
        `Hay más de un evento parecido a “${item.payload.title}”; no se importó esta categoría.`,
      );
    current = equivalent[0];
  }

  if (item.kind === "football_match") {
    const payload = item.payload;
    const rawValues = {
      title: payload.title,
      competition: payload.competition,
      firstParticipant: payload.firstParticipant,
      secondParticipant: payload.secondParticipant,
      eventDate: payload.eventDate,
      startsAt: payload.startsAt?.toISOString() ?? null,
      venue: payload.venue,
      channel: payload.channel,
      status: payload.status,
    };
    const overrides = current ? overrideKeys(current) : [];
    const valuesToApply = applyOverrides(
      rawValues,
      overrides,
      Object.keys(rawValues),
    );
    if (current?.status === "completed") {
      if (
        stableName(current.first_participant) !==
          stableName(payload.firstParticipant) ||
        stableName(current.second_participant) !==
          stableName(payload.secondParticipant)
      )
        fail(
          409,
          "La agenda cambia los equipos de un partido finalizado. Revisá el archivo manualmente.",
        );
      return { id: current.id, action: "updated" as const };
    }
    const automatic = JSON.stringify({
      ...rawValues,
      result: payload.result,
      source: item.source,
      checkedAt: bundle.checkedAt,
    });
    if (!current) {
      const {
        rows: [inserted],
      } = await tx.query(
        "INSERT INTO sports_events(family_id,kind,title,competition,first_participant,second_participant,event_date,starts_at,venue,channel,status,result,manually_edited,external_reference,source_provider,automatic_data,manual_overrides,created_by_member_id,updated_by_member_id) VALUES($1,'football_match',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12,$13,$14::jsonb,'[]'::jsonb,$15,$15) RETURNING id",
        [
          familyId,
          payload.title,
          payload.competition,
          payload.firstParticipant,
          payload.secondParticipant,
          payload.eventDate,
          payload.startsAt,
          payload.venue,
          payload.channel,
          payload.status,
          payload.result,
          item.externalReference,
          item.sourceProvider,
          automatic,
          memberId,
        ],
      );
      return { id: inserted.id, action: "inserted" as const };
    }
    const title = valuesToApply.title ?? current.title;
    const competition = valuesToApply.competition ?? current.competition;
    const first = valuesToApply.firstParticipant ?? current.first_participant;
    const second =
      valuesToApply.secondParticipant ?? current.second_participant;
    const eventDate = valuesToApply.eventDate ?? current.event_date;
    const startsAt = Object.hasOwn(valuesToApply, "startsAt")
      ? valuesToApply.startsAt
      : current.starts_at;
    const venue = Object.hasOwn(valuesToApply, "venue")
      ? valuesToApply.venue
      : current.venue;
    const channel = Object.hasOwn(valuesToApply, "channel")
      ? valuesToApply.channel
      : current.channel;
    const status = valuesToApply.status ?? current.status;
    await tx.query(
      "UPDATE sports_events SET title=$1,competition=$2,first_participant=$3,second_participant=$4,event_date=$5,starts_at=$6,venue=$7,channel=$8,status=$9,external_reference=$10,source_provider=$11,automatic_data=$12::jsonb,manual_overrides=$13::jsonb,manually_edited=$14,source_absent_at=NULL,updated_by_member_id=$15,updated_at=now() WHERE id=$16 AND family_id=$17",
      [
        title,
        competition,
        first,
        second,
        eventDate,
        startsAt,
        venue,
        channel,
        status,
        item.externalReference,
        item.sourceProvider,
        automatic,
        JSON.stringify(overrides),
        overrides.length > 0,
        memberId,
        current.id,
        familyId,
      ],
    );
    return { id: current.id, action: "updated" as const };
  }

  if (ufcIntegrityEnabled && current) {
    await freezeClosedBlocks(tx, familyId, current as unknown as UfcEventRow);
    if (current.event_date !== item.payload.eventDate) {
      const { rows: closed } = await tx.query(
        "SELECT 1 FROM sports_block_closures WHERE family_id=$1 AND event_id=$2 LIMIT 1",
        [familyId, current.id],
      );
      if (closed.length)
        fail(
          409,
          "La cartelera ya cerró: una postergación real requiere un evento nuevo con otra referencia.",
        );
    }
    const { rows: confirmed } = await tx.query(
      "SELECT f.first_fighter,f.second_fighter FROM sports_fight_results r JOIN sports_fights f ON f.id=r.fight_id WHERE r.family_id=$1 AND r.event_id=$2",
      [familyId, current.id],
    );
    const incoming = new Set(
      item.payload.fights.map((f) => mainPair([{ ...f, isMainEvent: true }])),
    );
    if (
      confirmed.some(
        (f) =>
          !incoming.has(
            mainPair([
              {
                firstFighter: f.first_fighter,
                secondFighter: f.second_fighter,
                isMainEvent: true,
              },
            ]),
          ),
      )
    )
      fail(
        409,
        "La agenda contradice una pelea con resultado confirmado. Revisá el archivo manualmente.",
      );
    if (current.card_status === "finalized")
      return { id: current.id, action: "updated" as const };
  }
  const payload = item.payload;
  const rawValues = {
    title: payload.title,
    eventDate: payload.eventDate,
    earlyPreliminariesStartsAt:
      payload.earlyPreliminariesStartsAt?.toISOString() ?? null,
    preliminaryStartsAt: payload.preliminaryStartsAt?.toISOString() ?? null,
    mainCardStartsAt: payload.mainCardStartsAt?.toISOString() ?? null,
  };
  const overrides = current ? overrideKeys(current) : [];
  const valuesToApply = applyOverrides(
    rawValues,
    overrides,
    Object.keys(rawValues),
  );
  const automatic = JSON.stringify({
    ...rawValues,
    source: item.source,
    checkedAt: bundle.checkedAt,
    fights: payload.fights,
  });
  let eventId: string;
  let action: "inserted" | "updated";
  if (!current) {
    const {
      rows: [inserted],
    } = await tx.query(
      "INSERT INTO sports_events(family_id,kind,title,event_date,early_preliminaries_starts_at,preliminary_starts_at,main_card_starts_at,card_status,is_current,manually_edited,external_reference,source_provider,automatic_data,manual_overrides,automatic_fights,manual_fights,created_by_member_id,updated_by_member_id) VALUES($1,'ufc_card',$2,$3,$4,$5,$6,'upcoming',true,false,$7,$8,$9::jsonb,'[]'::jsonb,$10::jsonb,false,$11,$11) RETURNING id",
      [
        familyId,
        payload.title,
        payload.eventDate,
        payload.earlyPreliminariesStartsAt,
        payload.preliminaryStartsAt,
        payload.mainCardStartsAt,
        item.externalReference,
        item.sourceProvider,
        automatic,
        JSON.stringify(payload.fights),
        memberId,
      ],
    );
    eventId = inserted.id;
    action = "inserted";
  } else {
    eventId = current.id;
    action = "updated";
    const title = valuesToApply.title ?? current.title;
    const eventDate = valuesToApply.eventDate ?? current.event_date;
    const earlyPreliminary = Object.hasOwn(
      valuesToApply,
      "earlyPreliminariesStartsAt",
    )
      ? valuesToApply.earlyPreliminariesStartsAt
      : current.early_preliminaries_starts_at;
    const preliminary = Object.hasOwn(valuesToApply, "preliminaryStartsAt")
      ? valuesToApply.preliminaryStartsAt
      : current.preliminary_starts_at;
    const main = Object.hasOwn(valuesToApply, "mainCardStartsAt")
      ? valuesToApply.mainCardStartsAt
      : current.main_card_starts_at;
    const manualFights = current.manual_fights === true;
    await tx.query(
      "UPDATE sports_events SET title=$1,event_date=$2,early_preliminaries_starts_at=$3,preliminary_starts_at=$4,main_card_starts_at=$5,card_status='upcoming',is_current=true,external_reference=$6,source_provider=$7,automatic_data=$8::jsonb,manual_overrides=$9::jsonb,automatic_fights=$10::jsonb,manual_fights=$11,manually_edited=$12,source_absent_at=NULL,updated_by_member_id=$13,updated_at=now() WHERE id=$14 AND family_id=$15",
      [
        title,
        eventDate,
        earlyPreliminary,
        preliminary,
        main,
        item.externalReference,
        item.sourceProvider,
        automatic,
        JSON.stringify(overrides),
        JSON.stringify(payload.fights),
        manualFights,
        overrides.length > 0 || manualFights,
        memberId,
        eventId,
        familyId,
      ],
    );
  }
  if (sportsFeatures().agenda) {
    const columns: Record<string, string> = {
      venue: "venue",
      city: "city",
      country: "country",
      eventType: "event_type",
    };
    for (const [field, value] of Object.entries(item.location)) {
      if (overrides.includes(field)) continue;
      await tx.query(
        `UPDATE sports_events SET ${columns[field]}=$1 WHERE id=$2 AND family_id=$3`,
        [value, eventId, familyId],
      );
    }
  }
  if (current?.manual_fights === true) return { id: eventId, action };
  const { rows: oldFightRows } = await tx.query(
    ufcIntegrityEnabled
      ? "SELECT id,first_fighter,second_fighter,first_fighter_id,second_fighter_id,bout_block,is_main_event FROM sports_fights WHERE family_id=$1 AND event_id=$2 AND removed_at IS NULL FOR UPDATE"
      : "SELECT id,first_fighter,second_fighter,bout_block,is_main_event FROM sports_fights WHERE family_id=$1 AND event_id=$2 FOR UPDATE",
    [familyId, eventId],
  );
  const oldFights = oldFightRows as FightRow[];
  const byPair = new Map(
    oldFights.map((fight) => [
      mainPair([
        {
          firstFighter: fight.first_fighter,
          secondFighter: fight.second_fighter,
          isMainEvent: true,
        },
      ]),
      fight,
    ]),
  );
  await tx.query(
    "UPDATE sports_fights SET is_main_event=false WHERE family_id=$1 AND event_id=$2",
    [familyId, eventId],
  );
  const retained = new Set<string>();
  for (const fight of payload.fights) {
    const pair = mainPair([
      {
        firstFighter: fight.firstFighter,
        secondFighter: fight.secondFighter,
        isMainEvent: true,
      },
    ]);
    const old = byPair.get(pair);
    if (old) {
      retained.add(old.id);
      if (
        ufcIntegrityEnabled &&
        stableName(old.first_fighter) !== stableName(fight.firstFighter)
      )
        await tx.query(
          "UPDATE sports_fights SET first_fighter_id=$1,second_fighter_id=$2 WHERE id=$3 AND family_id=$4",
          [old.second_fighter_id, old.first_fighter_id, old.id, familyId],
        );
      await tx.query(
        "UPDATE sports_fights SET bout_order=$1,first_fighter=$2,second_fighter=$3,bout_block=$4,is_main_event=$5,updated_at=now() WHERE id=$6 AND family_id=$7",
        [
          fight.boutOrder,
          fight.firstFighter,
          fight.secondFighter,
          fight.boutBlock,
          fight.isMainEvent,
          old.id,
          familyId,
        ],
      );
    } else {
      await tx.query(
        "INSERT INTO sports_fights(family_id,event_id,bout_order,first_fighter,second_fighter,bout_block,is_main_event) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          familyId,
          eventId,
          fight.boutOrder,
          fight.firstFighter,
          fight.secondFighter,
          fight.boutBlock,
          fight.isMainEvent,
        ],
      );
    }
  }
  const staleFightIds = oldFights
    .map((fight) => fight.id)
    .filter((id) => !retained.has(id));
  if (staleFightIds.length)
    await tx.query(
      ufcIntegrityEnabled
        ? "UPDATE sports_fights SET removed_at=now(),is_main_event=false,updated_at=now() WHERE family_id=$1 AND event_id=$2 AND id=ANY($3::uuid[])"
        : "DELETE FROM sports_fights WHERE family_id=$1 AND event_id=$2 AND id=ANY($3::uuid[])",
      [familyId, eventId, staleFightIds],
    );
  await tx.query(
    "UPDATE sports_weeks SET no_ufc_event=false,updated_at=now() WHERE family_id=$1 AND week_start=$2",
    [familyId, sportsWeek(new Date(`${payload.eventDate}T12:00:00Z`)).start],
  );
  return { id: eventId, action };
}

async function importCategory(
  actor: Actor,
  items: CuratedEvent[],
  bundle: SportsCuratedBundle,
  kind: CuratedEvent["kind"],
  horizon: { from: string; through: string; complete: boolean },
) {
  const tx = await getPool().connect();
  try {
    await tx.query("BEGIN");
    const {
      rows: [member],
    } = await tx.query(
      "SELECT id FROM members WHERE id=$1 AND family_id=$2 AND role='administrator' AND archived_at IS NULL FOR UPDATE",
      [actor.memberId, actor.familyId],
    );
    if (!member)
      fail(403, "Tu acceso de administración cambió. Volvé a ingresar.");
    const results = [];
    for (const item of items)
      results.push(
        await findOrInsertEvent(
          tx,
          actor.familyId,
          actor.memberId,
          item,
          bundle,
        ),
      );
    if (horizon.complete && items.length > 0) {
      const refs = items.map((item) => item.externalReference);
      if (
        kind === "ufc_card" &&
        (
          await tx.query(
            "SELECT to_regclass('public.sports_fight_results') IS NOT NULL AS enabled",
          )
        ).rows[0].enabled
      ) {
        const { rows: conflicts } = await tx.query(
          "SELECT e.id FROM sports_events e WHERE e.family_id=$1 AND e.kind=$2 AND e.source_provider='ufc_official' AND e.source_absent_at IS NULL AND e.status<>'completed' AND e.event_date BETWEEN $3 AND $4 AND e.event_date >= $5 AND NOT(e.external_reference=ANY($6::text[])) AND EXISTS(SELECT 1 FROM sports_fight_results r WHERE r.event_id=e.id AND r.family_id=e.family_id)",
          [
            actor.familyId,
            kind,
            horizon.from,
            horizon.through,
            sportsNowDay(),
            refs,
          ],
        );
        if (conflicts.length)
          fail(
            409,
            "La agenda omite una cartelera con resultados confirmados. Revisá el archivo manualmente.",
          );
      }

      await tx.query(
        "UPDATE sports_events SET source_absent_at=now(),updated_at=now() WHERE family_id=$1 AND kind=$2 AND (kind='ufc_card' OR football_category='river') AND source_provider=$3 AND source_absent_at IS NULL AND status <> 'completed' AND (card_status IS NULL OR card_status <> 'finalized') AND event_date BETWEEN $4 AND $5 AND event_date >= $6 AND NOT (external_reference=ANY($7::text[]))",
        [
          actor.familyId,
          kind,
          items[0].sourceProvider,
          horizon.from,
          horizon.through,
          sportsNowDay(),
          refs,
        ],
      );
    }
    await tx.query(
      "INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,\"after\") VALUES($1,$2,'sports_import',$3,'curated_bundle_imported',$4::jsonb)",
      [
        actor.familyId,
        actor.memberId,
        actor.familyId,
        JSON.stringify({
          kind,
          events: results.length,
          checkedAt: bundle.checkedAt,
          references: items.map((item) => item.externalReference),
        }),
      ],
    );
    await tx.query("COMMIT");
    return results;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}

export async function importSportsBundle(request: Request) {
  if (process.env.SPORTS_ENABLED !== "true") return Response.json({ error: "Deportes no está habilitado." }, { status: 404 });
  try {
    checkOrigin(request);
    const actor = await requestActor(request);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 1_000_000) fail(413, "El archivo JSON supera el tamaño permitido.");
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { body = null; }
    if (!record(body) || (body.mode !== "preview" && body.mode !== "import") || !record(body.bundle)) fail(400, "Enviá un archivo JSON curado válido.");
    const requestBody = body as Record<string, unknown>;
    const parsed = parseSportsCuratedBundle(requestBody.bundle);
    if (parsed.ok === false) throw new ImportError(400, parsed.error);
    if (requestBody.mode === "import" && parsed.bundle.status === "example") fail(400, "El ejemplo contiene datos ficticios. Completá y verificá una carga curada antes de importar.");
    const summary = sportsBundleSummary(parsed.bundle);
    if (requestBody.mode === "preview") return Response.json({ valid: true, summary, warnings: parsed.bundle.events.flatMap(event => event.kind === "ufc_card" && (event.source.validation as Record<string, unknown> | undefined)?.independentCrossCheck !== "passed" ? [`${event.payload.title}: la verificación independiente está pendiente.`] : []) }, { headers: { "Cache-Control": "no-store" } });

    const riverItems = parsed.bundle.events.filter(event => event.kind === "football_match");
    const ufcItems = parsed.bundle.events.filter(event => event.kind === "ufc_card");
    const river = await importCategory(actor, riverItems, parsed.bundle, "football_match", parsed.bundle.curation.completeHorizon.river);
    const ufc = await importCategory(actor, ufcItems, parsed.bundle, "ufc_card", parsed.bundle.curation.completeHorizon.ufc);
    return Response.json({ imported: true, summary, river: river.map(item => item.action), ufc: ufc.map(item => item.action) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
