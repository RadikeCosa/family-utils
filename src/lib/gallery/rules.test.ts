import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditDrawing,
  canManageGallery,
  createGuestSessionExpiry,
  createInvitationExpiry,
  galleryQuotaAllows,
  galleryShareExpiry,
  galleryUploadInput,
  guestSessionIsValid,
  invitationIsRedeemable,
  publicAccessIsValid,
  GALLERY_PUBLIC_IP_REQUESTS_PER_MINUTE,
  GALLERY_PUBLIC_SESSION_REQUESTS_PER_MINUTE,
  GALLERY_SHARE_DURATIONS,
  GALLERY_GUEST_SESSION_TTL_MS,
  GALLERY_INVITATION_TTL_MS,
  GALLERY_MAX_INPUT_BYTES,
  GALLERY_STORAGE_BUDGET_BYTES,
} from "./rules.ts";
import { galleryEnabled, gallerySharesEnabled } from "./config.ts";
import { galleryNow, injectGalleryClock } from "./clock.ts";

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

test("timed shares remain off until the separate release flag is exactly true", () => {
  const oldGallery = process.env.GALLERY_ENABLED;
  const oldShares = process.env.GALLERY_SHARES_ENABLED;
  try {
    process.env.GALLERY_ENABLED = "true";
    delete process.env.GALLERY_SHARES_ENABLED;
    assert.equal(gallerySharesEnabled(), false);
    process.env.GALLERY_SHARES_ENABLED = "1";
    assert.equal(gallerySharesEnabled(), false);
    process.env.GALLERY_SHARES_ENABLED = "true";
    assert.equal(gallerySharesEnabled(), true);
    process.env.GALLERY_ENABLED = "false";
    assert.equal(gallerySharesEnabled(), false);
  } finally {
    if (oldGallery === undefined) delete process.env.GALLERY_ENABLED;
    else process.env.GALLERY_ENABLED = oldGallery;
    if (oldShares === undefined) delete process.env.GALLERY_SHARES_ENABLED;
    else process.env.GALLERY_SHARES_ENABLED = oldShares;
  }
});

test("timed shares use exact UTC durations and expire at the boundary", () => {
  const now = new Date("2026-11-24T12:00:00.000Z");
  for (const [duration, milliseconds] of Object.entries(GALLERY_SHARE_DURATIONS)) {
    const expiresAt = galleryShareExpiry(duration, now)!;
    assert.equal(expiresAt.getTime() - now.getTime(), milliseconds);
    const share = { expiresAt, revokedAt: null, creatorArchivedAt: null };
    const session = { expiresAt, revokedAt: null };
    assert.equal(publicAccessIsValid({ share, session }, new Date(expiresAt.getTime() - 1)), true);
    assert.equal(publicAccessIsValid({ share, session }, expiresAt), false);
  }
  assert.equal(galleryShareExpiry("unknown", now), null);
  assert.equal(galleryShareExpiry("toString", now), null);
  assert.equal(publicAccessIsValid({ share: { expiresAt: new Date(now.getTime() + 1), revokedAt: now, creatorArchivedAt: null } }, now), false);
});

test("gallery services can use and restore an injected clock", () => {
  const instant = new Date("2026-11-24T12:34:56.000Z");
  const restore = injectGalleryClock(() => instant);
  try { assert.equal(galleryNow(), instant); }
  finally { restore(); }
  assert.notEqual(galleryNow(), instant);
});

test("public limits allow a 200 drawing lazy load burst with modest UI overhead", () => {
  const allImages = 200 * 2; // thumbnails and every drawing opened at full size
  const maximumImageRequestsInAnyMinute = Math.ceil(60_000 / 220);
  const pageRequestsInAnyMinute = Math.ceil(maximumImageRequestsInAnyMinute / 24);
  const revalidationsInAnyMinute = 2;
  const peakMinute = maximumImageRequestsInAnyMinute + pageRequestsInAnyMinute + revalidationsInAnyMinute;
  const completeVisitMilliseconds = allImages * 220;
  assert.ok(completeVisitMilliseconds > 60_000, "serialized images spread a complete 200-drawing visit across rate windows");
  assert.ok(peakMinute < GALLERY_PUBLIC_SESSION_REQUESTS_PER_MINUTE);
  assert.ok(peakMinute < GALLERY_PUBLIC_IP_REQUESTS_PER_MINUTE);
  assert.ok(peakMinute < 300, "a normal single-visitor burst stays under the shared global limit");
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
