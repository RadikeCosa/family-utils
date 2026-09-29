import assert from "node:assert/strict";
import test from "node:test";
import { accessAttemptBuckets, resolveAccessDevice, trustedClientIp } from "./device-limit.ts";

test("signed device cookies remain stable and reject tampering", () => {
  const secret = "test-secret-with-at-least-thirty-two-bytes-long";
  const first = resolveAccessDevice(new Headers(), secret);
  assert.equal(first.isNew, true);
  const restored = resolveAccessDevice(new Headers({ cookie: `fu_access_device=${first.cookie}` }), secret);
  assert.equal(restored.id, first.id);
  assert.equal(restored.isNew, false);
  const altered = resolveAccessDevice(new Headers({ cookie: `fu_access_device=${first.cookie.slice(0, -1)}x` }), secret);
  assert.equal(altered.isNew, true);
  assert.notEqual(altered.id, first.id);
});

test("failed codes have separate buckets for each device and trusted client IP", () => {
  const shared = { secret: "test-secret-with-at-least-thirty-two-bytes-long", endpoint: "redeem" as const, clientIp: "203.0.113.9" };
  const firstMember = accessAttemptBuckets({ ...shared, deviceId: "member-one-device", codeValue: "bad-code-one" });
  const secondMember = accessAttemptBuckets({ ...shared, deviceId: "member-two-device", codeValue: "bad-code-two" });
  assert.notEqual(firstMember.find(({ key }) => key.includes("redeem-device"))?.key, secondMember.find(({ key }) => key.includes("redeem-device"))?.key);
  assert.notEqual(firstMember.find(({ key }) => key.includes("redeem-code"))?.key, secondMember.find(({ key }) => key.includes("redeem-code"))?.key);
  assert.equal(firstMember.find(({ key }) => key.includes("redeem-ip"))?.key, secondMember.find(({ key }) => key.includes("redeem-ip"))?.key);
  assert.equal(firstMember.find(({ key }) => key.includes("redeem-global"))?.maximum, 1000);
});

test("untrusted or malformed forwarded headers do not create a shared IP bucket", () => {
  assert.equal(trustedClientIp(new Headers()), null);
  assert.equal(trustedClientIp(new Headers({ "x-vercel-forwarded-for": "unknown-origin" })), null);
  assert.equal(trustedClientIp(new Headers({ "x-vercel-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
});
