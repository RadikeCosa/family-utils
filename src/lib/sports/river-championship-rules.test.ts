import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRiverChampionship, rankedRiverPlayers, type RiverChampionship } from "./river-championship-rules.ts";

const snapshot = (): RiverChampionship => JSON.parse(readFileSync(new URL("./river-championship-snapshot.json", import.meta.url), "utf8"));

test("curated Clausura snapshot has a coherent River standing and four verified lists", () => {
  const data = parseRiverChampionship(snapshot());
  assert.ok(data);
  assert.equal(data.standing.zone, "B");
  assert.equal(data.standing.points, data.standing.won * 3 + data.standing.drawn);
  assert.ok(data.rankings.goals.items.length > 0);
  assert.ok(data.rankings.assists.items.length > 0);
  assert.ok(data.rankings.yellowCards.items.length > 10, "Do not truncate the official top-ten display");
  assert.equal(data.rankings.assists.items.find(p => p.name === "Tobías Andrada")?.count, 1);
});

test("rejects other competitions, annual totals and inconsistent standings", () => {
  for (const change of [{ competition: "annual" }, { competition: "apertura" }, { year: 2025 }, { team: "boca" }]) assert.equal(parseRiverChampionship({ ...snapshot(), ...change }), null);
  const data = snapshot();
  data.standing.played += 1;
  assert.equal(parseRiverChampionship(data), null);
  data.standing.played -= 1;
  data.standing.points += 1;
  assert.equal(parseRiverChampionship(data), null);
});

test("requires distinct player identities, positive known counts and source attribution", () => {
  for (const count of [-1, null, 0, 1.5]) {
    const data = snapshot();
    (data.rankings.goals.items[0] as unknown as Record<string, unknown>).count = count;
    assert.equal(parseRiverChampionship(data), null);
  }
  const data = snapshot();
  data.rankings.goals.items.push(data.rankings.goals.items[0]);
  assert.equal(parseRiverChampionship(data), null);
  const unsafe = snapshot();
  unsafe.rankings.assists.items[0].sourceUrl = "https://www.riverplate.com.attacker.invalid/";
  assert.equal(parseRiverChampionship(unsafe), null);
});

test("an empty published red-card list remains distinct from fabricated zero player totals", () => {
  const data = snapshot();
  data.rankings.redCards.items = [];
  assert.ok(parseRiverChampionship(data));
  assert.deepEqual(rankedRiverPlayers(data.rankings.redCards.items), []);
});

test("shared places respect tied counts and do not mutate the curated order", () => {
  const sourceUrl = "https://www.riverplate.com/";
  const items = [{ id: "c", name: "C", count: 1, sourceUrl }, { id: "b", name: "B", count: 4, sourceUrl }, { id: "a", name: "A", count: 4, sourceUrl }];
  assert.deepEqual(rankedRiverPlayers(items).map(p => [p.name, p.position]), [["A", 1], ["B", 1], ["C", 3]]);
  assert.equal(items[0].id, "c");
});
