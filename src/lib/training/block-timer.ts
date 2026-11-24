export const BLOCK_TIMER_MAX_TOTAL_MS = 4 * 60 * 60 * 1000;
export const BLOCK_TIMER_MAX_GAP_MS = 2000;
export type BlockKind = "work" | "rest";
export type BlockDefinition = { name: string; kind: BlockKind; durationSeconds: number };
export type BlockTimerConfig = { blocks: BlockDefinition[]; rounds: number; changeSeconds: number; omitFinalRest: boolean };
export type BlockPhaseKind = BlockKind | "change";
export type BlockPhase = { kind: BlockPhaseKind; durationMs: number; round: number; blockIndex: number; name: string; nextName: string | null; stage?: "warmup" | "exercise" | "rest"; group?: string; movement?: string; side?: "Derecho" | "Izquierdo" };
export type BlockValidation = { field: string; message: string };
export type BlockSnapshot = { phase: BlockPhase | null; phaseIndex: number; phaseElapsedMs: number; remainingMs: number; elapsedMs: number; totalMs: number; workMs: number; restMs: number; changeMs: number; pausedMs: number; firstWorkAt: number | null; paused: boolean; complete: boolean; sounds: string[] };
export type BlockRun = { soundChanges?: boolean; config: BlockTimerConfig; phases: BlockPhase[]; elapsedMs: number; lastSampleMono: number; anchorMono: number | null; anchorElapsedMs: number; lastSoundPhaseIndex: number | null; paused: boolean; complete: boolean; workMs: number; restMs: number; changeMs: number; pausedMs: number; pausedAtMono: number | null; firstWorkAt: number | null };

export const INITIAL_BLOCK_CONFIG: BlockTimerConfig = {
  blocks: [
    { name: "Bici", kind: "work", durationSeconds: 300 },
    { name: "Descanso", kind: "rest", durationSeconds: 40 },
    { name: "Ejercicio 1", kind: "work", durationSeconds: 60 },
    { name: "Ejercicio 2", kind: "work", durationSeconds: 60 },
    { name: "Ejercicio 3", kind: "work", durationSeconds: 60 },
    { name: "Ejercicio 4", kind: "work", durationSeconds: 60 },
    { name: "Descanso", kind: "rest", durationSeconds: 90 },
  ], rounds: 6, changeSeconds: 3, omitFinalRest: true,
};

export function generateBlockPhases(config: BlockTimerConfig): BlockPhase[] {
  const phases: BlockPhase[] = [];
  for (let round = 1; round <= config.rounds; round++) {
    const effectiveBlocks = round === config.rounds && config.omitFinalRest && config.blocks.at(-1)?.kind === "rest"
      ? config.blocks.slice(0, -1) : config.blocks;
    for (let index = 0; index < effectiveBlocks.length; index++) {
      const block = effectiveBlocks[index];
      if (phases.length && config.changeSeconds > 0) phases.push({ kind: "change", durationMs: config.changeSeconds * 1000, round, blockIndex: index, name: "Cambio", nextName: block.name });
      phases.push({ kind: block.kind, durationMs: block.durationSeconds * 1000, round, blockIndex: index, name: block.name, nextName: null });
    }
  }
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index];
    if (phase.kind === "change") continue;
    let next: BlockPhase | undefined;
    for (let cursor = index + 1; cursor < phases.length; cursor++) if (phases[cursor].kind !== "change") { next = phases[cursor]; break; }
    if (next) phases[index] = { ...phase, nextName: next.name };
  }
  return phases;
}

export function validateBlockTimer(config: BlockTimerConfig): BlockValidation[] {
  const errors: BlockValidation[] = [];
  if (config.blocks.length < 1 || config.blocks.length > 50) errors.push({ field: "blocks", message: "Agregá entre 1 y 50 bloques." });
  config.blocks.forEach((block, index) => {
    if (!block.name.trim()) errors.push({ field: `block-${index}-name`, message: "Escribí un nombre para este bloque." });
    if (Array.from(block.name.trim()).length > 80) errors.push({ field: `block-${index}-name`, message: "El nombre admite hasta 80 caracteres." });
    if (!Number.isInteger(block.durationSeconds) || block.durationSeconds < 1 || block.durationSeconds > 3600) errors.push({ field: `block-${index}-duration`, message: "La duración debe ser un número entero entre 1 y 3600 segundos." });
  });
  if (!Number.isInteger(config.rounds) || config.rounds < 1 || config.rounds > 100) errors.push({ field: "rounds", message: "Las vueltas deben ser un número entero entre 1 y 100." });
  if (!Number.isInteger(config.changeSeconds) || config.changeSeconds < 0 || config.changeSeconds > 60) errors.push({ field: "changeSeconds", message: "El cambio debe ser un número entero entre 0 y 60 segundos." });
  if (config.blocks.length > 0 && config.rounds >= 1 && config.rounds <= 100 && Number.isInteger(config.rounds) && Number.isInteger(config.changeSeconds) && config.changeSeconds >= 0 && config.changeSeconds <= 60 && config.blocks.every(block => Number.isInteger(block.durationSeconds) && block.durationSeconds >= 1 && block.durationSeconds <= 3600)) {
    const phases = generateBlockPhases(config);
    if (!phases.some(phase => phase.kind === "work")) errors.push({ field: "blocks", message: "La secuencia debe incluir al menos un bloque de trabajo." });
    if (phases.reduce((sum, phase) => sum + phase.durationMs, 0) > BLOCK_TIMER_MAX_TOTAL_MS) errors.push({ field: "rounds", message: "El circuito no puede superar cuatro horas." });
  }
  return errors;
}

function snapshot(run: BlockRun, sounds: string[] = []): BlockSnapshot {
  let cursor = 0;
  for (let index = 0; index < run.phases.length; index++) {
    const phase = run.phases[index];
    if (run.elapsedMs < cursor + phase.durationMs) {
      const phaseElapsedMs = run.elapsedMs - cursor;
      return { phase, phaseIndex: index, phaseElapsedMs, remainingMs: phase.durationMs - phaseElapsedMs, elapsedMs: run.elapsedMs, totalMs: run.phases.reduce((sum, item) => sum + item.durationMs, 0), workMs: run.workMs, restMs: run.restMs, changeMs: run.changeMs, pausedMs: run.pausedMs, firstWorkAt: run.firstWorkAt, paused: run.paused, complete: false, sounds };
    }
    cursor += phase.durationMs;
  }
  return { phase: null, phaseIndex: run.phases.length, phaseElapsedMs: 0, remainingMs: 0, elapsedMs: run.elapsedMs, totalMs: cursor, workMs: run.workMs, restMs: run.restMs, changeMs: run.changeMs, pausedMs: run.pausedMs, firstWorkAt: run.firstWorkAt, paused: run.paused, complete: true, sounds };
}

export function createBlockRun(config: BlockTimerConfig, monotonicNow: number): BlockRun {
  const errors = validateBlockTimer(config);
  if (errors.length) throw new Error(errors[0].message);
  return createPhaseRun(config, generateBlockPhases(config), monotonicNow);
}

export function createPhaseRun(config: BlockTimerConfig, phases: BlockPhase[], monotonicNow: number, soundChanges = false): BlockRun {
  return { soundChanges, config: structuredClone(config), phases, elapsedMs: 0, lastSampleMono: monotonicNow, anchorMono: monotonicNow, anchorElapsedMs: 0, lastSoundPhaseIndex: null, paused: false, complete: false, workMs: 0, restMs: 0, changeMs: 0, pausedMs: 0, pausedAtMono: null, firstWorkAt: null };
}

function accrue(run: BlockRun, nextElapsed: number, monotonicNow: number, wallNow: number) {
  const previous = run.elapsedMs;
  let offset = 0;
  for (const phase of run.phases) {
    const overlap = Math.max(0, Math.min(nextElapsed, offset + phase.durationMs) - Math.max(previous, offset));
    if (overlap) {
      if (phase.kind === "work") {
        run.workMs += overlap;
        if (run.firstWorkAt === null) {
          const phaseStartMono = (run.anchorMono ?? monotonicNow) + Math.max(0, offset - run.anchorElapsedMs);
          run.firstWorkAt = wallNow - Math.max(0, monotonicNow - phaseStartMono);
        }
      }
      else if (phase.kind === "rest") run.restMs += overlap;
      else run.changeMs += overlap;
    }
    offset += phase.durationMs;
  }
  run.elapsedMs = nextElapsed;
  if (nextElapsed >= offset) { run.complete = true; run.anchorMono = null; }
}

export function tickBlockRun(run: BlockRun, monotonicNow: number, wallNow: number): BlockSnapshot {
  if (run.paused || run.complete || run.anchorMono === null) return snapshot(run);
  const gap = monotonicNow - run.lastSampleMono;
  if (gap < 0 || gap > BLOCK_TIMER_MAX_GAP_MS) { run.paused = true; run.pausedAtMono = run.lastSampleMono; run.anchorMono = null; return snapshot(run); }
  const before = snapshot(run);
  const nextElapsed = Math.min(run.phases.reduce((sum, phase) => sum + phase.durationMs, 0), run.anchorElapsedMs + (monotonicNow - run.anchorMono));
  accrue(run, nextElapsed, monotonicNow, wallNow);
  run.lastSampleMono = monotonicNow;
  const current = snapshot(run);
  const sounds: string[] = [];
  if (run.lastSoundPhaseIndex === null && current.phase) {
    if (current.phase.kind !== "change" || run.soundChanges) sounds.push(current.phase.kind === "rest" || current.phase.kind === "change" ? "rest" : "start");
    run.lastSoundPhaseIndex = current.phaseIndex;
  } else if (current.phase && current.phaseIndex > (run.lastSoundPhaseIndex ?? before.phaseIndex)) {
    for (let index = (run.lastSoundPhaseIndex ?? before.phaseIndex) + 1; index <= current.phaseIndex; index++) {
      const entered = run.phases[index];
      if (entered && (entered.kind !== "change" || run.soundChanges)) sounds.push(entered.kind === "rest" || entered.kind === "change" ? "rest" : "start");
    }
    run.lastSoundPhaseIndex = current.phaseIndex;
  }
  if (current.complete) sounds.push("finish");
  for (let index = before.phaseIndex; index <= current.phaseIndex && index < run.phases.length; index++) {
    const phase = run.phases[index];
    if (phase.kind === "change" || phase.durationMs <= 3000) continue;
    const phaseStart = run.phases.slice(0, index).reduce((sum, item) => sum + item.durationMs, 0);
    const oldRemaining = phase.durationMs - Math.max(0, before.elapsedMs - phaseStart);
    const newRemaining = phase.durationMs - Math.max(0, Math.min(nextElapsed, phaseStart + phase.durationMs) - phaseStart);
    for (const seconds of [3, 2, 1]) if (oldRemaining > seconds * 1000 && newRemaining <= seconds * 1000) sounds.push(`count-${seconds}`);
  }
  if (run.soundChanges && current.complete) return snapshot(run, ["finish"]);
  if (run.soundChanges && current.phaseIndex !== before.phaseIndex && current.phase) return snapshot(run, [current.phase.kind === "work" ? "start" : "rest"]);
  return snapshot(run, [...new Set(sounds)]);
}

export function pauseBlockRun(run: BlockRun, monotonicNow: number, wallNow: number): BlockSnapshot {
  if (!run.paused && !run.complete) tickBlockRun(run, monotonicNow, wallNow);
  if (!run.complete) { run.paused = true; run.pausedAtMono = monotonicNow; run.anchorMono = null; }
  return snapshot(run);
}
export function resumeBlockRun(run: BlockRun, monotonicNow: number): BlockSnapshot {
  if (!run.complete && run.paused) {
    if (run.pausedAtMono !== null) run.pausedMs += Math.max(0, monotonicNow - run.pausedAtMono);
    run.paused = false; run.anchorMono = monotonicNow; run.anchorElapsedMs = run.elapsedMs; run.lastSampleMono = monotonicNow; run.pausedAtMono = null;
  }
  return snapshot(run);
}
export function finishBlockRun(run: BlockRun, monotonicNow: number, wallNow: number): BlockSnapshot {
  if (!run.paused) tickBlockRun(run, monotonicNow, wallNow);
  if (run.paused) { run.pausedMs += Math.max(0, monotonicNow - (run.pausedAtMono ?? monotonicNow)); run.pausedAtMono = null; }
  run.paused = true; run.anchorMono = null;
  return snapshot(run);
}

export function blockDiaryText(config: BlockTimerConfig, summary: BlockSnapshot, formatDuration: (seconds: number) => string): string {
  const executed = `Ejecutado: trabajo ${formatDuration(Math.floor(summary.workMs / 1000))}; descansos ${formatDuration(Math.floor(summary.restMs / 1000))}; cambios ${formatDuration(Math.floor(summary.changeMs / 1000))}; pausas ${formatDuration(Math.floor(summary.pausedMs / 1000))}.`;
  const roundsReached = summary.complete ? config.rounds : Math.max(0, (summary.phase?.round ?? 1) - 1);
  const completion = `Vueltas completadas: ${roundsReached} de ${config.rounds}. ${summary.complete ? "Sesión completa." : `Finalizó en ${summary.phase?.name ?? "la sesión"}.`}`;
  const header = `Entrenamiento por bloques · ${completion}\n${executed}\n`;
  const names = config.blocks.map(block => block.name.trim());
  const fullCircuit = `Circuito (${names.length} bloques): ${names.join(" · ")}. Cambio ${formatDuration(config.changeSeconds)}.\n`;
  const footer = `Configuración: ${config.rounds} vueltas; cambio ${formatDuration(config.changeSeconds)}; último descanso ${config.omitFinalRest && config.blocks.at(-1)?.kind === "rest" ? "omitido" : "incluido"}.`;
  const max = 2000;
  if (header.length + fullCircuit.length + footer.length <= max) return `${header}${fullCircuit}${footer}`;
  const circuitLead = `Circuito (${names.length} bloques): `;
  let included = "";
  for (const name of names) {
    const candidate = included ? `${included} · ${name}` : name;
    if (header.length + circuitLead.length + candidate.length + " · … (nombres resumidos)".length + footer.length > max) break;
    included = candidate;
  }
  const compactCircuit = `${circuitLead}${included}${included.length < names.join(" · ").length ? " · … (nombres resumidos)" : ""}.\n`;
  return `${header}${compactCircuit}${footer}`;
}
