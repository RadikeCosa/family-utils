import type { LibraryProfile, PersonalEntry } from "./types.ts";
export function familyRating(entries: Pick<PersonalEntry, "rating">[]) {
  const ratings = entries.flatMap(({ rating }) => rating === null ? [] : [rating]);
  return ratings.length ? `Familia · ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ratings.reduce((sum, value) => sum + value, 0) / ratings.length)}/5 · ${ratings.length} ${ratings.length === 1 ? "valoración" : "valoraciones"}` : "Familia · Sin valoraciones";
}

const companionNames = new Intl.Collator("es", { sensitivity: "base" });
export function orderCompanions(members: LibraryProfile[]) {
  return [...members].sort((a, b) => companionNames.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function selectedCompanionsSummary(ordered: LibraryProfile[], selected: string[]) {
  const names = ordered.filter((member) => selected.includes(member.id)).map((member) => member.name);
  return names.length ? `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}` : "Opcional";
}
