import assert from "node:assert/strict";
import test from "node:test";
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
        const { rows: [current] } = await client.query("SELECT version FROM meal_selections WHERE slot_id = $1 FOR UPDATE", [slot.id]);
        if ((current?.version ?? 0) !== 0) {
          await client.query("ROLLBACK");
          return 409;
        }
        await client.query(
          "INSERT INTO meal_selections (slot_id, suggestion_id, confirmed_by_member_id) VALUES ($1, $2, $3)",
          [slot.id, suggestion.id, memberId],
        );
        await client.query(
          `INSERT INTO audit_events (family_id, actor_member_id, entity_type, entity_id, action, after)
           VALUES ($1, $2, 'meal_selection', $3, 'confirmed', jsonb_build_object('suggestionId', $4))`,
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
    assert.equal((await pool.query("SELECT count(*) FROM meal_selections WHERE slot_id = $1", [slot.id])).rows[0].count, "1");
    assert.equal(Number((await pool.query("SELECT menus_revision FROM families WHERE id = $1", [familyId])).rows[0].menus_revision), 1);
  } finally {
    if (familyId) await pool.query("DELETE FROM families WHERE id = $1", [familyId]);
    await pool.end();
  }
});
