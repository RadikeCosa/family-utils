import { SPORTS_UUID } from "./rules.ts";
export type FootballResult = { homeGoals: number; awayGoals: number };
export type FightOutcome = "winner" | "draw" | "no_contest" | "cancelled";
export type FightResultInput = {
  fightId: string;
  result: { outcome: FightOutcome; winnerId: string | null } | null;
};
export type ResultEntry = {
  eventId: string;
  result?: FootballResult | null;
  fights?: FightResultInput[];
};
export type ResultsBundle = {
  version: 1;
  checkedAt: string;
  source: string;
  events: ResultEntry[];
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function parseResultsBundle(
  value: unknown,
  now = new Date(),
): ResultsBundle | null {
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(value.checkedAt)) ||
    Date.parse(value.checkedAt) > now.getTime() + 600000 ||
    typeof value.source !== "string" ||
    !value.source.trim() ||
    value.source.length > 1000 ||
    !Array.isArray(value.events) ||
    !value.events.length ||
    value.events.length > 100
  )
    return null;
  const events: ResultEntry[] = [];
  const seen = new Set<string>();
  for (const raw of value.events) {
    if (
      !record(raw) ||
      typeof raw.eventId !== "string" ||
      !SPORTS_UUID.test(raw.eventId) ||
      seen.has(raw.eventId)
    )
      return null;
    seen.add(raw.eventId);
    if (Object.hasOwn(raw, "fights")) {
      if (
        !Array.isArray(raw.fights) ||
        raw.fights.length > 80 ||
        Object.hasOwn(raw, "result")
      )
        return null;
      const fights: FightResultInput[] = [];
      const ids = new Set<string>();
      for (const fight of raw.fights) {
        if (
          !record(fight) ||
          typeof fight.fightId !== "string" ||
          !SPORTS_UUID.test(fight.fightId) ||
          ids.has(fight.fightId)
        )
          return null;
        ids.add(fight.fightId);
        if (fight.result === null) {
          fights.push({ fightId: fight.fightId, result: null });
          continue;
        }
        const r = fight.result;
        if (
          !record(r) ||
          !["winner", "draw", "no_contest", "cancelled"].includes(
            String(r.outcome),
          )
        )
          return null;
        if (
          r.outcome === "winner"
            ? typeof r.winnerId !== "string" || !SPORTS_UUID.test(r.winnerId)
            : r.winnerId !== null
        )
          return null;
        fights.push({
          fightId: fight.fightId,
          result: {
            outcome: r.outcome as FightOutcome,
            winnerId: r.winnerId as string | null,
          },
        });
      }
      events.push({ eventId: raw.eventId, fights });
      continue;
    }
    if (raw.result === null) {
      events.push({ eventId: raw.eventId, result: null });
      continue;
    }
    if (
      !record(raw.result) ||
      !Number.isSafeInteger(raw.result.homeGoals) ||
      !Number.isSafeInteger(raw.result.awayGoals) ||
      Number(raw.result.homeGoals) < 0 ||
      Number(raw.result.awayGoals) < 0 ||
      Number(raw.result.homeGoals) > 2147483647 ||
      Number(raw.result.awayGoals) > 2147483647
    )
      return null;
    events.push({
      eventId: raw.eventId,
      result: {
        homeGoals: Number(raw.result.homeGoals),
        awayGoals: Number(raw.result.awayGoals),
      },
    });
  }
  return {
    version: 1,
    checkedAt: value.checkedAt,
    source: value.source.trim(),
    events,
  };
}
