import { BLOCK_TIMER_MAX_TOTAL_MS, createPhaseRun, type BlockPhase, type BlockRun, type BlockSnapshot } from "./block-timer.ts";

export const STRENGTH_FIELDS = [
  { key: "rounds", label: "Vueltas", min: 1, max: 100, initial: 3 },
  { key: "warmupSeconds", label: "Segundos por articulación", min: 1, max: 3600, initial: 15 },
  { key: "exerciseSeconds", label: "Duración por lado (segundos)", min: 1, max: 3600, initial: 30 },
  { key: "internalChangeSeconds", label: "Cambios dentro del grupo (segundos)", min: 0, max: 60, initial: 3 },
  { key: "groupChangeSeconds", label: "Cambios entre grupos (segundos)", min: 0, max: 60, initial: 5 },
  { key: "restSeconds", label: "Descanso entre vueltas (segundos)", min: 0, max: 3600, initial: 60 },
] as const;
export type StrengthConfig = Record<(typeof STRENGTH_FIELDS)[number]["key"], number>;
export const INITIAL_STRENGTH_CONFIG: StrengthConfig = { rounds: 3, warmupSeconds: 15, exerciseSeconds: 30, internalChangeSeconds: 3, groupChangeSeconds: 5, restSeconds: 60 };
export const WARMUP_GROUPS = ["Hombros", "Codos", "Muñecas", "Cadera", "Rodillas", "Tobillos"];
export const STRENGTH_GROUPS = [
  { group: "Abdominales", movements: ["Abdominales"], bilateral: false },
  { group: "Hombros", movements: ["Flexión", "Extensión", "Aducción", "Abducción", "Rotación interna", "Rotación externa"], bilateral: true },
  { group: "Brazos", movements: ["Bíceps", "Tríceps"], bilateral: true },
  { group: "Cadera", movements: ["Flexión", "Extensión", "Aducción", "Abducción"], bilateral: true },
  { group: "Rodillas", movements: ["Flexión", "Extensión"], bilateral: true },
  { group: "Tobillos", movements: ["Flexión plantar"], bilateral: true },
];
export function strengthDurations(c: StrengthConfig) {
  const warmup = 6 * c.warmupSeconds + 6 * c.groupChangeSeconds;
  const round = 31 * c.exerciseSeconds + 25 * c.internalChangeSeconds + 5 * c.groupChangeSeconds;
  return { warmup, round, total: warmup + c.rounds * round + (c.rounds - 1) * c.restSeconds };
}
export function validateStrengthConfig(c: StrengthConfig) {
  const errors: { field: string; message: string }[] = [];
  for (const f of STRENGTH_FIELDS) if (!Number.isInteger(c[f.key]) || c[f.key] < f.min || c[f.key] > f.max) errors.push({ field: f.key, message: `${f.label}: ingresá un entero entre ${f.min} y ${f.max}.` });
  if (!errors.length && strengthDurations(c).total * 1000 > BLOCK_TIMER_MAX_TOTAL_MS) errors.push({ field: "total", message: "La sesión no puede superar cuatro horas. Reducí los tiempos o las vueltas." });
  return errors;
}
export function generateStrengthPhases(c: StrengthConfig): BlockPhase[] {
  if (STRENGTH_FIELDS.some(f => !Number.isInteger(c[f.key]) || c[f.key] < f.min || c[f.key] > f.max)) return [];
  const phases: BlockPhase[] = [];
  function add(kind: BlockPhase["kind"], seconds: number, name: string, round: number, metadata: Partial<BlockPhase> = {}) {
    if (seconds > 0) phases.push({ kind, durationMs: seconds * 1000, name, round, blockIndex: phases.length, nextName: null, ...metadata });
  }
  for (const group of WARMUP_GROUPS) {
    add("work", c.warmupSeconds, group, 0, { stage: "warmup", group });
    add("change", c.groupChangeSeconds, "Cambio", 0, { stage: "warmup" });
  }
  for (let round = 1; round <= c.rounds; round++) {
    STRENGTH_GROUPS.forEach(({ group, movements, bilateral }, groupIndex) => {
      let first = true;
      for (const movement of movements) for (const side of bilateral ? ["Derecho", "Izquierdo"] as const : [undefined]) {
        if (!first) add("change", c.internalChangeSeconds, "Cambio", round, { stage: "exercise", group });
        first = false;
        add("work", c.exerciseSeconds, bilateral ? `${group} · ${movement} · ${side}` : group, round, { stage: "exercise", group, movement, side });
      }
      if (groupIndex < STRENGTH_GROUPS.length - 1) add("change", c.groupChangeSeconds, "Cambio", round, { stage: "exercise" });
    });
    if (round < c.rounds) add("rest", c.restSeconds, "Descanso entre vueltas", round, { stage: "rest" });
  }
  let nextName: string | null = null;
  for (let i = phases.length - 1; i >= 0; i--) {
    phases[i].nextName = nextName;
    if (phases[i].kind !== "change") nextName = phases[i].name;
  }
  return phases;
}
export function createStrengthRun(c: StrengthConfig, now: number): BlockRun {
  const errors = validateStrengthConfig(c);
  if (errors.length) throw new Error(errors[0].message);
  return createPhaseRun({ blocks: [], rounds: c.rounds, changeSeconds: 0, omitFinalRest: false }, generateStrengthPhases(c), now, true);
}
export function strengthBreakdown(phases: BlockPhase[], elapsedMs: number) {
  let remaining = elapsedMs, warmupMs = 0, exerciseMs = 0;
  for (const phase of phases) {
    const executed = Math.max(0, Math.min(remaining, phase.durationMs));
    if (phase.kind === "work") { if (phase.stage === "warmup") warmupMs += executed; else exerciseMs += executed; }
    remaining -= executed;
    if (remaining <= 0) break;
  }
  return { warmupMs, exerciseMs };
}
export function strengthDiaryText(c: StrengthConfig, phases: BlockPhase[], s: BlockSnapshot, format: (seconds: number) => string) {
  const { warmupMs, exerciseMs } = strengthBreakdown(phases, s.elapsedMs);
  const time = (ms: number) => format(Math.floor(ms / 1000));
  return `Entrenamiento de fuerza · ${s.complete ? "Sesión completa" : "Sesión parcial"}.\nCalentamiento: ${time(warmupMs)}; ejercicios: ${time(exerciseMs)}; descansos: ${time(s.restMs)}; cambios: ${time(s.changeMs)}; pausas: ${time(s.pausedMs)}.\nTiempo registrado: ${time(s.workMs + s.restMs)}. Incluye calentamiento, ejercicios y descansos entre vueltas; excluye cambios y pausas. El calentamiento registrado excluye sus transiciones.\nPlan: ${c.rounds} vueltas; ${c.warmupSeconds} s por articulación; ${c.exerciseSeconds} s por lado (abdominales una sola vez por vuelta); cambios internos ${c.internalChangeSeconds} s y entre grupos ${c.groupChangeSeconds} s; descanso entre vueltas ${c.restSeconds} s.\n${STRENGTH_GROUPS.map(g => `${g.group}: ${g.movements.join(", ")}`).join(". ")}. Derecho y luego izquierdo en cada movimiento, excepto abdominales.`;
}
