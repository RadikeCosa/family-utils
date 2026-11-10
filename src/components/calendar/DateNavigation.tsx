"use client";
import { addCivilDays } from "@/lib/calendar/civil";
export default function DateNavigation({ date, today, min, max, disabled = false, step = 1, className, onSelect }: { date: string; today: string; min: string; max: string; disabled?: boolean; step?: number; className?: string; onSelect: (date: string, followToday?: boolean) => void }) {
  return <div className={className} aria-label="Navegar por fechas">
    <button type="button" aria-label={step === 7 ? "Semana anterior" : "Día anterior"} disabled={disabled || date <= min} onClick={() => onSelect(addCivilDays(date, -step) < min ? min : addCivilDays(date, -step))}>←</button>
    <label><span>Ir a una fecha</span><input type="date" value={date} min={min} max={max} disabled={disabled} onChange={event => onSelect(event.target.value)} /></label>
    <button type="button" aria-label={step === 7 ? "Semana siguiente" : "Día siguiente"} disabled={disabled || date >= max} onClick={() => onSelect(addCivilDays(date, step) > max ? max : addCivilDays(date, step))}>→</button>
    <button type="button" disabled={disabled} onClick={() => onSelect(today, true)}>Hoy</button>
  </div>;
}
