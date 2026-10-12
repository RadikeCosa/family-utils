import { addTaskDays, getFamilyDay } from "./family-day.ts";

export type ScheduleHistory = {
  open: boolean;
  latestCompletion: Date | null;
  latestOmission: string | null;
};
export type Schedule = { repeatWeekdays: number[] | null; scheduledDate: string | null; carryPolicy: "carry_forward" | "expires_daily" };

export function scheduledOnOrAfter(start: string, weekdays: readonly number[]): string | null {
  for (let offset = 0; offset < 7; offset++) {
    const day = addTaskDays(start, offset);
    if (weekdays.includes(new Date(`${day}T12:00:00Z`).getUTCDay())) return day;
  }
  return null;
}

// Both read-only forecasts and the materializer must use this calendar contract.
export function expectedOccurrenceDay(schedule: Schedule, today: string, selectedDate: string, history: ScheduleHistory): string | null {
  const weekdays = schedule.repeatWeekdays ?? [];
  if (!weekdays.length) return null;
  if (schedule.carryPolicy === "expires_daily") {
    if (selectedDate < today || selectedDate < (schedule.scheduledDate ?? today)) return null;
    return scheduledOnOrAfter(selectedDate, weekdays) === selectedDate ? selectedDate : null;
  }
  if (history.open) return null;
  let start = schedule.scheduledDate ?? today;
  if (history.latestCompletion) start = [start, addTaskDays(getFamilyDay(history.latestCompletion), 1)].sort().at(-1)!;
  if (history.latestOmission) start = [start, addTaskDays(history.latestOmission, 1)].sort().at(-1)!;
  return scheduledOnOrAfter(start, weekdays);
}
