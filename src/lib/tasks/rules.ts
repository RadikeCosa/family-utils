import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export { FAMILY_TIME_ZONE, getFamilyDay, taskListEtag } from "./family-day.ts";
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type FamilyRole = "administrator" | "member";
export type TaskStatus = "active" | "finalized" | "archived";
export type OccurrenceStatus = "open" | "completed" | "missed" | "archived";
export type CarryPolicy = "expires_daily" | "carry_forward";

export interface PresenceInterval {
  startsAt: number;
  endsAt: number;
}

export interface TaskPermissions {
  edit: boolean;
  assign: boolean;
  claim: boolean;
  complete: boolean;
  undo: boolean;
  finalize: boolean;
  archive: boolean;
  restore: boolean;
}

export function normalizeAccessCode(input: string): string {
  const normalized = input.toUpperCase().replace(/[\s-]/g, "").replace(/[O]/g, "0").replace(/[IL]/g, "1");
  if (normalized.length !== 10 || [...normalized].some((character) => !CROCKFORD_ALPHABET.includes(character))) {
    throw new Error("Invalid access code");
  }
  return normalized;
}

export function formatAccessCode(input: string): string {
  const code = normalizeAccessCode(input);
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function createAccessCode(): string {
  const bytes = randomBytes(10);
  return [...bytes].map((byte) => CROCKFORD_ALPHABET[byte & 31]).join("");
}

export function digestAccessCode(input: string, secret: string, purpose: string): string {
  if (!secret || secret.length < 32) throw new Error("CODE_PEPPER must contain at least 32 characters");
  const code = normalizeAccessCode(input);
  return createHmac("sha256", secret).update(`${purpose}\0${code}`).digest("hex");
}

export function secureDigestEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function hasPresentAssignee(assignees: readonly string[], presenceByMember: ReadonlyMap<string, readonly PresenceInterval[]>): boolean {
  return assignees.some((memberId) => (presenceByMember.get(memberId)?.length ?? 0) > 0);
}

export function overlapsPresence(intervals: readonly PresenceInterval[], startsAt?: number, endsAt?: number): boolean {
  if (intervals.length === 0) return false;
  if (startsAt === undefined || endsAt === undefined) return true;
  return intervals.some((interval) => interval.startsAt < endsAt && startsAt < interval.endsAt);
}

export function canUndoCompletion(role: FamilyRole, completingMemberId: string | null, actorMemberId: string): boolean {
  return role === "administrator" || completingMemberId === actorMemberId;
}

export function taskPermissions(role: FamilyRole): TaskPermissions {
  const administrator = role === "administrator";
  return {
    edit: true,
    assign: true,
    claim: true,
    complete: true,
    undo: true,
    finalize: administrator,
    archive: administrator,
    restore: administrator,
  };
}

export function nextScheduledDay(completedDay: string, weekdays: readonly number[]): string | null {
  if (weekdays.length === 0) return null;
  const [year, month, day] = completedDay.split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  for (let offset = 1; offset <= 7; offset += 1) {
    const next = new Date(current);
    next.setUTCDate(current.getUTCDate() + offset);
    if (weekdays.includes(next.getUTCDay())) {
      return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
    }
  }
  return null;
}
