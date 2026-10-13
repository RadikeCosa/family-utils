import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;

if (process.env.CI && !connectionString) {
  throw new Error("FAMILY_UTILS_TEST_DATABASE_URL is required in CI");
}

test("PostgreSQL meal selection is single-winner under concurrent confirmations", { skip: !connectionString && "requires an isolated PostgreSQL test service with migrations applied" }, async () => {
  const pool = new pg.Pool({ connectionString });
  const suffix = randomUUID();
  let familyId;
  try {
    const { rows: [family] } = await pool.query("INSERT INTO families (name) VALUES ($1) RETURNING id", [`meal-it-${suffix}`]);
    familyId = family.id;
    const { rows: profiles } = await pool.query(
      `INSERT INTO members (family_id, name, role)
       VALUES ($1, 'Adult A', 'administrator'), ($1, 'Adult B', 'administrator') RETURNING id`,
      [familyId],
    );
    const [adultA, adultB] = profiles.map((profile) => profile.id);
    const date = "2099-05-12";
    const { rows: [slot] } = await pool.query(
      `INSERT INTO meal_slots (family_id, meal_date, meal_type) VALUES ($1, $2, 'dinner') RETURNING id`,
      [familyId, date],
    );
    const { rows: [suggestion] } = await pool.query(
      "INSERT INTO meal_suggestions (slot_id, author_member_id, title) VALUES ($1, $2, 'Pasta') RETURNING id",
      [slot.id, adultA],
    );

    async function confirm(memberId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM families WHERE id = $1 FOR UPDATE", [familyId]);
        await client.query("SELECT id FROM meal_slots WHERE id = $1 FOR UPDATE", [slot.id]);
        const { rows: [current] } = await client.query("SELECT version FROM meal_groups WHERE slot_id = $1 FOR UPDATE", [slot.id]);
        if ((current?.version ?? 0) !== 0) {
          await client.query("ROLLBACK");
          return 409;
        }
        await client.query(
          "INSERT INTO meal_groups (slot_id, kind, name, is_default, suggestion_id, confirmed_by_member_id, version) VALUES ($1, 'home', 'Casa', true, $2, $3, 1)",
          [slot.id, suggestion.id, memberId],
        );
        await client.query(
          `INSERT INTO audit_events (family_id, actor_member_id, entity_type, entity_id, action, after)
           VALUES ($1, $2, 'meal_selection', $3, 'confirmed', jsonb_build_object('suggestionId', $4::uuid))`,
          [familyId, memberId, slot.id, suggestion.id],
        );
        await client.query("UPDATE families SET menus_revision = menus_revision + 1 WHERE id = $1", [familyId]);
        await client.query("COMMIT");
        return 200;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    }

    const outcomes = await Promise.all([confirm(adultA), confirm(adultB)]);
    assert.equal(outcomes.filter((status) => status === 200).length, 1);
    assert.equal(outcomes.filter((status) => status === 409).length, 1);
    assert.equal((await pool.query("SELECT count(*) FROM meal_groups WHERE slot_id = $1", [slot.id])).rows[0].count, "1");
    assert.equal(Number((await pool.query("SELECT menus_revision FROM families WHERE id = $1", [familyId])).rows[0].menus_revision), 1);
  } finally {
    if (familyId) {
      await pool.query("DELETE FROM meal_groups WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id = $1)", [familyId]);
      await pool.query("DELETE FROM meal_suggestions WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id = $1)", [familyId]);
      await pool.query("DELETE FROM meal_slots WHERE family_id = $1", [familyId]);
      await pool.query("DELETE FROM audit_events WHERE family_id = $1", [familyId]);
      await pool.query("DELETE FROM families WHERE id = $1", [familyId]);
    }
    await pool.end();
  }
});


test("four-meal migration preserves an existing lunch selection and attendance", { skip: !connectionString && "requires isolated PostgreSQL" }, async () => {
  const admin = new pg.Pool({ connectionString });
  const name = `meals_upgrade_${randomUUID().replaceAll("-", "")}`;
  const temporary = await mkdtemp(join(tmpdir(), "meals-migrations-"));
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  const index = journal.entries.findIndex((entry) => entry.tag.endsWith("_meal_four_types"));
  assert.ok(index >= 0);
  let pool;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(connectionString); url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    await mkdir(join(temporary, "meta"));
    const preceding = { ...journal, entries: journal.entries.slice(0, index) };
    await writeFile(join(temporary, "meta/_journal.json"), JSON.stringify(preceding));
    for (const entry of preceding.entries) await writeFile(join(temporary, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: temporary });
    const { rows: [family] } = await pool.query("INSERT INTO families(name) VALUES('Meal migration sentinel') RETURNING id");
    const { rows: [member] } = await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,'Adult','administrator') RETURNING id", [family.id]);
    const { rows: [slot] } = await pool.query("INSERT INTO meal_slots(family_id,meal_date,meal_type) VALUES($1,'2099-05-12','lunch') RETURNING id", [family.id]);
    const { rows: [idea] } = await pool.query("INSERT INTO meal_suggestions(slot_id,author_member_id,title) VALUES($1,$2,'Tarta') RETURNING id", [slot.id, member.id]);
    await pool.query("INSERT INTO meal_selections(slot_id,suggestion_id,confirmed_by_member_id,version) VALUES($1,$2,$3,3)", [slot.id, idea.id, member.id]);
    await pool.query("INSERT INTO meal_attendance(slot_id,member_id,status,updated_by_member_id) VALUES($1,$2,'present',$2)", [slot.id, member.id]);
    const {rows:[unconfirmed]}=await pool.query("INSERT INTO meal_slots(family_id,meal_date,meal_type) VALUES($1,'2099-05-13','lunch') RETURNING id",[family.id]);
    await pool.query("INSERT INTO meal_attendance(slot_id,member_id,status,updated_by_member_id) VALUES($1,$2,NULL,$2)",[unconfirmed.id,member.id]);
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    const { rows: [saved] } = await pool.query("SELECT suggestion_id,version FROM meal_selections WHERE slot_id=$1", [slot.id]);
    assert.deepEqual(saved, { suggestion_id: idea.id, version: 3 });
    assert.equal((await pool.query("SELECT status FROM meal_attendance WHERE slot_id=$1", [slot.id])).rows[0].status, "present");
    const group=(await pool.query("SELECT id,suggestion_id,version FROM meal_groups WHERE slot_id=$1 AND kind='home'",[slot.id])).rows[0];
    assert.equal(group.suggestion_id,idea.id);assert.equal(group.version,3);
    const snapshot=(await pool.query("SELECT participants FROM meal_distributions WHERE slot_id=$1",[slot.id])).rows[0].participants;
    assert.equal(snapshot[0].status,"home");assert.equal(snapshot[0].groupId,group.id);
    assert.equal(Number((await pool.query("SELECT count(*) FROM meal_exceptions WHERE slot_id=$1",[unconfirmed.id])).rows[0].count),0,"unknown migration must not create an exception");
    assert.equal(Number((await pool.query("SELECT count(*) FROM meal_distributions WHERE slot_id=$1",[unconfirmed.id])).rows[0].count),0,"unconfirmed meals must not freeze unknowns");
    assert.equal(Number((await pool.query("SELECT count(*) FROM meal_ideas")).rows[0].count),0,"migration must not import historical suggestions into bank");
    assert.equal((await pool.query("SELECT catalog_idea_id FROM meal_suggestions WHERE id=$1",[idea.id])).rows[0].catalog_idea_id,null);
    const types = (await pool.query("SELECT unnest(enum_range(NULL::meal_type))::text AS type")).rows.map((row) => row.type);
    assert.deepEqual(types, ["breakfast", "lunch", "snack", "dinner"]);
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    assert.equal(Number((await pool.query("SELECT count(*) FROM drizzle.__drizzle_migrations")).rows[0].count), journal.entries.length);
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
    await rm(temporary, { recursive: true, force: true });
  }
});
