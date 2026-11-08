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

export function commonMemberLabels(members: LibraryProfile[], currentMemberId: string) {
  const active = members.filter(member => !member.archivedAt && member.id !== currentMemberId);
  const totals = new Map<string, number>();
  const seen = new Map<string, number>();
  const key = (name: string) => name.trim().toLocaleLowerCase("es-AR");
  for (const member of active) totals.set(key(member.name), (totals.get(key(member.name)) ?? 0) + 1);
  return active.map(member => {
    const nameKey = key(member.name);
    const ordinal = (seen.get(nameKey) ?? 0) + 1;
    seen.set(nameKey, ordinal);
    return { ...member, label: totals.get(nameKey)! > 1 ? `${member.name} (${ordinal})` : member.name };
  });
}
