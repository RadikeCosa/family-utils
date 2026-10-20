import type { RoutineInput, SessionInput, TrainingBlock, TrainingExercise } from "./types.ts";

export const LIMITS = { name: 120, blockName: 80, note: 2000, blocks: 20, exercises: 30, rounds: 100, repetitions: 1000, seconds: 14400, durationSeconds: 86400, bodyBytes: 512 * 1024 } as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class TrainingValidationError extends Error {}
function invalid(message: string): never { throw new TrainingValidationError(message); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Datos inválidos.");
  return value as Record<string, unknown>;
}
export function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid("El formulario contiene campos no permitidos.");
}
function text(value: unknown, label: string, max: number, required = true) {
  if (typeof value !== "string") invalid(`${label}: ingresá texto.`);
  if (value.includes("\0") || /[\uD800-\uDFFF]/u.test(value)) invalid(`${label}: contiene caracteres no válidos.`);
  const normalized = value.trim();
  if ((required && !normalized) || Array.from(normalized).length > max) invalid(`${label}: ${required ? "entre 1 y" : "hasta"} ${max} caracteres.`);
  return normalized;
}
export function integer(value: unknown, label: string, max: number, min = 1): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid(`${label}: ingresá un entero entre ${min} y ${max}.`);
  return value;
}
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid("Identificador inválido.");
  return value.toLowerCase();
}
export function todayInZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find((entry) => entry.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") invalid("Fecha inválida.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid("Fecha inválida.");
  return value;
}
export function validateRoutine(value: unknown): RoutineInput {
  const input = object(value);
  const name = text(input.name, "Nombre", LIMITS.name);
  if (!Array.isArray(input.blocks) || !input.blocks.length || input.blocks.length > LIMITS.blocks) invalid(`Agregá entre 1 y ${LIMITS.blocks} bloques.`);
  const blocks: TrainingBlock[] = input.blocks.map((raw) => {
    const block = object(raw); onlyKeys(block, ["name", "rounds", "exercises"]);
    if (!Array.isArray(block.exercises) || !block.exercises.length || block.exercises.length > LIMITS.exercises) invalid(`Cada bloque necesita entre 1 y ${LIMITS.exercises} ejercicios.`);
    const exercises: TrainingExercise[] = block.exercises.map((rawExercise) => {
      const exercise = object(rawExercise);
      const name = text(exercise.name, "Ejercicio", LIMITS.name);
      if (exercise.mode === "repetitions") {
        onlyKeys(exercise, ["name", "mode", "repetitions"]);
        return { name, mode: "repetitions", repetitions: integer(exercise.repetitions, "Repeticiones", LIMITS.repetitions) };
      }
      if (exercise.mode === "time") {
        onlyKeys(exercise, ["name", "mode", "seconds"]);
        return { name, mode: "time", seconds: integer(exercise.seconds, "Segundos", LIMITS.seconds) };
      }
      return invalid("Elegí repeticiones o tiempo para cada ejercicio.");
    });
    return { name: text(block.name ?? "", "Nombre del bloque", LIMITS.blockName, false), rounds: integer(block.rounds, "Vueltas", LIMITS.rounds), exercises };
  });
  return { name, blocks };
}
export function validateSession(value: unknown, today: string): SessionInput {
  const input = object(value);
  const performedOn = calendarDate(input.performedOn);
  if (performedOn > today) invalid("La fecha no puede ser posterior a hoy.");
  return { ...validateRoutine(input), sourceRoutineId: identifier(input.sourceRoutineId), performedOn,
    durationSeconds: integer(input.durationSeconds, "Duración total", LIMITS.durationSeconds),
    effort: integer(input.effort, "Esfuerzo", 10), note: text(input.note ?? "", "Nota", LIMITS.note, false) };
}
export function effortLabel(effort: number) { return effort <= 3 ? "Suave" : effort <= 6 ? "Moderado" : effort <= 8 ? "Intenso" : "Máximo"; }
export function formatDuration(seconds: number) { return `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} s` : ""}`; }
