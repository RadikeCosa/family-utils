import type { RecipeTag } from "@/lib/recipes/types";
import type { TagOption } from "./TagSelector";
export type CatalogItem = { id: string; title: string; note: string | null; tags?: RecipeTag[] };
export type CatalogPage = { ideas: CatalogItem[]; nextCursor: string | null; revision: string; familyId: string; total: number; tags: TagOption[]; ignoredTags: string[] };
type Entry = { data: CatalogPage; scroll: number };
// Browser memory only. Never persisted offline or used before membership is revalidated.
let scope: string | null = null;
export const catalogMemory = new Map<string, Entry>();
export const catalogOrigin: { current: { recipeId: string; href: string; entry: string; pending: boolean } | null } = { current: null };
export function clearCatalogMemory() { catalogMemory.clear(); catalogOrigin.current = null; scope = null; }
export function acceptCatalogFamily(familyId: string) {
  if (scope !== null && scope !== familyId) clearCatalogMemory();
  scope = familyId;
}
