import { sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { recipeActor, recipeError, RecipeError } from "./server";
import { normalizeTagNameV1, tagCompare } from "./tags";
import { decodeRecipeCursor, encodeRecipeCursor, type RecipeCursor } from "./cursor";
import type { RecipeTag } from "./types";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function all(parts: SQL[]) { return sql.join(parts, sql` AND `); }
export async function recipeCatalog(request: Request, suggestionsOnly = false) {
  try {
    const actor = await recipeActor(request), params = new URL(request.url).searchParams;
    const query = (params.get("q") ?? "").trim().slice(0, 160), archived = params.get("archived") === "1";
    const requested = [...new Set(params.getAll("tag").map(normalizeTagNameV1))].sort(tagCompare);
    if (requested.length > 10 || requested.some(t => Array.from(t).length > 40)) throw new RecipeError("Revisá los filtros de etiquetas.");
    const limit = Math.max(1, Math.min(50, Math.trunc(Number(params.get("limit")) || 20)));
    const offset = Math.max(0, Math.min(100000, Math.trunc(Number(params.get("offset")) || 0)));
    return await getDb().transaction(async tx => {
      // Revalidate membership inside the same snapshot as revision, results and facets.
      const context = await tx.execute<{ revision: string; normalized: string }>(sql`
        SELECT f.menus_revision::text AS revision, normalize_name_v1(${query}) AS normalized FROM families f
        WHERE f.id = ${actor.familyId} AND EXISTS (
          SELECT 1 FROM member_devices d JOIN members m ON m.id = d.member_id
          WHERE d.auth_user_id = ${actor.authUser.id} AND d.revoked_at IS NULL AND m.archived_at IS NULL AND m.family_id = f.id)
      `);
      const family = context.rows[0];
      if (!family) throw new RecipeError("Tu acceso ya no está disponible.", 403, "NO_ACCESS");
      if (params.get("revisionOnly") === "1") return NextResponse.json({ familyId: actor.familyId, revision: family.revision }, { headers: privateHeaders });
      const available = await tx.execute<RecipeTag>(sql`
        SELECT t.id, t.name, t.normalized_name AS slug FROM recipe_tags t WHERE t.family_id = ${actor.familyId}
        AND EXISTS (SELECT 1 FROM recipe_tag_links l JOIN meal_ideas i ON i.id = l.recipe_id AND i.family_id = l.family_id
          WHERE l.family_id = t.family_id AND l.tag_id = t.id AND i.merged_into_id IS NULL)
        ORDER BY t.normalized_name COLLATE "C"
      `);
      const selected = available.rows.filter(t => requested.includes(t.slug));
      const ignoredTags = requested.filter(t => !selected.some(s => s.slug === t));
      const fingerprint = JSON.stringify([family.normalized, archived, selected.map(t => t.slug)]);
      let cursor: RecipeCursor | undefined;
      const rawCursor = params.get("cursor");
      if (rawCursor) {
        try { cursor = decodeRecipeCursor(rawCursor, process.env.BETTER_AUTH_SECRET!); } catch { throw new RecipeError("Cursor inválido. Actualizá la lista.", 400, "INVALID_CURSOR"); }
        if (cursor.family !== actor.familyId) throw new RecipeError("El cursor no corresponde a esta consulta.", 400, "INVALID_CURSOR");
        if (cursor.revision !== family.revision) throw new RecipeError("El catálogo cambió. Actualizá la lista para continuar.", 409, "CATALOG_CHANGED");
        if (cursor.query !== fingerprint) throw new RecipeError("El cursor no corresponde a esta consulta.", 400, "INVALID_CURSOR");
      }
      if (suggestionsOnly && params.get("mode") === "edit") return NextResponse.json({ tags: available.rows, familyId: actor.familyId }, { headers: privateHeaders });
      const filters: SQL[] = [sql`i.family_id = ${actor.familyId}`, sql`i.merged_into_id IS NULL`, archived ? sql`i.archived_at IS NOT NULL` : sql`i.archived_at IS NULL`];
      if (query) filters.push(sql`i.normalized_title LIKE '%' || replace(replace(replace(${family.normalized}, chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_') || '%'`);
      for (const tag of selected) filters.push(sql`EXISTS (SELECT 1 FROM recipe_tag_links l WHERE l.family_id = i.family_id AND l.recipe_id = i.id AND l.tag_id = ${tag.id})`);
      const base = all(filters);
      const counts = await tx.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM meal_ideas i WHERE ${base}`);
      const facets = await tx.execute<RecipeTag & { count: number }>(sql`
        WITH matching AS (SELECT i.id, i.family_id FROM meal_ideas i WHERE ${base})
        SELECT t.id, t.name, t.normalized_name AS slug, count(m.id)::int AS count
        FROM recipe_tags t JOIN recipe_tag_links l ON l.tag_id = t.id AND l.family_id = t.family_id
        JOIN meal_ideas i ON i.id = l.recipe_id AND i.family_id = l.family_id AND i.merged_into_id IS NULL
        LEFT JOIN matching m ON m.id = l.recipe_id AND m.family_id = l.family_id
        WHERE t.family_id = ${actor.familyId} GROUP BY t.id ORDER BY t.normalized_name COLLATE "C"
      `);
      const metadata = { familyId: actor.familyId, revision: family.revision, total: counts.rows[0].total, tags: facets.rows, ignoredTags };
      if (suggestionsOnly) return NextResponse.json(metadata, { headers: privateHeaders });
      if (cursor) {
        const c = cursor.last;
        const tail = sql`(i.updated_at, i.created_at, i.id) < (${c.updated}::timestamptz, ${c.created}::timestamptz, ${c.id}::uuid)`;
        filters.push(c.used === null ? sql`i.last_used_at IS NULL AND ${tail}` : sql`(i.last_used_at IS NULL OR i.last_used_at < ${c.used}::timestamptz OR (i.last_used_at = ${c.used}::timestamptz AND ${tail}))`);
      }
      type Row = { id: string; title: string; note: string | null; tags: RecipeTag[]; used: string | null; updated: string; created: string };
      const result = await tx.execute<Row>(sql`
        SELECT i.id, i.title, i.note, i.author_member_id AS "authorMemberId", m.name AS "authorName", i.meal_types AS "mealTypes",
          i.packed_suitable AS "packedSuitable", i.version, i.archived_at AS "archivedAt", i.last_used_at AS "lastUsedAt",
          (i.normalized_title = ${family.normalized}) AS "exactMatch",
          i.last_used_at::text AS used, i.updated_at::text AS updated, i.created_at::text AS created,
          COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'slug', t.normalized_name) ORDER BY t.normalized_name COLLATE "C")
            FROM recipe_tag_links l JOIN recipe_tags t ON t.id = l.tag_id AND t.family_id = l.family_id
            WHERE l.family_id = i.family_id AND l.recipe_id = i.id), '[]'::json) AS tags
        FROM meal_ideas i JOIN members m ON m.id = i.author_member_id WHERE ${all(filters)}
        ORDER BY i.last_used_at DESC NULLS LAST, i.updated_at DESC, i.created_at DESC, i.id DESC
        LIMIT ${limit + 1} OFFSET ${cursor ? 0 : offset}
      `);
      const page = result.rows.slice(0, limit), last = page.at(-1), hasMore = result.rows.length > limit;
      const nextCursor = hasMore && last ? encodeRecipeCursor({ v: 1, family: actor.familyId, query: fingerprint, revision: family.revision,
        last: { used: last.used, updated: last.updated, created: last.created, id: last.id } }, process.env.BETTER_AUTH_SECRET!) : null;
      return NextResponse.json({ ...metadata, ideas: page.map(row => { const item = { ...row } as Partial<Row>; delete item.used; delete item.updated; delete item.created; return item; }), nextCursor,
        nextOffset: hasMore ? offset + limit : null }, { headers: privateHeaders });
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  } catch (error) { return recipeError(error); }
}
