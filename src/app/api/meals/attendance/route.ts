import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, mealAttendance, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { getDayInTimeZone, isMealType, isUuid, isValidDate } from "@/lib/meals/rules";
import { bumpMenusRevision, lockFamilyActor, lockMealSlot } from "@/lib/meals/server";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid attendance" }, { status: 400 }); }

  const date = body.date;
  const mealType = body.mealType;
  const memberId = typeof body.memberId === "string" ? body.memberId : actor.memberId;
  const requestedStatus = body.status;
  const expectedVersion = body.expectedVersion;
  if (!isValidDate(date) || !isMealType(mealType) || !isUuid(memberId) || !["present", "absent", "unknown"].includes(String(requestedStatus)) || !Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0) {
    return NextResponse.json({ error: "Revisá la fecha, comida y asistencia." }, { status: 400 });
  }
  const status = requestedStatus as "present" | "absent" | "unknown";

  const result = await getDb().transaction(async (tx) => {
    const currentActor = await lockFamilyActor(tx, actor);
    if (!currentActor) return { kind: "forbidden" as const };
    if (memberId !== currentActor.memberId && currentActor.role !== "administrator") return { kind: "forbidden" as const };
    if (date < getDayInTimeZone(new Date(), actor.familyTimeZone)) return { kind: "past" as const };
    const [target] = await tx.select({ id: members.id }).from(members)
      .where(and(eq(members.id, memberId), eq(members.familyId, actor.familyId), isNull(members.archivedAt)))
      .limit(1);
    if (!target) return { kind: "invalid-member" as const };
    const slot = await lockMealSlot(tx, actor.familyId, date, mealType);
    if (!slot) return { kind: "missing-slot" as const };
    const [current] = await tx.select().from(mealAttendance)
      .where(and(eq(mealAttendance.slotId, slot.id), eq(mealAttendance.memberId, memberId))).limit(1);
    const version = current?.version ?? 0;
    if (version !== expectedVersion) return { kind: "conflict" as const };
    if (!current && status === "unknown") return { kind: "ok" as const, version: 0 };

    const nextStatus = status === "unknown" ? null : status;
    const saved = current
      ? await tx.update(mealAttendance).set({ status: nextStatus, updatedByMemberId: currentActor.memberId, version: current.version + 1, updatedAt: new Date() })
        .where(and(eq(mealAttendance.slotId, slot.id), eq(mealAttendance.memberId, memberId), eq(mealAttendance.version, current.version))).returning()
      : await tx.insert(mealAttendance).values({ slotId: slot.id, memberId, status: nextStatus, updatedByMemberId: currentActor.memberId }).returning();
    const updated = saved[0];
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(auditEvents).values({
      familyId: actor.familyId,
      actorMemberId: currentActor.memberId,
      entityType: "meal_attendance",
      entityId: slot.id,
      action: "updated",
      before: current ?? null,
      after: { ...updated, memberId },
    });
    await bumpMenusRevision(tx, actor.familyId);
    return { kind: "ok" as const, version: updated.version };
  });

  if (result.kind === "forbidden") return NextResponse.json({ error: "No tenés permiso para cambiar esa asistencia." }, { status: 403 });
  if (result.kind === "past") return NextResponse.json({ error: "Los días anteriores son de solo lectura." }, { status: 409 });
  if (result.kind === "invalid-member") return NextResponse.json({ error: "El perfil no está activo en esta familia." }, { status: 400 });
  if (result.kind === "conflict") return NextResponse.json({ error: "La asistencia cambió. Actualizá la semana y volvé a intentar." }, { status: 409 });
  return NextResponse.json({ version: result.version });
}
