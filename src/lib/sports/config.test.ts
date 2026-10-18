import test from "node:test";
import assert from "node:assert/strict";
import { championsEnabled, sportsFeatures } from "./config.ts";
test("server flags default off and enforce delivery dependencies", () => {
  const keys = [
    "SPORTS_ENABLED",
    "SPORTS_AGENDA_ENABLED",
    "SPORTS_RIVER_RESULTS_ENABLED",
    "SPORTS_UFC_PREDICTIONS_ENABLED",
    "SPORTS_CHAMPIONS_ENABLED",
  ];
  const previous = keys.map((k) => process.env[k]);
  try {
    for (const k of keys) delete process.env[k];
    assert.deepEqual(sportsFeatures(), {
      agenda: false,
      results: false,
      ufc: false,
    });
    assert.equal(championsEnabled(), false);
    process.env.SPORTS_ENABLED = "true";
    process.env.SPORTS_UFC_PREDICTIONS_ENABLED = "true";
    assert.equal(sportsFeatures().ufc, false);
    process.env.SPORTS_AGENDA_ENABLED = "true";
    assert.equal(sportsFeatures().results, false);
    process.env.SPORTS_RIVER_RESULTS_ENABLED = "true";
    process.env.SPORTS_CHAMPIONS_ENABLED = "false";
    assert.deepEqual(sportsFeatures(), {
      agenda: true,
      results: true,
      ufc: true,
    });
    assert.equal(championsEnabled(), true);
    process.env.SPORTS_AGENDA_ENABLED = "false";
    assert.deepEqual(sportsFeatures(), {
      agenda: false,
      results: false,
      ufc: false,
    });
    assert.equal(championsEnabled(), false);
  } finally {
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
});
