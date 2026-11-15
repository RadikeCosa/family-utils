import test from "node:test";
import assert from "node:assert/strict";
import { createHiitRun, finishHiit, hiitCanRegister, hiitCivilDate, hiitTotalMs, hiitTrainingMs, HIIT_PRESETS, pauseHiit, resumeHiit, tickHiit, validateHiitConfig } from "./hiit.ts";

test("preset durations exclude final rest and include preparation separately", () => {
  assert.equal(hiitTotalMs(HIIT_PRESETS[0].config), 240_000);
  assert.equal(hiitTotalMs(HIIT_PRESETS[1].config), 470_000);
  assert.equal(hiitTrainingMs(HIIT_PRESETS[0].config), 230_000);
  assert.equal(hiitTrainingMs(HIIT_PRESETS[1].config), 460_000);
});
test("total limit is applied even when individual fields are valid", () => {
  assert.match(validateHiitConfig({ preparationSeconds: 0, workSeconds: 3600, restSeconds: 0, rounds: 5 })!, /4 horas/);
  assert.equal(validateHiitConfig({ preparationSeconds: 0, workSeconds: 3600, restSeconds: 0, rounds: 4 }), null);
});
test("2000ms tick is accepted while 2001ms pauses without advancing", () => {
  const exact = createHiitRun({ preparationSeconds: 0, workSeconds: 20, restSeconds: 10, rounds: 2 }, 0);
  assert.equal(tickHiit(exact, 2000).elapsedMs, 2000);
  const delayed = createHiitRun({ preparationSeconds: 0, workSeconds: 20, restSeconds: 10, rounds: 2 }, 0);
  const result = tickHiit(delayed, 2001);
  assert.equal(result.paused, true); assert.equal(result.elapsedMs, 0);
});
test("work and rest accumulate, preparation remains separate, and last rest is omitted", () => {
  const run = createHiitRun({ preparationSeconds: 2, workSeconds: 3, restSeconds: 1, rounds: 2 }, 0);
  tickHiit(run, 2000); tickHiit(run, 4000); tickHiit(run, 5000); tickHiit(run, 6000); tickHiit(run, 8000);
  const done = tickHiit(run, 9000);
  assert.equal(done.complete, true); assert.equal(done.preparationMs, 2000); assert.equal(done.workMs, 6000); assert.equal(done.restMs, 1000); assert.ok(done.sounds.includes("finish"));
});
test("rest zero transitions directly to the next work round", () => {
  const run = createHiitRun({ preparationSeconds: 0, workSeconds: 1, restSeconds: 0, rounds: 2 }, 0);
  const transition = tickHiit(run, 1000);
  assert.equal(transition.stage, "work"); assert.equal(transition.round, 2); assert.ok(transition.sounds.includes("start"));
});
test("paused time is excluded and partial registration requires one second of work", () => {
  const short = createHiitRun({ preparationSeconds: 0, workSeconds: 2, restSeconds: 3, rounds: 2 }, 0);
  tickHiit(short, 999); assert.equal(hiitCanRegister(short), false);
  const partial = createHiitRun({ preparationSeconds: 0, workSeconds: 2, restSeconds: 3, rounds: 2 }, 0);
  tickHiit(partial, 1000); assert.equal(hiitCanRegister(partial), true);
  pauseHiit(partial, 1000); resumeHiit(partial, 5000); tickHiit(partial, 6000);
  assert.equal(partial.workMs, 2000); assert.equal(partial.restMs, 0);
  assert.equal(finishHiit(partial, 6000).complete, true);
});
test("partial work truncates only after accumulation and pauses are tracked separately", () => {
  const run = createHiitRun({ preparationSeconds: 0, workSeconds: 2, restSeconds: 3, rounds: 2 }, 0);
  tickHiit(run, 1900); pauseHiit(run, 1900); finishHiit(run, 4900);
  assert.equal(Math.floor(run.workMs / 1000), 1); assert.equal(run.pausedMs, 3000);
});
test("first-work date stays fixed across Buenos Aires midnight", () => {
  const start = Date.parse("2026-11-15T02:59:59.000Z");
  const run = createHiitRun({ preparationSeconds: 0, workSeconds: 3, restSeconds: 1, rounds: 2 }, start);
  tickHiit(run, start + 1000);
  assert.equal(hiitCivilDate(run.firstWorkAt!, "America/Argentina/Buenos_Aires"), "2026-11-14");
  tickHiit(run, start + 2000);
  assert.equal(hiitCivilDate(start + 2000, "America/Argentina/Buenos_Aires"), "2026-11-15");
  assert.equal(hiitCivilDate(run.firstWorkAt!, "America/Argentina/Buenos_Aires"), "2026-11-14");
});
test("crossing multiple stage limits advances correctly without replaying stale cues", () => {
  const run = createHiitRun({ preparationSeconds: 1, workSeconds: 1, restSeconds: 1, rounds: 3 }, 0);
  const result = tickHiit(run, 1500);
  assert.equal(result.stage, "work"); assert.equal(result.round, 1); assert.ok(!result.sounds.includes("count-3"));
});
