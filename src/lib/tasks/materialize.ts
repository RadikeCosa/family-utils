import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, occurrences, tasks } from "@/db/schema";
import { getFamilyDay } from "./family-day";
import { expectedOccurrences, occurrenceValues, type TaskConnection, type TaskTransaction } from "./schedule-server";

async function expiring(db: TaskConnection, familyId: string, today: string, taskId?: string) {
  return db.select({ id: occurrences.id }).from(occurrences).innerJoin(tasks, eq(occurrences.taskId, tasks.id)).where(and(
    eq(occurrences.familyId, familyId), eq(occurrences.status, "open"), lt(occurrences.dueDate, today),
    eq(occurrences.carryPolicySnapshot, "expires_daily"), eq(tasks.status, "active"), sql`cardinality(${tasks.repeatWeekdays}) > 0`, taskId ? eq(tasks.id, taskId) : undefined,
  ));
}

export async function needsTaskSync(db: TaskConnection, familyId: string, now = new Date(), taskId?: string): Promise<boolean> {
  const today = getFamilyDay(now);
  const expired = await expiring(db, familyId, today, taskId);
  const expected = await expectedOccurrences(db, familyId, today, today, taskId);
  return expired.length > 0 || expected.some((item) => item.generationDate <= today);
}

// Caller owns the transaction and revision bump. Writes and sync share this service.
export async function materializeInTransaction(tx: TaskTransaction, familyId: string, now = new Date(), taskId?: string): Promise<boolean> {
  const today = getFamilyDay(now);
  await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.familyId, familyId), eq(tasks.status, "active"), isNull(tasks.archivedAt), sql`cardinality(${tasks.repeatWeekdays}) > 0`, taskId ? eq(tasks.id, taskId) : undefined)).orderBy(asc(tasks.id)).for("update");
  let changed = false;
  const expiredIds = (await expiring(tx, familyId, today, taskId)).map((item) => item.id);
  if (expiredIds.length) {
    const expired = await tx.update(occurrences).set({ status: "missed", version: sql`${occurrences.version} + 1` }).where(and(eq(occurrences.status, "open"), inArray(occurrences.id, expiredIds))).returning();
    for (const item of expired) await tx.insert(auditEvents).values({ familyId, actorMemberId: null, entityType: "occurrence", entityId: item.id, action: "expired", before: { status: "open", dueDate: item.dueDate }, after: { status: "missed", dueDate: item.dueDate } });
    changed = expired.length > 0;
  }
  const expected = await expectedOccurrences(tx, familyId, today, today, taskId);
  for (const item of expected) {
    if (item.generationDate > today) continue;
    const inserted = await tx.insert(occurrences).values(occurrenceValues(item)).onConflictDoNothing().returning({ id: occurrences.id });
    changed ||= inserted.length > 0;
  }
  return changed;
}

export async function materializeOccurrences(familyId: string, now = new Date()): Promise<boolean> {
  const db = getDb();
  if (!await needsTaskSync(db, familyId, now)) return false;
  return db.transaction(async (tx) => {
    const changed = await materializeInTransaction(tx, familyId, now);
    if (changed) await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${familyId}`);
    return changed;
  });
}
