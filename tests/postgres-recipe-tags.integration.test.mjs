import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { normalizeTagNameV1 } from "../src/lib/recipes/tags.ts";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("Isolated PostgreSQL required");
test("recipe tag migration: Unicode identity, unique keys, family integrity and recipe preservation", { skip: !connectionString && "requires isolated PostgreSQL", timeout: 60000 }, async () => {
  const admin = new pg.Pool({ connectionString }), name = `recipe_tags_${randomUUID().replaceAll("-", "")}`;
  let pool;
  const folder = await mkdtemp(join(tmpdir(), "recipe-tags-upgrade-"));
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(connectionString); url.pathname = `/${name}`; pool = new pg.Pool({ connectionString: url.toString() });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    // Rehearse the prefix before tags; later migrations must not advance the watermark.
    const entries = journal.entries.slice(0, journal.entries.findIndex(e => e.tag === "0066_recipe_tags"));
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await writeFile(join(folder, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const { rows: [family] } = await pool.query("insert into families(name) values('Tags synthetic') returning id");
    const { rows: [other] } = await pool.query("insert into families(name) values('Other synthetic') returning id");
    const { rows: [member] } = await pool.query("insert into members(family_id,name) values($1,'Cook') returning id", [family.id]);
    const { rows: [recipe] } = await pool.query("insert into meal_ideas(family_id,author_member_id,title) values($1,$2,'Before tags') returning *", [family.id, member.id]);
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    for (const value of ["AÑO", "ano", "VERA\u0301NO", "𐐀", "Crème brûlée", "deVerano", "ma\u0303nana", "a\u{1E08F}"]) {
      const { rows: [row] } = await pool.query("select normalize_recipe_tag_v1($1) as key", [value]); assert.equal(row.key, normalizeTagNameV1(value));
    }
    const casePairs = [];
    for (let point = 0; point <= 0x10ffff; point++) {
      const value = String.fromCodePoint(point);
      if (/\p{L}/u.test(value) && value !== value.toLowerCase()) casePairs.push({ input: value, expected: normalizeTagNameV1(value) });
    }
    const mismatches = await pool.query("select value->>'input' as input from jsonb_array_elements($1::jsonb) where normalize_recipe_tag_v1(value->>'input') <> value->>'expected'", [JSON.stringify(casePairs)]);
    assert.deepEqual(mismatches.rows, [], "SQL and JavaScript must agree for all Unicode uppercase mappings");
    const { rows: [tag] } = await pool.query("insert into recipe_tags(family_id,name,normalized_name) values($1,'deVerano','ignored') returning *", [family.id]);
    assert.equal(tag.normalized_name, "deverano");
    await assert.rejects(pool.query("insert into recipe_tags(family_id,name,normalized_name) values($1,'DEVERÁNO','other')", [family.id]), e => e.code === "23505");
    await pool.query("insert into recipe_tag_links values($1,$2,$3)", [family.id, recipe.id, tag.id]);
    await assert.rejects(pool.query("insert into recipe_tag_links values($1,$2,$3)", [other.id, recipe.id, tag.id]), e => e.code === "23503");
    await assert.rejects(pool.query("insert into recipe_tag_links values($1,$2,$3)", [family.id, recipe.id, tag.id]), e => e.code === "23505");
    assert.deepEqual((await pool.query("select * from meal_ideas where id=$1", [recipe.id])).rows[0], recipe);
    const indexes = (await pool.query("select indexdef from pg_indexes where tablename='recipe_tag_links'")).rows.map(r => r.indexdef);
    assert.ok(indexes.some(i => i.includes("(family_id, tag_id, recipe_id)")));
    assert.equal((await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n, journal.entries.length);
  } finally {
    await pool?.end(); await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end(); await rm(folder, { recursive: true, force: true });
  }
});
