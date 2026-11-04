import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, families, mealIdeas, recipeIngredients, recipeShoppingOperations, shoppingEditors, shoppingItems, shoppingLists } from "@/db/schema";
import { type MemberContext } from "@/lib/auth/context";
import { lockFamilyActor, type MealTransaction } from "@/lib/meals/server";
import { shoppingPermissions } from "@/lib/shopping/rules";
import { RecipeError, jsonBody, recipeActor, recipeError } from "./server";
import { canonical, fingerprint, issueOperation, verifyOperation } from "./operation";
import { parseTransfer } from "./transfer-rules";
import type { ObservedItem, TransferCommand, TransferRow } from "./types";
function secret() { const value = process.env.BETTER_AUTH_SECRET; if (!value) throw new Error("Operation signing configuration missing"); return value; }
async function destinationList(tx: MealTransaction, actor: MemberContext, destination: TransferCommand["destination"]) {
  if (!("listId" in destination)) return null;
  const [list] = await tx.select().from(shoppingLists).where(and(eq(shoppingLists.id, destination.listId), eq(shoppingLists.familyId, actor.familyId))).for("update");
  if (!list) throw new RecipeError("La lista ya no está disponible. Elegí otra.", 404, "DESTINATION_UNAVAILABLE");
  const editors = await tx.select().from(shoppingEditors).where(eq(shoppingEditors.listId, list.id));
  if (!shoppingPermissions(list.ownerMemberId, actor.memberId, editors.map(e => e.memberId), !!list.archivedAt).canEdit) throw new RecipeError("Ya no podés editar esta lista. Elegí otra.", 403, "LIST_NOT_EDITABLE");
  return list;
}
async function matches(tx: MealTransaction, listId: string | null, rows: TransferRow[]) {
  if (!listId) return rows.map(r => ({ ingredientId: r.ingredientId, observed: [] as ObservedItem[] }));
  const result = await tx.execute<{ ingredientId: string; observed: ObservedItem[] }>(sql`
    SELECT q."ingredientId", coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'version', i.version, 'name', i.name, 'brand', i.brand,
      'quantity', i.quantity, 'purchased', i.purchased) ORDER BY i.id)
      FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb) AS observed
    FROM jsonb_to_recordset(${JSON.stringify(rows.map(r => ({ ingredientId: r.ingredientId, name: r.name })))}::jsonb) q("ingredientId" text, name text)
    LEFT JOIN shopping_items i ON i.list_id = ${listId}::uuid AND normalize_name_v1(i.name) = normalize_name_v1(q.name)
    GROUP BY q."ingredientId"`);
  return result.rows;
}
async function validIngredients(tx: MealTransaction, actor: MemberContext, command: TransferCommand) {
  const [recipe] = await tx.select({ id: mealIdeas.id }).from(mealIdeas).where(and(eq(mealIdeas.id, command.recipeId), eq(mealIdeas.familyId, actor.familyId), isNull(mealIdeas.mergedIntoId)));
  if (!recipe) throw new RecipeError("No se encontró la receta.", 404, "NOT_FOUND");
  const ingredients = await tx.select({ id: recipeIngredients.id }).from(recipeIngredients).where(and(eq(recipeIngredients.ideaId, command.recipeId), inArray(recipeIngredients.id, command.rows.map(r => r.ingredientId))));
  if (ingredients.length !== command.rows.length) throw new RecipeError("Cambiaron los ingredientes de la receta. Conservamos la revisión; volvé a seleccionar desde la ficha.", 409, "INGREDIENTS_CHANGED");
}
export async function transfer(request: Request) {
  try {
    const actor = await recipeActor(request), body = await jsonBody(request);
    let command: TransferCommand;
    try { command = parseTransfer(body); } catch (error) { throw new RecipeError(error instanceof Error ? error.message : "Revisá el envío."); }
    const prepare = body.action === "prepare";
    let claims: ReturnType<typeof verifyOperation> | null = null;
    if (!prepare) {
      if (body.action !== "confirm") throw new RecipeError("Acción inválida.");
      try { claims = verifyOperation(secret(), body.token, actor.familyId, actor.memberId); }
      catch (error) { const expired = error instanceof Error && error.message === "OPERATION_EXPIRED"; throw new RecipeError(expired ? "La revisión venció (24 horas). Volvé a revisar antes de confirmar." : "La revisión no es válida. Volvé a prepararla.", 409, expired ? "OPERATION_EXPIRED" : "INVALID_OPERATION"); }
    }
    const hash = fingerprint(command);
    const result = await getDb().transaction(async tx => {
      const current = await lockFamilyActor(tx, actor);
      if (!current) throw new RecipeError("Tu acceso a la familia ya no está disponible.", 403, "NO_ACCESS");
      if (claims) {
        const [receipt] = await tx.select().from(recipeShoppingOperations).where(and(eq(recipeShoppingOperations.familyId, actor.familyId), eq(recipeShoppingOperations.operationId, claims.id)));
        if (receipt) {
          if (receipt.memberId !== current.memberId) throw new RecipeError("Operación no disponible.", 403, "NO_ACCESS");
          if (receipt.fingerprint !== hash) throw new RecipeError("Este envío ya se confirmó con otros datos.", 409, "IDEMPOTENCY_MISMATCH");
          await destinationList(tx, actor, { listId: receipt.listId });
          return receipt.result;
        }
      }
      await validIngredients(tx, actor, command);
      let list = await destinationList(tx, actor, command.destination);
      const observations = await matches(tx, list?.id ?? null, command.rows);
      if (prepare) return { observations, token: issueOperation(secret(), actor.familyId, current.memberId) };
      const changed = observations.filter(o => {
        const row = command.rows.find(r => r.ingredientId === o.ingredientId)!;
        return canonical(o.observed) !== canonical(row.observed) || (row.action !== "add" && !o.observed.some(i => i.id === row.itemId));
      });
      if (changed.length) throw new RecipeError("Cambió la lista. Revisá solo los ingredientes señalados; conservamos las demás decisiones.", 409, "REVIEW_CHANGED", { observations: changed });
      if (!list) {
        if (!("newListName" in command.destination)) throw new Error("Missing destination");
        [list] = await tx.insert(shoppingLists).values({ familyId: actor.familyId, name: command.destination.newListName, createdByMemberId: current.memberId, ownerMemberId: current.memberId }).returning();
        await tx.insert(auditEvents).values({ familyId: actor.familyId, actorMemberId: current.memberId, entityType: "shopping_list", entityId: list.id, action: "created", after: list });
      }
      const additions = command.rows.filter(row => row.action === "add");
      const inserted = additions.length ? await tx.insert(shoppingItems).values(additions.map(row => ({ listId: list.id, name: row.name, brand: row.brand, quantity: row.quantity, updatedByMemberId: current.memberId }))).returning() : [];
      const added = inserted.length;
      let edited = 0;
      const auditRows: (typeof auditEvents.$inferInsert)[] = inserted.map(item => ({ familyId: actor.familyId, actorMemberId: current.memberId, entityType: "shopping_item", entityId: item.id, action: "created", after: item }));
      for (const row of command.rows.filter(row => row.action === "edit")) {
        const [before] = await tx.select().from(shoppingItems).where(and(eq(shoppingItems.id, row.itemId!), eq(shoppingItems.listId, list.id))).for("update");
        if (!before) throw new RecipeError("Cambió la lista. Volvé a revisar.", 409, "REVIEW_CHANGED", { observations });
        if (before.name === row.name && before.brand === row.brand && before.quantity === row.quantity) continue;
        const [after] = await tx.update(shoppingItems).set({ name: row.name, brand: row.brand, quantity: row.quantity, version: before.version + 1, updatedAt: new Date(), updatedByMemberId: current.memberId }).where(eq(shoppingItems.id, before.id)).returning();
        edited++;
        auditRows.push({ familyId: actor.familyId, actorMemberId: current.memberId, entityType: "shopping_item", entityId: after.id, action: "edited", before, after });
      }
      if (auditRows.length) await tx.insert(auditEvents).values(auditRows);
      if (added || edited || !("listId" in command.destination)) await tx.update(families).set({ shoppingRevision: sql`${families.shoppingRevision} + 1` }).where(eq(families.id, actor.familyId));
      const response = { listId: list.id, added, edited };
      await tx.insert(recipeShoppingOperations).values({ familyId: actor.familyId, operationId: claims!.id, memberId: current.memberId, listId: list.id, fingerprint: hash, result: response, expiresAt: new Date(claims!.expiresAt) });
      return response;
    });
    if (!prepare) {
      // Separate autocommit statement: cleanup cannot roll back the confirmed transfer.
      try { await getDb().execute(sql`DELETE FROM recipe_shopping_operations WHERE ctid IN (SELECT ctid FROM recipe_shopping_operations WHERE expires_at < now() ORDER BY expires_at LIMIT 100)`); }
      catch { console.error("recipe_operation_cleanup_failed"); }
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return recipeError(error); }
}
