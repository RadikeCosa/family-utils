import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, families, mealIdeas, members, recipeIngredients } from "@/db/schema";
import { getMemberContext, type MemberContext } from "@/lib/auth/context";
import { bumpMenusRevision, lockFamilyActor, MealError, type MealTransaction } from "@/lib/meals/server";
import { MEAL_TYPES, isMealType } from "@/lib/meals/rules";
import { cleanText, LIMITS, parseIngredients, UUID } from "./rules";
import { recipesEnabled } from "./config";

export class RecipeError extends MealError {
  constructor(message: string, status = 400, code = "INVALID", public details: Record<string, unknown> = {}) { super(message, status, code); }
}
export function recipeError(error: unknown) {
  if (error instanceof MealError) return NextResponse.json({ error: error.message, code: error.code ?? "INVALID", ...(error instanceof RecipeError ? error.details : {}) }, { status: error.status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  console.error("recipe_request_failed", { code: error && typeof error === "object" && "code" in error ? error.code : "unknown" });
  return NextResponse.json({ error: "No se pudo completar la operación. Tu borrador se conserva.", code: "UNAVAILABLE" }, { status: 500, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
export async function recipeActor(request: Request) {
  if (!recipesEnabled()) throw new RecipeError("Recetas todavía no está disponible.", 404, "NOT_FOUND");
  const actor = await getMemberContext(request.headers);
  if (!actor) throw new RecipeError("Ingresá a tu familia.", 403, "NO_ACCESS");
  return actor;
}
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) throw new RecipeError("Origen no permitido.", 403);
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RecipeError("Revisá los datos enviados.");
  return value;
}
export async function normalizedName(tx: MealTransaction, name: string): Promise<string> {
  const result = await tx.execute<{ normalized: string }>(sql`select normalize_name_v1(${name}) as normalized`);
  return result.rows[0].normalized;
}
export async function ingredientsFor(tx: MealTransaction, id: string) {
  return tx.select({ id: recipeIngredients.id, name: recipeIngredients.name, quantity: recipeIngredients.quantity }).from(recipeIngredients).where(eq(recipeIngredients.ideaId, id)).orderBy(asc(recipeIngredients.position));
}
async function collision(tx: MealTransaction, actor: MemberContext, title: string, except?: string) {
  const key = await normalizedName(tx, title);
  const matches = await tx.select().from(mealIdeas).where(and(eq(mealIdeas.familyId, actor.familyId), eq(mealIdeas.normalizedTitle, key), isNull(mealIdeas.mergedIntoId)));
  const existing = matches.find(row => row.id !== except);
  if (existing) throw new RecipeError(existing.archivedAt ? "Ya existe un plato oculto con ese nombre. Abrilo para restaurarlo." : "Ya existe un plato con ese nombre. Podés abrir su receta.", 409, existing.archivedAt ? "DUPLICATE_HIDDEN" : "DUPLICATE_NAME", { existing: { id: existing.id, title: existing.title, archivedAt: existing.archivedAt, canManage: actor.role === "administrator" || existing.authorMemberId === actor.memberId } });
  return key;
}
function content(body: Record<string, unknown>, previous?: typeof mealIdeas.$inferSelect) {
  const text = (key: "title" | "note" | "yieldText" | "preparation") => key in body ? cleanText(body[key], LIMITS[key], key === "title") : previous?.[key] ?? null;
  const title = text("title"); if (!title) throw new Error("Escribí el nombre del plato.");
  const tags = body.mealTypes ?? previous?.mealTypes ?? [];
  if (!Array.isArray(tags) || tags.length > 4 || !tags.every(isMealType)) throw new Error("Revisá las etiquetas.");
  const packedSuitable = body.packedSuitable ?? previous?.packedSuitable ?? false;
  if (typeof packedSuitable !== "boolean") throw new Error("Revisá las etiquetas.");
  return { title, note: text("note"), yieldText: text("yieldText"), preparation: text("preparation"), mealTypes: MEAL_TYPES.filter(t => tags.includes(t)), packedSuitable };
}
export async function saveRecipe(tx: MealTransaction, actor: MemberContext, body: Record<string, unknown>, id?: string) {
  const current = await lockFamilyActor(tx, actor);
  if (!current) throw new RecipeError("Tu acceso ya no está disponible.", 403, "NO_ACCESS");
  const [before] = id ? await tx.select().from(mealIdeas).where(and(eq(mealIdeas.id, id), eq(mealIdeas.familyId, actor.familyId))).for("update") : [];
  if (id && (!before || before.mergedIntoId)) throw new RecipeError("No se encontró el plato vigente.", 404, "NOT_FOUND");
  const action = body.action ?? "edit";
  if (!["edit", "archive", "restore"].includes(String(action)) || (!id && action !== "edit")) throw new RecipeError("Acción inválida.");
  const canManage = current.role === "administrator" || before?.authorMemberId === current.memberId;
  if (before && ((action !== "edit" || !recipesEnabled()) && !canManage)) throw new RecipeError("Solo el autor o un administrador puede administrar este plato.", 403, "NO_PERMISSION");
  if (before && before.version !== body.expectedVersion) throw new RecipeError("La receta cambió. Copiá tu borrador y consultá la versión actual antes de volver a guardar.", 409, "RECIPE_CONFLICT");
  let fields: ReturnType<typeof content>, ingredients;
  const previousIngredients = before ? await ingredientsFor(tx, before.id) : [];
  try {
    fields = action === "edit" ? content(body, before) : content({}, before);
    ingredients = action === "edit" && "ingredients" in body ? parseIngredients(body.ingredients) : previousIngredients;
  } catch (error) { throw new RecipeError(error instanceof Error ? error.message : "Revisá la receta."); }
  const normalizedTitle = await collision(tx, actor, fields.title, id);
  if (ingredients.length) {
    const used = await tx.select({ id: recipeIngredients.id, ideaId: recipeIngredients.ideaId }).from(recipeIngredients).where(inArray(recipeIngredients.id, ingredients.map(i => i.id)));
    if (used.some(i => i.ideaId !== id)) throw new RecipeError("Un identificador de ingrediente pertenece a otra receta.");
  }
  const archivedAt = action === "archive" ? before?.archivedAt ?? new Date() : action === "restore" ? null : before?.archivedAt ?? null;
  const comparable = { ...fields, archivedAt: archivedAt?.toISOString() ?? null, ingredients };
  const previousContent = before ? { ...content({}, before), archivedAt: before.archivedAt?.toISOString() ?? null, ingredients: previousIngredients } : null;
  if (before && JSON.stringify(comparable) === JSON.stringify(previousContent)) return { idea: before, changed: false };
  const now = new Date();
  const [idea] = before
    ? await tx.update(mealIdeas).set({ ...fields, normalizedTitle, archivedAt, version: before.version + 1, updatedAt: now, updatedByMemberId: current.memberId }).where(eq(mealIdeas.id, before.id)).returning()
    : await tx.insert(mealIdeas).values({ ...fields, normalizedTitle, familyId: actor.familyId, authorMemberId: current.memberId, updatedByMemberId: current.memberId }).returning();
  if ("ingredients" in body) {
    await tx.delete(recipeIngredients).where(eq(recipeIngredients.ideaId, idea.id));
    if (ingredients.length) await tx.insert(recipeIngredients).values(ingredients.map((i, position) => ({ ...i, familyId: actor.familyId, ideaId: idea.id, position })));
  }
  await tx.insert(auditEvents).values({ familyId: actor.familyId, actorMemberId: current.memberId, entityType: "meal_idea", entityId: idea.id, action: before ? String(action === "edit" ? "updated" : action === "archive" ? "archived" : "restored") : "created", before: before ? { ...before, ingredients: previousIngredients } : null, after: { ...idea, ingredients } });
  await bumpMenusRevision(tx, actor.familyId);
  return { idea, changed: true };
}
export async function writeRecipe(request: Request, id?: string, legacy = false) {
  try {
    const actor = legacy ? await getMemberContext(request.headers) : await recipeActor(request);
    if (!actor) throw new RecipeError("Ingresá a tu familia.", 403, "NO_ACCESS");
    if (id && !UUID.test(id)) throw new RecipeError("No se encontró el plato.", 404, "NOT_FOUND");
    const body = await jsonBody(request);
    if (id && (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1)) throw new RecipeError("Revisá la versión del plato.");
    if (!recipesEnabled() && ("ingredients" in body || "yieldText" in body || "preparation" in body)) throw new RecipeError("Recetas todavía no está habilitada.", 404);
    const result = await getDb().transaction(tx => saveRecipe(tx, actor, body, id));
    return NextResponse.json(result, { status: id ? 200 : 201 });
  } catch (error) { return recipeError(error); }
}
export async function readRecipe(request: Request, id: string) {
  try {
    const actor = await recipeActor(request);
    if (!UUID.test(id)) throw new RecipeError("No se encontró la receta.", 404, "NOT_FOUND");
    return await getDb().transaction(async tx => {
      const current = await lockFamilyActor(tx, actor);
      if (!current) throw new RecipeError("Tu acceso ya no está disponible.", 403, "NO_ACCESS");
      const [idea] = await tx.select().from(mealIdeas).where(and(eq(mealIdeas.id, id), eq(mealIdeas.familyId, actor.familyId), isNull(mealIdeas.mergedIntoId)));
      if (!idea) throw new RecipeError("No se encontró la receta.", 404, "NOT_FOUND");
      const [family] = await tx.select({ revision: families.revision }).from(families).where(eq(families.id, actor.familyId));
      const headers = { ETag: `"recipe-${actor.familyId}-${current.memberId}-${family.revision}-${idea.version}"`, "Cache-Control": "private, no-cache", Vary: "Cookie" };
      if (request.headers.get("if-none-match") === headers.ETag) return new NextResponse(null, { status: 304, headers });
      const [editor] = idea.updatedByMemberId ? await tx.select({ name: members.name }).from(members).where(eq(members.id, idea.updatedByMemberId)) : [];
      return NextResponse.json({ recipe: { ...idea, ingredients: await ingredientsFor(tx, id), updatedByName: editor?.name ?? null, canManage: current.role === "administrator" || idea.authorMemberId === current.memberId } }, { headers });
    });
  } catch (error) { return recipeError(error); }
}
