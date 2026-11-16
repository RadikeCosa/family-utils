import { dayInZone } from "../calendar/civil.ts";

export const HIIT_MAX_TOTAL_MS = 4 * 60 * 60 * 1000;
export const HIIT_MIN_WORK_MS = 1000;
export const HIIT_MAX_GAP_MS = 2000;
export type HiitStage = "preparation" | "work" | "rest" | "complete";
export interface HiitConfig { preparationSeconds: number; workSeconds: number; restSeconds: number; rounds: number }
export interface HiitSnapshot { stage: HiitStage; remainingMs: number; elapsedMs: number; workMs: number; restMs: number; preparationMs: number; pausedMs: number; round: number; completedRounds: number; stageElapsedMs: number; stageDurationMs: number; nextStage: HiitStage | null; paused: boolean; complete: boolean; sounds: string[] }
export const HIIT_PRESETS: { name: string; config: HiitConfig }[] = [
  { name: "20/10 × 8", config: { preparationSeconds: 10, workSeconds: 20, restSeconds: 10, rounds: 8 } },
  { name: "40/20 × 8", config: { preparationSeconds: 10, workSeconds: 40, restSeconds: 20, rounds: 8 } },
];
export function hiitTrainingMs(config: HiitConfig) { return (config.workSeconds * config.rounds + config.restSeconds * Math.max(0, config.rounds - 1)) * 1000; }
export function hiitTotalMs(config: HiitConfig) { return config.preparationSeconds * 1000 + hiitTrainingMs(config); }
export function validateHiitConfig(config: HiitConfig): string | null {
  if (![config.preparationSeconds, config.workSeconds, config.restSeconds, config.rounds].every(Number.isInteger) || config.preparationSeconds < 0 || config.preparationSeconds > 3600 || config.workSeconds < 1 || config.workSeconds > 3600 || config.restSeconds < 0 || config.restSeconds > 3600 || config.rounds < 1 || config.rounds > 100) return "Revisá los tiempos y las rondas permitidos.";
  return hiitTotalMs(config) > HIIT_MAX_TOTAL_MS ? "El temporizador no puede superar 4 horas. Reducí los tiempos o las rondas" : null;
}
type Segment = { stage: Exclude<HiitStage, "complete">; round: number; duration: number };
function segments(config: HiitConfig): Segment[] {
  const result: Segment[] = [];
  if (config.preparationSeconds) result.push({ stage: "preparation", round: 0, duration: config.preparationSeconds * 1000 });
  for (let round = 1; round <= config.rounds; round++) {
    result.push({ stage: "work", round, duration: config.workSeconds * 1000 });
    if (round < config.rounds && config.restSeconds) result.push({ stage: "rest", round, duration: config.restSeconds * 1000 });
  }
  return result;
}
export function createHiitRun(config: HiitConfig, now: number) {
  const error = validateHiitConfig(config); if (error) throw new Error(error);
  return { config: { ...config }, segments: segments(config), elapsedMs: 0, lastTick: now, paused: false, complete: false, firstWorkAt: null as number | null, workMs: 0, restMs: 0, preparationMs: 0, pausedMs: 0 };
}
export type HiitRun = ReturnType<typeof createHiitRun>;
function snapshot(run: HiitRun, sounds: string[] = []): HiitSnapshot {
  let before = 0; const index = run.segments.findIndex(item => run.elapsedMs < (before += item.duration));
  if (index < 0) return { stage: "complete", remainingMs: 0, elapsedMs: run.elapsedMs, workMs: run.workMs, restMs: run.restMs, preparationMs: run.preparationMs, pausedMs: run.pausedMs, round: run.config.rounds, completedRounds: run.config.rounds, stageElapsedMs: 0, stageDurationMs: 0, nextStage: null, paused: run.paused, complete: true, sounds };
  const segment = run.segments[index], start = before - segment.duration, stageElapsedMs = run.elapsedMs - start;
  return { stage: segment.stage, remainingMs: segment.duration - stageElapsedMs, elapsedMs: run.elapsedMs, workMs: run.workMs, restMs: run.restMs, preparationMs: run.preparationMs, pausedMs: run.pausedMs, round: segment.round, completedRounds: run.workMs > 0 ? Math.min(run.config.rounds, Math.floor(run.workMs / (run.config.workSeconds * 1000))) : 0, stageElapsedMs, stageDurationMs: segment.duration, nextStage: run.segments[index + 1]?.stage ?? null, paused: run.paused, complete: run.complete, sounds };
}
export function tickHiit(run: HiitRun, now: number): HiitSnapshot {
  if (run.paused || run.complete) return snapshot(run);
  const beforeState = snapshot(run);
  const gap = now - run.lastTick;
  if (gap < 0 || gap > HIIT_MAX_GAP_MS) { run.paused = true; return snapshot(run); }
  const previous = run.elapsedMs, next = Math.min(hiitTotalMs(run.config), previous + gap);
  let cursor = 0;
  for (const segment of run.segments) {
    const start = cursor, end = start + segment.duration;
    const overlap = Math.max(0, Math.min(next, end) - Math.max(previous, start));
    if (overlap) {
      if (segment.stage === "preparation") run.preparationMs += overlap;
      if (segment.stage === "work") { run.workMs += overlap; if (run.firstWorkAt === null) run.firstWorkAt = run.lastTick + Math.max(0, start - previous); }
      if (segment.stage === "rest") run.restMs += overlap;
    }
    cursor = end;
  }
  run.elapsedMs = next; run.lastTick = now;
  if (next >= hiitTotalMs(run.config)) run.complete = true;
  const current = snapshot(run);
  const sounds: string[] = [];
  if (beforeState.stage !== current.stage || beforeState.round !== current.round) sounds.push(current.stage === "work" ? "start" : current.stage === "rest" ? "rest" : "start");
  if (current.complete && previous < hiitTotalMs(run.config)) sounds.push("finish");
  const countdown = [3, 2, 1];
  for (const second of countdown) if (beforeState.remainingMs > second * 1000 && current.remainingMs <= second * 1000 && current.stageDurationMs > second * 1000) sounds.push(`count-${second}`);
  return snapshot(run, [...new Set(sounds)]);
}
export function pauseHiit(run: HiitRun, now: number) { if (!run.paused && !run.complete) tickHiit(run, now); run.paused = true; return snapshot(run); }
export function resumeHiit(run: HiitRun, now: number) { if (!run.complete) { if (run.paused) run.pausedMs += Math.max(0, now - run.lastTick); run.paused = false; run.lastTick = now; } return snapshot(run); }
export function finishHiit(run: HiitRun, now: number) { if (run.paused) { run.pausedMs += Math.max(0, now - run.lastTick); run.lastTick = now; } else pauseHiit(run, now); run.paused = true; run.complete = true; return snapshot(run); }
export function hiitCanRegister(run: HiitRun) { return run.workMs >= HIIT_MIN_WORK_MS && run.firstWorkAt !== null; }
export function hiitCivilDate(timestamp: number, timeZone: string) { return dayInZone(new Date(timestamp), timeZone); }
