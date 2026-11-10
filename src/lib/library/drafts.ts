import { normalizeCast } from "./movie-metadata.ts";
import { normalizeGenres } from "./genres.ts";
const PREFIX = "family-library-draft:v1:";
export function clearLibraryDrafts(identity?: string) {
  if (typeof window === "undefined") return;
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX) && (!identity || !key.startsWith(`${PREFIX}${identity}:`))) sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}
export function libraryDraftKey(scope: string) { return `${PREFIX}${scope}`; }

export function restoreLibraryDraft<T extends Record<string, unknown>>(initial: T, value: unknown): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return initial;
  const saved = value as Record<string, unknown>;
  if (!Object.keys(initial).every(field => ["cineWithCami", "genres", "runtimeMinutes", "cast", "synopsis", "castPending"].includes(field) || (typeof saved[field] === typeof initial[field] && Array.isArray(saved[field]) === Array.isArray(initial[field])))) return initial;
  return Object.fromEntries(Object.keys(initial).map(field => [field, field === "cineWithCami" ? (typeof saved.cineWithCami === "boolean" ? saved.cineWithCami : null) : field === "kind" ? "movie" : field === "genres" ? normalizeGenres(Array.isArray(saved.genres) ? saved.genres : initial.genres)
    : field === "cast" ? (normalizeCast(saved.cast).error ? initial.cast : normalizeCast(saved.cast).names)
    : ["runtimeMinutes", "synopsis", "castPending"].includes(field) ? (typeof saved[field] === "string" ? saved[field] : initial[field])
    : saved[field]])) as T;
}
