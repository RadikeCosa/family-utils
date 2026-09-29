import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { accessCodes, auditEvents, authSession, authUser, families, memberDevices, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ memberId: string }> };
const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  if (actor.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const { memberId } = await context.params;
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid action" }, { status: 400 }); }
  const action = input.action;
  if (action !== "archive" && action !== "restore" && action !== "configure") return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${families} WHERE id = ${actor.familyId} FOR UPDATE`);
    const [currentActor] = await tx.select({ role: members.role }).from(memberDevices)
      .innerJoin(members, eq(memberDevices.memberId, members.id))
      .where(and(eq(memberDevices.authUserId, actor.authUser.id), eq(members.familyId, actor.familyId), isNull(memberDevices.revokedAt), isNull(members.archivedAt)))
      .limit(1);
    if (currentActor?.role !== "administrator") return { kind: "forbidden" as const };
    const [target] = await tx.select().from(members)
      .where(and(eq(members.id, memberId), eq(members.familyId, actor.familyId)))
      .for("update")
      .limit(1);
    if (!target) return { kind: "missing" as const };
    const activeAdmins = await tx.select({ id: members.id }).from(members)
      .where(and(eq(members.familyId, actor.familyId), eq(members.role, "administrator"), isNull(members.archivedAt)));

    if (action === "configure") {
      const expectedVersion = input.expectedVersion;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== target.version || target.archivedAt) return { kind: "conflict" as const };
      if (target.id === actor.memberId) return { kind: "self-config" as const };
      const role = input.role === "administrator" ? "administrator" : input.role === "member" ? "member" : null;
      if (!role) return { kind: "invalid" as const };
      const suppliedEmail = typeof input.googleEmail === "string" ? input.googleEmail.trim().toLowerCase() : "";
      if (role === "administrator" && (!validEmail.test(suppliedEmail) || suppliedEmail.length > 254)) return { kind: "invalid-email" as const };
      const email = role === "administrator" ? suppliedEmail : null;
      if (target.role === "administrator" && target.googleEmail?.toLowerCase() !== email) {
        const linkedGoogleIdentities = await tx.select({ authUserId: memberDevices.authUserId }).from(memberDevices)
          .innerJoin(authUser, eq(memberDevices.authUserId, authUser.id))
          .where(and(eq(memberDevices.memberId, target.id), isNull(memberDevices.revokedAt), eq(authUser.isAnonymous, false)));
        if (linkedGoogleIdentities.length > 0) return { kind: "email-change" as const };
      }
      if (target.role !== role) {
        if (target.role === "administrator" && activeAdmins.length <= 1) return { kind: "last-admin" as const };
        const linked = await tx.select({ authUserId: memberDevices.authUserId }).from(memberDevices)
          .innerJoin(authUser, eq(memberDevices.authUserId, authUser.id))
          .where(and(eq(memberDevices.memberId, target.id), isNull(memberDevices.revokedAt), eq(authUser.isAnonymous, role === "administrator")));
        if (linked.length > 0) return { kind: "linked" as const };
      }
      const name = typeof input.name === "string" ? input.name.trim() : target.name;
      if (!name || name.length > 100) return { kind: "invalid-name" as const };
      const now = new Date();
      const [updated] = await tx.update(members).set({
        name,
        role,
        accessMethod: role === "administrator" ? "google" : "code",
        googleEmail: email,
        version: target.version + 1,
        updatedAt: now,
      }).where(and(eq(members.id, target.id), eq(members.version, target.version))).returning();
      if (!updated) return { kind: "conflict" as const };
      if (target.role !== role || target.googleEmail?.toLowerCase() !== email) {
        await tx.update(accessCodes).set({ revokedAt: now })
          .where(and(eq(accessCodes.memberId, target.id), isNull(accessCodes.consumedAt), isNull(accessCodes.revokedAt)));
      }
      await tx.insert(auditEvents).values({
        familyId: actor.familyId,
        actorMemberId: actor.memberId,
        entityType: "member",
        entityId: target.id,
        action: "configured",
        before: { name: target.name, role: target.role, accessMethod: target.accessMethod },
        after: { name: updated.name, role: updated.role, accessMethod: updated.accessMethod },
      });
      await tx.execute(sql`UPDATE families SET revision = revision + 1, menus_revision = menus_revision + 1, updated_at = now() WHERE id = ${actor.familyId}`);
      return { kind: "ok" as const, member: updated };
    }

    if (action === "archive" && target.archivedAt) return { kind: "conflict" as const };
    if (action === "restore" && !target.archivedAt) return { kind: "conflict" as const };
    if (action === "archive" && target.role === "administrator" && activeAdmins.length <= 1) return { kind: "last-admin" as const };

    const now = new Date();
    const [updated] = await tx.update(members)
      .set({ archivedAt: action === "archive" ? now : null, version: target.version + 1, updatedAt: now })
      .where(and(eq(members.id, memberId), eq(members.familyId, actor.familyId), eq(members.version, target.version)))
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
    await tx.execute(sql`UPDATE families SET revision = revision + 1, menus_revision = menus_revision + 1, updated_at = now() WHERE id = ${actor.familyId}`);
    return { kind: "ok" as const, member: updated };
  });

  if (result.kind === "missing") return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (result.kind === "forbidden") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  if (result.kind === "last-admin") return NextResponse.json({ error: "La familia necesita conservar un administrador con acceso." }, { status: 409 });
  if (result.kind === "conflict") return NextResponse.json({ error: "El perfil cambió. Actualizá y volvé a intentar." }, { status: 409 });
  if (result.kind === "self-config") return NextResponse.json({ error: "No podés cambiar tu propio perfil desde esta pantalla." }, { status: 409 });
  if (result.kind === "email-change") return NextResponse.json({ error: "El cambio de cuenta Google requiere otro proceso de recuperación." }, { status: 409 });
  if (result.kind === "linked") return NextResponse.json({ error: "Este perfil ya tiene un acceso vinculado. No se puede cambiar su forma de acceso." }, { status: 409 });
  if (result.kind === "invalid-email") return NextResponse.json({ error: "Ingresá el correo Google exacto y verificado de la persona." }, { status: 400 });
  if (result.kind === "invalid-name" || result.kind === "invalid") return NextResponse.json({ error: "Revisá el nombre y el rol del perfil." }, { status: 400 });
  return NextResponse.json({ id: result.member.id, name: result.member.name, role: result.member.role, accessMethod: result.member.accessMethod, googleEmail: result.member.googleEmail, version: result.member.version, archivedAt: result.member.archivedAt });
}
