import { readRecipeFilters } from "../recipes/filters.ts";
import { findApp, type AppDefinition } from "./catalog.ts";
import { readLibraryFilters, libraryFilterString } from "../library/filters.ts";
const keys: Record<string, string[]> = {
  tasks: ["fecha", "seccion", "estado"],
  menus: ["fecha", "vista", "comida"],
  recipes: ["q", "archived", "fecha", "comida"],
  shopping: ["archived"],
  library: [
    "q",
    "selection",
    "view",
    "status",
    "archived",
    "genre",
    "withMember",
  ],
  sports: ["sport", "event", "round", "member"],
  training: ["fecha", "seccion", "archived", "detalle"],
  kitchen: ["temperatura"],
  home: [],
  family: [],
};
const enums: Record<string, string[]> = {
  seccion: ["historial", "plantillas"],
  estado: ["completed", "archived"],
  vista: ["dia", "semana"],
  archived: ["true"],
  temperatura: ["true"],
  sport: ["river", "ufc", "champions"],
  comida: ["breakfast", "lunch", "snack", "dinner"],
};
export function normalizeNavigationSearch(
  path: string,
  input: URLSearchParams,
  apps: AppDefinition[],
) {
  const app = findApp(path, apps);
  if (!app) return "";
  if (app.id === "library")
    return libraryFilterString(readLibraryFilters(input));
  const output = app.id === "recipes"
    ? new URLSearchParams(readRecipeFilters(input).queryKey)
    : new URLSearchParams();
  if (app.id === "recipes") {
    output.delete("q");
    const query = input.get("q")?.slice(0, 160);
    if (query) output.set("q", query);
    const tags = output.getAll("tag").filter(tag => tag.length > 0 && tag.length <= 40 && !/[\p{Cc}\p{Cf}]/u.test(tag)).slice(0, 10);
    output.delete("tag");
    tags.forEach(tag => output.append("tag", tag));
  }
  for (const key of keys[app.id] ?? []) {
    if (app.id === "recipes" && ["q", "archived"].includes(key)) continue;
    const value = input.get(key);
    if (!value) continue;
    if (enums[key] && !enums[key].includes(value)) continue;
    if (
      key === "sport" &&
      !app.sections.some(
        (section) =>
          new URL(section.href, "https://family.invalid").searchParams.get(
            "sport",
          ) === value,
      )
    )
      continue;
    if (key === "fecha" && !validDate(value)) continue;
    if (
      ["detalle", "event", "round", "member"].includes(key) &&
      !/^[a-zA-Z0-9_-]{1,100}$/.test(value)
    )
      continue;
    output.set(key, key === "q" ? value.slice(0, 200) : value);
  }
  return output.toString();
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
