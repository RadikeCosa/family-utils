import snapshot from "./champions-standings-snapshot.json";
import { parseChampionsStandings, type ChampionsTeamStanding } from "./champions-standings-rules";

export type ChampionsStandingsData = {
  season: string;
  checkedAt: string;
  sourceUrl: string;
  fallback: boolean;
  rows: ChampionsTeamStanding[];
};

export async function loadChampionsStandings(): Promise<ChampionsStandingsData> {
  try {
    const response = await fetch(
      `https://standings.uefa.com/v1/standings?competitionId=1&seasonYear=${snapshot.seasonYear}`,
      { next: { revalidate: 60 }, signal: AbortSignal.timeout(6000) },
    );
    if (!response.ok) throw new Error("UEFA standings unavailable");
    const rows = parseChampionsStandings(await response.json(), snapshot.seasonYear);
    if (!rows) throw new Error("Incomplete UEFA standings");
    const date = response.headers.get("date");
    return {
      season: snapshot.season, sourceUrl: snapshot.sourceUrl, rows, fallback: false,
      checkedAt: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : new Date().toISOString(),
    };
  } catch {
    return { ...snapshot, fallback: true };
  }
}
