import assert from "node:assert/strict";
import test from "node:test";
import {
  accessCodeLifetimeMs,
  canGenerateMemberCode,
  isAccessCodeCurrent,
  matchesVerifiedGoogleIdentity,
  normalizeGoogleEmail,
} from "./policy.ts";

const childInvite = {
  actorRole: "administrator" as const,
  actorMemberId: "adult-a",
  targetMemberId: "child-a",
  targetRole: "member" as const,
  accessMethod: "code" as const,
  googleEmail: null,
  hasActiveDevice: false,
  purpose: "invitation" as const,
};

test("Google email matching trims spaces and case but does not fold Gmail aliases", () => {
  assert.equal(normalizeGoogleEmail("  Parent.Name+family@gmail.com "), "parent.name+family@gmail.com");
  assert.equal(matchesVerifiedGoogleIdentity({ configuredEmail: "Parent.Name@gmail.com", actualEmail: " parent.name@gmail.com ", emailVerified: true, providerIsGoogle: true }), true);
  assert.equal(matchesVerifiedGoogleIdentity({ configuredEmail: "parent.name@gmail.com", actualEmail: "parentname@gmail.com", emailVerified: true, providerIsGoogle: true }), false);
  assert.equal(matchesVerifiedGoogleIdentity({ configuredEmail: "parent@gmail.com", actualEmail: "parent@gmail.com", emailVerified: false, providerIsGoogle: true }), false);
  assert.equal(matchesVerifiedGoogleIdentity({ configuredEmail: "parent@gmail.com", actualEmail: "parent@gmail.com", emailVerified: true, providerIsGoogle: false }), false);
});

test("only administrators can invite another profile and recovery applies to code profiles with an active device", () => {
  assert.equal(canGenerateMemberCode(childInvite), true);
  assert.equal(canGenerateMemberCode({ ...childInvite, purpose: "recovery" }), false);
  assert.equal(canGenerateMemberCode({ ...childInvite, purpose: "recovery", hasActiveDevice: true }), true);
  assert.equal(canGenerateMemberCode({ ...childInvite, actorRole: "member" }), false);
  assert.equal(canGenerateMemberCode({ ...childInvite, targetMemberId: "adult-a" }), false);
});

test("adult Google profiles can only receive a first invitation", () => {
  const adultInvite = { ...childInvite, targetMemberId: "adult-b", targetRole: "administrator" as const, accessMethod: "google" as const, googleEmail: "adult@example.com" };
  assert.equal(canGenerateMemberCode(adultInvite), true);
  assert.equal(canGenerateMemberCode({ ...adultInvite, hasActiveDevice: true }), false);
  assert.equal(canGenerateMemberCode({ ...adultInvite, purpose: "recovery" }), false);
});

test("invitation and recovery lifetime, including the exact expiry boundary", () => {
  assert.equal(accessCodeLifetimeMs("invitation"), 24 * 60 * 60 * 1000);
  assert.equal(accessCodeLifetimeMs("recovery"), 30 * 60 * 1000);
  const expiry = new Date("2026-10-01T12:00:00.000Z");
  assert.equal(isAccessCodeCurrent(expiry, new Date("2026-10-01T11:59:59.999Z")), true);
  assert.equal(isAccessCodeCurrent(expiry, expiry), false);
  assert.equal(isAccessCodeCurrent(expiry, new Date("2026-10-01T12:00:00.001Z")), false);
});
