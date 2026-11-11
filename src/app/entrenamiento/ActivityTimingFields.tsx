"use client";
import { addCivilDays, dayInZone } from "@/lib/calendar/civil";
import { clockCandidates, localClock, timingDuration, timingFromClocks, type ActivityTiming } from "@/lib/training/timing";
import { formatActivityDuration as formatDuration } from "@/lib/training/timing";
import styles from "./training.module.css";

export type TimingDraft = { start: string; end: string; nextDay: boolean; startChoice: string; endChoice: string; touched: boolean; original?: ActivityTiming | null };
export function initialTiming(timing?: ActivityTiming | null): TimingDraft {
  return { start: timing ? localClock(timing.startAt, timing.timeZone) : "", end: timing ? localClock(timing.endAt, timing.timeZone) : "", nextDay: !!timing && dayInZone(new Date(timing.startAt), timing.timeZone) !== dayInZone(new Date(timing.endAt), timing.timeZone), startChoice: timing?.startAt ?? "", endChoice: timing?.endAt ?? "", touched: false, original: timing };
}
export function resolveTiming(draft: TimingDraft, date: string, timeZone: string, dateChanged = false): ActivityTiming | null | undefined {
  if (!draft.touched && !dateChanged) return undefined;
  if (!draft.start && !draft.end) return null;
  return timingFromClocks(date, draft.start, draft.end, draft.nextDay, timeZone, draft.startChoice, draft.endChoice);
}
export default function ActivityTimingFields({ value, onChange, date, timeZone, planned, historicalDuration }: { value: TimingDraft; onChange: (value: TimingDraft) => void; date: string; timeZone: string; planned: boolean; historicalDuration?: number | null }) {
  const dateChanged = !!value.original && date !== dayInZone(new Date(value.original.startAt), value.original.timeZone);
  const zone = value.touched || dateChanged ? timeZone : value.original?.timeZone ?? timeZone;
  function change(patch: Partial<TimingDraft>) { onChange({ ...value, ...patch, touched: true }); }
  function candidates(day: string, clock: string) { try { return clock ? clockCandidates(day, clock, zone) : []; } catch { return []; } }
  const starts = candidates(date, value.start), ends = candidates(value.nextDay ? addCivilDays(date, 1) : date, value.end);
  let duration = "", hint = "";
  if (value.start || value.end) {
    try { duration = formatDuration(timingDuration(timingFromClocks(date, value.start, value.end, value.nextDay, zone, value.startChoice, value.endChoice))); }
    catch (error) { hint = (error as Error).message; }
  }
  const choices = (label: string, items: string[], choice: string, key: "startChoice" | "endChoice") => items.length > 1 ? <label>{label}<select value={items.includes(choice) ? choice : ""} onChange={event => change({ [key]: event.target.value })}><option value="">Elegí una ocurrencia</option>{items.map((at, index) => <option key={at} value={at}>{index === 0 ? "Primera" : "Segunda"} ocurrencia ({new Intl.DateTimeFormat("es", { timeZone: zone, timeZoneName: "longOffset" }).format(new Date(at))})</option>)}</select></label> : null;
  return <fieldset className={styles.block}><legend>{planned ? "Horario previsto (opcional)" : "Horario de la actividad (opcional)"}</legend>
    <p>Zona horaria: {zone}</p>
    {value.original && value.original.timeZone !== timeZone && <p>La zona familiar cambió. Si modificás estos horarios, se usarán las mismas horas en {timeZone}. Revisalas antes de guardar.</p>}
    <label>Hora de inicio<input type="time" value={value.start} onChange={event => change({ start: event.target.value, startChoice: "" })} /></label>
    {choices("Ocurrencia de inicio", starts, value.startChoice, "startChoice")}
    <label>Hora de fin<input type="time" value={value.end} onChange={event => change({ end: event.target.value, endChoice: "" })} /></label>
    {choices("Ocurrencia de fin", ends, value.endChoice, "endChoice")}
    <label className={styles.nextDay}><input type="checkbox" checked={value.nextDay} onChange={event => change({ nextDay: event.target.checked, endChoice: "" })} />{planned ? "Finaliza al día siguiente" : "Terminé al día siguiente"}</label>
    <p role="status">{duration ? `Duración: ${duration}` : hint || (!value.touched && historicalDuration ? `Duración guardada: ${formatDuration(historicalDuration)}. No se conocen los horarios.` : "La duración se calcula al completar inicio y fin.")}</p>
    {(value.start || value.end || historicalDuration) && <button type="button" onClick={() => change({ start: "", end: "", nextDay: false, startChoice: "", endChoice: "" })}>Quitar horarios y duración</button>}
  </fieldset>;
}
