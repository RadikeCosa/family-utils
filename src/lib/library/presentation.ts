import type { PersonalEntry } from "./types.ts";
export function familyRating(entries: Pick<PersonalEntry, "rating">[]) {
  const ratings = entries.flatMap(({ rating }) => rating === null ? [] : [rating]);
  return ratings.length ? `${(ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1)} / 5 · ${ratings.length} ${ratings.length === 1 ? "valoración" : "valoraciones"}` : "Sin valoraciones";
}
