import { and, asc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, members, occurrences, taskAssignees, tasks } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { getFamilyDay } from "@/lib/tasks/rules";
import { materializeOccurrences } from "@/lib/tasks/materialize";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ taskId: string }> };

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nextScheduledDay(fromDay: string, weekdays: number[]): string | null {
  if (!weekdays.length) return null;
  const [year, month, day] = fromDay.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    if (weekdays.includes(date.getUTCDay())) return date.toISOString().slice(0, 10);
  }
  return null;
}

function normalizedIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20 || value.some((id) => typeof id !== "string")) return null;
  return [...new Set(value as string[])];
}

export async function PATCH(request: Request, context: RouteContext) {
  const member = await getMemberContext(request.headers);
  if (!member) return NextResponse.json({ error: "No family access" }, { status: 403 });
  const { taskId } = await context.params;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Revisá los datos de la tarea." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Revisá los datos de la tarea." }, { status: 400 });

  const scope = body.scope;
  const expectedTaskVersion = body.expectedTaskVersion;
  const occurrenceId = typeof body.occurrenceId === "string" ? body.occurrenceId : "";
  const expectedOccurrenceVersion = body.expectedOccurrenceVersion;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const dueDateValue = body.dueDate == null || body.dueDate === "" ? null : body.dueDate;
  const scheduledTimeValue = body.scheduledTime == null || body.scheduledTime === "" ? null : body.scheduledTime;
  const assignmentMode = body.assignmentMode === "individual" ? "individual" : body.assignmentMode === "shared" ? "shared" : null;
  const assigneeIds = normalizedIds(body.assigneeIds);

  if ((scope !== "occurrence" && scope !== "future") || !Number.isSafeInteger(expectedTaskVersion) || !title || title.length > 160 || description.length > 3000 || !assignmentMode || !assigneeIds) {
    return NextResponse.json({ error: "Revisá los datos de la tarea." }, { status: 400 });
  }
  if (dueDateValue !== null && !validDate(dueDateValue)) return NextResponse.json({ error: "La fecha no es válida." }, { status: 400 });
  if (scheduledTimeValue !== null && (typeof scheduledTimeValue !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTimeValue))) {
    return NextResponse.json({ error: "El horario no es válido." }, { status: 400 });
  }
  if (assignmentMode === "individual" && (!assigneeIds.length || (scope === "occurrence" && assigneeIds.length !== 1))) {
    return NextResponse.json({ error: "Elegí una responsabilidad válida para esta ocasión." }, { status: 400 });
  }

  let weekdays: number[] = [];
  let carryPolicy: "expires_daily" | "carry_forward" = "expires_daily";
  if (scope === "future") {
    const weekdayInput = body.repeatWeekdays ?? [];
    if (!Array.isArray(weekdayInput) || weekdayInput.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      return NextResponse.json({ error: "Los días de repetición no son válidos." }, { status: 400 });
    }
    weekdays = [...new Set(weekdayInput as number[])];
    if (body.carryPolicy !== "expires_daily" && body.carryPolicy !== "carry_forward") return NextResponse.json({ error: "Elegí qué hacer con los pendientes." }, { status: 400 });
    carryPolicy = body.carryPolicy;
    if (carryPolicy === "carry_forward" && !weekdays.length) return NextResponse.json({ error: "El pendiente conservado requiere días de repetición." }, { status: 400 });
  }
  if (scope === "occurrence" && (!occurrenceId || !Number.isSafeInteger(expectedOccurrenceVersion))) {
    return NextResponse.json({ error: "La ocasión cambió. Actualizá y volvé a intentar." }, { status: 409 });
  }

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.familyId, member.familyId)))
      .for("update")
      .limit(1);
    if (!task || task.status === "archived") return { kind: "missing" as const };
    if (task.status !== "active") return { kind: "not-active" as const };
    if (task.version !== expectedTaskVersion) return { kind: "conflict" as const };

    const assignedMembers = assigneeIds.length
      ? await tx.select({ id: members.id }).from(members)
        .where(and(eq(members.familyId, member.familyId), isNull(members.archivedAt), inArray(members.id, assigneeIds)))
      : [];
    if (assignedMembers.length !== assigneeIds.length) return { kind: "invalid-assignees" as const };

    const previousAssignments = await tx.select({ memberId: taskAssignees.memberId }).from(taskAssignees)
      .where(eq(taskAssignees.taskId, taskId))
      .orderBy(asc(taskAssignees.memberId));
    const beforeTask = { ...task, assigneeIds: previousAssignments.map(({ memberId }) => memberId) };
    const now = new Date();

    if (scope === "occurrence") {
      const [occurrence] = await tx.select().from(occurrences)
        .where(and(eq(occurrences.id, occurrenceId), eq(occurrences.taskId, taskId), eq(occurrences.familyId, member.familyId)))
        .for("update")
        .limit(1);
      if (!occurrence || occurrence.status !== "open") return { kind: "conflict" as const };
      if (occurrence.version !== expectedOccurrenceVersion) return { kind: "conflict" as const };
      if (dueDateValue && dueDateValue < getFamilyDay(now)) return { kind: "past-date" as const };
      if (assignmentMode === "individual" && occurrence.generationDate) {
        const [duplicate] = await tx.select({ id: occurrences.id }).from(occurrences)
          .where(and(
            eq(occurrences.taskId, taskId),
            ne(occurrences.id, occurrence.id),
            eq(occurrences.generationDate, occurrence.generationDate),
            eq(occurrences.responsibilityMemberId, assigneeIds[0]),
            ne(occurrences.status, "archived"),
          ))
          .limit(1);
        if (duplicate) return { kind: "conflict" as const };
      }

      const updatedTask = await tx.update(tasks)
        .set({ editedByMemberId: member.memberId, updatedAt: now, version: sql`${tasks.version} + 1` })
        .where(and(eq(tasks.id, taskId), eq(tasks.version, expectedTaskVersion)))
        .returning();
      const responsibilityMemberId = assignmentMode === "individual" ? assigneeIds[0] : null;
      const [updatedOccurrence] = await tx.update(occurrences)
        .set({
          titleSnapshot: title,
          descriptionSnapshot: description || null,
          dueDate: dueDateValue,
          scheduledTimeSnapshot: scheduledTimeValue,
          assignmentModeSnapshot: assignmentMode,
          assigneeIdsSnapshot: assigneeIds,
          responsibilityMemberId,
          version: sql`${occurrences.version} + 1`,
        })
        .where(and(eq(occurrences.id, occurrence.id), eq(occurrences.version, expectedOccurrenceVersion)))
        .returning();
      if (!updatedTask.length || !updatedOccurrence) return { kind: "conflict" as const };
      await tx.insert(auditEvents).values({
        familyId: member.familyId,
        actorMemberId: member.memberId,
        entityType: "occurrence",
        entityId: occurrence.id,
        action: "edited",
        before: { ...occurrence, task: beforeTask },
        after: { ...updatedOccurrence, editorId: member.memberId, editedAt: now },
      });
      await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${member.familyId}`);
      return { kind: "ok" as const, task: updatedTask[0], occurrence: updatedOccurrence, shouldMaterialize: false };
    }

    const today = getFamilyDay(now);
    const selectedDate = validDate(dueDateValue) ? dueDateValue : null;
    const scheduleStart = selectedDate && selectedDate > today ? selectedDate : today;
    const scheduledDate = weekdays.length ? nextScheduledDay(scheduleStart, weekdays) : selectedDate && selectedDate >= today ? selectedDate : selectedDate ? today : null;
    const [updatedTask] = await tx.update(tasks)
      .set({
        title,
        description: description || null,
        scheduledDate,
        scheduledTime: scheduledTimeValue,
        assignmentMode,
        repeatWeekdays: weekdays.length ? weekdays : null,
        carryPolicy,
        editedByMemberId: member.memberId,
        updatedAt: now,
        version: sql`${tasks.version} + 1`,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.version, expectedTaskVersion)))
      .returning();
    if (!updatedTask) return { kind: "conflict" as const };

    const oldFuture = await tx.update(occurrences)
      .set({ status: "archived", archivedAt: now, version: sql`${occurrences.version} + 1` })
      .where(and(
        eq(occurrences.taskId, taskId),
        eq(occurrences.status, "open"),
        or(isNull(occurrences.dueDate), gte(occurrences.dueDate, today)),
      ))
      .returning();
    for (const occurrence of oldFuture) {
      await tx.insert(auditEvents).values({
        familyId: member.familyId,
        actorMemberId: member.memberId,
        entityType: "occurrence",
        entityId: occurrence.id,
        action: "superseded_by_task_edit",
        before: { status: "open", dueDate: occurrence.dueDate },
        after: occurrence,
      });
    }

    await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
    if (assigneeIds.length) await tx.insert(taskAssignees).values(assigneeIds.map((memberId) => ({ taskId, memberId })));

    let createdOccurrences: (typeof occurrences.$inferSelect)[] = [];
    if (!weekdays.length) {
      const responsibilities = assignmentMode === "individual" ? assigneeIds : [null];
      createdOccurrences = await tx.insert(occurrences).values(responsibilities.map((responsibilityMemberId) => ({
        taskId,
        familyId: member.familyId,
        dueDate: scheduledDate,
        generationDate: scheduledDate,
        titleSnapshot: updatedTask.title,
        descriptionSnapshot: updatedTask.description,
        scheduledTimeSnapshot: updatedTask.scheduledTime,
        assignmentModeSnapshot: updatedTask.assignmentMode,
        assigneeIdsSnapshot: assigneeIds,
        carryPolicySnapshot: updatedTask.carryPolicy,
        carryForward: false,
        responsibilityMemberId,
      }))).returning();
    }

    const afterTask = { ...updatedTask, assigneeIds };
    await tx.insert(auditEvents).values({
      familyId: member.familyId,
      actorMemberId: member.memberId,
      entityType: "task",
      entityId: taskId,
      action: "edited_from_today",
      before: beforeTask,
      after: afterTask,
    });
    await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${member.familyId}`);
    return { kind: "ok" as const, task: updatedTask, occurrences: createdOccurrences, shouldMaterialize: !!weekdays.length };
  });

  if (result.kind === "missing") return NextResponse.json({ error: "No encontramos esa tarea." }, { status: 404 });
  if (result.kind === "not-active") return NextResponse.json({ error: "Restaurá la tarea antes de editarla." }, { status: 409 });
  if (result.kind === "invalid-assignees") return NextResponse.json({ error: "Elegí responsables de esta familia." }, { status: 400 });
  if (result.kind === "past-date") return NextResponse.json({ error: "Elegí hoy o una fecha futura para esta ocasión." }, { status: 400 });
  if (result.kind === "conflict") return NextResponse.json({ error: "La tarea cambió. Actualizá y volvé a intentar." }, { status: 409 });
  if (result.shouldMaterialize) await materializeOccurrences(member.familyId);
  return NextResponse.json({ task: result.task, occurrences: result.occurrences ?? [result.occurrence] });
}
