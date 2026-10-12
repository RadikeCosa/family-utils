import { PERSONAL_STATUSES, WORK_KINDS, type ExperienceDate, type WorkInput } from "./types.ts";
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const codePointLength = (value: string) => Array.from(value).length;
export function normalizeLibraryText(value: string) { return value.trim().replace(/\s+/gu, " ").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(); }
export function workInput(body: Record<string, unknown>): WorkInput | null {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const creator = typeof body.creator === "string" ? body.creator.trim() || null : body.creator == null ? null : undefined;
  const referenceUrl = typeof body.referenceUrl === "string" ? body.referenceUrl.trim() || null : body.referenceUrl == null ? null : undefined;
  const year = body.year === "" || body.year == null ? null : body.year;
  if (!title || codePointLength(title) > 200 || !WORK_KINDS.includes(body.kind as never) || creator === undefined || referenceUrl === undefined) return null;
  if (creator && codePointLength(creator) > 200) return null;
  if (year !== null && (!Number.isInteger(year) || Number(year) < 1 || Number(year) > 9999)) return null;
  if (referenceUrl) {
    if (codePointLength(referenceUrl) > 2048 || /\s/u.test(referenceUrl)) return null;
    try { const url = new URL(referenceUrl); if (!["http:", "https:"].includes(url.protocol)) return null; } catch { return null; }
  }
  return { title, kind: body.kind as WorkInput["kind"], creator, year: year as number | null, referenceUrl };
}
export function personalInput(body: Record<string, unknown>) {
  if (body.status !== null && !PERSONAL_STATUSES.includes(body.status as never)) return null;
  if (body.rating !== null && (!Number.isInteger(body.rating) || Number(body.rating) < 1 || Number(body.rating) > 5)) return null;
  return { status: body.status as typeof PERSONAL_STATUSES[number] | null, rating: body.rating as number | null };
}
export function familyDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (kind: string) => parts.find((part) => part.type === kind)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function experienceInput(value: unknown, today = familyDay()): ExperienceDate | null {
  if (value == null) return { year: null, month: null, day: null };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const year = raw.year ?? null, month = raw.month ?? null, day = raw.day ?? null;
  if (year === null) return month === null && day === null ? { year: null, month: null, day: null } : null;
  if (!Number.isInteger(year) || Number(year) < 1 || Number(year) > 9999) return null;
  if (month === null && day !== null) return null;
  if (month !== null && (!Number.isInteger(month) || Number(month) < 1 || Number(month) > 12)) return null;
  if (day !== null) {
    if (!Number.isInteger(day) || Number(day) < 1 || Number(day) > 31) return null;
    const date = new Date(0); date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  }
  const firstDay = `${String(year).padStart(4, "0")}-${String(month ?? 1).padStart(2, "0")}-${String(day ?? 1).padStart(2, "0")}`;
  if (firstDay > today) return null;
  return { year: year as number, month: month as number | null, day: day as number | null };
}
export function contributionInput(body: Record<string, unknown>, today = familyDay()) {
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const experience = experienceInput(body.experience, today);
  if (!text || codePointLength(text) > 5000 || typeof body.spoiler !== "boolean" || !experience || !Array.isArray(body.companionIds) || body.companionIds.length > 100 || body.companionIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) return null;
  return { body: text, spoiler: body.spoiler, experience, companionIds: [...new Set(body.companionIds as string[])] };
}
