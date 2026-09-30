import assert from "node:assert/strict";
import test from "node:test";
import { canConfirmMeal, getDayInTimeZone, hasUnknownAttendance, isMenuDateInRange, isUuid, mayEditMeal, mayManageSuggestion, menuDateBounds, startOfWeek } from "./rules.ts";

test("meal weeks start Monday and local family day ignores the device timezone", () => {
  assert.equal(startOfWeek("2026-09-30"), "2026-09-28");
  assert.equal(startOfWeek("2026-10-04"), "2026-09-28");
  assert.equal(getDayInTimeZone(new Date("2026-09-28T02:30:00.000Z")), "2026-09-27");
  assert.equal(getDayInTimeZone(new Date("2026-09-30T02:59:59.999Z")), "2026-09-29");
  assert.equal(getDayInTimeZone(new Date("2026-09-30T03:00:00.000Z")), "2026-09-30");
  const beforeCutoff = getDayInTimeZone(new Date("2026-09-30T02:59:59.999Z"));
  const afterCutoff = getDayInTimeZone(new Date("2026-09-30T03:00:00.000Z"));
  assert.equal(mayEditMeal("2026-09-29", beforeCutoff), true);
  assert.equal(mayEditMeal("2026-09-29", afterCutoff), false);
});

test("past meals are read-only and suggestion ownership is checked by role", () => {
  assert.equal(mayEditMeal("2026-09-28", "2026-09-29"), false);
  assert.equal(mayEditMeal("2026-09-29", "2026-09-29"), true);
  assert.equal(mayManageSuggestion("member", "member-a", "member-a"), true);
  assert.equal(mayManageSuggestion("member", "member-a", "member-b"), false);
  assert.equal(mayManageSuggestion("administrator", "adult-a", "member-b"), true);
  assert.equal(isUuid("0550e840-e29b-41d4-a716-446655440000"), true);
  assert.equal(isUuid("not-a-uuid"), false);
});

test("confirmation only requires an active family member; attendance does not block it", () => {
  assert.equal(canConfirmMeal([]), "no-active-members");
  assert.equal(canConfirmMeal(["a", "b"]), "ok");
  assert.equal(hasUnknownAttendance(["a", "b"], [{ memberId: "a", status: "absent" }]), true);
  assert.equal(hasUnknownAttendance(["a"], [{ memberId: "a", status: "present" }]), false);
});

test("menu dates allow ten years of history and six months ahead", () => {
  assert.deepEqual(menuDateBounds("2026-09-30"), { earliest: "2016-09-30", latest: "2027-03-30" });
  assert.deepEqual(menuDateBounds("2024-08-31"), { earliest: "2014-08-31", latest: "2025-02-28" });
  assert.equal(isMenuDateInRange("2026-09-30", "2026-09-30"), true);
  assert.equal(isMenuDateInRange("2027-03-31", "2026-09-30"), false);
  assert.equal(isMenuDateInRange("not-a-day", "2026-09-30"), false);
});
