import { cleanText, UUID } from "./rules.ts";
import type { ObservedItem, TransferCommand, TransferRow } from "./types.ts";
function snapshotText(value: unknown, limit: number, required = false): string | null {
  if (value === null && !required) return null;
  if (typeof value !== "string" || value.length > limit || (required && !value.length)) throw new Error("Coincidencias inválidas.");
  return value;
}
export function parseTransfer(body: Record<string, unknown>): TransferCommand {
  if (typeof body.recipeId !== "string" || !UUID.test(body.recipeId)) throw new Error("Revisá la receta.");
  const dest = body.destination as Record<string, unknown> | undefined;
  if (!dest || Array.isArray(dest)) throw new Error("Elegí una lista.");
  const destination = typeof dest.listId === "string" && UUID.test(dest.listId) && !("newListName" in dest)
    ? { listId: dest.listId.toLowerCase() } : !("listId" in dest) && typeof dest.newListName === "string" ? { newListName: cleanText(dest.newListName, 160, true)! } : null;
  if (!destination) throw new Error("Elegí una lista existente o un nombre para la nueva.");
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 100) throw new Error("Seleccioná entre 1 y 100 ingredientes.");
  const ids = new Set<string>(), edited = new Set<string>();
  const rows: TransferRow[] = body.rows.map(row => {
    if (!row || !UUID.test(row.ingredientId) || ids.has(row.ingredientId.toLowerCase()) || !["add", "keep", "edit"].includes(row.action)) throw new Error("Revisá los ingredientes seleccionados.");
    ids.add(row.ingredientId.toLowerCase());
    const itemId = row.action === "add" ? null : typeof row.itemId === "string" && UUID.test(row.itemId) ? row.itemId.toLowerCase() : null;
    if (row.action !== "add" && !itemId) throw new Error("Elegí la fila existente.");
    if (row.action === "edit" && edited.has(itemId!)) throw new Error("No se puede editar la misma fila dos veces en un envío.");
    if (row.action === "edit") edited.add(itemId!);
    if (!Array.isArray(row.observed) || row.observed.length > 1000) throw new Error("Revisá las coincidencias.");
    const observedIds = new Set<string>();
    const observed: ObservedItem[] = row.observed.map((i: ObservedItem) => {
      if (!i || !UUID.test(i.id) || observedIds.has(i.id.toLowerCase()) || !Number.isSafeInteger(i.version) || i.version < 1 || typeof i.purchased !== "boolean") throw new Error("Coincidencias inválidas.");
      const id = i.id.toLowerCase(); observedIds.add(id);
      return { id, version: i.version, name: snapshotText(i.name, 160, true)!, brand: snapshotText(i.brand, 160), quantity: snapshotText(i.quantity, 100), purchased: i.purchased };
    }).sort((a: ObservedItem, b: ObservedItem) => a.id.localeCompare(b.id));
    return { ingredientId: row.ingredientId.toLowerCase(), name: cleanText(row.name, 160, true)!, brand: cleanText(row.brand, 160), quantity: cleanText(row.quantity, 100), action: row.action, itemId, observed };
  });
  return { recipeId: body.recipeId.toLowerCase(), destination, rows };
}
