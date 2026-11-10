import { normalizeTagNameV1, tagCompare } from "./tags.ts";
export function readRecipeFilters(params: URLSearchParams) {
  const query = params.get("q") ?? "", archived = params.get("archived") === "true" || params.get("archived") === "1";
  const slugs = [...new Set(params.getAll("tag").map(normalizeTagNameV1))].sort(tagCompare);
  const canonical = new URLSearchParams();
  if (query) canonical.set("q", query);
  if (archived) canonical.set("archived", "true");
  slugs.forEach(t => canonical.append("tag", t));
  return { query, archived, slugs, queryKey: canonical.toString() };
}
