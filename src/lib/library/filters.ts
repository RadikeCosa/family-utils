import { isGenre } from "./genres.ts";
import { PERSONAL_STATUSES, type PersonalStatus } from "./types.ts";
export type SearchFilters = { selection: string; q: string; view: string; status: string; archived: string; genre: string; withMember: string };
const filterKeys = ["selection", "q", "view", "status", "archived", "genre", "withMember"] as const;
export function readLibraryFilters(params: URLSearchParams): SearchFilters {
  const view = ["common_pending", "pair_pending"].includes(params.get("view") ?? "") ? params.get("view")! : "";
  const status = params.get("status") ?? "";
  const genres = params.getAll("genre");
  const genre = genres.length === 1 && (genres[0] === "none" || isGenre(genres[0])) ? genres[0] : "";
  const selections = params.getAll("selection");
  return { selection: selections.length === 1 && selections[0] === "cine_with_cami" ? "cine_with_cami" : "", genre,
    withMember: view === "pair_pending" ? (params.get("withMember") ?? "").toLowerCase() : "",
    q: (params.get("q") ?? "").slice(0, 200), view,
    status: view ? "" : status === "none" || PERSONAL_STATUSES.includes(status as PersonalStatus) ? status : "",
    archived: params.get("archived") === "true" ? "true" : "",
  };
}
export function libraryFilterString(value: SearchFilters) {
  const params = new URLSearchParams();
  for (const key of filterKeys) if (value[key]) params.set(key, value[key]);
  return params.toString();
}
export function canonicalLibrarySearch(params: URLSearchParams, filters = readLibraryFilters(params)) {
  const next = new URLSearchParams(params);
  for (const key of [...filterKeys, "kind", "type", "cursor"]) next.delete(key);
  for (const [key, value] of new URLSearchParams(libraryFilterString(filters))) next.set(key, value);
  return next.toString();
}
