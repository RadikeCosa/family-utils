import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { reconcileMealCatalog } from "../scripts/reconcile-meal-catalog.mjs";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("Isolated PostgreSQL required");
test("staged recipe migrations preserve legacy records and abort normalization collisions independently", { skip: !connectionString && "requires isolated PostgreSQL", timeout: 60000 }, async () => {
  const admin = new pg.Pool({ connectionString }), name = `recipes_upgrade_${randomUUID().replaceAll("-", "")}`;
  const folder = await mkdtemp(join(tmpdir(), "recipes-upgrade-")); let pool;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(connectionString); url.pathname = `/${name}`; pool = new pg.Pool({ connectionString: url.toString() });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")); await mkdir(join(folder, "meta"));
    async function through(tag) {
      const index = journal.entries.findIndex(e => e.tag === tag); assert.ok(index >= 0);
      const entries = journal.entries.slice(0, index + 1);
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
      for (const entry of entries) await writeFile(join(folder, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
      await migrate(drizzle(pool), { migrationsFolder: folder });
    }
    await through("0055_meal_catalog");
    const { rows: [family] } = await pool.query("insert into families(name) values('Migration sentinel') returning id");
    const { rows: [member] } = await pool.query("insert into members(family_id,name,role) values($1,'Cook','administrator') returning id", [family.id]);
    const { rows: [idea] } = await pool.query("insert into meal_ideas(family_id,author_member_id,title,note,normalized_title) values($1,$2,'Café familiar','Existing note','cafe familiar') returning *", [family.id, member.id]);
    const { rows: [list] } = await pool.query("insert into shopping_lists(family_id,name,created_by_member_id,owner_member_id) values($1,'Existing',$2,$2) returning id", [family.id, member.id]);
    const { rows: [item] } = await pool.query("insert into shopping_items(list_id,name,brand,quantity,purchased,updated_by_member_id) values($1,'Café','Marca','½ taza',true,$2) returning *", [list.id, member.id]);
    await pool.query("insert into shopping_suggestions(family_id,name,normalized_name,hidden) values($1,'CAFÉ','old-first',true),($1,'cafe','old-second',false)", [family.id]);
    // Reproduce a deployed catalog whose DDL/backfill exists but ledger entry is absent.
    const catalogEntry = journal.entries.find(e => e.tag === "0055_meal_catalog");
    await pool.query("delete from drizzle.__drizzle_migrations where created_at=$1", [catalogEntry.when]);
    assert.equal((await reconcileMealCatalog(pool)).changed, false);
    await pool.query("update meal_ideas set normalized_title='invalid' where id=$1", [idea.id]);
    await assert.rejects(() => reconcileMealCatalog(pool, { apply: true }), /not fully adoptable/);
    assert.equal((await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n, journal.entries.findIndex(e => e.tag === "0055_meal_catalog"));
    await pool.query("update meal_ideas set normalized_title='cafe familiar' where id=$1", [idea.id]);
    assert.equal((await reconcileMealCatalog(pool, { apply: true })).changed, true);
    assert.equal((await reconcileMealCatalog(pool, { apply: true })).alreadyRecorded, true);
    assert.deepEqual((await pool.query("select * from meal_ideas where id=$1", [idea.id])).rows[0], idea);
    await through("0056_recipes_base");
    await assert.rejects(() => through("0057_recipe_name_normalization"), /NORMALIZATION_COLLISION/);
    assert.ok((await pool.query("select preparation from meal_ideas where id=$1", [idea.id])).rows[0]);
    assert.equal((await pool.query("select to_regclass('recipe_ingredients') as name")).rows[0].name, "recipe_ingredients");
    await pool.query("delete from shopping_suggestions where normalized_name='old-second'");
    await through("0059_recipe_family_integrity");
    const upgraded = (await pool.query("select * from meal_ideas where id=$1", [idea.id])).rows[0];
    for (const [key, value] of Object.entries(idea)) assert.deepEqual(upgraded[key], value, key);
    assert.deepEqual((await pool.query("select * from shopping_items where id=$1", [item.id])).rows[0], item);
    const suggestion = (await pool.query("select * from shopping_suggestions where family_id=$1", [family.id])).rows[0]; assert.equal(suggestion.hidden, true); assert.equal(suggestion.name, "CAFÉ"); assert.equal(suggestion.normalized_name, "cafe");
    const vectors = [["  CAÑA\t CAFÉ\n", "cana cafe"], ["Cafe\u0301", "cafe"], ["Crème brûlée", "crème brûlee"], ["Huevos", "huevos"], ["Huevo", "huevo"], ["Arroz 100%", "arroz 100%"]];
    for (const [input, expected] of vectors) assert.equal((await pool.query("select normalize_name_v1($1) as value", [input])).rows[0].value, expected);
    await pool.query("update meal_ideas set title=' CAÑA  ' , normalized_title='wrong' where id=$1", [idea.id]); assert.equal((await pool.query("select normalized_title from meal_ideas where id=$1", [idea.id])).rows[0].normalized_title, "cana");
    const { rows: [otherFamily] } = await pool.query("insert into families(name) values('Other') returning id");
    await assert.rejects(() => pool.query("insert into recipe_ingredients(id,family_id,idea_id,name,position) values($1,$2,$3,'Wrong family',0)", [randomUUID(), otherFamily.id, idea.id]), /foreign key/);
    await through("0059_recipe_family_integrity");
    // The deferred index is independent and accepts hidden canonical entries.
    await pool.query(await readFile("drizzle-deferred/recipes_name_unique.sql", "utf8"));
    await assert.rejects(() => pool.query("insert into meal_ideas(family_id,author_member_id,title,archived_at) values($1,$2,'Caña',now())", [family.id, member.id]), /unique/);
    const snapshotBytes = {};
    for (const [kind, character] of [["ascii", "x"], ["unicode", "料"], ["escaped", "\u0001"]]) {
      const huge = { preparation: character.repeat(20000), ingredients: Array.from({ length: 100 }, () => ({ id: randomUUID(), name: character.repeat(160), quantity: character.repeat(100) })) };
      const { rows: [size] } = await pool.query("select octet_length($1::jsonb::text) as bytes", [JSON.stringify({ before: huge, after: huge })]);
      snapshotBytes[kind] = size.bytes;
      assert.ok(size.bytes < 650000);
    }
    console.info("recipe_audit_snapshot_bytes", snapshotBytes); // Synthetic, bounded fixture sizes; no family content.

  } finally {
    await pool?.end(); await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end(); await rm(folder, { recursive: true, force: true });
  }
});
