import { and, eq, gt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, occurrences, tasks } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { getFamilyDay } from "@/lib/tasks/rules";

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
      .limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.version !== expectedVersion) return { kind: "conflict" as const };
    if (action === "finalize" && current.status !== "active") return { kind: "conflict" as const };
    if (action === "archive" && current.status === "archived") return { kind: "conflict" as const };
    if (action === "restore" && current.status !== "archived") return { kind: "conflict" as const };

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
      await tx.update(occurrences)
        .set({ status: "archived", archivedAt: now, version: sql`${occurrences.version} + 1` })
        .where(and(eq(occurrences.taskId, taskId), eq(occurrences.status, "open"), gt(occurrences.dueDate, familyDay)));
    }
    if (action === "archive") {
      await tx.update(occurrences)
        .set({ status: "archived", archivedAt: now, version: sql`${occurrences.version} + 1` })
        .where(and(eq(occurrences.taskId, taskId), eq(occurrences.status, "open")));
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
    return { kind: "ok" as const, task: updated };
  });

  if (result.kind === "missing") return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (result.kind === "conflict") return NextResponse.json({ error: "This task changed. Refresh and try again." }, { status: 409 });
  return NextResponse.json(result.task);
}
