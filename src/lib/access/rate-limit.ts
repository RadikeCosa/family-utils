import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { codeRateLimits } from "@/db/schema";
import { getDb } from "@/db";
import { accessAttemptBuckets, resolveAccessDevice, trustedClientIp } from "@/lib/access/device-limit";

export function accessPepper(): string {
  const secret = process.env.CODE_PEPPER;
  if (!secret || secret.length < 32) throw new Error("CODE_PEPPER must contain at least 32 characters");
  return secret;
}

export function opaqueBucketKey(secret: string, namespace: string, value: string): string {
  return `${namespace}:${createHmac("sha256", secret).update(`${namespace}\0${value}`).digest("hex")}`;
}

export async function recordCodeAttempt(bucketKey: string, maximum: number, windowMinutes = 15): Promise<boolean> {
  const [row] = await getDb()
    .insert(codeRateLimits)
    .values({ bucketKey, windowStartedAt: new Date(), attempts: 1 })
    .onConflictDoUpdate({
      target: codeRateLimits.bucketKey,
      set: {
        attempts: sql`CASE WHEN ${codeRateLimits.windowStartedAt} <= now() - make_interval(mins => ${windowMinutes}) THEN 1 ELSE ${codeRateLimits.attempts} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${codeRateLimits.windowStartedAt} <= now() - make_interval(mins => ${windowMinutes}) THEN now() ELSE ${codeRateLimits.windowStartedAt} END`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ attempts: codeRateLimits.attempts });
  return row.attempts <= maximum;
}

export async function enforceAccessAttemptLimit(input: {
  headers: Headers;
  endpoint: "prepare" | "redeem";
  secret: string;
  codeValue?: string;
}) {
  const device = resolveAccessDevice(input.headers, input.secret);
  const buckets = accessAttemptBuckets({
    secret: input.secret,
    endpoint: input.endpoint,
    deviceId: device.id,
    clientIp: trustedClientIp(input.headers),
    codeValue: input.codeValue,
  });
  const results = await Promise.all(buckets.map(({ key, maximum }) => recordCodeAttempt(key, maximum, 15)));
  return {
    allowed: results.every(Boolean),
    deviceCookie: device.cookie,
    shouldSetCookie: device.isNew,
  };
}
