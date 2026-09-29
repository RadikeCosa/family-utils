import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { members, occurrences, tasks } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const member = await getMemberContext(request.headers);
  if (!member) return NextResponse.json({ error: "No family access" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const limitValue = Number(params.get("limit") ?? 30);
  const limit = Number.isInteger(limitValue) ? Math.max(1, Math.min(50, limitValue)) : 30;
  const statusFilter = params.get("status");
  if (statusFilter && statusFilter !== "completed" && statusFilter !== "archived") {
    return NextResponse.json({ error: "El filtro del historial no es válido." }, { status: 400 });
  }
  let cursor: { at: Date; id: string } | null = null;
  const cursorValue = params.get("cursor");
  if (cursorValue) {
    try {
      const parsed = JSON.parse(Buffer.from(cursorValue, "base64url").toString("utf8")) as { at?: unknown; id?: unknown };
      if (typeof parsed.at !== "string" || Number.isNaN(Date.parse(parsed.at)) || typeof parsed.id !== "string" || !/^[0-9a-f-]{36}$/i.test(parsed.id)) throw new Error("bad cursor");
      cursor = { at: new Date(parsed.at), id: parsed.id };
    } catch {
      return NextResponse.json({ error: "El historial cambió. Volvé a abrirlo." }, { status: 400 });
    }
  }

  const activityAt = sql<Date>`coalesce(${occurrences.completedAt}, ${occurrences.archivedAt}, ${occurrences.createdAt})`;
  const clauses = [
    eq(occurrences.familyId, member.familyId),
    inArray(occurrences.status, statusFilter === "completed" ? ["completed"] : statusFilter === "archived" ? ["archived", "missed"] : ["completed", "archived", "missed"]),
  ];
  if (cursor) {
    const cursorClause = or(lt(activityAt, cursor.at), and(eq(activityAt, cursor.at), lt(occurrences.id, cursor.id)));
    if (cursorClause) clauses.push(cursorClause);
  }
  const rows = await getDb().select({
    id: occurrences.id,
    taskId: tasks.id,
    title: occurrences.titleSnapshot,
    description: occurrences.descriptionSnapshot,
    taskStatus: tasks.status,
    taskVersion: tasks.version,
    status: occurrences.status,
    dueDate: occurrences.dueDate,
    assignmentMode: occurrences.assignmentModeSnapshot,
    assigneeIds: occurrences.assigneeIdsSnapshot,
    responsibilityMemberId: occurrences.responsibilityMemberId,
    completedByMemberId: occurrences.completedByMemberId,
    completedAt: occurrences.completedAt,
    archivedAt: occurrences.archivedAt,
    version: occurrences.version,
    activityAt,
  }).from(occurrences).innerJoin(tasks, eq(occurrences.taskId, tasks.id))
    .where(and(...clauses))
    .orderBy(desc(activityAt), desc(occurrences.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const memberIds = [...new Set(page.flatMap((row) => [...(row.assigneeIds ?? []), row.responsibilityMemberId, row.completedByMemberId].filter((id): id is string => !!id)))];
  const people = memberIds.length
    ? await getDb().select({ id: members.id, name: members.name }).from(members)
      .where(and(eq(members.familyId, member.familyId), inArray(members.id, memberIds)))
    : [];
  const peopleById = new Map(people.map((person) => [person.id, person.name]));
  const last = page.at(-1);
  const nextCursor = hasMore && last
    ? Buffer.from(JSON.stringify({ at: new Date(last.activityAt).toISOString(), id: last.id })).toString("base64url")
    : null;

  return NextResponse.json({
    items: page.map(({ assigneeIds, activityAt: at, ...item }) => ({
      ...item,
      activityAt: new Date(at).toISOString(),
      assignees: (assigneeIds ?? []).flatMap((id) => peopleById.has(id) ? [{ memberId: id, name: peopleById.get(id)! }] : []),
      responsibleName: item.responsibilityMemberId ? peopleById.get(item.responsibilityMemberId) ?? "Integrante archivado" : null,
      completedByName: item.completedByMemberId ? peopleById.get(item.completedByMemberId) ?? "Integrante archivado" : null,
    })),
    nextCursor,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
