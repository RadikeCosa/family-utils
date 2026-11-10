import { addCivilDays, dayInZone, isCivilDate } from "../calendar/civil.ts";
import { object, onlyKeys, TrainingValidationError } from "./rules.ts";

export interface ActivityTiming { startAt: string; endAt: string; timeZone: string }
const MIN = "1900-01-01", MAX = "2200-12-31";
export function timingZone(value: unknown): string {
  if (typeof value !== "string" || value.length > 100 || value !== "UTC" && !value.includes("/")) throw new TrainingValidationError("Zona horaria inválida.");
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); } catch { throw new TrainingValidationError("Zona horaria inválida."); }
  return value;
}
export function localClock(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !isCivilDate(value.slice(0, 10)) || value.slice(11, 13) > "23" || value.slice(14, 16) > "59" || value.slice(17, 19) > "59" || !Number.isFinite(Date.parse(value))) throw new TrainingValidationError("Horario inválido.");
  return new Date(value).toISOString();
}
export function activityTiming(value: unknown): ActivityTiming {
  const raw = object(value); onlyKeys(raw, ["startAt", "endAt", "timeZone"]);
  const timing = { startAt: instant(raw.startAt), endAt: instant(raw.endAt), timeZone: timingZone(raw.timeZone) };
  const startDay = dayInZone(new Date(timing.startAt), timing.timeZone), endDay = dayInZone(new Date(timing.endAt), timing.timeZone);
  if (startDay < MIN || endDay > MAX || endDay < startDay || endDay > addCivilDays(startDay, 1)) throw new TrainingValidationError("Los horarios deben estar entre 1900 y 2200 y finalizar el mismo día o el siguiente.");
  const seconds = timingDuration(timing);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 86400) throw new TrainingValidationError("La duración real debe ser mayor que cero y no superar 24 horas, incluso en días con cambio de hora.");
  return timing;
}
export function timingDuration(timing: ActivityTiming): number { return (Date.parse(timing.endAt) - Date.parse(timing.startAt)) / 1000; }
export function formatActivityDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), remaining = seconds % 60;
  return [hours ? `${hours} h` : "", minutes || !hours && !remaining ? `${minutes} min` : "", remaining ? `${remaining} s` : ""].filter(Boolean).join(" ");
}

/** Find every real instant for a civil minute; zero means a DST gap, two a fold. */
export function clockCandidates(date: string, clock: string, timeZone: string): string[] {
  timingZone(timeZone);
  if (!isCivilDate(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new TrainingValidationError("Completá un horario válido.");
  const nominal = Date.parse(`${date}T${clock}:00Z`), offsets = new Set<number>();
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = nominal + hours * 3600_000, parts = formatter.formatToParts(sample);
    const p = (key: string) => parts.find(part => part.type === key)!.value;
    offsets.add(Date.parse(`${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}Z`) - sample);
  }
  return [...offsets].map(offset => new Date(nominal - offset).toISOString()).filter(at => dayInZone(new Date(at), timeZone) === date && localClock(at, timeZone) === clock).sort();
}
export function timingFromClocks(date: string, start: string, end: string, nextDay: boolean, zone: string, startChoice = "", endChoice = ""): ActivityTiming {
  if (!start || !end) throw new TrainingValidationError("Completá inicio y fin, o dejá ambos vacíos.");
  if (!nextDay && end < start) throw new TrainingValidationError("El fin es anterior al inicio. Marcá «Terminé al día siguiente» si corresponde.");
  const choose = (day: string, clock: string, choice: string) => {
    const candidates = clockCandidates(day, clock, zone);
    if (!candidates.length) throw new TrainingValidationError("Ese horario no existe por el cambio de hora. Elegí otro.");
    if (candidates.length > 1 && !candidates.includes(choice)) throw new TrainingValidationError("Ese horario ocurre dos veces. Elegí la primera o segunda ocurrencia.");
    return candidates.length === 1 ? candidates[0] : choice;
  };
  return activityTiming({ startAt: choose(date, start, startChoice), endAt: choose(nextDay ? addCivilDays(date, 1) : date, end, endChoice), timeZone: zone });
}
