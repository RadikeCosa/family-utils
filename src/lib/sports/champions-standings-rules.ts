export type ChampionsTeamStanding = {
  teamId: string;
  name: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  live: boolean;
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// Preserve UEFA's order and ranks, including ties and official tiebreakers.
export function parseChampionsStandings(raw: unknown, seasonYear: string): ChampionsTeamStanding[] | null {
  if (!Array.isArray(raw)) return null;
  const groups = raw.filter(group => object(group) && object(group.group) &&
    group.group.competitionId === "1" && group.group.seasonYear === seasonYear &&
    group.group.phase === "TOURNAMENT" && Array.isArray(group.items) && group.items.length === 36);
  if (groups.length !== 1) return null;
  const rows: ChampionsTeamStanding[] = [];
  const ids = new Set<string>();
  for (const item of groups[0].items) {
    if (!object(item) || !object(item.team)) return null;
    const teamId = item.team.id;
    const name = item.team.internationalName;
    const fields = ["played", "won", "drawn", "lost", "goalsFor", "goalsAgainst", "points"] as const;
    if (typeof teamId !== "string" || !/^\d+$/.test(teamId) || ids.has(teamId) ||
      typeof name !== "string" || !name.trim() || name.length > 120 ||
      !fields.every(key => Number.isSafeInteger(item[key]) && Number(item[key]) >= 0) ||
      !Number.isSafeInteger(item.rank) || Number(item.rank) < 1 || Number(item.rank) > 36 ||
      !Number.isSafeInteger(item.goalDifference) || typeof item.isLive !== "boolean") return null;
    const row = {
      teamId, name, position: Number(item.rank), played: Number(item.played),
      won: Number(item.won), drawn: Number(item.drawn), lost: Number(item.lost),
      goalsFor: Number(item.goalsFor), goalsAgainst: Number(item.goalsAgainst),
      goalDifference: Number(item.goalDifference), points: Number(item.points), live: item.isLive,
    };
    if (row.played !== row.won + row.drawn + row.lost || row.played > 8 ||
      row.goalDifference !== row.goalsFor - row.goalsAgainst) return null;
    rows.push(row);
    ids.add(teamId);
  }
  return rows.sort((a, b) => a.position - b.position);
}
