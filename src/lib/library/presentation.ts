import type { PersonalEntry } from "./types.ts";
export function familyRating(entries: Pick<PersonalEntry, "rating">[]) {
  const ratings = entries.flatMap(({ rating }) => rating === null ? [] : [rating]);
  return ratings.length ? `Familia · ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ratings.reduce((sum, value) => sum + value, 0) / ratings.length)}/5 · ${ratings.length} ${ratings.length === 1 ? "valoración" : "valoraciones"}` : "Familia · Sin valoraciones";
}
