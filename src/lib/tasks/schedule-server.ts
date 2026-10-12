import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, members, occurrences, taskAssignees, tasks } from "@/db/schema";
import { taskLogicalKey } from "./family-day";
import { expectedOccurrenceDay, type ScheduleHistory } from "./schedule";

export type TaskTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type TaskConnection = ReturnType<typeof getDb> | TaskTransaction;
export type ScheduledTask = typeof tasks.$inferSelect & { assigneeIds: string[] };
export type ExpectedOccurrence = { task: ScheduledTask; responsibilityMemberId: string | null; generationDate: string; key: string };

export async function expectedOccurrences(db: TaskConnection, familyId: string, today: string, selectedDate: string, taskId?: string): Promise<ExpectedOccurrence[]> {
  const scheduled = await db.select().from(tasks).where(and(eq(tasks.familyId, familyId), eq(tasks.status, "active"), isNull(tasks.archivedAt), isNull(tasks.finalizedAt), sql`cardinality(${tasks.repeatWeekdays}) > 0`, taskId ? eq(tasks.id, taskId) : undefined));
  if (!scheduled.length) return [];
  const ids = scheduled.map((item) => item.id);
  const assignments = await (
    db.select({ taskId: taskAssignees.taskId, memberId: members.id, archivedAt: members.archivedAt }).from(taskAssignees).innerJoin(members, eq(taskAssignees.memberId, members.id)).where(and(eq(members.familyId, familyId), inArray(taskAssignees.taskId, ids))));
  const current = await (db.select().from(occurrences).where(and(eq(occurrences.familyId, familyId), inArray(occurrences.taskId, ids), or(eq(occurrences.status, "open"), eq(occurrences.generationDate, selectedDate)))));
  const completions = await (db.execute<{ taskId: string; memberId: string | null; completedAt: Date }>(sql`SELECT DISTINCT ON (task_id, responsibility_member_id) task_id AS "taskId", responsibility_member_id AS "memberId", completed_at AS "completedAt" FROM task_occurrences WHERE family_id = ${familyId} AND task_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND status = 'completed' ORDER BY task_id, responsibility_member_id, completed_at DESC`));
  const omissions = await (db.execute<{ taskId: string; memberId: string | null; generationDate: string }>(sql`SELECT DISTINCT ON (o.task_id, o.responsibility_member_id) o.task_id AS "taskId", o.responsibility_member_id AS "memberId", o.generation_date AS "generationDate" FROM task_occurrences o WHERE o.family_id = ${familyId} AND o.task_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND o.status = 'archived' AND o.generation_date <= ${today}::date AND EXISTS (SELECT 1 FROM audit_events a WHERE a.family_id = ${familyId} AND a.entity_type = 'occurrence' AND a.entity_id = o.id AND a.action = 'skip') ORDER BY o.task_id, o.responsibility_member_id, o.generation_date DESC`));
  const edited = await (db.select({ before: auditEvents.before }).from(auditEvents).where(and(eq(auditEvents.familyId, familyId), eq(auditEvents.entityType, "occurrence"), eq(auditEvents.action, "edited"), sql`${auditEvents.before}->>'generationDate' = ${selectedDate}`)));
  const skipIds = current.filter((item) => item.status === "archived").map((item) => item.id);
  const skips = skipIds.length ? await db.select({ entityId: auditEvents.entityId }).from(auditEvents).where(and(eq(auditEvents.familyId, familyId), eq(auditEvents.entityType, "occurrence"), eq(auditEvents.action, "skip"), inArray(auditEvents.entityId, skipIds))) : [];
  const skipped = new Set(skips.map((item) => item.entityId));
  const blocked = new Set(current.filter((item) => item.status !== "archived" || skipped.has(item.id)).map((item) => taskLogicalKey(item.taskId, item.responsibilityMemberId, item.generationDate)));
  for (const event of edited) {
    const before = event.before as typeof occurrences.$inferSelect | null;
    if (before && ids.includes(before.taskId)) blocked.add(taskLogicalKey(before.taskId, before.responsibilityMemberId, before.generationDate));
  }
  const results: ExpectedOccurrence[] = [];
  for (const row of scheduled) {
    const configured = assignments.filter((item) => item.taskId === row.id);
    const assigneeIds = configured.filter((item) => !item.archivedAt).map((item) => item.memberId);
    if (row.assignmentMode === "individual" && !assigneeIds.length) continue;
    if (row.assignmentMode === "shared" && configured.length && !assigneeIds.length) continue;
    const task = { ...row, assigneeIds };
    for (const responsibilityMemberId of row.assignmentMode === "individual" ? assigneeIds : [null]) {
      const history: ScheduleHistory = {
        open: current.some((item) => item.taskId === row.id && item.responsibilityMemberId === responsibilityMemberId && item.status === "open"),
        latestCompletion: (() => { const value = completions.rows.find((item) => item.taskId === row.id && item.memberId === responsibilityMemberId)?.completedAt; return value ? new Date(value) : null; })(),
        latestOmission: omissions.rows.find((item) => item.taskId === row.id && item.memberId === responsibilityMemberId)?.generationDate ?? null,
      };
      const generationDate = expectedOccurrenceDay(row, today, selectedDate, history);
      if (!generationDate) continue;
      const key = taskLogicalKey(row.id, responsibilityMemberId, generationDate);
      if (!blocked.has(key)) results.push({ task, responsibilityMemberId, generationDate, key });
    }
  }
  return results;
}

export function occurrenceValues(expected: ExpectedOccurrence) {
  const { task, responsibilityMemberId, generationDate } = expected;
  return { taskId: task.id, familyId: task.familyId, dueDate: generationDate, generationDate,
    titleSnapshot: task.title, descriptionSnapshot: task.description, scheduledTimeSnapshot: task.scheduledTime,
    assignmentModeSnapshot: task.assignmentMode, assigneeIdsSnapshot: task.assigneeIds, carryPolicySnapshot: task.carryPolicy,
    carryForward: task.carryPolicy === "carry_forward", responsibilityMemberId };
}
