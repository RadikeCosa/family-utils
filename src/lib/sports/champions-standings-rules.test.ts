import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseChampionsStandings } from "./champions-standings-rules.ts";

function fixture() {
  return [{ group: { competitionId: "1", seasonYear: "2027", phase: "TOURNAMENT" }, items: Array.from({ length: 36 }, (_, i) => ({
    team: { id: String(100 + i), internationalName: `Club ${i}` }, rank: i < 2 ? 1 : i + 1,
    played: 2, won: 1, drawn: 1, lost: 0, goalsFor: 3, goalsAgainst: 1, goalDifference: 2, points: 4, isLive: i === 0,
  })) }];
}

test("preserves UEFA ranks, ties, order and live scores", () => {
  const rows = parseChampionsStandings(fixture(), "2027")!;
  assert.equal(rows.length, 36);
  assert.deepEqual(rows.slice(0, 3).map(row => row.position), [1, 1, 3]);
  assert.equal(rows[0].live, true);
  assert.equal(rows[0].points, 4);
});

test("rejects wrong seasons, partial tables, duplicate teams and invalid statistics", () => {
  assert.equal(parseChampionsStandings(fixture(), "2026"), null);
  const short = fixture(); short[0].items.pop();
  assert.equal(parseChampionsStandings(short, "2027"), null);
  const duplicate = fixture(); duplicate[0].items[1].team.id = duplicate[0].items[0].team.id;
  assert.equal(parseChampionsStandings(duplicate, "2027"), null);
  const invalid = fixture(); invalid[0].items[0].played = 3;
  assert.equal(parseChampionsStandings(invalid, "2027"), null);
  const badGoals = fixture(); badGoals[0].items[0].goalDifference = 10;
  assert.equal(parseChampionsStandings(badGoals, "2027"), null);
  assert.equal(parseChampionsStandings({}, "2027"), null);
});

test("verified fallback contains the whole league and consistent statistics", () => {
  const snapshot = JSON.parse(readFileSync(new URL("./champions-standings-snapshot.json", import.meta.url), "utf8"));
  assert.equal(snapshot.rows.length, 36);
  assert.equal(new Set(snapshot.rows.map((row: {teamId: string}) => row.teamId)).size, 36);
  for (const row of snapshot.rows) {
    assert.equal(row.played, row.won + row.drawn + row.lost);
    assert.equal(row.goalDifference, row.goalsFor - row.goalsAgainst);
  }
});
