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

export function taskListEtag(familyId: string, revision: number, day: string): string {
  return `"family-${familyId}-r${revision}-d${day}"`;
}
