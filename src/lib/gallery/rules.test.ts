import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditDrawing,
  canManageGallery,
  createGuestSessionExpiry,
  createInvitationExpiry,
  galleryQuotaAllows,
  galleryUploadInput,
  guestSessionIsValid,
  invitationIsRedeemable,
  GALLERY_GUEST_SESSION_TTL_MS,
  GALLERY_INVITATION_TTL_MS,
  GALLERY_MAX_INPUT_BYTES,
  GALLERY_STORAGE_BUDGET_BYTES,
} from "./rules.ts";
import { galleryEnabled } from "./config.ts";

test("gallery is off unless the server flag is exactly true", () => {
  const old = process.env.GALLERY_ENABLED;
  try {
    delete process.env.GALLERY_ENABLED;
    assert.equal(galleryEnabled(), false);
    process.env.GALLERY_ENABLED = "1";
    assert.equal(galleryEnabled(), false);
    process.env.GALLERY_ENABLED = "true";
    assert.equal(galleryEnabled(), true);
  } finally {
    if (old === undefined) delete process.env.GALLERY_ENABLED;
    else process.env.GALLERY_ENABLED = old;
  }
});

test("members manage their own work and administrators manage family work", () => {
  assert.equal(canManageGallery("member", "owner", "owner"), true);
  assert.equal(canManageGallery("member", "other", "owner"), false);
  assert.equal(canManageGallery("administrator", "admin", "owner"), true);
  assert.equal(canEditDrawing("member", "other", "owner"), false);
});

test("invitation and session deadlines are exact and use an injected clock", () => {
  const now = new Date("2026-11-19T12:00:00.000Z");
  const inviteExpiry = createInvitationExpiry(now);
  const sessionExpiry = createGuestSessionExpiry(now);
  assert.equal(inviteExpiry.getTime() - now.getTime(), GALLERY_INVITATION_TTL_MS);
  assert.equal(sessionExpiry.getTime() - now.getTime(), GALLERY_GUEST_SESSION_TTL_MS);
  const invitation = { expiresAt: inviteExpiry, redeemedAt: null, revokedAt: null };
  assert.equal(invitationIsRedeemable(invitation, new Date(inviteExpiry.getTime() - 1)), true);
  assert.equal(invitationIsRedeemable(invitation, inviteExpiry), false);
  assert.equal(invitationIsRedeemable({ ...invitation, revokedAt: now }, now), false);
  const redeemed = { ...invitation, redeemedAt: now };
  const session = { expiresAt: sessionExpiry, revokedAt: null };
  const access = { session, invitation: redeemed, collectionArchivedAt: null };
  assert.equal(guestSessionIsValid(access, new Date(sessionExpiry.getTime() - 1)), true);
  assert.equal(guestSessionIsValid(access, sessionExpiry), false);
  assert.equal(guestSessionIsValid({ ...access, invitation: { ...redeemed, revokedAt: now } }, now), false);
  assert.equal(guestSessionIsValid({ ...access, collectionArchivedAt: now }, now), false);
});

test("upload metadata and storage quota reject values outside product limits", () => {
  assert.deepEqual(galleryUploadInput({ name: "../drawing.png", bytes: 1024, type: "image/png" }), { name: "drawing.png", bytes: 1024, type: "image/png" });
  for (const invalid of [
    { name: "", bytes: 1, type: "image/png" },
    { name: "drawing.svg", bytes: 1, type: "image/svg+xml" },
    { name: "drawing.png", bytes: GALLERY_MAX_INPUT_BYTES + 1, type: "image/png" },
    { name: "drawing.png", bytes: 1.5, type: "image/png" },
  ]) assert.equal(galleryUploadInput(invalid), null);
  assert.equal(galleryQuotaAllows(GALLERY_STORAGE_BUDGET_BYTES - 10, 0, 10), true);
  assert.equal(galleryQuotaAllows(GALLERY_STORAGE_BUDGET_BYTES - 10, 1, 10), false);
});
