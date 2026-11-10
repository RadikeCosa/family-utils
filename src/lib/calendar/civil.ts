/** Civil dates never pass through the device's local timezone. */
export function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addCivilDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function civilWeekStart(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addCivilDays(day, weekday === 0 ? -6 : 1 - weekday);
}
export function dayInZone(now = new Date(), timeZone = "America/Argentina/Buenos_Aires"): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function nextCivilDayAt(now: Date, timeZone: string): Date {
  const day = dayInZone(now, timeZone);
  let low = now.getTime(), high = low + 48 * 3600_000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (dayInZone(new Date(middle), timeZone) === day) low = middle; else high = middle;
  }
  return new Date(high);
}
export function civilLabel(day: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", dateStyle: "full" }).format(new Date(`${day}T12:00:00Z`));
}
