import assert from "node:assert/strict";
import test from "node:test";
import { createStrengthRun, generateStrengthPhases, INITIAL_STRENGTH_CONFIG as initial, STRENGTH_FIELDS, strengthBreakdown, strengthDiaryText, strengthDurations, validateStrengthConfig } from "./strength-timer.ts";
import { finishBlockRun, pauseBlockRun, resumeBlockRun, tickBlockRun } from "./block-timer.ts";

function advance(run: ReturnType<typeof createStrengthRun>, until: number) {
  let snapshot = tickBlockRun(run, run.lastSampleMono, 0);
  while (run.lastSampleMono < until && !run.complete && !run.paused) {
    const now = Math.min(until, run.lastSampleMono + 100);
    snapshot = tickBlockRun(run, now, Date.UTC(2026, 10, 24) + now);
  }
  return snapshot;
}
test("default sequence, right then left, warmup once and exact totals", () => {
  const phases = generateStrengthPhases(initial);
  assert.equal(phases.filter(p => p.kind === "work" && p.stage === "warmup").length, 6);
  assert.equal(phases.filter(p => p.kind === "work" && p.round === 1).length, 31);
  assert.equal(phases.filter(p => p.kind === "rest").length, 2);
  assert.equal(phases.at(-1)?.name, "Tobillos · Flexión plantar · Izquierdo");
  assert.equal(phases.at(-1)?.nextName, null);
  const names = phases.filter(p => p.kind === "work" && p.round === 1).map(p => p.name);
  assert.deepEqual(names.slice(0, 5), ["Abdominales", "Hombros · Flexión · Derecho", "Hombros · Flexión · Izquierdo", "Hombros · Extensión · Derecho", "Hombros · Extensión · Izquierdo"]);
  assert.equal(strengthDurations(initial).total, 3330);
  assert.equal(strengthDurations(initial).round, 1030);
});
test("preview equals phases for defaults, custom values, one round and zero transitions/rest", () => {
  for (const config of [initial, { ...initial, rounds: 1 }, { ...initial, rounds: 4, restSeconds: 0 }, { ...initial, rounds: 5, internalChangeSeconds: 0, groupChangeSeconds: 0, restSeconds: 0 }, { ...initial, rounds: 2, warmupSeconds: 12, exerciseSeconds: 17, internalChangeSeconds: 2, groupChangeSeconds: 7, restSeconds: 13 }]) {
    const phases = generateStrengthPhases(config);
    assert.equal(phases.reduce((sum, p) => sum + p.durationMs, 0), strengthDurations(config).total * 1000);
    assert.ok(phases.every(p => p.durationMs > 0));
    if (config.restSeconds === 0) for (let round = 1; round < config.rounds; round++) {
      const last = phases.findLastIndex(p => p.round === round);
      assert.equal(phases[last].name, "Tobillos · Flexión plantar · Izquierdo");
      assert.equal(phases[last + 1].name, "Abdominales");
    }
  }
});
test("all field boundaries, empty/noninteger, exact four hours and overflow", () => {
  for (const field of STRENGTH_FIELDS) {
    for (const value of [field.min, field.max]) assert.ok(!validateStrengthConfig({ ...initial, [field.key]: value }).some(e => e.field === field.key));
    for (const value of [field.min - 1, field.max + 1, NaN, 1.5, Infinity]) {
      assert.ok(validateStrengthConfig({ ...initial, [field.key]: value }).some(e => e.field === field.key));
      assert.throws(() => createStrengthRun({ ...initial, [field.key]: value }, 0));
    }
  }
  const exact = { ...initial, rounds: 1, warmupSeconds: 48, exerciseSeconds: 452, internalChangeSeconds: 4, groupChangeSeconds: 0 };
  assert.equal(strengthDurations(exact).total, 14400);
  assert.deepEqual(validateStrengthConfig(exact), []);
  assert.deepEqual(validateStrengthConfig({ ...exact, internalChangeSeconds: 3 }), []);
  assert.ok(validateStrengthConfig({ ...exact, internalChangeSeconds: 5 }).some(e => e.field === "total"));
});
test("full execution records 50 minutes with separate warmup, exercise and changes", () => {
  const run = createStrengthRun(initial, 0), s = advance(run, 3330000);
  assert.equal(s.complete, true);
  assert.deepEqual(strengthBreakdown(run.phases, s.elapsedMs), { warmupMs: 90000, exerciseMs: 2790000 });
  assert.equal(s.workMs + s.restMs, 3000000);
  assert.equal(s.changeMs, 330000);
  const text = strengthDiaryText(initial, run.phases, s, String);
  assert.ok(text.includes("calentamiento, ejercicios y descansos"));
  assert.ok(text.length <= 2000);
  assert.equal(s.firstWorkAt, Date.UTC(2026, 10, 24));
  assert.deepEqual(s.sounds, ["finish"]);
});
test("pause/resume inside change and rest excludes pauses and preserves phase", () => {
  const config = { ...initial, rounds: 2, warmupSeconds: 1, exerciseSeconds: 1, internalChangeSeconds: 1, groupChangeSeconds: 1, restSeconds: 5 };
  for (const kind of ["work", "change", "rest"]) {
    const run = createStrengthRun(config, 0);
    const index = run.phases.findIndex(p => p.kind === kind);
    const at = run.phases.slice(0, index).reduce((sum, p) => sum + p.durationMs, 0) + 500;
    advance(run, at);
    const paused = pauseBlockRun(run, at, at);
    assert.equal(paused.phase?.kind, kind);
    assert.equal(tickBlockRun(run, at + 10000, at + 10000).elapsedMs, paused.elapsedMs);
    const resumed = resumeBlockRun(run, at + 10000);
    assert.equal(resumed.pausedMs, 10000);
    assert.equal(resumed.phaseIndex, paused.phaseIndex);
    assert.deepEqual(tickBlockRun(run, at + 10000, at + 10000).sounds, []);
  }
});
test("incoming phase signals only, countdown excludes changes, gap pauses", () => {
  const run = createStrengthRun(initial, 0);
  assert.deepEqual(tickBlockRun(run, 0, 0).sounds, ["start"]);
  assert.deepEqual(advance(run, 12000).sounds, ["count-3"]);
  assert.deepEqual(advance(run, 15000).sounds, ["rest"]);
  assert.deepEqual(advance(run, 18000).sounds, []);
  assert.deepEqual(advance(run, 20000).sounds, ["start"]);
  const before = run.elapsedMs;
  assert.equal(tickBlockRun(run, 23001, 23001).paused, true);
  assert.equal(run.elapsedMs, before);
});
test("visibility pause exactly at phase boundary does not consume hidden time or replay sound", () => {
  const run = createStrengthRun(initial, 0);
  advance(run, 14900);
  const paused = pauseBlockRun(run, 15000, 15000);
  assert.equal(paused.phase?.kind, "change");
  resumeBlockRun(run, 25000);
  const resumed = tickBlockRun(run, 25000, 25000);
  assert.equal(resumed.elapsedMs, 15000);
  assert.deepEqual(resumed.sounds, []);
  assert.equal(finishBlockRun(run, 25100, 25100).changeMs, 100);
});

test("rest entry/countdown/exit signals and no signals for omitted phases", () => {
  const c = { ...initial, rounds: 2, warmupSeconds: 1, exerciseSeconds: 1, internalChangeSeconds: 0, groupChangeSeconds: 0, restSeconds: 5 };
  const run = createStrengthRun(c, 0);
  assert.deepEqual(advance(run, 37000).sounds, ["rest"]);
  assert.deepEqual(advance(run, 39000).sounds, ["count-3"]);
  assert.deepEqual(advance(run, 40000).sounds, ["count-2"]);
  assert.deepEqual(advance(run, 41000).sounds, ["count-1"]);
  assert.deepEqual(advance(run, 42000).sounds, ["start"]);
  const direct = createStrengthRun({ ...c, restSeconds: 0 }, 0);
  assert.deepEqual(advance(direct, 37000).sounds, ["start"]);
});
