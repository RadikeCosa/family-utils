import { addCivilDays, civilWeekStart, isCivilDate } from "../calendar/civil.ts";
import { identifier, integer, LIMITS, object, onlyKeys, TrainingValidationError, validateRoutine } from "./rules.ts";
import type { TrainingBlock } from "./types.ts";
export const DIARY_MIN = "1900-01-01", DIARY_MAX = "2200-12-31", SEARCH_MIN = 3;
export type DiaryKind = "training" | "rest";
export interface DiaryContent { title?: string; text?: string; blocks?: TrainingBlock[]; durationSeconds?: number | null; effort?: number | null }
export interface DiaryInput { date: string; kind: DiaryKind; plan: DiaryContent | null; result: DiaryContent | null; disposition: "open" | "skipped"; sourceRoutineId: string | null }
export interface DiaryEntry extends DiaryInput { id: string; version: number; archivedAt: string | null; createdAt: string; updatedAt: string; status: DiaryStatus }
export type DiaryStatus = "planned" | "completed" | "missed" | "archived";
export interface DiaryContext { today: string; timeZone: string; serverNow: string; nextDayAt: string; writable: boolean }
export type DayCounts = Record<"training_planned" | "training_completed" | "training_missed" | "rest_planned" | "rest_completed" | "rest_missed", number>;
export const emptyCounts = (): DayCounts => ({ training_planned: 0, training_completed: 0, training_missed: 0, rest_planned: 0, rest_completed: 0, rest_missed: 0 });
export function diaryDate(value: unknown): string {
  if (!isCivilDate(value) || value < DIARY_MIN || value > DIARY_MAX) throw new TrainingValidationError("Elegí una fecha entre 1900 y 2200.");
  return value;
}
export function diaryWeek(value: unknown): string {
  if (!isCivilDate(value) || civilWeekStart(value) !== value || value < civilWeekStart(DIARY_MIN) || value > DIARY_MAX) throw new TrainingValidationError("La semana debe comenzar un lunes.");
  return value;
}
export function weekDates(start: string): string[] { return Array.from({ length: 7 }, (_, i) => addCivilDays(start, i)).filter(day => day >= DIARY_MIN && day <= DIARY_MAX); }
function optionalText(value: unknown, max: number): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.includes("\0") || /[\uD800-\uDFFF]/u.test(value) || Array.from(value.trim()).length > max) throw new TrainingValidationError(`Texto inválido: máximo ${max} caracteres.`);
  return value.trim();
}
export function diaryContent(value: unknown, kind: DiaryKind): DiaryContent | null {
  if (value === null) return null;
  const raw = object(value); onlyKeys(raw, ["title", "text", "blocks", "durationSeconds", "effort"]);
  const title = optionalText(raw.title, LIMITS.name), text = optionalText(raw.text, LIMITS.note);
  if (kind === "rest") {
    if (["blocks", "durationSeconds", "effort"].some(key => key in raw)) throw new TrainingValidationError("El descanso no lleva ejercicios ni métricas.");
    return { ...(title ? { title } : {}), ...(text ? { text } : {}) };
  }
  const blocks = raw.blocks === undefined ? [] : raw.blocks;
  if (!Array.isArray(blocks)) throw new TrainingValidationError("Bloques inválidos.");
  const validBlocks = blocks.length ? validateRoutine({ name: title || "Entrenamiento", blocks }).blocks : [];
  if (!title && !text && !validBlocks.length) throw new TrainingValidationError("Escribí qué entrenaste o agregá ejercicios.");
  return { title, text, blocks: validBlocks,
    durationSeconds: raw.durationSeconds == null ? null : integer(raw.durationSeconds, "Duración", LIMITS.durationSeconds),
    effort: raw.effort == null ? null : integer(raw.effort, "Esfuerzo", 10) };
}
export function validateDiary(value: unknown, today: string): DiaryInput {
  const input = object(value);
  onlyKeys(input, ["date", "kind", "plan", "result", "disposition", "sourceRoutineId"]);
  if (input.kind !== "training" && input.kind !== "rest") throw new TrainingValidationError("Tipo de anotación inválido.");
  const date = diaryDate(input.date), plan = diaryContent(input.plan, input.kind), result = diaryContent(input.result, input.kind);
  if (plan === null && result === null) throw new TrainingValidationError("La anotación necesita un plan o algo realizado.");
  const disposition = input.disposition ?? "open";
  if (disposition !== "open" && disposition !== "skipped" || disposition === "skipped" && (plan === null || result !== null)) throw new TrainingValidationError("Estado inválido.");
  if (result !== null && date > today) throw new TrainingValidationError("Reprogramá para hoy antes de registrar lo realizado.");
  return { date, kind: input.kind, plan, result, disposition, sourceRoutineId: input.sourceRoutineId == null ? null : identifier(input.sourceRoutineId) };
}
export function diaryStatus(entry: Pick<DiaryEntry, "archivedAt" | "result" | "date" | "disposition">, today: string): DiaryStatus {
  return entry.archivedAt ? "archived" : entry.result !== null ? "completed" : entry.disposition === "skipped" || entry.date < today ? "missed" : "planned";
}
export function statusLabel(entry: Pick<DiaryEntry, "kind" | "status">): string {
  const labels = { planned: "Planificado", completed: "Realizado", missed: "No realizado", archived: "Archivada" };
  return entry.kind === "rest" && entry.status !== "archived" ? `Descanso ${labels[entry.status].toLowerCase()}` : labels[entry.status];
}
export function entryTitle(entry: Pick<DiaryEntry, "kind" | "plan" | "result">): string {
  const content = entry.result ?? entry.plan;
  return content?.title || content?.text?.slice(0, 80) || (entry.kind === "rest" ? "Descanso" : "Entrenamiento");
}
export function dayIndicator(counts: DayCounts): string {
  for (const key of ["training_missed", "training_planned", "training_completed", "rest_missed", "rest_planned", "rest_completed"] as const) {
    if (counts[key]) { const [kind, status] = key.split("_"); return statusLabel({ kind: kind as DiaryKind, status: status as DiaryStatus }); }
  }
  return "Sin anotaciones";
}
export function countsLabel(counts: DayCounts): string {
  return Object.entries(counts).filter(([, count]) => count > 0).map(([key, count]) => { const [kind, status] = key.split("_"); return `${count} ${statusLabel({ kind: kind as DiaryKind, status: status as DiaryStatus }).toLowerCase()}`; }).join("; ") || "Sin anotaciones";
}
