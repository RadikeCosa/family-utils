export const GENRES = [
  { id: "accion", label: "Acción" }, { id: "animacion", label: "Animación" },
  { id: "aventura", label: "Aventura" }, { id: "belica", label: "Bélica" },
  { id: "ciencia_ficcion", label: "Ciencia ficción" }, { id: "comedia", label: "Comedia" },
  { id: "crimen", label: "Crimen" }, { id: "documental", label: "Documental" },
  { id: "drama", label: "Drama" }, { id: "familiar", label: "Familiar" },
  { id: "fantasia", label: "Fantasía" }, { id: "historia", label: "Historia" },
  { id: "misterio", label: "Misterio" }, { id: "musical", label: "Musical" },
  { id: "romance", label: "Romance" }, { id: "suspenso", label: "Suspenso" },
  { id: "terror", label: "Terror" }, { id: "western", label: "Western" },
] as const;
export type Genre = typeof GENRES[number]["id"];
export function isGenre(value: unknown): value is Genre { return GENRES.some(genre => genre.id === value); }
export function normalizeGenres(value: unknown): Genre[] {
  return Array.isArray(value) ? GENRES.filter(genre => value.includes(genre.id)).map(genre => genre.id) : [];
}
export function genreInput(value: unknown): Genre[] | null {
  return Array.isArray(value) && value.every(isGenre) ? normalizeGenres(value) : null;
}
export function genreLabels(value: Genre[]) { return normalizeGenres(value).map(id => GENRES.find(genre => genre.id === id)!.label); }
