import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSportsCuratedBundle, sportsBundleSummary } from "./import-rules.ts";

const snapshot = JSON.parse(readFileSync(new URL("../../../sources/deportes-carga-2026-10-15.json", import.meta.url), "utf8")) as Record<string, unknown>;
const checkedAt = new Date(String(snapshot.checkedAt));

test("accepts the curated snapshot and counts all events and fights", () => {
  const result = parseSportsCuratedBundle(snapshot, new Date(checkedAt.getTime() + 60_000));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(sportsBundleSummary(result.bundle), {
    riverMatches: 3,
    ufcCards: 3,
    ufcFights: 35,
    through: { river: "2026-11-01", ufc: "2026-11-01" },
  });
});

test("rejects a stale snapshot", () => {
  const result = parseSportsCuratedBundle(snapshot, new Date(checkedAt.getTime() + 31 * 86400_000));
  assert.equal(result.ok, false);
});

test("rejects a card whose fight list is not complete per its evidence", () => {
  const changed = structuredClone(snapshot) as { events: Array<Record<string, unknown>> };
  const card = changed.events.find(event => event.kind === "ufc_card");
  assert.ok(card && Array.isArray(card.fights));
  (card.fights as unknown[]).pop();
  const result = parseSportsCuratedBundle(changed, new Date(checkedAt.getTime() + 60_000));
  assert.equal(result.ok, false);
});

test("rejects duplicate provider references in a bundle", () => {
  const changed = structuredClone(snapshot) as { events: Array<Record<string, unknown>> };
  changed.events[1].externalReference = changed.events[0].externalReference;
  const result = parseSportsCuratedBundle(changed, new Date(checkedAt.getTime() + 60_000));
  assert.equal(result.ok, false);
});
