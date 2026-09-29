import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { codeRateLimits } from "@/db/schema";
import { getDb } from "@/db";

export function accessPepper(): string {
  const secret = process.env.CODE_PEPPER;
  if (!secret || secret.length < 32) throw new Error("CODE_PEPPER must contain at least 32 characters");
  return secret;
}

export function opaqueBucketKey(secret: string, namespace: string, value: string): string {
  return `${namespace}:${createHmac("sha256", secret).update(`${namespace}\0${value}`).digest("hex")}`;
}

export async function recordCodeAttempt(bucketKey: string, maximum: number): Promise<boolean> {
  const [row] = await getDb()
    .insert(codeRateLimits)
    .values({ bucketKey, windowStartedAt: new Date(), attempts: 1 })
    .onConflictDoUpdate({
      target: codeRateLimits.bucketKey,
      set: {
        attempts: sql`CASE WHEN ${codeRateLimits.windowStartedAt} <= now() - interval '15 minutes' THEN 1 ELSE ${codeRateLimits.attempts} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${codeRateLimits.windowStartedAt} <= now() - interval '15 minutes' THEN now() ELSE ${codeRateLimits.windowStartedAt} END`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ attempts: codeRateLimits.attempts });
  return row.attempts <= maximum;
}
