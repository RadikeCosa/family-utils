import { isSportsDate, isSportsTime, sportsNowDay } from "./rules.ts";

export type AgendaIssue = { path: string; message: string; round?: string };
export type ProviderIds = { uefa: string; espn?: string };
export type ChampionsTeamInput = { name: string; externalIds: ProviderIds };
export type ChampionsMatchInput = {
  externalIds: ProviderIds; homeTeam: string; awayTeam: string;
  eventDate: string | null; startsAt: string | null;
  status: "scheduled" | "postponed" | "suspended" | "cancelled" | "completed";
  venue: string | null; channel: string | null; neutralVenue: boolean;
  source: { uefaUrl: string; kickoffConfirmed: boolean; espnUrl?: string; note?: string };
};
export type ChampionsRoundInput = { reference: string; name: string; originalFrom: string; originalThrough: string; matches: ChampionsMatchInput[] };
export type ChampionsBundle = { schemaVersion: 1; sport: "champions"; status: "curated" | "example"; checkedAt: string; season: string; teams: ChampionsTeamInput[]; rounds: ChampionsRoundInput[] };
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const string = (x: unknown, max: number) => typeof x === "string" && !!x.trim() && x.length <= max;
const id = (x: unknown) => typeof x === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(x);
function providerIds(x: unknown): x is ProviderIds { return object(x) && Object.keys(x).every(k => ["uefa", "espn"].includes(k)) && id(x.uefa) && (x.espn === undefined || id(x.espn)); }
function sourceUrl(x: unknown, provider: "uefa" | "espn") {
  if (typeof x !== "string" || x.length > 1000) return false;
  try { const u = new URL(x); return u.protocol === "https:" && !u.username && !u.password && (provider === "uefa" ? ["uefa.com", "www.uefa.com", "es.uefa.com"].includes(u.hostname) : ["espn.com", "www.espn.com", "www.espn.com.ar", "site.api.espn.com"].includes(u.hostname)); } catch { return false; }
}

// Derive the zone offset on both sides of the date, then verify the local clock.
// Folds/gaps are rejected rather than guessed. No fixed Europe/Argentina offset.
export function zonedKickoff(value: unknown): string | null {
  if (!object(value) || !isSportsDate(value.date) || !isSportsTime(value.time) || !string(value.timeZone, 80)) return null;
  try {
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: value.timeZone as string, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const parts = (t: number) => Object.fromEntries(format.formatToParts(new Date(t)).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
    const naive = Date.parse(`${value.date}T${value.time}:00Z`);
    const offsets = new Set([-86400000, 0, 86400000].map(delta => { const p = parts(naive + delta); return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - (naive + delta); }));
    const candidates = [...offsets].map(offset => naive - offset).filter(t => { const p = parts(t); return `${p.year}-${p.month}-${p.day}` === value.date && `${p.hour}:${p.minute}` === value.time; });
    return candidates.length === 1 ? new Date(candidates[0]).toISOString() : null;
  } catch { return null; }
}
export function utcKickoff(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !isSportsDate(value.slice(0, 10)) || !isSportsTime(value.slice(11, 16))) return null;
  const n = Date.parse(value); return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

export function parseChampionsBundle(raw: unknown, now = new Date()): { bundle: ChampionsBundle | null; issues: AgendaIssue[] } {
  const issues: AgendaIssue[] = [];
  const add = (path: string, message: string, round?: string) => issues.push({ path, message, ...(round ? { round } : {}) });
  if (!object(raw)) return { bundle: null, issues: [{ path: "bundle", message: "Se requiere un objeto JSON." }] };
  if (raw.schemaVersion !== 1 || raw.sport !== "champions") add("schemaVersion", "Usá schemaVersion 1 y sport champions.");
  if (raw.status !== "curated" && raw.status !== "example") add("status", "Indicá curated o example.");
  if (typeof raw.checkedAt !== "string" || !utcKickoff(raw.checkedAt) || Date.parse(raw.checkedAt) > now.getTime() + 600000 || Date.parse(raw.checkedAt) < now.getTime() - 30 * 86400000) add("checkedAt", "Indicá una revisión reciente, con zona horaria explícita.");
  if (!string(raw.season, 40)) add("season", "Completá la temporada.");
  const teams: ChampionsTeamInput[] = [], teamKeys = new Set<string>(), teamRefs = new Set<string>();
  if (!Array.isArray(raw.teams) || !raw.teams.length || raw.teams.length > 100) add("teams", "Se requieren entre 1 y 100 equipos.");
  else raw.teams.forEach((t, i) => {
    if (!object(t) || !string(t.name, 120) || !providerIds(t.externalIds)) { add(`teams[${i}]`, "Completá nombre y referencia UEFA válida del equipo."); return; }
    for (const [provider, ref] of Object.entries(t.externalIds)) { const key = `${provider}:${ref}`; if (teamRefs.has(key)) add(`teams[${i}].externalIds`, "Referencia de equipo duplicada."); teamRefs.add(key); }
    teamKeys.add(t.externalIds.uefa); teams.push({ name: (t.name as string).trim(), externalIds: t.externalIds });
  });
  const rounds: ChampionsRoundInput[] = [], roundKeys = new Set<string>(), matchRefs = new Set<string>();
  if (!Array.isArray(raw.rounds) || !raw.rounds.length || raw.rounds.length !== 1) add("rounds", "Importá una jornada completa por archivo.");
  else raw.rounds.forEach((r, ri) => {
    const path = `rounds[${ri}]`;
    if (!object(r)) { add(path, "Jornada inválida."); return; }
    const reference = typeof r.reference === "string" ? r.reference : `invalid-${ri}`;
    if (!id(r.reference)) add(`${path}.reference`, "Referencia de jornada inválida.", reference);
    if (roundKeys.has(reference)) add(`${path}.reference`, "Jornada duplicada.", reference); roundKeys.add(reference);
    if (!string(r.name, 120)) add(`${path}.name`, "Completá el nombre de la jornada.", reference);
    if (!isSportsDate(r.originalFrom) || !isSportsDate(r.originalThrough) || String(r.originalFrom) > String(r.originalThrough)) add(`${path}.originalFrom`, "Ventana original inválida.", reference);
    const matches: ChampionsMatchInput[] = [];
    if (!Array.isArray(r.matches) || !r.matches.length || r.matches.length > 36) add(`${path}.matches`, "Se requieren entre 1 y 36 partidos por jornada.", reference);
    else r.matches.forEach((m, mi) => {
      const mp = `${path}.matches[${mi}]`, before = issues.length;
      if (!object(m)) { add(mp, "Partido inválido.", reference); return; }
      if (!providerIds(m.externalIds)) add(`${mp}.externalIds`, "Completá la referencia UEFA del partido.", reference);
      else for (const [provider, ref] of Object.entries(m.externalIds)) { const key = `${provider}:${ref}`; if (matchRefs.has(key)) add(`${mp}.externalIds`, "Referencia de partido duplicada.", reference); matchRefs.add(key); }
      if (typeof m.homeTeam !== "string" || !teamKeys.has(m.homeTeam)) add(`${mp}.homeTeam`, "Local desconocido.", reference);
      if (typeof m.awayTeam !== "string" || !teamKeys.has(m.awayTeam) || m.awayTeam === m.homeTeam) add(`${mp}.awayTeam`, "Visitante desconocido o igual al local.", reference);
      if (Object.hasOwn(m, "result")) add(`${mp}.result`, "Los resultados se importan por separado.", reference);
      const status = m.status ?? "scheduled";
      if (!["scheduled", "postponed", "suspended", "cancelled", "completed"].includes(String(status))) add(`${mp}.status`, "Estado inválido.", reference);
      if (!(isSportsDate(m.eventDate) || (m.eventDate === null && status === "postponed"))) add(`${mp}.eventDate`, "Fecha argentina inválida.", reference);
      let startsAt: string | null = null;
      if (m.localStart !== undefined && m.startsAt != null) add(`${mp}.startsAt`, "Usá un instante con zona o localStart, no ambos.", reference);
      else if (m.localStart !== undefined) { startsAt = zonedKickoff(m.localStart); if (!startsAt) add(`${mp}.localStart`, "Hora local inexistente, ambigua o sin zona IANA válida.", reference); }
      else if (m.startsAt !== null) { startsAt = utcKickoff(m.startsAt); if (!startsAt) add(`${mp}.startsAt`, "Usá un instante con zona explícita o null.", reference); }
      if (startsAt && m.eventDate !== sportsNowDay(new Date(startsAt))) add(`${mp}.eventDate`, "La fecha debe coincidir con el día del inicio en Argentina.", reference);
      const source = m.source;
      if (!object(source) || !sourceUrl(source.uefaUrl, "uefa") || typeof source.kickoffConfirmed !== "boolean" || (source.espnUrl !== undefined && !sourceUrl(source.espnUrl, "espn")) || (source.note !== undefined && !string(source.note, 1000))) add(`${mp}.source`, "Indicá fuente UEFA, confirmación de hora y enlaces válidos.", reference);
      else if (source.kickoffConfirmed !== (startsAt !== null)) add(`${mp}.source.kickoffConfirmed`, "Sin hora confirmada por UEFA, el inicio debe ser null.", reference);
      for (const field of ["venue", "channel"]) if (m[field] !== undefined && m[field] !== null && !string(m[field], field === "venue" ? 200 : 160)) add(`${mp}.${field}`, "Texto inválido.", reference);
      if (m.neutralVenue !== undefined && typeof m.neutralVenue !== "boolean") add(`${mp}.neutralVenue`, "Indicá true o false.", reference);
      if (issues.length === before) matches.push({ externalIds: m.externalIds as ProviderIds, homeTeam: m.homeTeam as string, awayTeam: m.awayTeam as string, eventDate: m.eventDate as string | null, startsAt, status: status as ChampionsMatchInput["status"], venue: (m.venue as string | null) ?? null, channel: (m.channel as string | null) ?? null, neutralVenue: m.neutralVenue === true, source: source as ChampionsMatchInput["source"] });
    });
    rounds.push({ reference, name: String(r.name ?? ""), originalFrom: String(r.originalFrom ?? ""), originalThrough: String(r.originalThrough ?? ""), matches });
  });
  if (rounds.reduce((n, r) => n + r.matches.length, 0) > 200) add("rounds", "La carga supera 200 partidos.");
  return { bundle: { schemaVersion: 1, sport: "champions", status: raw.status as ChampionsBundle["status"], checkedAt: String(raw.checkedAt ?? ""), season: String(raw.season ?? ""), teams, rounds }, issues };
}
export function selectChampionsRound<T extends { id: string; originalFrom: string; originalThrough: string }>(rounds: T[], day = sportsNowDay(), selected?: string | null) {
  const ordered = [...rounds].sort((a,b) => a.originalFrom.localeCompare(b.originalFrom) || a.id.localeCompare(b.id));
  return ordered.find(r => r.id === selected) ?? ordered.find(r => r.originalFrom <= day && day <= r.originalThrough) ?? ordered.find(r => r.originalFrom > day) ?? ordered.at(-1) ?? null;
}
