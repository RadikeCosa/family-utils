import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { accessCodes, auditEvents, authSession, memberDevices, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ memberId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  if (actor.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const { memberId } = await context.params;

  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid action" }, { status: 400 }); }
  const action = input.action;
  if (action !== "archive" && action !== "restore") return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const result = await getDb().transaction(async (tx) => {
    const [target] = await tx.select().from(members)
      .where(and(eq(members.id, memberId), eq(members.familyId, actor.familyId)))
      .limit(1);
    if (!target) return { kind: "missing" as const };
    if (action === "archive" && target.archivedAt) return { kind: "conflict" as const };
    if (action === "restore" && !target.archivedAt) return { kind: "conflict" as const };

    if (action === "archive" && target.role === "administrator") {
      const administrators = await tx.select({ id: members.id }).from(members)
        .where(and(eq(members.familyId, actor.familyId), eq(members.role, "administrator"), isNull(members.archivedAt)));
      if (administrators.length <= 1) return { kind: "last-admin" as const };
    }

    const now = new Date();
    const [updated] = await tx.update(members)
      .set({ archivedAt: action === "archive" ? now : null, updatedAt: now })
      .where(and(eq(members.id, memberId), eq(members.familyId, actor.familyId), target.archivedAt ? eq(members.archivedAt, target.archivedAt) : isNull(members.archivedAt)))
      .returning();
    if (!updated) return { kind: "conflict" as const };

    if (action === "archive") {
      const devices = await tx.select({ authUserId: memberDevices.authUserId }).from(memberDevices)
        .where(and(eq(memberDevices.memberId, memberId), isNull(memberDevices.revokedAt)));
      for (const device of devices) {
        await tx.update(memberDevices).set({ revokedAt: now }).where(eq(memberDevices.authUserId, device.authUserId));
        await tx.delete(authSession).where(eq(authSession.userId, device.authUserId));
      }
      await tx.update(accessCodes).set({ revokedAt: now })
        .where(and(eq(accessCodes.memberId, memberId), isNull(accessCodes.consumedAt), isNull(accessCodes.revokedAt)));
    }

    await tx.insert(auditEvents).values({
      familyId: actor.familyId,
      actorMemberId: actor.memberId,
      entityType: "member",
      entityId: memberId,
      action,
      before: target,
      after: updated,
    });
    await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${actor.familyId}`);
    return { kind: "ok" as const, member: updated };
  });

  if (result.kind === "missing") return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (result.kind === "last-admin") return NextResponse.json({ error: "The last administrator must remain recoverable" }, { status: 409 });
  if (result.kind === "conflict") return NextResponse.json({ error: "This profile changed. Refresh and try again." }, { status: 409 });
  return NextResponse.json({ id: result.member.id, name: result.member.name, role: result.member.role, archivedAt: result.member.archivedAt });
}
