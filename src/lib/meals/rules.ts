export type MealType = "lunch" | "dinner";
export type AttendanceStatus = "present" | "absent" | "unknown";
export type AttendanceSource = "manual" | "calendar" | "unknown";
export type FamilyRole = "administrator" | "member";

export function formatMealAttribution(
  proposedById: string | null | undefined,
  proposedByName: string | null | undefined,
  confirmedById: string,
  confirmedByName: string | null | undefined,
): string {
  const proposer = proposedByName?.trim() || "alguien de la familia";
  const confirmer = confirmedByName?.trim() || "alguien de la familia";
  if (proposedById && proposedById === confirmedById) return `Propuesto y confirmado por ${confirmer}`;
  return `Propuesto por ${proposer} · Confirmado por ${confirmer}`;
}

export interface AttendanceRecord {
  memberId: string;
  status: "present" | "absent";
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function startOfWeek(day: string): string {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

export function getDayInTimeZone(now = new Date(), timeZone = "America/Argentina/Buenos_Aires"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function mayEditMeal(day: string, today: string): boolean {
  return day >= today;
}

export function mayManageSuggestion(role: FamilyRole, actorId: string, authorId: string): boolean {
  return role === "administrator" || actorId === authorId;
}

export function canConfirmMeal(activeMemberIds: readonly string[]): "ok" | "no-active-members" {
  return activeMemberIds.length === 0 ? "no-active-members" : "ok";
}

export function menuDateBounds(today: string): { earliest: string; latest: string } {
  const current = new Date(`${today}T12:00:00.000Z`);
  const earlierYear = current.getUTCFullYear() - 10;
  const earlierLastDay = new Date(Date.UTC(earlierYear, current.getUTCMonth() + 1, 0)).getUTCDate();
  const earlier = new Date(Date.UTC(earlierYear, current.getUTCMonth(), Math.min(current.getUTCDate(), earlierLastDay), 12));
  const laterMonth = current.getUTCMonth() + 6;
  const lastDayOfLaterMonth = new Date(Date.UTC(current.getUTCFullYear(), laterMonth + 1, 0)).getUTCDate();
  const later = new Date(Date.UTC(current.getUTCFullYear(), laterMonth, Math.min(current.getUTCDate(), lastDayOfLaterMonth), 12));
  return { earliest: earlier.toISOString().slice(0, 10), latest: later.toISOString().slice(0, 10) };
}

export function isMenuDateInRange(day: string, today: string): boolean {
  if (!isValidDate(day) || !isValidDate(today)) return false;
  const bounds = menuDateBounds(today);
  return day >= bounds.earliest && day <= bounds.latest;
}

export function hasUnknownAttendance(activeMemberIds: readonly string[], attendance: readonly AttendanceRecord[]): boolean {
  const states = new Map(attendance.map((record) => [record.memberId, record.status]));
  return activeMemberIds.some((memberId) => !states.has(memberId));
}

export function isMealType(value: unknown): value is MealType {
  return value === "lunch" || value === "dinner";
}
