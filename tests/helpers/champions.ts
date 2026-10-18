import type { Pool } from "pg";

// Deliberately uses River's name: category, not participant text, must isolate it.
export async function championsFixture(pool: Pool, familyId: string, memberId: string) {
  await pool.query("INSERT INTO sports_champions_switches(family_id,enabled) VALUES($1,true) ON CONFLICT(family_id) DO UPDATE SET enabled=true", [familyId]);
  const season = (await pool.query("INSERT INTO sports_football_seasons(family_id,competition,name) VALUES($1,'champions','2026/27') RETURNING id", [familyId])).rows[0].id as string;
  const round = (await pool.query("INSERT INTO sports_football_rounds(family_id,season_id,reference,name,original_from,original_through) VALUES($1,$2,'league-3','Jornada 3','2026-10-20','2026-10-21') RETURNING id", [familyId, season])).rows[0].id as string;
  const teams: string[] = [];
  for (const name of ["River Plate", "Champions sentinel opponent"]) teams.push((await pool.query("INSERT INTO sports_football_teams(family_id,name) VALUES($1,$2) RETURNING id", [familyId, name])).rows[0].id as string);
  const event = (await pool.query("INSERT INTO sports_events(family_id,kind,football_category,season_id,round_id,first_team_id,second_team_id,title,competition,first_participant,second_participant,event_date,starts_at,source_provider,external_reference,created_by_member_id,updated_by_member_id) VALUES($1,'football_match','champions',$2,$3,$4,$5,'Champions sentinel','UEFA Champions League','River Plate','Champions sentinel opponent',CURRENT_DATE,now()+interval '2 hours','espn','771234991',$6,$6) RETURNING id", [familyId, season, round, ...teams, memberId])).rows[0].id as string;
  return { season, round, teams, event };
}

export const championsCleanupTables = [
  "sports_football_round_comments",
  "sports_football_result_corrections",
  "sports_football_resolutions",
  "sports_football_results",
  "sports_football_predictions",
  "sports_football_closures",
  "sports_football_event_sources", // Delete before sports_events.
  "sports_football_team_sources",
] as const;
export const championsIdentityTables = [
  "sports_football_rounds",
  "sports_football_seasons",
  "sports_football_teams",
] as const;
