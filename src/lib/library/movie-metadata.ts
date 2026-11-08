export const MAX_RUNTIME_MINUTES = 1440;
export const MAX_SYNOPSIS_LENGTH = 5000;
export const MAX_CAST_MEMBERS = 30;
export const MAX_CAST_NAME_LENGTH = 200;
export const movieTextLength = (value: string) => Array.from(value).length;
export const normalizeSynopsis = (value: string) => value.replace(/\r\n?/g, "\n").trim();
export const normalizeCastName = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ");

export function normalizeCast(value: unknown): { names: string[]; duplicates: number; error: string | null } {
  const names: string[] = [], seen = new Set<string>();
  let duplicates = 0;
  if (!Array.isArray(value)) return { names, duplicates, error: "Ingresá una lista de nombres." };
  for (const item of value) {
    if (typeof item !== "string") return { names: [], duplicates: 0, error: "Cada integrante debe tener un nombre." };
    const name = normalizeCastName(item);
    if (!name || movieTextLength(name) > MAX_CAST_NAME_LENGTH) return { names: [], duplicates: 0, error: "Cada nombre debe tener entre 1 y 200 caracteres." };
    const key = name.toLowerCase();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key); names.push(name);
  }
  return { names, duplicates, error: names.length > MAX_CAST_MEMBERS ? "Podés agregar hasta 30 integrantes al reparto." : null };
}

export function appendCast(existing: string[], pending: string) {
  const added = pending.split(/\r\n?|\n/).map(normalizeCastName).filter(Boolean);
  return normalizeCast([...existing, ...added]);
}

export function formatRuntime(minutes: number) {
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return {
    text: [hours ? `${hours} h` : "", remainder ? `${remainder} min` : ""].filter(Boolean).join(" "),
    label: [hours ? `${hours} ${hours === 1 ? "hora" : "horas"}` : "", remainder ? `${remainder} ${remainder === 1 ? "minuto" : "minutos"}` : ""].filter(Boolean).join(" y "),
  };
}
