export const FAMILY_TIME_ZONE = "America/Argentina/Buenos_Aires";

export function getFamilyDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FAMILY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function taskListEtag(familyId: string, revision: number, day: string, selectedDate = day, page = "", mode = ""): string {
  return `"family-${familyId}-r${revision}-d${day}-view-${selectedDate}-${page}-${mode}"`;
}

export function isTaskDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addTaskDays(day: string, amount: number): string {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function taskDateBounds(today: string) {
  const value = new Date(`${today}T12:00:00Z`);
  const shift = (years: number, months: number) => {
    const last = new Date(Date.UTC(value.getUTCFullYear() + years, value.getUTCMonth() + months + 1, 0)).getUTCDate();
    return new Date(Date.UTC(value.getUTCFullYear() + years, value.getUTCMonth() + months, Math.min(value.getUTCDate(), last), 12)).toISOString().slice(0, 10);
  };
  return { earliest: shift(-10, 0), latest: shift(0, 6) };
}

export function isTaskDateInRange(day: unknown, today: string): day is string {
  if (!isTaskDate(day)) return false;
  const bounds = taskDateBounds(today);
  return day >= bounds.earliest && day <= bounds.latest;
}

export function labelTaskDay(day: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${day}T12:00:00Z`));
}

// Find civil midnight using the same IANA rules as getFamilyDay, rather than a fixed offset.
export function familyDayInterval(day: string): { startsAt: Date; endsAt: Date } {
  const midnight = (date: string) => {
    const target = Date.parse(`${date}T00:00:00Z`);
    let lower = target - 36 * 60 * 60 * 1000;
    let upper = target + 36 * 60 * 60 * 1000;
    // First instant belonging to the civil day, including historical midnight DST gaps.
    while (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2);
      if (getFamilyDay(new Date(middle)) < date) lower = middle;
      else upper = middle;
    }
    return new Date(upper);
  };
  return { startsAt: midnight(day), endsAt: midnight(addTaskDays(day, 1)) };
}

export function taskLogicalKey(taskId: string, responsibilityMemberId: string | null, generationDate: string | null): string {
  return JSON.stringify([taskId, responsibilityMemberId, generationDate]);
}

export function parseTaskLogicalKey(key: string): [string, string | null, string | null] {
  const value: unknown = JSON.parse(key);
  if (!Array.isArray(value) || value.length !== 3 || typeof value[0] !== "string" || !(value[1] === null || typeof value[1] === "string") || !(value[2] === null || isTaskDate(value[2]))) throw new Error("Invalid task key");
  return value as [string, string | null, string | null];
}
