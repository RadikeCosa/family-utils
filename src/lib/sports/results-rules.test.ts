import assert from "node:assert/strict";
import test from "node:test";
import { parseResultsBundle } from "./results-rules.ts";
const example = () => ({
  version: 1,
  checkedAt: new Date().toISOString(),
  source: "Fuente verificada",
  events: [
    {
      eventId: "11111111-1111-4111-8111-111111111111",
      result: { homeGoals: 0, awayGoals: 1 },
    },
  ],
});
test("valid score and pending template", () => {
  const value = example();
  assert.ok(parseResultsBundle(value));
  assert.ok(
    parseResultsBundle({
      ...value,
      events: [{ ...value.events[0], result: null }],
    }),
  );
});
test("invalid scores, duplicates and unknown versions", () => {
  const value = example();
  for (const bad of [-1, 1.5, 2147483648])
    assert.equal(
      parseResultsBundle({
        ...value,
        events: [
          { ...value.events[0], result: { homeGoals: bad, awayGoals: 0 } },
        ],
      }),
      null,
    );
  assert.equal(
    parseResultsBundle({
      ...value,
      events: [...value.events, ...value.events],
    }),
    null,
  );
  assert.equal(parseResultsBundle({ ...value, version: 2 }), null);
});
