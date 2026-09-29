import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, mealSelections, mealSlots, mealSuggestions } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { getDayInTimeZone, isUuid, mayManageSuggestion, mayEditMeal } from "@/lib/meals/rules";
import { bumpMenusRevision, lockFamilyActor, lockMealSlot } from "@/lib/meals/server";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ suggestionId: string }> };

async function mutate(request: Request, context: RouteContext, withdraw: boolean) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  const { suggestionId } = await context.params;
  if (!isUuid(suggestionId)) return NextResponse.json({ error: "No se encontró la sugerencia." }, { status: 404 });
  let body: Record<string, unknown> = {};
  if (!withdraw) {
    try { body = await request.json() as Record<string, unknown>; }
    catch { return NextResponse.json({ error: "Invalid suggestion" }, { status: 400 }); }
  }
  const expectedVersion = body.expectedVersion;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1 || (!withdraw && (!title || title.length > 160 || note.length > 1000))) {
    return NextResponse.json({ error: "Revisá la sugerencia y su versión." }, { status: 400 });
  }

  const result = await getDb().transaction(async (tx) => {
    const currentActor = await lockFamilyActor(tx, actor);
    if (!currentActor) return { kind: "forbidden" as const };
    const [candidate] = await tx.select({
      id: mealSuggestions.id,
      authorMemberId: mealSuggestions.authorMemberId,
      slotId: mealSlots.id,
      date: mealSlots.mealDate,
      mealType: mealSlots.mealType,
    }).from(mealSuggestions).innerJoin(mealSlots, eq(mealSuggestions.slotId, mealSlots.id))
      .where(and(eq(mealSuggestions.id, suggestionId), eq(mealSlots.familyId, actor.familyId))).limit(1);
    if (!candidate) return { kind: "missing" as const };
    if (!mayEditMeal(candidate.date, getDayInTimeZone(new Date(), actor.familyTimeZone))) return { kind: "past" as const };
    const slot = await lockMealSlot(tx, actor.familyId, candidate.date, candidate.mealType);
    if (!slot) return { kind: "missing" as const };
    const [current] = await tx.select().from(mealSuggestions)
      .where(and(eq(mealSuggestions.id, suggestionId), eq(mealSuggestions.slotId, slot.id))).for("update").limit(1);
    if (!current || current.withdrawnAt) return { kind: "missing" as const };
    if (!mayManageSuggestion(currentActor.role, currentActor.memberId, current.authorMemberId)) return { kind: "forbidden" as const };
    if (current.version !== expectedVersion) return { kind: "conflict" as const };
    const [selected] = await tx.select({ slotId: mealSelections.slotId }).from(mealSelections)
      .where(and(eq(mealSelections.slotId, slot.id), eq(mealSelections.suggestionId, current.id))).limit(1);
    if (selected) return { kind: "selected" as const };
    const now = new Date();
    const [updated] = await tx.update(mealSuggestions).set(withdraw
      ? { withdrawnAt: now, version: current.version + 1, updatedAt: now }
      : { title, note: note || null, version: current.version + 1, updatedAt: now })
      .where(and(eq(mealSuggestions.id, current.id), eq(mealSuggestions.version, current.version), isNull(mealSuggestions.withdrawnAt)))
      .returning();
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(auditEvents).values({
      familyId: actor.familyId,
      actorMemberId: currentActor.memberId,
      entityType: "meal_suggestion",
      entityId: current.id,
      action: withdraw ? "withdrawn" : "updated",
      before: current,
      after: updated,
    });
    await bumpMenusRevision(tx, actor.familyId);
    return { kind: "ok" as const, suggestion: updated };
  });

  if (result.kind === "missing") return NextResponse.json({ error: "No se encontró la sugerencia." }, { status: 404 });
  if (result.kind === "forbidden") return NextResponse.json({ error: "No tenés permiso para modificar esa sugerencia." }, { status: 403 });
  if (result.kind === "past") return NextResponse.json({ error: "Los días anteriores son de solo lectura." }, { status: 409 });
  if (result.kind === "selected") return NextResponse.json({ error: "Primero cambiá o quitá el menú confirmado." }, { status: 409 });
  if (result.kind === "conflict") return NextResponse.json({ error: "La sugerencia cambió. Actualizá la semana y volvé a intentar." }, { status: 409 });
  return withdraw ? new Response(null, { status: 204 }) : NextResponse.json(result.suggestion);
}

export async function PATCH(request: Request, context: RouteContext) { return mutate(request, context, false); }
export async function DELETE(request: Request, context: RouteContext) { return mutate(request, context, true); }
