import assert from "node:assert/strict";
import test from "node:test";
import { formatSportsTime, isRiverMatch, sportsLocalDateTime, sportsNowDay, sportsTodayInterval, ufcCardInput } from "./rules.ts";

test("Argentina day changes at 03:00 UTC and agenda interval follows that day", () => {
  const beforeMidnightArgentina = new Date("2026-10-14T02:30:00.000Z");
  const midnightArgentina = new Date("2026-10-14T03:00:00.000Z");
  assert.equal(sportsNowDay(beforeMidnightArgentina), "2026-10-13");
  assert.equal(sportsNowDay(midnightArgentina), "2026-10-14");
  const interval = sportsTodayInterval("2026-10-13");
  assert.equal(interval.startsAt.toISOString(), "2026-10-13T03:00:00.000Z");
  assert.equal(interval.endsAt.toISOString(), "2026-10-14T03:00:00.000Z");
});

test("missing football and UFC times remain unknown instead of becoming midnight", () => {
  assert.equal(sportsLocalDateTime("2026-10-14", null), null);
  assert.equal(formatSportsTime(null), "A confirmar");
  const card = ufcCardInput({ title: "UFC", eventDate: "2026-10-14", fights: [{ firstFighter: "A", secondFighter: "B", boutBlock: "main", isMainEvent: true }] });
  assert.equal(card?.preliminaryStartsAt, null);
  assert.equal(card?.mainCardStartsAt, null);
});

test("local Argentine time serializes to UTC and River is recognized", () => {
  assert.equal(sportsLocalDateTime("2026-10-14", "00:30")?.toISOString(), "2026-10-14T03:30:00.000Z");
  assert.equal(isRiverMatch("River Plate", "Boca Juniors"), true);
  assert.equal(isRiverMatch("Club Atlético River Plate", "Boca Juniors"), true);
  assert.equal(isRiverMatch("Racing", "Boca Juniors"), false);
});
