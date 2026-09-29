import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const ACCESS_DEVICE_COOKIE = "fu_access_device";
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function signDevice(secret: string, id: string) {
  return createHmac("sha256", secret).update(`access-device\0${id}`).digest("base64url");
}

function cookieValue(headers: Headers): string | null {
  const cookieHeader = headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === ACCESS_DEVICE_COOKIE) return value.join("=") || null;
  }
  return null;
}

export function resolveAccessDevice(headers: Headers, secret: string) {
  const incoming = cookieValue(headers);
  const [id, signature, extra] = incoming?.split(".") ?? [];
  if (id && signature && !extra && /^[A-Za-z0-9_-]{22}$/.test(id)) {
    const expected = Buffer.from(signDevice(secret, id));
    const actual = Buffer.from(signature);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
      return { id, cookie: `${id}.${signature}`, isNew: false };
    }
  }
  const newId = randomBytes(16).toString("base64url");
  return { id: newId, cookie: `${newId}.${signDevice(secret, newId)}`, isNew: true };
}

export function accessDeviceSetCookie(value: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ACCESS_DEVICE_COOKIE}=${value}; Max-Age=${DEVICE_COOKIE_MAX_AGE}; Path=/api/access; HttpOnly; SameSite=Lax${secure}`;
}

export function trustedClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  return forwarded && isIP(forwarded) ? forwarded : null;
}

function opaqueKey(secret: string, namespace: string, value: string) {
  return `${namespace}:${createHmac("sha256", secret).update(`${namespace}\0${value}`).digest("hex")}`;
}

export function accessAttemptBuckets(input: {
  secret: string;
  endpoint: "prepare" | "redeem";
  deviceId: string;
  clientIp: string | null;
  codeValue?: string;
}) {
  const { secret, endpoint, deviceId, clientIp, codeValue } = input;
  const buckets: { key: string; maximum: number }[] = [
    { key: opaqueKey(secret, `${endpoint}-device`, deviceId), maximum: 10 },
    { key: opaqueKey(secret, `${endpoint}-global`, "all"), maximum: 1000 },
  ];
  if (clientIp) buckets.push({ key: opaqueKey(secret, `${endpoint}-ip`, clientIp), maximum: 60 });
  if (endpoint === "redeem" && codeValue !== undefined) {
    buckets.push({ key: opaqueKey(secret, "redeem-code", codeValue.slice(0, 80)), maximum: 5 });
  }
  return buckets;
}
