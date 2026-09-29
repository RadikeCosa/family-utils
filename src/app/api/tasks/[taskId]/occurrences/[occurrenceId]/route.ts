import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, occurrences, taskAssignees, tasks } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { canUndoCompletion } from "@/lib/tasks/rules";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ taskId: string; occurrenceId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const member = await getMemberContext(request.headers);
  if (!member) return NextResponse.json({ error: "No family access" }, { status: 403 });
  const { taskId, occurrenceId } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  const action = body.action;
  const expectedVersion = body.expectedVersion;
  if (!Number.isInteger(expectedVersion) || !["claim", "complete", "undo", "skip"].includes(String(action))) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const result = await getDb().transaction(async (tx) => {
    const [task] = await tx.select().from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.familyId, member.familyId)))
      .for("update")
      .limit(1);
    if (!task || task.status === "archived") return { kind: "missing" as const };
    const [current] = await tx.select().from(occurrences)
      .where(and(eq(occurrences.id, occurrenceId), eq(occurrences.taskId, taskId), eq(occurrences.familyId, member.familyId)))
      .for("update")
      .limit(1);
    if (!current || current.status === "archived") return { kind: "missing" as const };
    if (current.version !== expectedVersion) return { kind: "conflict" as const };

    if (action === "claim") {
      if (current.status !== "open" || current.claimedByMemberId) return { kind: "conflict" as const };
      const [assignee] = await tx.select({ memberId: taskAssignees.memberId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, taskId))
        .limit(1);
      if (assignee) return { kind: "not-claimable" as const };
    }
    if (action === "complete" && current.status !== "open") return { kind: "conflict" as const };
    if (action === "skip" && (current.status !== "open" || task.status !== "active")) return { kind: "conflict" as const };
    if (action === "undo") {
      if (current.status !== "completed" || !canUndoCompletion(member.role, current.completedByMemberId, member.memberId)) {
        return { kind: "forbidden" as const };
      }
      const generationDate = current.generationDate ?? current.dueDate;
      if (current.carryForward && generationDate) {
        const [laterOccurrence] = await tx.select({ id: occurrences.id }).from(occurrences)
          .where(and(
            eq(occurrences.taskId, taskId),
            ne(occurrences.id, current.id),
            gt(occurrences.generationDate, generationDate),
            ne(occurrences.status, "archived"),
            current.responsibilityMemberId ? eq(occurrences.responsibilityMemberId, current.responsibilityMemberId) : isNull(occurrences.responsibilityMemberId),
          ))
          .limit(1);
        if (laterOccurrence) return { kind: "undo-blocked" as const };
      }
    }

    const update = action === "claim"
      ? { claimedByMemberId: member.memberId, version: sql`${occurrences.version} + 1` }
      : action === "complete"
        ? { status: "completed" as const, completedByMemberId: member.memberId, completedAt: new Date(), version: sql`${occurrences.version} + 1` }
        : action === "skip"
          ? { status: "archived" as const, archivedAt: new Date(), version: sql`${occurrences.version} + 1` }
          : { status: "open" as const, completedByMemberId: null, completedAt: null, version: sql`${occurrences.version} + 1` };
    const [updated] = await tx.update(occurrences)
      .set(update)
      .where(and(
        eq(occurrences.id, occurrenceId),
        eq(occurrences.familyId, member.familyId),
        eq(occurrences.version, expectedVersion),
        action === "claim" ? isNull(occurrences.claimedByMemberId) : sql`true`,
      ))
      .returning();
    if (!updated) return { kind: "conflict" as const };

    await tx.insert(auditEvents).values({
      familyId: member.familyId,
      actorMemberId: member.memberId,
      entityType: "occurrence",
      entityId: occurrenceId,
      action: String(action),
      before: current,
      after: updated,
    });
    await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${member.familyId}`);
    return { kind: "ok" as const, occurrence: updated };
  });

  if (result.kind === "missing") return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (result.kind === "forbidden") return NextResponse.json({ error: "Action not allowed" }, { status: 403 });
  if (result.kind === "not-claimable") return NextResponse.json({ error: "This task already has responsible members" }, { status: 409 });
  if (result.kind === "undo-blocked") return NextResponse.json({ error: "No se puede deshacer: la siguiente ocasión ya fue asumida, modificada o completada. Abrila para corregirla o pedí ayuda a un administrador." }, { status: 409 });
  if (result.kind === "conflict") return NextResponse.json({ error: "La tarea cambió. Actualizá y volvé a intentar." }, { status: 409 });
  return NextResponse.json(result.occurrence);
}
