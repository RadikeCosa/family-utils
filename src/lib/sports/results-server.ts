import { inspectUfcResults, applyUfcResults } from "./results-ufc-server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { sportsFeatures } from "./config";
import {
  parseResultsBundle,
  type ResultsBundle,
  type ResultEntry,
} from "./results-rules";
import {
  sportsActor,
  activeSportsActor,
  sportsBody,
  reject,
  sportsResponseError,
  privateHeaders,
  SportsRequestError,
} from "./request";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
type PreviewToken = {
  familyId: string;
  memberId: string;
  bundleHash: string;
  states: Record<string, string>;
  expires: number;
};
function sign(payload: PreviewToken) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret)
    reject(503, "No está configurada la validación de importaciones.");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}
function verify(raw: unknown): PreviewToken {
  if (typeof raw !== "string" || raw.length > 50000)
    reject(409, "Volvé a revisar la vista previa.");
  const [encoded, signature, ...extra] = raw.split(".");
  if (!encoded || !signature || extra.length)
    reject(409, "Volvé a revisar la vista previa.");
  let payload: PreviewToken;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
  } catch {
    reject(409, "La vista previa no es válida.");
  }
  const expected = sign(payload).split(".")[1];
  const a = Buffer.from(signature),
    b = Buffer.from(expected);
  if (
    a.length !== b.length ||
    !timingSafeEqual(a, b) ||
    payload.expires < Date.now()
  )
    reject(409, "La vista previa venció. Volvé a validarla.");
  return payload;
}
async function inspect(tx: PoolClient, familyId: string, entry: ResultEntry) {
  const {
    rows: [event],
  } = await tx.query(
    "SELECT id,title,kind,football_category,status,updated_at FROM sports_events WHERE id=$1 AND family_id=$2 FOR UPDATE",
    [entry.eventId, familyId],
  );
  if (!event || event.kind !== "football_match" || event.football_category !== "river")
    reject(400, "No encontramos ese partido de River en la familia.");
  const {
    rows: [previous],
  } = await tx.query(
    "SELECT * FROM sports_football_results WHERE event_id=$1 AND family_id=$2",
    [entry.eventId, familyId],
  );
  const before = previous
    ? { homeGoals: previous.home_goals, awayGoals: previous.away_goals }
    : null;
  return {
    event,
    previous,
    state: hash({ event, previous: previous ?? null }),
    preview: {
      eventId: event.id,
      title: event.title,
      before,
      after: entry.result,
      changed: entry.result !== null && hash(before) !== hash(entry.result),
    },
  };
}
export async function importSportsResults(request: Request) {
  if (!sportsFeatures().results)
    return Response.json({ error: "No encontrado." }, { status: 404 });
  try {
    const actor = await sportsActor(request, true);
    const body = await sportsBody(request);
    if (body.mode !== "preview" && body.mode !== "import")
      reject(400, "Elegí vista previa o confirmación.");
    if (
      body.mode === "import" &&
      body.bundle &&
      typeof body.bundle === "object" &&
      "example" in body.bundle &&
      body.bundle.example === true
    )
      reject(
        400,
        "El ejemplo contiene resultados ficticios. Completá una plantilla con datos verificados.",
      );
    const bundle = parseResultsBundle(body.bundle);
    if (!bundle) reject(400, "El archivo de resultados no es válido.");
    const states: Record<string, string> = {};
    const events: unknown[] = [];
    const errors: Array<{ eventId: string; error: string }> = [];
    const token = body.mode === "import" ? verify(body.token) : null;
    if (
      token &&
      (token.familyId !== actor.familyId ||
        token.memberId !== actor.memberId ||
        token.bundleHash !== hash(bundle))
    )
      reject(409, "El archivo cambió. Revisá la vista previa nuevamente.");
    if (
      body.mode === "import" &&
      !bundle.events.some(
        (entry) =>
          entry.result != null || entry.fights?.some((f) => f.result !== null),
      )
    )
      reject(400, "La plantilla no tiene resultados para guardar.");
    if (bundle.events.some((entry) => entry.fights) && !sportsFeatures().ufc)
      reject(404, "Los resultados UFC todavía no están habilitados.");
    for (const entry of bundle.events) {
      const tx = await getPool().connect();
      try {
        await tx.query("BEGIN");
        await activeSportsActor(tx, actor, true);
        const current = entry.fights
          ? await inspectUfcResults(tx, actor.familyId, entry)
          : await inspect(tx, actor.familyId, entry);
        if (token && token.states[entry.eventId] !== current.state)
          reject(409, "Los datos cambiaron. Volvé a revisar este evento.");
        states[entry.eventId] = current.state;
        if (body.mode === "import" && entry.fights && current.preview.changed)
          await applyUfcResults(
            tx,
            actor.familyId,
            actor.memberId,
            entry,
            bundle,
          );
        if (body.mode === "import" && entry.result && current.preview.changed) {
          await tx.query(
            "INSERT INTO sports_football_results(event_id,family_id,home_goals,away_goals,source,checked_at,updated_by_member_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_id) DO UPDATE SET home_goals=excluded.home_goals,away_goals=excluded.away_goals,source=excluded.source,checked_at=excluded.checked_at,updated_by_member_id=excluded.updated_by_member_id,updated_at=now()",
            [
              entry.eventId,
              actor.familyId,
              entry.result.homeGoals,
              entry.result.awayGoals,
              bundle.source,
              bundle.checkedAt,
              actor.memberId,
            ],
          );
          await tx.query(
            "UPDATE sports_events SET status='completed',result=$3,updated_at=now() WHERE id=$1 AND family_id=$2",
            [
              entry.eventId,
              actor.familyId,
              `${entry.result.homeGoals}–${entry.result.awayGoals}`,
            ],
          );
          await tx.query(
            "INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,\"after\") VALUES($1,$2,'sports_result',$3,'curated_result_imported',$4::jsonb)",
            [
              actor.familyId,
              actor.memberId,
              entry.eventId,
              JSON.stringify({
                ...current.preview,
                source: bundle.source,
                checkedAt: bundle.checkedAt,
              }),
            ],
          );
        }
        await tx.query("COMMIT");
        events.push(current.preview);
      } catch (error) {
        await tx.query("ROLLBACK");
        errors.push({
          eventId: entry.eventId,
          error:
            error instanceof SportsRequestError
              ? error.message
              : "No se pudo importar el evento. Los datos anteriores se conservaron.",
        });
      } finally {
        tx.release();
      }
    }
    if (body.mode === "preview")
      return Response.json(
        {
          events,
          errors,
          token: sign({
            familyId: actor.familyId,
            memberId: actor.memberId,
            bundleHash: hash(bundle),
            states,
            expires: Date.now() + 15 * 60000,
          }),
          warnings: errors.map((item) => item.error),
        },
        { headers: privateHeaders },
      );
    return Response.json(
      { imported: events.length > 0, events, errors },
      { headers: privateHeaders },
    );
  } catch (error) {
    return sportsResponseError(error);
  }
}
export async function resultsTemplate(request: Request) {
  if (!sportsFeatures().results)
    return Response.json({ error: "No encontrado." }, { status: 404 });
  try {
    const actor = await sportsActor(request, true);
    const { rows } = await getPool().query(
      "SELECT id,title,event_date,kind FROM sports_events WHERE family_id=$1 AND ((kind='football_match' AND football_category='river') OR (kind='ufc_card' AND $2)) AND hidden=false ORDER BY event_date DESC,id LIMIT 20",
      [actor.familyId, sportsFeatures().ufc],
    );
    const bundle: ResultsBundle = {
      version: 1,
      checkedAt: new Date().toISOString(),
      source: "Completar con la fuente verificada en el chat",
      events: await Promise.all(
        rows.map(async (event) =>
          event.kind === "football_match"
            ? {
                eventId: event.id,
                title: event.title,
                date: event.event_date,
                result: null,
              }
            : {
                eventId: event.id,
                title: event.title,
                date: event.event_date,
                fights: (
                  await getPool().query(
                    "SELECT id,first_fighter,second_fighter,first_fighter_id,second_fighter_id FROM sports_fights WHERE family_id=$1 AND event_id=$2 AND removed_at IS NULL ORDER BY bout_order,id",
                    [actor.familyId, event.id],
                  )
                ).rows.map((f) => ({
                  fightId: f.id,
                  firstFighter: {
                    id: f.first_fighter_id,
                    name: f.first_fighter,
                  },
                  secondFighter: {
                    id: f.second_fighter_id,
                    name: f.second_fighter,
                  },
                  result: null,
                })),
              },
        ),
      ),
    };
    if (new URL(request.url).searchParams.get("example") === "true")
      return Response.json(
        {
          ...bundle,
          example: true,
          events: bundle.events.length
            ? bundle.events.map((entry) =>
                entry.fights
                  ? {
                      ...entry,
                      fights: entry.fights.slice(0, 1).map((f) => ({
                        ...f,
                        result: { outcome: "draw", winnerId: null },
                      })),
                    }
                  : { ...entry, result: { homeGoals: 2, awayGoals: 1 } },
              )
            : [
                {
                  eventId: "11111111-1111-4111-8111-111111111111",
                  title: "Partido de ejemplo · resultado ficticio",
                  result: { homeGoals: 2, awayGoals: 1 },
                },
              ],
        },
        { headers: privateHeaders },
      );
    if (!rows.length)
      reject(404, "No hay eventos cargados para generar una plantilla.");
    return Response.json(bundle, { headers: privateHeaders });
  } catch (error) {
    return sportsResponseError(error);
  }
}
