import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { accessCodes, auditEvents, families, memberDevices, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { createAccessCode, digestAccessCode, formatAccessCode } from "@/lib/tasks/rules";
import { accessPepper } from "@/lib/access/rate-limit";
import { accessCodeLifetimeMs, canGenerateMemberCode } from "@/lib/access/policy";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ memberId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  if (actor.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const { memberId } = await context.params;
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid code request" }, { status: 400 }); }
  const purpose = input.purpose;
  if (purpose !== "invitation" && purpose !== "recovery") return NextResponse.json({ error: "Invalid code request" }, { status: 400 });

  let pepper: string;
  try { pepper = accessPepper(); }
  catch { return NextResponse.json({ error: "Access codes are not configured" }, { status: 503 }); }

  const code = createAccessCode();
  const digest = digestAccessCode(code, pepper, purpose);
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${families} WHERE id = ${actor.familyId} FOR UPDATE`);
    const [currentActor] = await tx.select({ role: members.role }).from(memberDevices)
      .innerJoin(members, eq(memberDevices.memberId, members.id))
      .where(and(eq(memberDevices.authUserId, actor.authUser.id), eq(members.familyId, actor.familyId), isNull(memberDevices.revokedAt), isNull(members.archivedAt)))
      .limit(1);
    if (currentActor?.role !== "administrator") return { kind: "forbidden" as const };
    const [target] = await tx.select().from(members)
      .where(and(eq(members.id, memberId), eq(members.familyId, actor.familyId), isNull(members.archivedAt)))
      .for("update")
      .limit(1);
    if (!target) return { kind: "missing" as const };

    const activeDevices = await tx.select({ id: memberDevices.id }).from(memberDevices)
      .where(and(eq(memberDevices.memberId, target.id), isNull(memberDevices.revokedAt)));
    if (!canGenerateMemberCode({
      actorRole: actor.role,
      actorMemberId: actor.memberId,
      targetMemberId: target.id,
      targetRole: target.role,
      accessMethod: target.accessMethod,
      googleEmail: target.googleEmail,
      hasActiveDevice: activeDevices.length > 0,
      purpose,
    })) return { kind: "wrong-method" as const };

    const now = new Date();
    await tx.update(accessCodes).set({ revokedAt: now })
      .where(and(eq(accessCodes.memberId, memberId), eq(accessCodes.purpose, purpose), isNull(accessCodes.consumedAt), isNull(accessCodes.revokedAt)));
    const [record] = await tx.insert(accessCodes).values({
      familyId: actor.familyId,
      memberId,
      purpose,
      digest,
      expiresAt: new Date(Date.now() + accessCodeLifetimeMs(purpose)),
      createdByMemberId: actor.memberId,
    }).returning();
    await tx.insert(auditEvents).values({
      familyId: actor.familyId,
      actorMemberId: actor.memberId,
      entityType: "member",
      entityId: memberId,
      action: `${purpose}_code_created`,
      after: { codeId: record.id, expiresAt: record.expiresAt },
    });
    await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${actor.familyId}`);
    return { kind: "ok" as const, expiresAt: record.expiresAt };
  });

  if (result.kind === "missing") return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (result.kind === "forbidden") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  if (result.kind === "wrong-method") return NextResponse.json({ error: "Este perfil usa Google o todavía no tiene un acceso que reemplazar." }, { status: 409 });
  return NextResponse.json({ code: formatAccessCode(code), purpose, expiresAt: result.expiresAt }, { status: 201, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
