import { createHash } from "node:crypto";
import { getPool } from "@/db";
import type { MemberContext } from "@/lib/auth/context";
import { createAuth } from "@/lib/auth/server";
import { championsEnabled } from "./config";
import { selectChampionsRound, type ChampionsBundle, type ChampionsMatchInput } from "./champions-rules";
import type { FootballPredictionView } from "./football-predictions-server";
import { activeSportsActor, privateHeaders, reject, sportsActor, sportsResponseError } from "./request";
import { SPORTS_UUID, sportsNowDay } from "./rules";

export type ChampionsRoundView = { id: string; name: string; season: string; originalFrom: string; originalThrough: string; partial: boolean };
export type ChampionsMatchView = { id: string; title: string; home: string; away: string; eventDate: string | null; startsAt: string | null; status: string; resolutionKind: string | null; resolutionReason: string | null; venue: string | null; channel: string | null; neutralVenue: boolean; checkedAt: string | null; sourceUrl: string | null; prediction: FootballPredictionView };
export type ChampionsTable = { roundId: string; partial: boolean; resolvedMatches: number; totalMatches: number; standings: Array<{memberId:string;name:string;points:number;position:number}>; results: Array<{eventId:string;homeGoals:number;awayGoals:number;source:string;checkedAt:string}> };
export type ChampionsPageData = { table: ChampionsTable | null; rounds: ChampionsRoundView[]; selectedRoundId: string | null; matches: ChampionsMatchView[]; revision: string };

export async function loadChampionsData(actor: MemberContext, sessionToken: string, selected: string | null): Promise<ChampionsPageData | null> {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    const active = (await c.query<{ family_id: string }>("SELECT * FROM public.sports_football_session_actor($1)",[sessionToken])).rows[0];
    if (!active || active.family_id !== actor.familyId) reject(403,"Ingresá a tu familia.");
    const rounds = (await c.query<ChampionsRoundView>(`SELECT r.id,r.name,s.name AS season,r.original_from::text AS "originalFrom",r.original_through::text AS "originalThrough",
      EXISTS(SELECT 1 FROM sports_events e WHERE e.family_id=r.family_id AND e.round_id=r.id AND e.hidden=false AND e.status NOT IN ('completed','cancelled') AND NOT EXISTS(SELECT 1 FROM sports_football_resolutions x WHERE x.event_id=e.id AND x.family_id=e.family_id AND x.kind='void_for_prode')) AS partial
      FROM sports_football_rounds r JOIN sports_football_seasons s ON s.id=r.season_id AND s.family_id=r.family_id
      WHERE r.family_id=$1 AND s.competition='champions' ORDER BY r.original_from,r.id`, [actor.familyId])).rows;
    const round = selectChampionsRound(rounds, sportsNowDay(), selected);
    const matches: ChampionsMatchView[] = [];
    if (round) {
      const events = (await c.query<{ id: string; title: string; home: string; away: string; eventDate: string | null; starts_at: Date | null; status: string; resolution_kind:string|null; resolution_reason:string|null; venue: string | null; channel: string | null; automatic_data: { checkedAt?: string; neutralVenue?: boolean; source?: { uefaUrl?: string } } | null }>(`SELECT e.id,e.title,e.first_participant AS home,e.second_participant AS away,e.event_date::text AS "eventDate",e.starts_at,e.status,x.kind AS resolution_kind,x.reason AS resolution_reason,e.venue,e.channel,e.automatic_data
        FROM sports_events e LEFT JOIN sports_football_resolutions x ON x.event_id=e.id AND x.family_id=e.family_id
        WHERE e.family_id=$1 AND e.round_id=$2 AND e.football_category='champions' AND e.hidden=false AND e.source_absent_at IS NULL ORDER BY e.id FOR UPDATE OF e`, [actor.familyId, round.id])).rows;
      // Batch the SQL session API in one round trip; no application-side private picks.
      const responses = (await c.query<{ id: string; response: { status: number; data: FootballPredictionView } }>("SELECT id,public.sports_football_predictions_api($1,id) AS response FROM sports_events WHERE id=ANY($2::uuid[]) ORDER BY id", [sessionToken, events.map(e => e.id)])).rows;
      for (const e of events) {
        const response = responses.find(x => x.id === e.id)!.response;
        if (response.status !== 200) reject(response.status, "No se pudo consultar el partido. Actualizá tu acceso.");
        matches.push({ id: e.id, title: e.title, home: e.home, away: e.away, eventDate: e.eventDate, startsAt: e.starts_at?.toISOString() ?? null, status: e.status, resolutionKind:e.resolution_kind, resolutionReason:e.resolution_reason, venue: e.venue, channel: e.channel, neutralVenue: e.automatic_data?.neutralVenue === true, checkedAt: e.automatic_data?.checkedAt ?? null, sourceUrl: e.automatic_data?.source?.uefaUrl ?? null, prediction: response.data });
      }
    }
    let table: ChampionsTable | null = null;
    if (round) {
      const response=(await c.query<{response:{status:number;data:ChampionsTable}}>("SELECT public.sports_football_round_table($1,$2) AS response",[sessionToken,round.id])).rows[0].response;
      if(response.status!==200)reject(response.status,"No se pudo consultar la tabla de la jornada.");
      table=response.data;
    }
    await c.query("COMMIT");
    matches.sort((a,b) => (a.eventDate ?? "9999").localeCompare(b.eventDate ?? "9999") || (a.startsAt ?? "9999").localeCompare(b.startsAt ?? "9999") || a.id.localeCompare(b.id));
    const visible = { rounds, selectedRoundId: round?.id ?? null, matches, table };
    return { ...visible, revision: createHash("sha256").update(JSON.stringify(visible)).digest("hex") };
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}
export async function readChampions(request: Request) {
  if (!championsEnabled()) return Response.json({ error: "No encontrado." }, { status: 404, headers: privateHeaders });
  try {
    const actor = await sportsActor(request), selected = new URL(request.url).searchParams.get("round");
    if (selected && !SPORTS_UUID.test(selected)) reject(400, "Jornada inválida.");
    const session = await createAuth().api.getSession({ headers: request.headers });
    if (!session) reject(403, "Ingresá a tu familia.");
    const data = await loadChampionsData(actor, session.session.token, selected);
    if (!data) return Response.json({ error: "No encontrado." }, { status: 404, headers: privateHeaders });
    return Response.json(data, { headers: privateHeaders });
  } catch (error) { return sportsResponseError(error); }
}
export function championsExample(now = new Date()): ChampionsBundle {
  const date = sportsNowDay(new Date(now.getTime()+7*86400000));
  return { schemaVersion: 1, sport: "champions", status: "example", checkedAt: now.toISOString(), season: "2026/27", teams: [{ name: "Equipo de ejemplo A", externalIds: { uefa: "example-team-a" } }, { name: "Equipo de ejemplo B", externalIds: { uefa: "example-team-b" } }], rounds: [{ reference: "example-round", name: "Jornada de ejemplo", originalFrom: date, originalThrough: date, matches: [{ externalIds: { uefa: "example-match" }, homeTeam: "example-team-a", awayTeam: "example-team-b", eventDate: date, startsAt: `${date}T18:00:00Z`, status: "scheduled", venue: null, channel: null, neutralVenue: false, source: { uefaUrl: "https://www.uefa.com/uefachampionsleague/", kickoffConfirmed: true, note: "Datos ficticios. Reemplazá identidades y verificá fuentes antes de marcar curated." } }] }] };
}
export async function championsTemplate(request: Request) {
  if (!championsEnabled()) return Response.json({ error: "No encontrado." }, { status: 404, headers: privateHeaders });
  const c = await getPool().connect();
  try {
    const actor = await sportsActor(request, true), url = new URL(request.url), roundId = url.searchParams.get("round");
    await c.query("BEGIN");
    await activeSportsActor(c, actor, true);
    if (url.searchParams.get("example") === "true" || !roundId) { await c.query("COMMIT"); return Response.json(championsExample(), { headers: privateHeaders }); }
    if (!SPORTS_UUID.test(roundId)) reject(400, "Jornada inválida.");
    const round = (await c.query<{ reference: string; name: string; original_from: string; original_through: string; season: string }>("SELECT r.reference,r.name,r.original_from::text,r.original_through::text,s.name AS season FROM sports_football_rounds r JOIN sports_football_seasons s ON s.id=r.season_id AND s.family_id=r.family_id WHERE r.id=$1 AND r.family_id=$2 AND s.competition='champions'", [roundId, actor.familyId])).rows[0];
    if (!round) reject(404, "No encontramos esta jornada.");
    const rows = (await c.query<{ first_team_id: string; second_team_id: string; id: string; event_date: string | null; starts_at: Date | null; status: ChampionsMatchInput["status"]; venue: string | null; channel: string | null; automatic_data: { checkedAt?: string; source?: ChampionsMatchInput["source"]; neutralVenue?: boolean } }>("SELECT *,event_date::text FROM sports_events WHERE family_id=$1 AND round_id=$2 AND football_category='champions' ORDER BY id", [actor.familyId, roundId])).rows;
    const teamIds = [...new Set(rows.flatMap(m => [m.first_team_id,m.second_team_id]))];
    const teams = (await c.query<{ id: string; name: string; externalIds: { uefa: string; espn?: string } }>(`SELECT t.id,t.name,jsonb_object_agg(s.provider,s.external_id) AS "externalIds" FROM sports_football_teams t JOIN sports_football_team_sources s ON s.team_id=t.id AND s.family_id=t.family_id WHERE t.family_id=$1 AND t.id=ANY($2::uuid[]) GROUP BY t.id ORDER BY t.id`, [actor.familyId, teamIds])).rows;
    const refs = (await c.query<{ event_id: string; externalIds: { uefa: string; espn?: string } }>(`SELECT event_id,jsonb_object_agg(provider,external_id) AS "externalIds" FROM sports_football_event_sources WHERE family_id=$1 AND event_id=ANY($2::uuid[]) GROUP BY event_id`, [actor.familyId, rows.map(r=>r.id)])).rows;
    if (teams.some(t => !t.externalIds.uefa) || refs.length !== rows.length || refs.some(r=>!r.externalIds.uefa)) reject(409, "La jornada todavía no tiene todas sus referencias UEFA.");
    const checked = rows.map(m=>m.automatic_data?.checkedAt).filter((v):v is string => !!v).sort()[0] ?? new Date().toISOString();
    const bundle: ChampionsBundle = { schemaVersion:1,sport:"champions",status:"curated",season:round.season,checkedAt:checked,teams:teams.map(({name,externalIds})=>({name,externalIds})),rounds:[{reference:round.reference,name:round.name,originalFrom:round.original_from,originalThrough:round.original_through,matches:rows.map(m=>({externalIds:refs.find(r=>r.event_id===m.id)!.externalIds,homeTeam:teams.find(t=>t.id===m.first_team_id)!.externalIds.uefa,awayTeam:teams.find(t=>t.id===m.second_team_id)!.externalIds.uefa,eventDate:m.event_date,startsAt:m.starts_at?.toISOString()??null,status:m.status,venue:m.venue,channel:m.channel,neutralVenue:m.automatic_data?.neutralVenue===true,source:m.automatic_data?.source??{uefaUrl:"https://www.uefa.com/uefachampionsleague/",kickoffConfirmed:m.starts_at!==null}}))}] };
    await c.query("COMMIT"); return Response.json(bundle,{headers:privateHeaders});
  } catch (error) { await c.query("ROLLBACK"); const response=sportsResponseError(error); for(const [key,value] of Object.entries(privateHeaders)) response.headers.set(key,value); return response; } finally { c.release(); }
}
