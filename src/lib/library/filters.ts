import { PERSONAL_STATUSES, type PersonalStatus } from "./types.ts";
export type SearchFilters = { q: string; view: string; status: string; archived: string };
const filterKeys = ["q", "view", "status", "archived"] as const;
export function readLibraryFilters(params: URLSearchParams): SearchFilters {
  const view = params.get("view") === "common_pending" ? "common_pending" : "";
  const status = params.get("status") ?? "";
  return {
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
