import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, mealAttendance, mealSelections, mealSuggestions, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { canConfirmMeal, getDayInTimeZone, hasUnknownAttendance, isMealType, isUuid, isValidDate } from "@/lib/meals/rules";
import { bumpMenusRevision, lockFamilyActor, lockMealSlot } from "@/lib/meals/server";

export const runtime = "nodejs";

class SelectionConflict extends Error {}

export async function PUT(request: Request) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid selection" }, { status: 400 }); }
  const date = body.date;
  const mealType = body.mealType;
  const suggestionId = typeof body.suggestionId === "string" ? body.suggestionId : null;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const expectedVersion = body.expectedVersion;
  if (!isValidDate(date) || !isMealType(mealType) || !Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0 || (suggestionId && !isUuid(suggestionId)) || (suggestionId && title) || title.length > 160 || note.length > 1000) {
    return NextResponse.json({ error: "Revisá la comida, la sugerencia y su versión." }, { status: 400 });
  }
  if (!suggestionId && body.suggestionId !== null && body.suggestionId !== undefined) return NextResponse.json({ error: "Sugerencia inválida." }, { status: 400 });

  try {
    const result = await getDb().transaction(async (tx) => {
    const currentActor = await lockFamilyActor(tx, actor);
    if (!currentActor) return { kind: "forbidden" as const };
    if (currentActor.role !== "administrator") return { kind: "forbidden" as const };
    if (date < getDayInTimeZone(new Date(), actor.familyTimeZone)) return { kind: "past" as const };
    const activeMembers = await tx.select({ id: members.id }).from(members)
      .where(and(eq(members.familyId, actor.familyId), isNull(members.archivedAt)));
    const slot = await lockMealSlot(tx, actor.familyId, date, mealType);
    if (!slot) return { kind: "missing-slot" as const };
    const [current] = await tx.select().from(mealSelections).where(eq(mealSelections.slotId, slot.id)).for("update").limit(1);
    if ((current?.version ?? 0) !== expectedVersion) return { kind: "conflict" as const };

    const clearing = !suggestionId && !title;
    if (clearing) {
      if (!current || !current.suggestionId) return { kind: "cleared" as const, version: current?.version ?? 0 };
      const now = new Date();
      const [updated] = await tx.update(mealSelections).set({ suggestionId: null, confirmedByMemberId: currentActor.memberId, confirmedAt: now, version: current.version + 1, updatedAt: now })
        .where(and(eq(mealSelections.slotId, slot.id), eq(mealSelections.version, current.version))).returning();
      if (!updated) return { kind: "conflict" as const };
      await tx.insert(auditEvents).values({ familyId: actor.familyId, actorMemberId: currentActor.memberId, entityType: "meal_selection", entityId: slot.id, action: "cleared", before: current, after: updated });
      await bumpMenusRevision(tx, actor.familyId);
      return { kind: "cleared" as const, version: updated.version };
    }

    const targetSuggestion = suggestionId
      ? (await tx.select({ id: mealSuggestions.id }).from(mealSuggestions)
        .where(and(eq(mealSuggestions.id, suggestionId), eq(mealSuggestions.slotId, slot.id), isNull(mealSuggestions.withdrawnAt))).for("update").limit(1))[0]
      : null;
    if (suggestionId && !targetSuggestion) return { kind: "invalid-suggestion" as const };
    if (!suggestionId && !title) return { kind: "invalid-title" as const };
    const attendance = activeMembers.length
      ? await tx.select({ memberId: mealAttendance.memberId, status: mealAttendance.status }).from(mealAttendance)
        .where(and(eq(mealAttendance.slotId, slot.id), inArray(mealAttendance.memberId, activeMembers.map((profile) => profile.id))))
      : [];
    const eligibility = canConfirmMeal(activeMembers.map((profile) => profile.id));
    if (eligibility !== "ok") return { kind: eligibility };
    const pending = hasUnknownAttendance(activeMembers.map((profile) => profile.id), attendance.flatMap((record) => record.status ? [{ memberId: record.memberId, status: record.status }] : []));

    let targetSuggestionId = suggestionId;
    let createdSuggestion: typeof mealSuggestions.$inferSelect | null = null;
    if (!suggestionId) {
      const [created] = await tx.insert(mealSuggestions).values({ slotId: slot.id, authorMemberId: currentActor.memberId, title, note: note || null }).returning();
      createdSuggestion = created;
      targetSuggestionId = created.id;
      await tx.insert(auditEvents).values({ familyId: actor.familyId, actorMemberId: currentActor.memberId, entityType: "meal_suggestion", entityId: created.id, action: "created_and_confirmed", after: created });
    }
    const now = new Date();
    const saved = current
      ? await tx.update(mealSelections).set({ suggestionId: targetSuggestionId, confirmedByMemberId: currentActor.memberId, confirmedAt: now, version: current.version + 1, updatedAt: now })
        .where(and(eq(mealSelections.slotId, slot.id), eq(mealSelections.version, current.version))).returning()
      : await tx.insert(mealSelections).values({ slotId: slot.id, suggestionId: targetSuggestionId, confirmedByMemberId: currentActor.memberId }).returning();
    const selection = saved[0];
    if (!selection) throw new SelectionConflict();
    await tx.insert(auditEvents).values({ familyId: actor.familyId, actorMemberId: currentActor.memberId, entityType: "meal_selection", entityId: slot.id, action: current?.suggestionId ? "changed" : "confirmed", before: current ?? null, after: selection });
    await bumpMenusRevision(tx, actor.familyId);
    return { kind: "ok" as const, selection, pending, createdSuggestion };
    });

    if (result.kind === "forbidden") return NextResponse.json({ error: "Solo una persona adulta puede confirmar el menú." }, { status: 403 });
    if (result.kind === "past") return NextResponse.json({ code: "MEAL_DAY_CLOSED", error: "Este día ya no se puede editar." }, { status: 403 });
    if (result.kind === "no-active-members") return NextResponse.json({ error: "No hay integrantes activos para esta comida." }, { status: 409 });
    if (result.kind === "invalid-suggestion") return NextResponse.json({ error: "La sugerencia ya no está disponible para esta comida." }, { status: 400 });
    if (result.kind === "invalid-title") return NextResponse.json({ error: "Escribí una comida o elegí una sugerencia." }, { status: 400 });
    if (result.kind === "conflict") return NextResponse.json({ code: "MEAL_SELECTION_CONFLICT", error: "La comida cambió mientras guardabas. Revisá la elección actual." }, { status: 409 });
    if (result.kind === "cleared") return NextResponse.json({ selection: null, version: result.version });
    return NextResponse.json({ selection: result.selection, pendingAttendance: result.pending, suggestion: result.createdSuggestion });
  } catch (error) {
    if (error instanceof SelectionConflict) return NextResponse.json({ code: "MEAL_SELECTION_CONFLICT", error: "La comida cambió mientras guardabas. Revisá la elección actual." }, { status: 409 });
    throw error;
  }
}
