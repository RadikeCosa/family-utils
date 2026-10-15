import { FAMILY_TIME_ZONE, familyDayInterval, getFamilyDay, isTaskDate } from "../tasks/family-day.ts";

export const SPORTS_TIME_ZONE = FAMILY_TIME_ZONE;
export const SPORTS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SPORTS_KINDS = ["football_match", "ufc_card"] as const;
export const FOOTBALL_STATUSES = ["scheduled", "postponed", "completed", "cancelled"] as const;
export const FIGHT_BLOCKS = ["preliminaries", "main"] as const;
export const PREDICTION_CLOSE_MODES = ["event", "block", "fight"] as const;

export function sportsEnabled() {
  return process.env.SPORTS_ENABLED === "true";
}

export function isRiverName(value: string | null | undefined) {
  return !!value && value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().includes("river plate");
}

export function isRiverMatch(first: string | null | undefined, second: string | null | undefined) {
  return isRiverName(first) || isRiverName(second);
}

export function isSportsDate(value: unknown): value is string {
  return isTaskDate(value);
}

export function isSportsTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour < 24 && minute < 60;
}

// Argentina has no current daylight-saving changes; keep the IANA zone for display and day boundaries.
export function sportsLocalDateTime(date: string, time: string | null): Date | null {
  if (!isSportsDate(date) || (time !== null && !isSportsTime(time))) return null;
  return time ? new Date(`${date}T${time}:00-03:00`) : null;
}

export function sportsNowDay(now = new Date()) {
  return getFamilyDay(now);
}

export function sportsTodayInterval(day = sportsNowDay()) {
  return familyDayInterval(day);
}

export function formatSportsTime(value: string | Date | null) {
  if (!value) return "A confirmar";
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: SPORTS_TIME_ZONE }).format(new Date(value));
}

export function formatSportsDate(value: string | Date) {
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeZone: SPORTS_TIME_ZONE }).format(date);
}

export function commentInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.trim();
  return Array.from(body).length > 0 && Array.from(body).length <= 2000 ? body : null;
}

export type FootballEventInput = {
  title: string;
  competition: string;
  firstParticipant: string;
  secondParticipant: string;
  eventDate: string;
  startsAt: Date | null;
  channel: string | null;
  status: typeof FOOTBALL_STATUSES[number];
  result: string | null;
};

export function footballEventInput(body: Record<string, unknown>): FootballEventInput | null {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const competition = typeof body.competition === "string" ? body.competition.trim() : "";
  const firstParticipant = typeof body.firstParticipant === "string" ? body.firstParticipant.trim() : "";
  const secondParticipant = typeof body.secondParticipant === "string" ? body.secondParticipant.trim() : "";
  const eventDate = body.eventDate;
  const rawTime = body.startTime == null || body.startTime === "" ? null : body.startTime;
  const channel = typeof body.channel === "string" ? body.channel.trim() || null : body.channel == null ? null : undefined;
  const result = typeof body.result === "string" ? body.result.trim() || null : body.result == null ? null : undefined;
  const status = body.status ?? "scheduled";
  const startsAt = typeof eventDate === "string" && (rawTime === null || isSportsTime(rawTime)) ? sportsLocalDateTime(eventDate, rawTime) : null;
  if (!title || Array.from(title).length > 160 || !competition || Array.from(competition).length > 120 || !firstParticipant || !secondParticipant || Array.from(firstParticipant).length > 120 || Array.from(secondParticipant).length > 120) return null;
  if (!isSportsDate(eventDate) || (rawTime !== null && !isSportsTime(rawTime)) || (rawTime !== null && !startsAt)) return null;
  if (channel === undefined || (channel && Array.from(channel).length > 160) || result === undefined || (result && Array.from(result).length > 160)) return null;
  if (!(FOOTBALL_STATUSES as readonly unknown[]).includes(status)) return null;
  return { title, competition, firstParticipant, secondParticipant, eventDate, startsAt, channel, status: status as FootballEventInput["status"], result };
}

export type FightInput = { boutOrder: number; firstFighter: string; secondFighter: string; boutBlock: typeof FIGHT_BLOCKS[number]; isMainEvent: boolean };
export type UfcCardInput = { title: string; eventDate: string; preliminaryStartsAt: Date | null; mainCardStartsAt: Date | null; fights: FightInput[] };

export function ufcCardInput(body: Record<string, unknown>): UfcCardInput | null {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const eventDate = body.eventDate;
  const preliminaryTime = body.preliminaryTime == null || body.preliminaryTime === "" ? null : body.preliminaryTime;
  const mainCardTime = body.mainCardTime == null || body.mainCardTime === "" ? null : body.mainCardTime;
  const fights = body.fights;
  if (!title || Array.from(title).length > 160 || !isSportsDate(eventDate)) return null;
  if ((preliminaryTime !== null && !isSportsTime(preliminaryTime)) || (mainCardTime !== null && !isSportsTime(mainCardTime))) return null;
  const preliminaryStartsAt = sportsLocalDateTime(eventDate, preliminaryTime as string | null);
  const mainCardStartsAt = sportsLocalDateTime(eventDate, mainCardTime as string | null);
  if ((preliminaryTime && !preliminaryStartsAt) || (mainCardTime && !mainCardStartsAt)) return null;
  if (!Array.isArray(fights) || fights.length < 1 || fights.length > 40) return null;
  const mapped: FightInput[] = [];
  for (let index = 0; index < fights.length; index++) {
    const raw = fights[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const fight = raw as Record<string, unknown>;
    const firstFighter = typeof fight.firstFighter === "string" ? fight.firstFighter.trim() : "";
    const secondFighter = typeof fight.secondFighter === "string" ? fight.secondFighter.trim() : "";
    const boutBlock = fight.boutBlock;
    if (!firstFighter || !secondFighter || firstFighter === secondFighter || Array.from(firstFighter).length > 120 || Array.from(secondFighter).length > 120) return null;
    if (!(FIGHT_BLOCKS as readonly unknown[]).includes(boutBlock) || typeof fight.isMainEvent !== "boolean") return null;
    mapped.push({ boutOrder: index + 1, firstFighter, secondFighter, boutBlock: boutBlock as FightInput["boutBlock"], isMainEvent: fight.isMainEvent });
  }
  if (mapped.filter((fight) => fight.isMainEvent).length !== 1) return null;
  return { title, eventDate, preliminaryStartsAt, mainCardStartsAt, fights: mapped };
}

export function isSportsContext(value: string | null): value is "football_day" | "river_match" | "ufc_card" {
  return value === "football_day" || value === "river_match" || value === "ufc_card";
}
