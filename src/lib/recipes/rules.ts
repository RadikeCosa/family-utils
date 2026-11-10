import { normalizeTagNameV1, tagCompare } from "./tags.ts";
import type { Ingredient, RecipeDraft } from "./types.ts";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LIMITS = { title: 160, name: 160, note: 1000, yieldText: 100, preparation: 20000, quantity: 100, brand: 160, ingredients: 100 } as const;
export function cleanText(value: unknown, limit: number, required = false): string | null {
  if (value === null || value === undefined) { if (required) throw new Error("Falta un nombre obligatorio."); return null; }
  if (typeof value !== "string") throw new Error("Revisá los campos de texto.");
  const result = value.replace(/\r\n?/g, "\n").trim();
  if (result.includes("\0") || !result.isWellFormed()) throw new Error("El texto contiene caracteres no válidos.");
  if (result.length > limit || (required && !result)) throw new Error(`Revisá el texto: máximo ${limit} caracteres.`);
  return result || null;
}
export function parseIngredients(value: unknown): Ingredient[] {
  if (!Array.isArray(value) || value.length > LIMITS.ingredients) throw new Error("La receta admite hasta 100 ingredientes.");
  const ids = new Set<string>();
  return value.map(row => {
    if (!row || typeof row !== "object" || !UUID.test(row.id) || ids.has(row.id.toLowerCase())) throw new Error("Identificador de ingrediente inválido o repetido.");
    const id = row.id.toLowerCase(); ids.add(id);
    return { id, name: cleanText(row.name, LIMITS.name, true)!, quantity: cleanText(row.quantity, LIMITS.quantity) };
  });
}
export function draftText(recipe: RecipeDraft): string {
  return [recipe.title, recipe.tags?.length && [...recipe.tags].sort((a, b) => tagCompare(normalizeTagNameV1(a), normalizeTagNameV1(b))).map(t => `#${t}`).join(" "), recipe.note, recipe.yieldText && `Rendimiento: ${recipe.yieldText}`, "Ingredientes", ...recipe.ingredients.map(i => `${i.name}${i.quantity ? ` · ${i.quantity}` : ""}`), "Preparación", recipe.preparation].filter(Boolean).join("\n");
}
