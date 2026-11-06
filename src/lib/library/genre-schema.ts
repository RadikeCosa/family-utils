import { GENRES } from "./genres.ts";
// Used by Drizzle generation. Applied migration SQL remains immutable.
export function genresCheckSql(column = '"genres"') {
  const ids = GENRES.map(genre => `'${genre.id}'`);
  return `CASE WHEN array_ndims(${column}) IS NULL OR array_ndims(${column}) = 1 THEN ${column} <@ ARRAY[${ids.join(", ")}]::text[] AND array_position(${column}, NULL::text) IS NULL AND cardinality(${column}) = num_nonnulls(${ids.map(id => `array_position(${column}, ${id})`).join(", ")}) ELSE FALSE END`;
}
