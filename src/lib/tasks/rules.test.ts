import assert from "node:assert/strict";
import test from "node:test";
import {
  canUndoCompletion,
  createAccessCode,
  digestAccessCode,
  formatAccessCode,
  getFamilyDay,
  hasPresentAssignee,
  normalizeAccessCode,
  nextScheduledDay,
  overlapsPresence,
  secureDigestEqual,
  taskPermissions,
} from "./rules.ts";

test("access codes use the unambiguous alphabet and display in two groups", () => {
  const code = createAccessCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.equal(formatAccessCode(code), `${code.slice(0, 5)}-${code.slice(5)}`);
  assert.equal(normalizeAccessCode(` ${code.slice(0, 5)} - ${code.slice(5).toLowerCase()} `), code);
  assert.equal(normalizeAccessCode("OIL2345678"), "0112345678");
});

test("manual codes are keyed digests scoped to their purpose", () => {
  const code = "0123456789";
  const invitation = digestAccessCode(code, "a-server-secret-with-at-least-thirty-two-bytes", "invitation");
  assert.equal(invitation.length, 64);
  assert.equal(secureDigestEqual(invitation, digestAccessCode(code, "a-server-secret-with-at-least-thirty-two-bytes", "invitation")), true);
  assert.equal(secureDigestEqual(invitation, digestAccessCode(code, "a-server-secret-with-at-least-thirty-two-bytes", "recovery")), false);
  assert.throws(() => digestAccessCode(code, "too-short", "invitation"), /CODE_PEPPER/);
});

test("presence is satisfied when any assignee is home and timed work overlaps", () => {
  const byMember = new Map([[
    "present",
    [{ startsAt: 100, endsAt: 300 }],
  ]] as const);
  assert.equal(hasPresentAssignee(["absent", "present"], byMember), true);
  assert.equal(hasPresentAssignee(["absent"], byMember), false);
  assert.equal(overlapsPresence([{ startsAt: 100, endsAt: 300 }], 250, 350), true);
  assert.equal(overlapsPresence([{ startsAt: 100, endsAt: 300 }], 300, 400), false);
  assert.equal(overlapsPresence([{ startsAt: 100, endsAt: 300 }]), true);
});

test("the next carry-forward occurrence is after the completion date", () => {
  assert.equal(nextScheduledDay("2026-09-28", [1, 4]), "2026-10-01");
  assert.equal(nextScheduledDay("2026-09-28", [1]), "2026-10-05");
  assert.equal(nextScheduledDay("2026-09-28", []), null);
});

test("family day uses Buenos Aires regardless of the device timezone", () => {
  assert.equal(getFamilyDay(new Date("2026-09-28T02:30:00.000Z")), "2026-09-27");
  assert.equal(getFamilyDay(new Date("2026-09-28T03:30:00.000Z")), "2026-09-28");
});

test("all members can edit and complete, but only administrators can archive or finalize", () => {
  const member = taskPermissions("member");
  const admin = taskPermissions("administrator");
  assert.equal(member.edit, true);
  assert.equal(member.complete, true);
  assert.equal(member.archive, false);
  assert.equal(member.finalize, false);
  assert.equal(admin.archive, true);
  assert.equal(canUndoCompletion("member", "member-a", "member-a"), true);
  assert.equal(canUndoCompletion("member", "member-a", "member-b"), false);
  assert.equal(canUndoCompletion("administrator", "member-a", "member-b"), true);
});
