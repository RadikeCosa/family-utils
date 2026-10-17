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

test("UFC awards 5/3/1 by card role, not array position or prelim block", async () => {
  const { ufcFightPoints } = await import("./prediction-rules.ts");
  const fight = (id: string, order: number, block = "main", main = false) => ({
    id, bout_order: order, bout_block: block, is_main_event: main,
    prode_eligible: true, removed_at: null as Date | null,
  });
  const main = fight("main", 1, "main", true);
  const coMain = fight("co", 2);
  const ordinary = fight("ordinary", 3);
  const prelim = fight("prelim", 4, "preliminaries");
  const early = fight("early", 5, "early_preliminaries");
  const weights = ufcFightPoints([early, ordinary, coMain, main, prelim]);
  assert.equal(weights.get(main.id), 5);
  assert.equal(weights.get(coMain.id), 3);
  assert.equal(weights.get(ordinary.id), 1);
  assert.equal(weights.get(prelim.id), 1);
  assert.equal(weights.get(early.id), 1);
  assert.equal(ufcFightPoints([main, prelim]).get(prelim.id), 1);
  // Removed co-main keeps its slot: nobody inherits its bonus after cancellation.
  coMain.removed_at = new Date();
  const removed = ufcFightPoints([main, coMain, ordinary]);
  assert.equal(removed.get(coMain.id), 0);
  assert.equal(removed.get(ordinary.id), 1);
  // An eligible replacement at the original slot is the new co-main.
  const replacement = fight("replacement", 2);
  assert.equal(ufcFightPoints([main, coMain, replacement, ordinary]).get(replacement.id), 3);
  replacement.prode_eligible = false;
  assert.equal(ufcFightPoints([main, coMain, replacement, ordinary]).get(replacement.id), 0);
  assert.equal(ufcFightPoints([main, coMain, replacement, ordinary]).get(ordinary.id), 1);
});
