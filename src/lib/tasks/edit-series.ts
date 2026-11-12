import { and, eq, sql } from "drizzle-orm";
import { auditEvents, occurrences, tasks } from "@/db/schema";
import type { TaskTransaction } from "./schedule-server";
import { occurrencePolicyValues } from "./occurrence-policy";

type Task = typeof tasks.$inferSelect;

// The task row is locked by the caller; all reconciliation shares its transaction.
export async function reconcileTaskEdit(tx: TaskTransaction, before: Task, after: Task, assigneeIds: string[], actorMemberId: string, today: string, now: Date, reschedule: boolean) {
  const existing = await tx.select().from(occurrences).where(and(eq(occurrences.taskId, after.id), sql`NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.family_id = ${after.familyId} AND a.entity_type = 'occurrence' AND a.entity_id = ${occurrences.id} AND a.action = 'superseded_by_task_edit')`)).for("update");
  const edits = await tx.select({ entityId: auditEvents.entityId }).from(auditEvents).where(and(eq(auditEvents.familyId, after.familyId), eq(auditEvents.entityType, "occurrence"), eq(auditEvents.action, "edited"), sql`${auditEvents.before} ? 'task'`));
  const editedIds = new Set(edits.map((item) => item.entityId));
  const wasRoutine = !!before.repeatWeekdays?.length;
  const isRoutine = !!after.repeatWeekdays?.length;
  const responsibilities: (string | null)[] = after.assignmentMode === "individual" ? assigneeIds : [null];
  const preserved = new Set<string | null>();
  const changed: (typeof occurrences.$inferSelect)[] = [];
  const ordinaryCounts = new Map<string | null, number>();
  for (const previous of existing.filter((item) => item.status === "open")) {
    // Explicit exceptions retain their snapshots and responsibility after conversion too.
    if (editedIds.has(previous.id)) { preserved.add(previous.responsibilityMemberId); continue; }
    const future = !!previous.dueDate && previous.dueDate > today;
    const keep = responsibilities.includes(previous.responsibilityMemberId) && (!wasRoutine || (!future && (!isRoutine || after.carryPolicy === "carry_forward")));
    if (!keep) {
      const [retired] = await tx.update(occurrences).set({ status: "archived", archivedAt: now, version: sql`${occurrences.version} + 1` }).where(eq(occurrences.id, previous.id)).returning();
      await tx.insert(auditEvents).values({ familyId: after.familyId, actorMemberId, entityType: "occurrence", entityId: previous.id, action: "superseded_by_task_edit", before: previous, after: retired });
      continue;
    }
    const count = (ordinaryCounts.get(previous.responsibilityMemberId) ?? 0) + 1;
    ordinaryCounts.set(previous.responsibilityMemberId, count);
    if (count > 1) throw new Error("TASK_PENDING_CONFLICT");
    preserved.add(previous.responsibilityMemberId);
    const dueDate = !wasRoutine && !isRoutine && reschedule ? after.scheduledDate : previous.dueDate;
    const [updated] = await tx.update(occurrences).set({
      titleSnapshot: after.title, descriptionSnapshot: after.description, dueDate,
      scheduledTimeSnapshot: after.scheduledTime, assignmentModeSnapshot: after.assignmentMode,
      assigneeIdsSnapshot: assigneeIds, ...occurrencePolicyValues(after.carryPolicy),
      version: sql`${occurrences.version} + 1`,
    }).where(eq(occurrences.id, previous.id)).returning();
    changed.push(updated);
    await tx.insert(auditEvents).values({ familyId: after.familyId, actorMemberId, entityType: "occurrence", entityId: previous.id, action: "edited", before: previous, after: updated });
  }
  if (!isRoutine) {
    for (const responsibilityMemberId of responsibilities) {
      if (preserved.has(responsibilityMemberId) || existing.some((item) => item.responsibilityMemberId === responsibilityMemberId && (item.status !== "open" || item.status === "open" && item.dueDate && item.dueDate > today && editedIds.has(item.id)))) continue;
      const [created] = await tx.insert(occurrences).values({
        taskId: after.id, familyId: after.familyId, dueDate: after.scheduledDate, generationDate: after.scheduledDate,
        titleSnapshot: after.title, descriptionSnapshot: after.description, scheduledTimeSnapshot: after.scheduledTime,
        assignmentModeSnapshot: after.assignmentMode, assigneeIdsSnapshot: assigneeIds,
        ...occurrencePolicyValues(after.carryPolicy), responsibilityMemberId,
      }).returning();
      changed.push(created);
    }
  }
  return changed;
}
