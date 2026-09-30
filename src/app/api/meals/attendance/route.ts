import { and, eq, isNull, sql } from "drizzle-orm";
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
  if (!isValidDate(date) || !isMealType(mealType) || !isUuid(memberId) || !["present", "absent", "unknown"].includes(String(requestedStatus))) {
    return NextResponse.json({ error: "Revisá la fecha, comida y asistencia." }, { status: 400 });
  }
  const status = requestedStatus as "present" | "absent" | "unknown";

  const result = await getDb().transaction(async (tx) => {
    const currentActor = await lockFamilyActor(tx, actor);
    if (!currentActor) return { kind: "forbidden" as const };
    if (date < getDayInTimeZone(new Date(), actor.familyTimeZone)) return { kind: "past" as const };
    const [target] = await tx.select({ id: members.id }).from(members)
      .where(and(eq(members.id, memberId), eq(members.familyId, actor.familyId), isNull(members.archivedAt)))
      .limit(1);
    if (!target) return { kind: "invalid-member" as const };
    const slot = await lockMealSlot(tx, actor.familyId, date, mealType);
    if (!slot) return { kind: "missing-slot" as const };
    const nextStatus = status === "unknown" ? null : status;
    const [current] = await tx.select().from(mealAttendance)
      .where(and(eq(mealAttendance.slotId, slot.id), eq(mealAttendance.memberId, memberId))).for("update").limit(1);
    const saved = await tx.insert(mealAttendance).values({
      slotId: slot.id,
      memberId,
      status: nextStatus,
      updatedByMemberId: currentActor.memberId,
    }).onConflictDoUpdate({
      target: [mealAttendance.slotId, mealAttendance.memberId],
      set: {
        status: nextStatus,
        updatedByMemberId: currentActor.memberId,
        version: sql`${mealAttendance.version} + 1`,
        updatedAt: new Date(),
      },
    }).returning();
    const updated = saved[0];
    if (!updated) throw new Error("Attendance upsert returned no row");
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
    return { kind: "ok" as const, status: updated.status, version: updated.version, updatedAt: updated.updatedAt, updatedByMemberId: updated.updatedByMemberId };
  });

  if (result.kind === "forbidden") return NextResponse.json({ error: "No tenés permiso para cambiar esa asistencia." }, { status: 403 });
  if (result.kind === "past") return NextResponse.json({ code: "MEAL_DAY_CLOSED", error: "Este día ya no se puede editar." }, { status: 403 });
  if (result.kind === "invalid-member") return NextResponse.json({ error: "El perfil no está activo en esta familia." }, { status: 400 });
  return NextResponse.json({ status: result.status ?? "unknown", version: result.version, updatedAt: result.updatedAt, updatedByMemberId: result.updatedByMemberId });
}
