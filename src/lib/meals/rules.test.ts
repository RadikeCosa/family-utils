import assert from "node:assert/strict";
import test from "node:test";
import { canConfirmMeal, getDayInTimeZone, hasUnknownAttendance, isUuid, mayEditMeal, mayManageSuggestion, startOfWeek } from "./rules.ts";

test("meal weeks start Monday and local family day ignores the device timezone", () => {
  assert.equal(startOfWeek("2026-09-30"), "2026-09-28");
  assert.equal(startOfWeek("2026-10-04"), "2026-09-28");
  assert.equal(getDayInTimeZone(new Date("2026-09-28T02:30:00.000Z")), "2026-09-27");
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

test("confirmation blocks empty families and all-absent meals but allows unknown attendance with warning", () => {
  assert.equal(canConfirmMeal([], []), "no-active-members");
  assert.equal(canConfirmMeal(["a", "b"], [{ memberId: "a", status: "absent" }, { memberId: "b", status: "absent" }]), "all-absent");
  assert.equal(canConfirmMeal(["a", "b"], [{ memberId: "a", status: "present" }, { memberId: "b", status: "absent" }]), "ok");
  assert.equal(canConfirmMeal(["a", "b"], [{ memberId: "a", status: "absent" }]), "ok");
  assert.equal(hasUnknownAttendance(["a", "b"], [{ memberId: "a", status: "absent" }]), true);
  assert.equal(hasUnknownAttendance(["a"], [{ memberId: "a", status: "present" }]), false);
});
