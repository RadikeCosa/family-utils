export const RIVER_METRICS = ["goals", "assists", "yellowCards", "redCards"] as const;
export type RiverMetric = typeof RIVER_METRICS[number];
export type RiverPlayerTotal = { id: string; name: string; count: number; sourceUrl: string };
export type RiverChampionship = {
  version: 1;
  team: "river";
  competition: "clausura";
  year: 2026;
  checkedAt: string;
  standing: { zone: "B"; position: number; teams: number; points: number; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; sourceUrl: string };
  rankings: Record<RiverMetric, { items: RiverPlayerTotal[]; sourceUrl: string; note: string }>;
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
function source(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password && ["www.riverplate.com", "www.espn.com.ar", "www.ligaprofesional.ar", "site.api.espn.com"].includes(u.hostname); } catch { return false; }
}

// A championship snapshot cannot silently become an annual or Apertura total.
export function parseRiverChampionship(value: unknown): RiverChampionship | null {
  if (!object(value) || value.version !== 1 || value.team !== "river" || value.competition !== "clausura" || value.year !== 2026 || typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt))) return null;
  const s = value.standing;
  if (!object(s) || s.zone !== "B" || !source(s.sourceUrl) || !["position", "teams", "points", "played", "won", "drawn", "lost", "goalsFor", "goalsAgainst"].every(k => integer(s[k]))) return null;
  if (Number(s.position) < 1 || Number(s.position) > Number(s.teams) || s.teams !== 15 || Number(s.played) !== Number(s.won) + Number(s.drawn) + Number(s.lost) || Number(s.played) > 16 || Number(s.points) !== 3 * Number(s.won) + Number(s.drawn)) return null;
  if (!object(value.rankings)) return null;
  for (const key of RIVER_METRICS) {
    const list = value.rankings[key];
    if (!object(list) || !Array.isArray(list.items) || list.items.length > 60 || !source(list.sourceUrl) || typeof list.note !== "string" || list.note.length > 600) return null;
    const ids = new Set<string>();
    for (const item of list.items) {
      if (!object(item) || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 120 || !integer(item.count) || item.count === 0 || !source(item.sourceUrl)) return null;
      ids.add(item.id);
    }
  }
  return value as RiverChampionship;
}

export function rankedRiverPlayers(items: RiverPlayerTotal[]) {
  const sorted = [...items].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"));
  let position = 0;
  return sorted.map((item, index) => {
    if (index === 0 || item.count !== sorted[index - 1].count) position = index + 1;
    return { ...item, position };
  });
}
