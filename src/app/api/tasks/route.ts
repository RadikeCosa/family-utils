import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, families, members, occurrences, taskAssignees, tasks } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { FAMILY_TIME_ZONE, getFamilyDay, taskListEtag } from "@/lib/tasks/family-day";
import { materializeOccurrences } from "@/lib/tasks/materialize";

export const runtime = "nodejs";

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nextScheduledDay(fromDay: string, weekdays: number[]): string | null {
  if (weekdays.length === 0) return null;
  const [year, month, day] = fromDay.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    if (weekdays.includes(date.getUTCDay())) return date.toISOString().slice(0, 10);
  }
  return null;
}

export async function GET(request: Request) {
  const member = await getMemberContext(request.headers);
  if (!member) return NextResponse.json({ error: "No family access" }, { status: 403 });

  const now = new Date();
  const today = getFamilyDay(now);
  await materializeOccurrences(member.familyId, now);
  const [familyState] = await getDb().select({ revision: families.revision })
    .from(families)
    .where(eq(families.id, member.familyId))
    .limit(1);
  const revision = familyState?.revision ?? member.familyRevision;
  const etag = taskListEtag(member.familyId, revision, today);
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  }

  const editor = alias(members, "task_editor");
  const data = await getDb()
    .select({
      id: occurrences.id,
      taskId: tasks.id,
      title: occurrences.titleSnapshot,
      description: occurrences.descriptionSnapshot,
      taskStatus: tasks.status,
      taskVersion: tasks.version,
      taskTitle: tasks.title,
      taskDescription: tasks.description,
      taskScheduledDate: tasks.scheduledDate,
      taskScheduledTime: tasks.scheduledTime,
      taskAssignmentMode: tasks.assignmentMode,
      repeatWeekdays: tasks.repeatWeekdays,
      carryPolicy: occurrences.carryPolicySnapshot,
      assignmentMode: occurrences.assignmentModeSnapshot,
      assigneeIdsSnapshot: occurrences.assigneeIdsSnapshot,
      scheduledTime: occurrences.scheduledTimeSnapshot,
      editedByMemberId: tasks.editedByMemberId,
      editedByName: editor.name,
      updatedAt: tasks.updatedAt,
      dueDate: occurrences.dueDate,
      responsibilityMemberId: occurrences.responsibilityMemberId,
      claimedByMemberId: occurrences.claimedByMemberId,
      status: occurrences.status,
      completedByMemberId: occurrences.completedByMemberId,
      completedAt: occurrences.completedAt,
      version: occurrences.version,
    })
    .from(occurrences)
    .innerJoin(tasks, eq(occurrences.taskId, tasks.id))
    .innerJoin(editor, eq(tasks.editedByMemberId, editor.id))
    .where(and(
      eq(occurrences.familyId, member.familyId),
      ne(tasks.status, "archived"),
      ne(occurrences.status, "archived"),
      or(eq(occurrences.status, "open"), and(
        eq(occurrences.status, "completed"),
        eq(sql<string>`(${occurrences.completedAt} AT TIME ZONE ${FAMILY_TIME_ZONE})::date`, today),
      )),
    ))
    .orderBy(sql`CASE WHEN ${occurrences.status} = 'open' THEN 0 ELSE 1 END`, asc(occurrences.dueDate), asc(occurrences.id))
    .limit(150);

  const snapshotMemberIds = [...new Set(data.flatMap((item) => item.assigneeIdsSnapshot ?? []))];
  const taskIds = [...new Set(data.map((item) => item.taskId))];
  const people = snapshotMemberIds.length
    ? await getDb().select({ id: members.id, name: members.name }).from(members)
      .where(and(eq(members.familyId, member.familyId), inArray(members.id, snapshotMemberIds)))
    : [];
  const peopleById = new Map(people.map((person) => [person.id, person.name]));
  const configuredAssignments = taskIds.length
    ? await getDb().select({ taskId: taskAssignees.taskId, memberId: members.id, name: members.name })
      .from(taskAssignees)
      .innerJoin(members, eq(taskAssignees.memberId, members.id))
      .where(and(eq(members.familyId, member.familyId), isNull(members.archivedAt), inArray(taskAssignees.taskId, taskIds)))
    : [];
  const configuredByTask = new Map<string, { memberId: string; name: string }[]>();
  for (const assignment of configuredAssignments) {
    const current = configuredByTask.get(assignment.taskId) ?? [];
    current.push({ memberId: assignment.memberId, name: assignment.name });
    configuredByTask.set(assignment.taskId, current);
  }

  return NextResponse.json({
    familyDay: today,
    timeZone: FAMILY_TIME_ZONE,
    memberId: member.memberId,
    revision,
    tasks: data.map(({ assigneeIdsSnapshot, ...item }) => ({
      ...item,
      taskAssignees: configuredByTask.get(item.taskId) ?? [],
      assignees: (assigneeIdsSnapshot ?? []).flatMap((memberId) => {
        const name = peopleById.get(memberId);
        return name ? [{ memberId, name }] : [];
      }),
    })),
  }, { headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
}

export async function POST(request: Request) {
  const member = await getMemberContext(request.headers);
  if (!member) return NextResponse.json({ error: "No family access" }, { status: 403 });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid task" }, { status: 400 });
  }
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Invalid task" }, { status: 400 });

  const body = input as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const dueDate = body.dueDate == null || body.dueDate === "" ? null : body.dueDate;
  const scheduledTime = body.scheduledTime == null || body.scheduledTime === "" ? null : body.scheduledTime;
  const weekdayInput = body.repeatWeekdays ?? [];
  const assigneeInput = body.assigneeIds ?? [];
  const assignmentMode = body.assignmentMode === "individual" ? "individual" : body.assignmentMode === "shared" || body.assignmentMode == null ? "shared" : null;
  const carryPolicy = body.carryPolicy === "carry_forward" ? "carry_forward" : body.carryPolicy === "expires_daily" || body.carryPolicy == null ? "expires_daily" : null;

  if (!title || title.length > 160 || (description && description.length > 3000)) {
    return NextResponse.json({ error: "Task name is required (160 characters max)" }, { status: 400 });
  }
  if (dueDate !== null && !validDate(dueDate)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  if (scheduledTime !== null && (typeof scheduledTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime))) {
    return NextResponse.json({ error: "Invalid time" }, { status: 400 });
  }
  if (!Array.isArray(weekdayInput) || weekdayInput.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return NextResponse.json({ error: "Invalid repeat days" }, { status: 400 });
  }
  const weekdays = [...new Set(weekdayInput as number[])];
  if (!Array.isArray(assigneeInput) || assigneeInput.length > 20 || assigneeInput.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "Invalid assignees" }, { status: 400 });
  }
  const assigneeIds = [...new Set(assigneeInput as string[])];
  if (!assignmentMode || !carryPolicy || (assignmentMode === "individual" && assigneeIds.length === 0) || (carryPolicy === "carry_forward" && weekdays.length === 0)) {
    return NextResponse.json({ error: "Invalid task settings" }, { status: 400 });
  }

  const db = getDb();
  const created = await db.transaction(async (tx) => {
    if (assigneeIds.length) {
      const validMembers = await tx.select({ id: members.id })
        .from(members)
        .where(and(eq(members.familyId, member.familyId), isNull(members.archivedAt)));
      const validIds = new Set(validMembers.map((item) => item.id));
      if (assigneeIds.some((id) => !validIds.has(id))) throw new Error("INVALID_ASSIGNEE");
    }

    const [task] = await tx.insert(tasks).values({
      familyId: member.familyId,
      title,
      description: description || null,
      assignmentMode,
      repeatWeekdays: weekdays.length ? weekdays : null,
      carryPolicy,
      scheduledDate: weekdays.length ? nextScheduledDay(validDate(dueDate) ? dueDate : getFamilyDay(), weekdays) : validDate(dueDate) ? dueDate : null,
      scheduledTime,
      createdByMemberId: member.memberId,
      editedByMemberId: member.memberId,
    }).returning();

    if (assigneeIds.length) await tx.insert(taskAssignees).values(assigneeIds.map((assigneeId) => ({ taskId: task.id, memberId: assigneeId })));
    const firstDueDate = weekdays.length ? task.scheduledDate : validDate(dueDate) ? dueDate : null;
    const validAssignmentMode = assignmentMode as "shared" | "individual";
    const validCarryPolicy = carryPolicy as "expires_daily" | "carry_forward";
    const responsibilities = validAssignmentMode === "individual" ? assigneeIds : [null];
    const firstOccurrences = await tx.insert(occurrences).values(responsibilities.map((responsibilityMemberId) => ({
      taskId: task.id,
      familyId: member.familyId,
      dueDate: firstDueDate,
      generationDate: firstDueDate,
      titleSnapshot: task.title,
      descriptionSnapshot: task.description,
      scheduledTimeSnapshot: task.scheduledTime,
      assignmentModeSnapshot: validAssignmentMode,
      assigneeIdsSnapshot: assigneeIds,
      carryPolicySnapshot: validCarryPolicy,
      carryForward: validCarryPolicy === "carry_forward",
      responsibilityMemberId,
    }))).returning();

    await tx.insert(auditEvents).values({
      familyId: member.familyId,
      actorMemberId: member.memberId,
      entityType: "task",
      entityId: task.id,
      action: "created",
      after: { ...task, assigneeIds },
    });
    await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${member.familyId}`);
    return { task, occurrences: firstOccurrences };
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "INVALID_ASSIGNEE") return null;
    throw error;
  });

  if (!created) return NextResponse.json({ error: "Assignee must belong to this family" }, { status: 400 });
  return NextResponse.json(created, { status: 201 });
}
