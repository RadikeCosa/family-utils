import { and, desc, eq, isNull, lt, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, members, occurrences, taskAssignees, tasks } from "@/db/schema";
import { getFamilyDay } from "@/lib/tasks/rules";

function addDays(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, date + offset));
  return value.toISOString().slice(0, 10);
}

function weekday(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay();
}

export async function materializeOccurrences(familyId: string, now: Date = new Date()): Promise<void> {
  const today = getFamilyDay(now);
  await getDb().transaction(async (tx) => {
    const scheduledTasks = await tx.select().from(tasks)
      .where(and(eq(tasks.familyId, familyId), eq(tasks.status, "active"), isNull(tasks.archivedAt), isNull(tasks.finalizedAt)))
      .for("update");
    let changed = false;

    for (const task of scheduledTasks) {
      const weekdays = task.repeatWeekdays ?? [];
      if (weekdays.length === 0) continue;

      if (task.carryPolicy === "expires_daily") {
        const expired = await tx.update(occurrences)
          .set({ status: "missed", version: sql`${occurrences.version} + 1` })
          .where(and(eq(occurrences.taskId, task.id), eq(occurrences.status, "open"), lt(occurrences.dueDate, today)))
          .returning();
        for (const occurrence of expired) {
          await tx.insert(auditEvents).values({
            familyId,
            actorMemberId: null,
            entityType: "occurrence",
            entityId: occurrence.id,
            action: "expired",
            before: { status: "open", dueDate: occurrence.dueDate },
            after: { status: "missed", dueDate: occurrence.dueDate },
          });
        }
        changed ||= expired.length > 0;
      }

      const allAssignments = await tx.select({ memberId: taskAssignees.memberId, archivedAt: members.archivedAt })
        .from(taskAssignees)
        .innerJoin(members, eq(taskAssignees.memberId, members.id))
        .where(and(eq(taskAssignees.taskId, task.id), eq(members.familyId, familyId)));
      const activeAssigneeIds = allAssignments.filter((assignment) => !assignment.archivedAt).map((assignment) => assignment.memberId);
      if (task.assignmentMode === "individual" && activeAssigneeIds.length === 0) continue;
      if (task.assignmentMode === "shared" && allAssignments.length > 0 && activeAssigneeIds.length === 0) continue;

      const baseStart = task.scheduledDate && task.scheduledDate > today ? task.scheduledDate : today;
      const responsibilities = task.assignmentMode === "individual" ? activeAssigneeIds : [null];
      for (const responsibilityMemberId of responsibilities) {
        let start = task.carryPolicy === "carry_forward" ? task.scheduledDate ?? today : baseStart;
        if (task.carryPolicy === "carry_forward") {
          const responsibility = responsibilityMemberId ? eq(occurrences.responsibilityMemberId, responsibilityMemberId) : isNull(occurrences.responsibilityMemberId);
          const pending = await tx.select({ id: occurrences.id }).from(occurrences)
            .where(and(eq(occurrences.taskId, task.id), eq(occurrences.status, "open"), responsibility))
            .limit(1);
          if (pending.length > 0) continue;

          const latestCompletion = await tx.select({ completedAt: occurrences.completedAt }).from(occurrences)
            .where(and(
              eq(occurrences.taskId, task.id),
              eq(occurrences.status, "completed"),
              responsibility,
            ))
            .orderBy(desc(occurrences.completedAt))
            .limit(1);
          const completedAt = latestCompletion[0]?.completedAt;
          if (completedAt) {
            const afterCompletion = addDays(getFamilyDay(completedAt), 1);
            if (afterCompletion > start) start = afterCompletion;
          }
          const latestOmission = await tx.select({ generationDate: occurrences.generationDate }).from(occurrences)
            .where(and(eq(occurrences.taskId, task.id), eq(occurrences.status, "archived"), lte(occurrences.generationDate, today), responsibility))
            .orderBy(desc(occurrences.generationDate))
            .limit(1);
          const omittedDay = latestOmission[0]?.generationDate;
          if (omittedDay) {
            const afterOmission = addDays(omittedDay, 1);
            if (afterOmission > start) start = afterOmission;
          }
        }

        for (let offset = 0; offset < 8; offset += 1) {
          const dueDate = addDays(start, offset);
          if (!weekdays.includes(weekday(dueDate))) continue;
          // A carried occasion starts on its scheduled day, never at completion.
          // The existing open row remains the only pending item across later days.
          if (task.carryPolicy === "carry_forward" && dueDate > today) break;

          const inserted = await tx.insert(occurrences).values({
            taskId: task.id,
            familyId,
            dueDate,
            generationDate: dueDate,
            titleSnapshot: task.title,
            descriptionSnapshot: task.description,
            scheduledTimeSnapshot: task.scheduledTime,
            assignmentModeSnapshot: task.assignmentMode,
            assigneeIdsSnapshot: activeAssigneeIds,
            carryPolicySnapshot: task.carryPolicy,
            carryForward: task.carryPolicy === "carry_forward",
            responsibilityMemberId,
          }).onConflictDoNothing().returning({ id: occurrences.id });
          changed ||= inserted.length > 0;
          if (task.carryPolicy === "carry_forward") break;
        }
      }
    }

    if (changed) await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${familyId}`);
  });
}
