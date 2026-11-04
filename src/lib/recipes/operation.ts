import { createHash, createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
export const OPERATION_TTL = 24 * 60 * 60 * 1000;
type Claims = { id: string; familyId: string; memberId: string; expiresAt: number };
function key(secret: string) { return Buffer.from(hkdfSync("sha256", secret, "family-utils", "recipe-shopping-operation-v1", 32)); }
export function issueOperation(secret: string, familyId: string, memberId: string, now = Date.now()) {
  const claims: Claims = { id: randomUUID(), familyId, memberId, expiresAt: now + OPERATION_TTL };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${createHmac("sha256", key(secret)).update(payload).digest("base64url")}`;
}
export function verifyOperation(secret: string, token: unknown, familyId: string, memberId: string, now = Date.now()): Claims {
  if (typeof token !== "string" || token.length > 1000) throw new Error("INVALID_OPERATION");
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("INVALID_OPERATION");
  const expected = createHmac("sha256", key(secret)).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("INVALID_OPERATION");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Claims;
  if (claims.familyId !== familyId || claims.memberId !== memberId || !Number.isFinite(claims.expiresAt)) throw new Error("INVALID_OPERATION");
  if (now >= claims.expiresAt) throw new Error("OPERATION_EXPIRED");
  return claims;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function fingerprint(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }
