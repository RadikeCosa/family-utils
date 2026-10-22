import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, mealDailyPlans, mealIdeas, mealSuggestions } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { addDays, getDayInTimeZone, hasMealAttendance, isMealType, isMenuDateInRange, isParticipationStatus, isUuid, isValidDate, menuDateBounds, normalizeMealIdea, startOfWeek } from "@/lib/meals/rules";
import { addSecondMenu, canChangePerson, changePerson, duplicateMenu, needsMeal, removeSecondMenu, type DailySelection, type MenuNumber } from "@/lib/meals/daily";
import { loadPlanner } from "@/lib/meals/planner-server";
import { bumpMenusRevision, lockFamilyActor, lockMealSlot, MealError } from "@/lib/meals/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  const today = getDayInTimeZone(new Date(), actor.familyTimeZone);
  const date = new URL(request.url).searchParams.get("weekStart") ?? today;
  if (!isValidDate(date)) return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
  const weekStart = startOfWeek(date), bounds = menuDateBounds(today);
  if (weekStart > bounds.latest || addDays(weekStart, 6) < bounds.earliest) return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
  // Consistent legacy projection and version, including concurrent proposal creation.
  const result = await getDb().transaction(tx => loadPlanner(tx, actor.familyId, weekStart, addDays(weekStart, 6)), { isolationLevel: "repeatable read", accessMode: "read only" });
  return NextResponse.json({ ...result, weekStart, today, timeZone: actor.familyTimeZone, currentMemberId: actor.memberId, currentRole: actor.role }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function PUT(request: Request) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || !isValidDate(body.date) || !isMealType(body.mealType)) throw new MealError("Revisá la fecha y la comida.");
    const date = body.date, mealType = body.mealType;
    const result = await getDb().transaction(async tx => {
      const current = await lockFamilyActor(tx, actor);
      if (!current) throw new MealError("No tenés acceso a esta familia.", 403);
      const today = getDayInTimeZone(new Date(), actor.familyTimeZone);
      if (date < today) throw new MealError("Este día ya no se puede editar.", 403, "MEAL_DAY_CLOSED");
      if (!isMenuDateInRange(date, today)) throw new MealError("Fecha fuera del período permitido.");
      const { meals, members } = await loadPlanner(tx, actor.familyId, date, date);
      const meal = meals.find(m => m.mealType === mealType)!;
      if (meal.readOnly) throw new MealError("Este plan anterior se conserva en modo de consulta.", 409, "LEGACY_READ_ONLY");
      if (body.expectedVersion !== meal.version) throw new MealError("Alguien cambió esta comida. Revisá la elección actual antes de volver a confirmar.", 409, "MEAL_CONFLICT");
      const slot = await lockMealSlot(tx, actor.familyId, date, mealType);
      if (!slot) throw new Error("Missing meal slot");
      let plan = structuredClone(meal.plan);
      if (body.action === "person") {
        if (!hasMealAttendance(mealType) || !isUuid(body.memberId) || !isParticipationStatus(body.status) || !members.some(m => m.id === body.memberId)) throw new MealError("Revisá la persona y su elección.");
        if (!canChangePerson(current.role, current.memberId, body.memberId)) throw new MealError("Solo podés cambiar tu propia elección.", 403);
        if (body.menu !== undefined && body.menu !== 1 && body.menu !== 2) throw new MealError("Menú inválido.");
        if (body.menu && (!needsMeal(body.status) || !plan.menus.some(m => m.number === body.menu))) throw new MealError("Ese menú no está disponible.");
        plan = changePerson(plan, body.memberId, body.status, body.menu as MenuNumber | undefined);
      } else if (body.action === "propose" || body.action === "confirm") {
        let suggestion = isUuid(body.suggestionId) ? (await tx.select().from(mealSuggestions).where(and(eq(mealSuggestions.id, body.suggestionId), eq(mealSuggestions.slotId, slot.id), isNull(mealSuggestions.withdrawnAt))).limit(1))[0] : undefined;
        if (body.suggestionId !== undefined && !suggestion) throw new MealError("La idea ya no está disponible.");
        if (!suggestion) {
          let title = typeof body.title === "string" ? body.title.trim() : "";
          let note = typeof body.note === "string" ? body.note.trim() : "";
          let catalogIdeaId: string | null = null;
          if (body.catalogIdeaId !== undefined) {
            if (!isUuid(body.catalogIdeaId)) throw new MealError("Idea guardada inválida.");
            const [idea] = await tx.select().from(mealIdeas).where(and(eq(mealIdeas.id, body.catalogIdeaId), eq(mealIdeas.familyId, actor.familyId), isNull(mealIdeas.mergedIntoId))).limit(1);
            if (!idea || (idea.archivedAt && body.action !== "confirm")) throw new MealError("El plato ya no está disponible.");
            title = idea.title; note = idea.note ?? ""; catalogIdeaId = idea.id;
          }
          const selectedFromCatalog = !!catalogIdeaId;
          if (!title || title.length > 160 || note.length > 1000) throw new MealError("Escribí un plato de hasta 160 caracteres y una nota de hasta 1.000.");
          {
            const normalizedTitle = normalizeMealIdea(title).replace(/\s+/g, " ");
            let [catalog] = catalogIdeaId
              ? await tx.select().from(mealIdeas).where(and(eq(mealIdeas.id, catalogIdeaId), eq(mealIdeas.familyId, actor.familyId))).limit(1)
              : await tx.select().from(mealIdeas).where(and(eq(mealIdeas.familyId, actor.familyId), eq(mealIdeas.normalizedTitle, normalizedTitle))).limit(1);
            if (catalog?.mergedIntoId) {
              [catalog] = await tx.select().from(mealIdeas).where(and(eq(mealIdeas.id, catalog.mergedIntoId), eq(mealIdeas.familyId, actor.familyId))).limit(1);
            }
            if (catalog) {
              if (catalog.archivedAt) {
                const [restored] = await tx.update(mealIdeas).set({ archivedAt: null, version: catalog.version + 1, updatedAt: new Date() }).where(eq(mealIdeas.id, catalog.id)).returning();
                await tx.insert(auditEvents).values({ familyId: actor.familyId, actorMemberId: current.memberId, entityType: "meal_idea", entityId: catalog.id, action: "restored", before: catalog, after: restored });
              }
              title = catalog.title; note = selectedFromCatalog ? (catalog.note ?? "") : (note || catalog.note || ""); catalogIdeaId = catalog.id;
            } else {
              const [created] = await tx.insert(mealIdeas).values({ familyId: actor.familyId, authorMemberId: current.memberId, title, note: note || null, normalizedTitle }).returning();
              await tx.insert(auditEvents).values({ familyId: actor.familyId, actorMemberId: current.memberId, entityType: "meal_idea", entityId: created.id, action: "created_from_meal", after: created });
              catalogIdeaId = created.id;
            }
          }
          [suggestion] = await tx.insert(mealSuggestions).values({ slotId: slot.id, authorMemberId: current.memberId, title, note: note || null, catalogIdeaId }).returning();
        }
        if (body.action === "confirm") {
          if (body.menu !== 1 && body.menu !== 2) throw new MealError("Elegí qué menú querés confirmar.");
          const menu = plan.menus.find(m => m.number === body.menu);
          if (!menu) throw new MealError("Ese menú no está abierto.");
          if (menu.selection && current.role !== "administrator") throw new MealError("Solo una persona adulta puede cambiar una comida elegida.", 403);
          if (menu.selection && body.replace !== true) throw new MealError("Confirmá el reemplazo del plato actual.", 409, "REPLACE_REQUIRED");
          const selection: DailySelection = { suggestionId: suggestion.id, title: suggestion.title, note: suggestion.note, confirmedByMemberId: current.memberId, confirmedAt: new Date().toISOString() };
          if (duplicateMenu(plan, menu.number, selection)) throw new MealError("Ese plato ya está en el otro menú. Compartilo asignando allí las personas.", 409, "DUPLICATE_MENU");
          menu.selection = selection;
          if (suggestion.catalogIdeaId) await tx.update(mealIdeas).set({ lastUsedAt: new Date(), updatedAt: new Date() }).where(eq(mealIdeas.id, suggestion.catalogIdeaId));
        }
      } else {
        if (current.role !== "administrator") throw new MealError("Solo una persona adulta puede cambiar los menús.", 403);
        if (body.action === "add-second" && hasMealAttendance(mealType)) plan = addSecondMenu(plan);
        else if (body.action === "remove-second") {
          if (body.confirm !== true) throw new MealError("Confirmá que las personas vuelven al menú 1.");
          plan = removeSecondMenu(plan);
        } else if (body.action === "clear" && (body.menu === 1 || body.menu === 2)) {
          const menu = plan.menus.find(m => m.number === body.menu);
          if (!menu) throw new MealError("Ese menú no existe.");
          menu.selection = null;
        } else throw new MealError("Acción inválida.");
      }
      const [before] = await tx.select().from(mealDailyPlans).where(eq(mealDailyPlans.slotId, slot.id));
      const version = (before?.version ?? 0) + 1;
      // No choice is absence, not a fourth stored response. Keep archived people's data.
      const archived = (before?.plan.people.filter(p => !members.some(m => m.id === p.memberId)) ?? []).map(p => p.menu === 2 && plan.menus.length === 1 ? { ...p, menu: 1 as const } : p);
      const storedPlan = { ...plan, people: [...archived, ...plan.people.filter(p => p.status !== "unknown")] };
      const [after] = await tx.insert(mealDailyPlans).values({ slotId: slot.id, plan: storedPlan, original: meal.previous ?? {}, version, updatedByMemberId: current.memberId }).onConflictDoUpdate({ target: mealDailyPlans.slotId, set: { plan: storedPlan, version, updatedByMemberId: current.memberId, updatedAt: new Date() } }).returning();
      await tx.insert(auditEvents).values({ familyId: actor.familyId, actorMemberId: current.memberId, entityType: "meal_daily_plan", entityId: slot.id, action: String(body.action), before: before?.plan ?? meal.plan, after: after.plan });
      await bumpMenusRevision(tx, actor.familyId);
      return { plan, version: `daily:${version}` };
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MealError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
