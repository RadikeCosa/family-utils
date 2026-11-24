import assert from "node:assert/strict";
import test from "node:test";
import { blockDiaryText, BLOCK_TIMER_MAX_TOTAL_MS, createBlockRun, finishBlockRun, generateBlockPhases, INITIAL_BLOCK_CONFIG, pauseBlockRun, resumeBlockRun, tickBlockRun, validateBlockTimer, type BlockTimerConfig } from "./block-timer.ts";

function config(overrides: Partial<BlockTimerConfig> = {}): BlockTimerConfig {
  return { blocks: [{ name: "Uno", kind: "work", durationSeconds: 10 }, { name: "Pausa", kind: "rest", durationSeconds: 5 }], rounds: 1, changeSeconds: 2, omitFinalRest: false, ...overrides };
}

test("circuito inicial suma 63:30 con el descanso final omitido y cambios de 3 segundos", () => {
  assert.equal(generateBlockPhases(INITIAL_BLOCK_CONFIG).reduce((sum, phase) => sum + phase.durationMs, 0), 63 * 60_000 + 30_000);
  assert.equal(INITIAL_BLOCK_CONFIG.changeSeconds, 3);
  assert.ok(generateBlockPhases(INITIAL_BLOCK_CONFIG).filter(phase => phase.kind === "change").every(phase => phase.durationMs === 3000));
});
test("una vuelta, cambio cero y omisión aplicada solo al descanso final", () => {
  assert.equal(generateBlockPhases(config({ rounds: 1, changeSeconds: 0 })).reduce((sum, p) => sum + p.durationMs, 0), 15_000);
  const omitted = generateBlockPhases(config({ rounds: 2, omitFinalRest: true }));
  assert.equal(omitted.filter(p => p.kind === "rest").length, 1);
  assert.equal(omitted.filter(p => p.kind === "change").length, 2);
  const workLast = config({ blocks: [{ name: "Trabajo", kind: "work", durationSeconds: 10 }], omitFinalRest: true });
  assert.equal(generateBlockPhases(workLast).length, 1);
  assert.ok(!validateBlockTimer(workLast).some(error => error.field === "omitFinalRest"));
});
test("valida secuencia de hasta cuatro horas y rechaza el exceso", () => {
  const exactly = config({ blocks: [{ name: "A", kind: "work", durationSeconds: 3600 }, { name: "B", kind: "work", durationSeconds: 3600 }, { name: "C", kind: "work", durationSeconds: 3600 }, { name: "D", kind: "work", durationSeconds: 3600 }], rounds: 1, changeSeconds: 0 });
  assert.equal(generateBlockPhases(exactly).reduce((sum, p) => sum + p.durationMs, 0), BLOCK_TIMER_MAX_TOTAL_MS);
  assert.deepEqual(validateBlockTimer(exactly), []);
  assert.ok(validateBlockTimer(config({ blocks: [...exactly.blocks, { name: "E", kind: "work", durationSeconds: 1 }], rounds: 1, changeSeconds: 0 })).some(error => error.message.includes("cuatro horas")));
});
test("admite límites de 1 y 50 bloques y de 1 y 100 vueltas", () => {
  assert.deepEqual(validateBlockTimer(config({ blocks: [{ name: "A", kind: "work", durationSeconds: 1 }], rounds: 1, changeSeconds: 0 })), []);
  assert.deepEqual(validateBlockTimer(config({ blocks: Array.from({ length: 50 }, (_, index) => ({ name: `A${index}`, kind: "work" as const, durationSeconds: 1 })), rounds: 100, changeSeconds: 0, omitFinalRest: false })), []);
  assert.ok(validateBlockTimer(config({ blocks: Array.from({ length: 51 }, () => ({ name: "A", kind: "work" as const, durationSeconds: 1 })) })).some(error => error.field === "blocks"));
});
test("el reloj monotónico conserva tiempo exacto al pausar durante un cambio", () => {
  const run = createBlockRun(config(), 100);
  for (let mono = 2100; mono <= 10_100; mono += 2000) tickBlockRun(run, mono, 1_000_000 + mono - 100);
  const inChange = tickBlockRun(run, 10_600, 1_010_500);
  assert.equal(inChange.phase?.kind, "change");
  const paused = pauseBlockRun(run, 10_900, 1_010_800);
  assert.equal(paused.remainingMs, 1200);
  resumeBlockRun(run, 20_900);
  assert.equal(tickBlockRun(run, 22_000, 1_011_900).phase?.kind, "change");
  assert.equal(tickBlockRun(run, 22_100, 1_012_000).phase?.kind, "rest");
});
test("un salto mayor a dos segundos pausa sin consumirlo y los ticks irregulares no derivan", () => {
  const run = createBlockRun(config(), 0);
  tickBlockRun(run, 900, 1_000_900);
  const paused = tickBlockRun(run, 3_001, 1_003_001);
  assert.equal(paused.paused, true);
  assert.equal(paused.elapsedMs, 900);
});
test("finalización parcial registra trabajo y descansos, pero excluye cambios y pausas", () => {
  const run = createBlockRun(config(), 0);
  for (let mono = 1000; mono <= 15_000; mono += 1000) tickBlockRun(run, mono, 1_000_000 + mono);
  const summary = finishBlockRun(run, 15_000, 1_015_000);
  assert.equal(summary.workMs, 10_000);
  assert.equal(summary.restMs, 3_000);
  assert.equal(summary.changeMs, 2_000);
});
test("fecha civil del primer trabajo queda fijada aunque el resumen llegue luego", () => {
  const run = createBlockRun(config({ blocks: [{ name: "Trabajo", kind: "work", durationSeconds: 10 }], changeSeconds: 0 }), 0);
  tickBlockRun(run, 1000, Date.parse("2026-11-23T00:00:00-03:00"));
  assert.equal(new Date(run.firstWorkAt!).toISOString(), "2026-11-23T02:59:59.000Z");
});
test("sonidos de inicio, cuenta final y fin se emiten una sola vez", () => {
  const run = createBlockRun(config({ blocks: [{ name: "Trabajo", kind: "work", durationSeconds: 5 }, { name: "Descanso", kind: "rest", durationSeconds: 4 }], rounds: 1, changeSeconds: 1 }), 0);
  const sounds: string[] = [];
  for (let mono = 0; mono <= 10_000; mono += 500) sounds.push(...tickBlockRun(run, mono, 1_000_000 + mono).sounds);
  assert.equal(sounds.filter(sound => sound === "start").length, 1);
  assert.equal(sounds.filter(sound => sound === "rest").length, 1);
  for (const second of [1, 2, 3]) assert.equal(sounds.filter(sound => sound === `count-${second}`).length, 2);
  assert.equal(sounds.filter(sound => sound === "finish").length, 1);
});
test("finalizar durante trabajo, cambio o pausa conserva solo tiempos activos", () => {
  const duringWork = createBlockRun(config({ blocks: [{ name: "Trabajo", kind: "work", durationSeconds: 10 }], changeSeconds: 0 }), 0);
  const workSummary = finishBlockRun(duringWork, 1500, 1_001_500);
  assert.equal(workSummary.workMs, 1500);
  const duringChange = createBlockRun(config(), 0);
  for (let mono = 1000; mono <= 10_000; mono += 1000) tickBlockRun(duringChange, mono, 1_000_000 + mono);
  const changeSummary = finishBlockRun(duringChange, 10_500, 1_010_500);
  assert.equal(changeSummary.changeMs, 500);
  assert.equal(changeSummary.restMs, 0);
  const duringPause = createBlockRun(config(), 0);
  tickBlockRun(duringPause, 1000, 1_001_000);
  pauseBlockRun(duringPause, 1000, 1_001_000);
  const pausedSummary = finishBlockRun(duringPause, 6000, 1_006_000);
  assert.equal(pausedSummary.workMs, 1000);
  assert.equal(pausedSummary.pausedMs, 5000);
});
test("el texto del diario resume nombres largos y conserva siempre los tiempos ejecutados", () => {
  const longConfig = config({ blocks: Array.from({ length: 50 }, (_, index) => ({ name: `Ejercicio ${index + 1} ${"nombre ".repeat(8)}`, kind: "work" as const, durationSeconds: 1 })), rounds: 1, changeSeconds: 0 });
  const run = createBlockRun(longConfig, 0);
  tickBlockRun(run, 1000, 1_001_000);
  const summary = finishBlockRun(run, 1000, 1_001_000);
  const text = blockDiaryText(longConfig, summary, seconds => `${seconds} segundos`);
  assert.ok(text.length <= 2000);
  assert.match(text, /Circuito \(50 bloques\)/);
  assert.match(text, /Ejecutado: trabajo 1 segundos; descansos 0 segundos; cambios 0 segundos; pausas 0 segundos\./);
  assert.match(text, /nombres resumidos/);
});
