import assert from "node:assert/strict";
import test from "node:test";
import { addTaskDays, familyDayInterval, getFamilyDay, isTaskDateInRange, parseTaskLogicalKey, taskDateBounds, taskLogicalKey } from "./family-day.ts";

test("civil dates clamp month boundaries and ignore device timezone", () => {
  assert.deepEqual(taskDateBounds("2024-08-31"), { earliest: "2014-08-31", latest: "2025-02-28" });
  assert.equal(addTaskDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addTaskDays("2026-12-31", 1), "2027-01-01");
  assert.equal(isTaskDateInRange("2026-02-30", "2026-10-12"), false);
  assert.equal(getFamilyDay(new Date("2026-10-12T02:59:00Z")), "2026-10-11");
});

test("day interval uses IANA zone at both boundaries", () => {
  const interval = familyDayInterval("2026-10-12");
  assert.equal(interval.startsAt.toISOString(), "2026-10-12T03:00:00.000Z");
  assert.equal(interval.endsAt.toISOString(), "2026-10-13T03:00:00.000Z");
  assert.equal(getFamilyDay(interval.startsAt), "2026-10-12");
  assert.equal(getFamilyDay(new Date(interval.endsAt.getTime() - 1)), "2026-10-12");
});

test("logical key has a fixed wire format and round trips", () => {
  const key = taskLogicalKey("task", null, "2026-10-12");
  assert.equal(key, '["task",null,"2026-10-12"]');
  assert.deepEqual(parseTaskLogicalKey(key), ["task", null, "2026-10-12"]);
  assert.deepEqual(parseTaskLogicalKey(taskLogicalKey("task", "member", null)), ["task", "member", null]);
  assert.throws(() => parseTaskLogicalKey('["task",null,"bad"]'));
});

import { expectedOccurrenceDay } from "./schedule.ts";
const emptyHistory = { open: false, latestCompletion: null, latestOmission: null };

test("carry forecasts and real generation share the completion/omission calendar", () => {
  const schedule = { repeatWeekdays: [1, 4], scheduledDate: "2026-09-01", carryPolicy: "carry_forward" as const };
  const completed = { ...emptyHistory, latestCompletion: new Date("2026-10-06T03:30:00Z") };
  assert.equal(expectedOccurrenceDay(schedule, "2026-10-06", "2026-10-08", completed), "2026-10-08");
  assert.equal(expectedOccurrenceDay(schedule, "2026-10-08", "2026-10-08", completed), "2026-10-08");
  assert.equal(expectedOccurrenceDay(schedule, "2026-10-08", "2026-10-12", { ...completed, latestOmission: "2026-10-08" }), "2026-10-12");
  assert.equal(expectedOccurrenceDay(schedule, "2026-10-08", "2026-10-12", { ...completed, open: true }), null);
});

test("daily expiry forecasts select only the requested day, never retroactive", () => {
  const schedule = { repeatWeekdays: [1, 4], scheduledDate: "2026-10-01", carryPolicy: "expires_daily" as const };
  assert.equal(expectedOccurrenceDay(schedule, "2026-10-06", "2026-10-08", emptyHistory), "2026-10-08");
  assert.equal(expectedOccurrenceDay(schedule, "2026-10-06", "2026-10-07", emptyHistory), null);
  assert.equal(expectedOccurrenceDay(schedule, "2026-10-06", "2026-10-05", emptyHistory), null);
});


test("historical daylight saving transitions do not move the start into the prior day", () => {
  for (const day of ["2007-12-30", "2008-10-19", "2009-03-15"]) {
    const { startsAt, endsAt } = familyDayInterval(day);
    assert.equal(getFamilyDay(startsAt), day);
    assert.equal(getFamilyDay(new Date(startsAt.getTime() - 1)), addTaskDays(day, -1));
    assert.equal(getFamilyDay(new Date(endsAt.getTime() - 1)), day);
  }
});
