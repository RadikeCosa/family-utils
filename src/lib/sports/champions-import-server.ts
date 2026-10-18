import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { championsEnabled } from "./config";
import { familyChampionsEnabled } from "./champions-switch";
import { activeSportsActor, privateHeaders, reject, sportsActor, sportsBody, sportsResponseError } from "./request";
import { parseChampionsBundle, type AgendaIssue, type ChampionsBundle, type ChampionsMatchInput, type ProviderIds } from "./champions-rules";

type Team = { id: string; name: string };
type Season = { id: string; name: string };
type Round = { id: string; season_id: string; reference: string; name: string; original_from: string; original_through: string };
type Match = { id: string; football_category: string; season_id: string | null; round_id: string | null; first_team_id: string | null; second_team_id: string | null; event_date: string | null; starts_at: Date | null; status: string; title: string; venue: string | null; channel: string | null; automatic_data: Record<string, unknown> | null; manual_overrides: string[]; result: string | null };
type Source = { team_id?: string; event_id?: string; provider: string; external_id: string };
type Snapshot = { seasons: Season[]; rounds: Round[]; teams: Team[]; teamSources: Source[]; matches: Match[]; eventSources: Source[]; closures: unknown[]; results: Array<{ event_id: string }> };
type Token = { familyId: string; memberId: string; bundleHash: string; state: string; expires: number };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function secret() { const s = process.env.BETTER_AUTH_SECRET; if (!s) reject(503, "Falta configurar las importaciones."); return s; }
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)]));
  return value;
}
const hmac = (value: unknown) => createHmac("sha256", secret()).update(JSON.stringify(canonical(value))).digest("hex");
function sign(t: Token) { const content = Buffer.from(JSON.stringify(t)).toString("base64url"); return `${content}.${hmac(content)}`; }
function verify(value: unknown): Token {
  if (typeof value !== "string" || value.length > 4000) reject(409, "Volvé a revisar la vista previa.");
  const [content, signature, extra] = value.split(".");
  const expected = Buffer.from(hmac(content)), given = Buffer.from(signature ?? "");
  if (extra || given.length !== expected.length || !timingSafeEqual(given, expected)) reject(409, "La vista previa no es válida.");
  let t: Token; try { t = JSON.parse(Buffer.from(content, "base64url").toString()); } catch { reject(409, "La vista previa no es válida."); }
  if (!t || !Number.isSafeInteger(t.expires) || t.expires <= Date.now()) reject(409, "La vista previa venció. Volvé a validarla.");
  return t;
}
async function snapshot(c: PoolClient, family: string, lock: boolean): Promise<Snapshot> {
  const seasons = (await c.query<Season>("SELECT * FROM sports_football_seasons WHERE family_id=$1 AND competition='champions' ORDER BY id", [family])).rows;
  const rounds = (await c.query<Round>("SELECT *,original_from::text,original_through::text FROM sports_football_rounds WHERE family_id=$1 ORDER BY id", [family])).rows;
  const teams = (await c.query<Team>("SELECT * FROM sports_football_teams WHERE family_id=$1 ORDER BY id", [family])).rows;
  const teamSources = (await c.query<Source>("SELECT * FROM sports_football_team_sources WHERE family_id=$1 ORDER BY team_id,provider", [family])).rows;
  const matches = (await c.query<Match>(`SELECT *,event_date::text FROM sports_events WHERE family_id=$1 AND kind='football_match' ORDER BY id ${lock ? "FOR UPDATE" : ""}`, [family])).rows;
  const eventSources = (await c.query<Source>("SELECT * FROM sports_football_event_sources WHERE family_id=$1 ORDER BY event_id,provider", [family])).rows;
  const closures = (await c.query("SELECT * FROM sports_football_closures WHERE family_id=$1 ORDER BY event_id", [family])).rows;
  const results = (await c.query<{ event_id: string }>("SELECT event_id FROM sports_football_results WHERE family_id=$1 ORDER BY event_id", [family])).rows;
  // No predictions in this snapshot: preview/tokens must not signal private participation.
  return { seasons, rounds, teams, teamSources, matches, eventSources, closures, results };
}
function existingId(ids: ProviderIds, refs: Source[], field: "team_id" | "event_id") {
  return [...new Set(Object.entries(ids).flatMap(([provider, external]) => refs.filter(r => r.provider === provider && r.external_id === external).map(r => r[field]!)))];
}
function plan(bundle: ChampionsBundle, state: Snapshot) {
  const issues: AgendaIssue[] = [], teams = new Map<string, Team | undefined>();
  for (const [i, team] of bundle.teams.entries()) {
    const found = existingId(team.externalIds, state.teamSources, "team_id");
    let row = state.teams.find(t => t.id === found[0]);
    if (found.length > 1) issues.push({ path: `teams[${i}]`, message: "Las referencias apuntan a equipos diferentes." });
    if (!row) {
      row = state.teams.find(t => t.name === team.name);
      if (row && state.teamSources.some(r => r.team_id === row!.id && r.provider === "uefa" && r.external_id !== team.externalIds.uefa)) issues.push({ path: `teams[${i}]`, message: "El nombre ya pertenece a otro equipo UEFA." });
    }
    if (row && state.teams.some(t => t.name === team.name && t.id !== row!.id)) issues.push({ path: `teams[${i}].name`, message: "El nombre coincide con otro equipo." });
    if (row) for (const [provider, ref] of Object.entries(team.externalIds)) if (state.teamSources.some(r => r.team_id === row!.id && r.provider === provider && r.external_id !== ref)) issues.push({ path: `teams[${i}].externalIds`, message: "No se puede reemplazar una identidad externa existente." });
    teams.set(team.externalIds.uefa, row);
  }
  if (new Set(bundle.teams.map(t => t.name)).size !== bundle.teams.length) issues.push({ path: "teams", message: "Hay nombres de equipo duplicados." });
  const season = state.seasons.find(s => s.name === bundle.season);
  const r = bundle.rounds[0], round = season ? state.rounds.find(x => x.season_id === season.id && x.reference === r.reference) : undefined;
  if (round && (round.original_from !== r.originalFrom || round.original_through !== r.originalThrough)) issues.push({ path: "rounds[0]", message: "La ventana original no cambia al reprogramar partidos." });
  const matches: Array<{ input: ChampionsMatchInput; current?: Match }> = [];
  for (const [i, match] of r.matches.entries()) {
    const path = `rounds[0].matches[${i}]`, found = existingId(match.externalIds, state.eventSources, "event_id");
    const current = state.matches.find(m => m.id === found[0]);
    if (found.length > 1) issues.push({ path, message: "Las referencias apuntan a partidos diferentes." });
    if (current && (current.football_category !== "champions" || current.round_id !== round?.id)) issues.push({ path, message: "El partido pertenece a otra jornada o categoría; no se puede trasladar." });
    if (current && (current.first_team_id !== teams.get(match.homeTeam)?.id || current.second_team_id !== teams.get(match.awayTeam)?.id)) issues.push({ path, message: "No se pueden reemplazar ni invertir los equipos de un partido existente." });
    if (current) for (const [provider, ref] of Object.entries(match.externalIds)) if (state.eventSources.some(s => s.event_id === current.id && s.provider === provider && s.external_id !== ref)) issues.push({ path, message: "No se puede reemplazar la identidad externa del partido." });
    if (match.status === "completed" && (!current || !state.results.some(x => x.event_id === current.id))) issues.push({ path: `${path}.status`, message: "La agenda no confirma resultados deportivos." });
    if (current && (current.status === "completed" || state.results.some(x => x.event_id === current.id)) && match.status !== current.status) issues.push({ path: `${path}.status`, message: "La agenda no reemplaza un estado con resultado confirmado." });
    if (current && current.manual_overrides.length) issues.push({ path, message: "El partido tiene correcciones manuales; revisalo antes de importar." });
    matches.push({ input: match, current });
  }
  if (round && state.matches.some(m => m.round_id === round.id && !matches.some(x => x.current?.id === m.id))) issues.push({ path: "rounds[0].matches", message: "La carga omite partidos existentes de la jornada; no se eliminan por omisión." });
  return { issues, teams, season, round, matches };
}
export async function importChampionsAgenda(request: Request) {
  if (!championsEnabled()) return Response.json({ error: "No encontrado." }, { status: 404, headers: privateHeaders });
  const c = await getPool().connect();
  try {
    const actor = await sportsActor(request, true);
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await activeSportsActor(c, actor, true);
    if (!(await familyChampionsEnabled(c, actor.familyId))) reject(404, "No encontrado.");
    const body = await sportsBody(request);
    if (body.mode !== "preview" && body.mode !== "import") reject(400, "Elegí vista previa o confirmación.");
    const parsed = parseChampionsBundle(body.bundle);
    if (!parsed.bundle || parsed.issues.length) { await c.query("ROLLBACK"); return Response.json({ valid: false, errors: parsed.issues }, { status: 400, headers: privateHeaders }); }
    const bundle = parsed.bundle;
    const token = body.mode === "import" ? verify(body.token) : null;
    if (token && (token.familyId !== actor.familyId || token.memberId !== actor.memberId || token.bundleHash !== hash(body.bundle))) reject(409, "El archivo o el administrador cambió. Revisá la vista previa.");
    if (body.mode === "import" && bundle.status === "example") reject(400, "El ejemplo es ficticio; no se puede importar como carga real.");
    if (token) await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`champions-agenda:${actor.familyId}`]);
    const state = await snapshot(c, actor.familyId, !!token), stateHash = hmac(state);
    if (token && token.state !== stateHash) reject(409, "Los datos cambiaron. Volvé a revisar la jornada.");
    const prepared = plan(bundle, state);
    if (prepared.issues.length) { await c.query("ROLLBACK"); return Response.json({ valid: false, errors: prepared.issues }, { status: 400, headers: privateHeaders }); }
    const preview = { valid: true, errors: [], summary: { season: bundle.season, round: bundle.rounds[0].name, teams: bundle.teams.length, matches: bundle.rounds[0].matches.length }, matches: prepared.matches.map(x => ({ reference: x.input.externalIds.uefa, title: `${bundle.teams.find(t => t.externalIds.uefa === x.input.homeTeam)!.name} vs ${bundle.teams.find(t => t.externalIds.uefa === x.input.awayTeam)!.name}`, before: x.current ? { eventDate: x.current.event_date, startsAt: x.current.starts_at?.toISOString() ?? null, status: x.current.status } : null, after: { eventDate: x.input.eventDate, startsAt: x.input.startsAt, status: x.input.status } })) };
    if (!token) { await c.query("COMMIT"); return Response.json({ ...preview, ...(body.issueToken === false ? {} : { token: sign({ familyId: actor.familyId, memberId: actor.memberId, bundleHash: hash(body.bundle), state: stateHash, expires: Date.now() + 15 * 60000 }) }) }, { headers: privateHeaders }); }
    const seasonId = prepared.season?.id ?? (await c.query<{ id: string }>("INSERT INTO sports_football_seasons(family_id,competition,name) VALUES($1,'champions',$2) RETURNING id", [actor.familyId, bundle.season])).rows[0].id;
    const teamIds = new Map<string, string>();
    let changes = 0;
    for (const t of bundle.teams) {
      const existing = prepared.teams.get(t.externalIds.uefa);
      const id = existing?.id ?? (await c.query<{ id: string }>("INSERT INTO sports_football_teams(family_id,name) VALUES($1,$2) RETURNING id", [actor.familyId, t.name])).rows[0].id;
      if (!existing) changes++;
      else if (existing.name !== t.name) { await c.query("UPDATE sports_football_teams SET name=$2 WHERE id=$1", [id, t.name]); changes++; }
      for (const [provider, ref] of Object.entries(t.externalIds)) { const result = await c.query("INSERT INTO sports_football_team_sources(family_id,team_id,provider,external_id) VALUES($1,$2,$3,$4) ON CONFLICT(family_id,team_id,provider) DO NOTHING", [actor.familyId, id, provider, ref]); changes += result.rowCount ?? 0; }
      teamIds.set(t.externalIds.uefa, id);
    }
    const round = bundle.rounds[0];
    const roundId = prepared.round?.id ?? (await c.query<{ id: string }>("INSERT INTO sports_football_rounds(family_id,season_id,reference,name,original_from,original_through) VALUES($1,$2,$3,$4,$5,$6) RETURNING id", [actor.familyId, seasonId, round.reference, round.name, round.originalFrom, round.originalThrough])).rows[0].id;
    if (prepared.round && prepared.round.name !== round.name) { await c.query("UPDATE sports_football_rounds SET name=$2 WHERE id=$1", [roundId, round.name]); changes++; }
    for (const { input: m, current } of prepared.matches) {
      const first = bundle.teams.find(t => t.externalIds.uefa === m.homeTeam)!.name, second = bundle.teams.find(t => t.externalIds.uefa === m.awayTeam)!.name;
      const automatic = { source: m.source, checkedAt: bundle.checkedAt, neutralVenue: m.neutralVenue };
      const values = [actor.familyId, seasonId, roundId, teamIds.get(m.homeTeam), teamIds.get(m.awayTeam), `${first} vs ${second}`, first, second, m.eventDate, m.startsAt, m.status, m.venue, m.channel, JSON.stringify(automatic), actor.memberId];
      let eventId = current?.id;
      if (!current) { eventId = (await c.query<{ id: string }>("INSERT INTO sports_events(family_id,kind,football_category,season_id,round_id,first_team_id,second_team_id,title,competition,first_participant,second_participant,event_date,starts_at,status,venue,channel,automatic_data,manually_edited,created_by_member_id,updated_by_member_id) VALUES($1,'football_match','champions',$2,$3,$4,$5,$6,'UEFA Champions League',$7,$8,$9,$10,$11,$12,$13,$14::jsonb,false,$15,$15) RETURNING id", values)).rows[0].id; changes++; }
      else {
        const actual = { eventDate: current.event_date, startsAt: current.starts_at?.toISOString() ?? null, status: current.status, venue: current.venue, channel: current.channel, title: current.title, automatic: current.automatic_data };
        const next = { eventDate: m.eventDate, startsAt: m.startsAt, status: m.status, venue: m.venue, channel: m.channel, title: `${first} vs ${second}`, automatic };
        if (hmac(actual) !== hmac(next)) { await c.query("UPDATE sports_events SET title=$6,first_participant=$7,second_participant=$8,event_date=$9,starts_at=$10,status=$11,venue=$12,channel=$13,automatic_data=$14::jsonb,updated_by_member_id=$15,updated_at=now() WHERE id=$16 AND family_id=$1 AND season_id=$2 AND round_id=$3 AND first_team_id=$4 AND second_team_id=$5", [...values, current.id]); changes++; }
      }
      for (const [provider, ref] of Object.entries(m.externalIds)) { const result = await c.query("INSERT INTO sports_football_event_sources(family_id,event_id,provider,external_id) VALUES($1,$2,$3,$4) ON CONFLICT(family_id,event_id,provider) DO NOTHING", [actor.familyId, eventId, provider, ref]); changes += result.rowCount ?? 0; }
    }
    if (changes) await c.query("INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,\"after\") VALUES($1,$2,'sports_champions_agenda',$3,'curated_imported',$4::jsonb)", [actor.familyId, actor.memberId, roundId, JSON.stringify({ checkedAt: bundle.checkedAt, matches: round.matches.length })]);
    await c.query("COMMIT");
    return Response.json({ imported: true, changed: changes > 0, roundId, summary: preview.summary }, { headers: privateHeaders });
  } catch (error) {
    await c.query("ROLLBACK");
    if (error && typeof error === "object" && "code" in error && ["23505","40001"].includes(String(error.code))) return Response.json({error:"Las referencias o los datos cambiaron. Volvé a revisar la jornada."},{status:409,headers:privateHeaders});
    const response=sportsResponseError(error);for(const [key,value] of Object.entries(privateHeaders))response.headers.set(key,value);return response;
  } finally { c.release(); }
}
