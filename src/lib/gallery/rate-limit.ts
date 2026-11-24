import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { authRateLimit } from "@/db/schema";

// Fixed UTC buckets keep counters atomic across serverless instances. The
// bucket key is a digest or a global scope, never a raw token or IP address.
export async function consumeGalleryRateLimit(scope: string, limit: number, windowMs: number, now = Date.now()) {
  const bucket = Math.floor(now / windowMs);
  const key = `gallery:${scope}:${windowMs}:${bucket}`;
  const [counter] = await getDb().insert(authRateLimit).values({ key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: authRateLimit.key,
      set: { count: sql`${authRateLimit.count} + 1`, lastRequest: now },
    }).returning({ count: authRateLimit.count });
  return (counter?.count ?? limit + 1) <= limit;
}

export async function consumeGalleryInterval(scope: string, intervalMs: number, now = Date.now()) {
  const key = `gallery:interval:${scope}`;
  const allowed = await getDb().insert(authRateLimit).values({ key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: authRateLimit.key,
      set: { count: 1, lastRequest: now },
      setWhere: sql`${authRateLimit.lastRequest} <= ${now - intervalMs}`,
    }).returning({ key: authRateLimit.key });
  return allowed.length === 1;
}
