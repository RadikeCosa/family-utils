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

import { footballEventInput, formationInput, selectRiverEvent, selectUfcEvent, sportsWeek } from "./rules.ts";
const event = (id: string, eventDate: string | null, extra: Record<string, unknown> = {}) => ({ id, eventDate, startsAt: null, hidden: false, status: "scheduled", firstParticipant: "River Plate", secondParticipant: "Boca", ...extra });

test("River keeps today's match until Argentine midnight, then chooses the next dated match", () => {
  const events = [event("pending", null, { status: "postponed" }), event("next", "2026-10-18"), event("today", "2026-10-14"), event("cancelled", "2026-10-15", { status: "cancelled" }), event("hidden", "2026-10-15", { hidden: true })];
  assert.equal(selectRiverEvent(events, new Date("2026-10-15T02:59:59Z"))?.id, "today");
  assert.equal(selectRiverEvent(events, new Date("2026-10-15T03:00:00Z"))?.id, "next");
  assert.equal(selectRiverEvent(events, new Date("2026-10-19T03:00:00Z"))?.id, "pending");
  assert.equal(selectRiverEvent([event("finished", null, { status: "completed" })]), null);
  assert.equal(selectRiverEvent([event("not-river", null, { firstParticipant: "Racing" })]), null);
});

test("River sorts known times before unknown times and validates an undated postponed match", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  assert.equal(selectRiverEvent([event("unknown", "2026-10-14"), event("known", "2026-10-14", { startsAt: "2026-10-14T20:00:00Z" })], now)?.id, "known");
  const input = { title: "River vs Boca", competition: "Liga", firstParticipant: "River Plate", secondParticipant: "Boca", eventDate: null, venue: "Monumental", status: "postponed" };
  assert.equal(footballEventInput(input)?.eventDate, null);
  assert.equal(footballEventInput(input)?.venue, "Monumental");
  assert.equal(footballEventInput({ ...input, startTime: "20:00" }), null);
  assert.equal(footballEventInput({ ...input, eventDate: "2026-02-30" }), null);
});

test("UFC chooses the next official date in this week, then the last event through Sunday", () => {
  const events = [event("tuesday", "2026-10-13"), event("saturday", "2026-10-17", { mainCardStartsAt: "2026-10-18T03:00:00Z" }), event("next-week", "2026-10-24")];
  assert.equal(selectUfcEvent(events, new Date("2026-10-13T12:00:00Z"))?.id, "tuesday");
  assert.equal(selectUfcEvent(events, new Date("2026-10-14T12:00:00Z"))?.id, "saturday");
  assert.equal(selectUfcEvent(events, new Date("2026-10-19T02:59:59Z"))?.id, "saturday");
  assert.equal(selectUfcEvent(events, new Date("2026-10-19T03:00:00Z"))?.id, "next-week");
  assert.equal(selectUfcEvent(events.slice(0, 2), new Date("2026-10-19T03:00:00Z")), null);
  assert.deepEqual(sportsWeek(new Date("2026-10-19T02:59:59Z")), { start: "2026-10-12", end: "2026-10-18" });
  assert.deepEqual(sportsWeek(new Date("2026-10-19T03:00:00Z")), { start: "2026-10-19", end: "2026-10-25" });
});

test("UFC excludes cancelled/hidden events and deterministically breaks equal dates", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  assert.equal(selectUfcEvent([event("hidden", "2026-10-14", { hidden: true }), event("cancelled", "2026-10-14", { status: "cancelled" }), event("b", "2026-10-17"), event("a", "2026-10-17")], now)?.id, "a");
});

test("UFC official date stays Saturday when block starts on Argentine Sunday", () => {
  const input = { title: "UFC", eventDate: "2026-10-17", preliminaryDate: "2026-10-17", preliminaryTime: "21:00", mainCardDate: "2026-10-18", mainCardTime: "00:00", fights: [{ firstFighter: "A", secondFighter: "B", boutBlock: "main", isMainEvent: true }] };
  const card = ufcCardInput(input);
  assert.equal(card?.eventDate, "2026-10-17");
  assert.equal(card?.mainCardStartsAt?.toISOString(), "2026-10-18T03:00:00.000Z");
  assert.equal(card?.preliminaryStartsAt?.toISOString(), "2026-10-18T00:00:00.000Z");
  assert.equal(ufcCardInput({ ...input, mainCardDate: "2026-02-30" }), null);
});

test("formations require 1–500 Unicode characters after trimming", () => {
  assert.equal(formationInput(" 4-3-3: mi once "), "4-3-3: mi once");
  assert.equal(formationInput(" "), null);
  assert.equal(formationInput("a".repeat(501)), null);
  assert.equal(formationInput("⚽".repeat(500))?.length, 500);
  assert.equal(formationInput({ body: "once" }), null);
});
