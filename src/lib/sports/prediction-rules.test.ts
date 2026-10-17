import test from "node:test";
import assert from "node:assert/strict";
import { ranked, closedAt } from "./prediction-rules.ts";
import { parseResultsBundle } from "./results-rules.ts";
test("competition ranks preserve ties and exact block boundary", () => {
  assert.deepEqual(
    ranked([
      { memberId: "a", name: "Ana", points: 2 },
      { memberId: "b", name: "Bea", points: 2 },
      { memberId: "c", name: "Ciro", points: 0 },
    ]).map((r) => r.rank),
    [1, 1, 3],
  );
  const now = new Date();
  assert.equal(closedAt(now, now), true);
  assert.equal(closedAt(null, now), false);
  assert.equal(closedAt(new Date(now.getTime() + 1), now), false);
});
test("UFC result templates allow null and reject invalid winners, duplicates and outcomes", () => {
  const fightId = "11111111-1111-4111-8111-111111111111",
    eventId = "22222222-2222-4222-8222-222222222222";
  const make = (result: unknown) => ({
    version: 1,
    checkedAt: new Date().toISOString(),
    source: "Fuente",
    events: [{ eventId, fights: [{ fightId, result }] }],
  });
  assert.ok(parseResultsBundle(make(null)));
  assert.ok(parseResultsBundle(make({ outcome: "cancelled", winnerId: null })));
  assert.equal(
    parseResultsBundle(make({ outcome: "winner", winnerId: null })),
    null,
  );
  assert.equal(
    parseResultsBundle(make({ outcome: "draw", winnerId: fightId })),
    null,
  );
  assert.equal(
    parseResultsBundle(make({ outcome: "unknown", winnerId: null })),
    null,
  );
  const value = make(null);
  value.events[0].fights.push(value.events[0].fights[0]);
  assert.equal(parseResultsBundle(value), null);
});
