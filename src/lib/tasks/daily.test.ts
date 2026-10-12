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
