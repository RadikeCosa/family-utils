import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, occurrences, tasks } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { getFamilyDay } from "@/lib/tasks/rules";
import { materializeOccurrences } from "@/lib/tasks/materialize";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ taskId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const member = await getMemberContext(request.headers);
  if (!member) return NextResponse.json({ error: "No family access" }, { status: 403 });
  if (member.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });

  const { taskId } = await context.params;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid action" }, { status: 400 }); }
  const action = body.action;
  const expectedVersion = body.expectedVersion;
  if (!Number.isInteger(expectedVersion) || !["finalize", "archive", "restore"].includes(String(action))) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const result = await getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.familyId, member.familyId)))
      .for("update")
      .limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.version !== expectedVersion) return { kind: "conflict" as const };
    if (action === "finalize" && current.status !== "active") return { kind: "conflict" as const };
    if (action === "archive" && current.status === "archived") return { kind: "conflict" as const };
    if (action === "restore" && current.status === "active") return { kind: "conflict" as const };

    const now = new Date();
    const familyDay = getFamilyDay(now);
    let nextStatus: "active" | "finalized" | "archived" = current.status;
    let nextArchivedAt: Date | null = current.archivedAt;
    let nextFinalizedAt: Date | null = current.finalizedAt;
    if (action === "finalize") { nextStatus = "finalized"; nextFinalizedAt = now; }
    if (action === "archive") { nextStatus = "archived"; nextArchivedAt = now; }
    if (action === "restore") { nextStatus = "active"; nextArchivedAt = null; nextFinalizedAt = null; }

    const [updated] = await tx.update(tasks)
      .set({ status: nextStatus, archivedAt: nextArchivedAt, finalizedAt: nextFinalizedAt, editedByMemberId: member.memberId, updatedAt: now, version: sql`${tasks.version} + 1` })
      .where(and(eq(tasks.id, taskId), eq(tasks.familyId, member.familyId), eq(tasks.version, expectedVersion)))
      .returning();
    if (!updated) return { kind: "conflict" as const };

    if (action === "finalize") {
      const archived = await tx.update(occurrences)
        .set({ status: "archived", archivedAt: now, version: sql`${occurrences.version} + 1` })
        .where(and(eq(occurrences.taskId, taskId), eq(occurrences.status, "open"), gt(occurrences.dueDate, familyDay)))
        .returning();
      for (const occurrence of archived) {
        await tx.insert(auditEvents).values({
          familyId: member.familyId,
          actorMemberId: member.memberId,
          entityType: "occurrence",
          entityId: occurrence.id,
          action: "archived_by_task_finalization",
          before: { status: "open", dueDate: occurrence.dueDate },
          after: occurrence,
        });
      }
    }
    if (action === "archive") {
      const archived = await tx.update(occurrences)
        .set({ status: "archived", archivedAt: now, version: sql`${occurrences.version} + 1` })
        .where(and(eq(occurrences.taskId, taskId), eq(occurrences.status, "open")))
        .returning();
      for (const occurrence of archived) {
        await tx.insert(auditEvents).values({
          familyId: member.familyId,
          actorMemberId: member.memberId,
          entityType: "occurrence",
          entityId: occurrence.id,
          action: "archived_by_task_archive",
          before: { status: "open", dueDate: occurrence.dueDate },
          after: occurrence,
        });
      }
    }
    if (action === "restore" && !(current.repeatWeekdays?.length)) {
      const archivedAtValues = [current.archivedAt, current.finalizedAt].filter((value): value is Date => value !== null);
      if (archivedAtValues.length) {
        const pending = await tx.select().from(occurrences)
          .where(and(eq(occurrences.taskId, taskId), eq(occurrences.status, "archived"), or(...archivedAtValues.map((value) => eq(occurrences.archivedAt, value)))))
          .orderBy(asc(occurrences.dueDate))
          .for("update");
        for (const occurrence of pending) {
          const [restored] = await tx.update(occurrences)
            .set({
              status: "open",
              archivedAt: null,
              dueDate: sql`CASE WHEN ${occurrences.dueDate} IS NULL OR ${occurrences.dueDate} < ${familyDay}::date THEN ${familyDay}::date ELSE ${occurrences.dueDate} END`,
              version: sql`${occurrences.version} + 1`,
            })
            .where(eq(occurrences.id, occurrence.id))
            .returning();
          await tx.insert(auditEvents).values({
            familyId: member.familyId,
            actorMemberId: member.memberId,
            entityType: "occurrence",
            entityId: occurrence.id,
            action: "restored_by_task_restore",
            before: occurrence,
            after: restored,
          });
        }
      }
    }

    await tx.insert(auditEvents).values({
      familyId: member.familyId,
      actorMemberId: member.memberId,
      entityType: "task",
      entityId: taskId,
      action: String(action),
      before: current,
      after: updated,
    });
    await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${member.familyId}`);
    return { kind: "ok" as const, task: updated, shouldMaterialize: action === "restore" && !!current.repeatWeekdays?.length };
  });

  if (result.kind === "missing") return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (result.kind === "conflict") return NextResponse.json({ error: "This task changed. Refresh and try again." }, { status: 409 });
  if (result.shouldMaterialize) await materializeOccurrences(member.familyId);
  return NextResponse.json(result.task);
}
