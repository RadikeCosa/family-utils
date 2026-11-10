import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectionString, diaryDatabase } from "./training-diary-fixture.mjs";
async function seed(pool, date) {
  const family = (await pool.query("INSERT INTO families(name,time_zone) VALUES('Historical diary','Pacific/Auckland') RETURNING id")).rows[0];
  const member = (await pool.query("INSERT INTO members(family_id,name) VALUES($1,'History') RETURNING id", [family.id])).rows[0];
  const blocks = [{ name: "Circuito", rounds: 2, exercises: [{ name: "Plancha", mode: "time", seconds: 30 }] }];
  const routine = (await pool.query("INSERT INTO training_routines(family_id,owner_member_id,name,blocks,operation_key,creation_hash) VALUES($1,$2,'Rutina',$3,$4,$5) RETURNING id", [family.id, member.id, JSON.stringify(blocks), randomUUID(), "a".repeat(64)])).rows[0];
  const session = (await pool.query("INSERT INTO training_sessions(family_id,owner_member_id,source_routine_id,name,blocks,performed_on,duration_seconds,effort,note,version,operation_key,creation_hash) VALUES($1,$2,$3,'Sesión histórica',$4,$5::date,NULL,NULL,'Nota original',7,$6,$7) RETURNING id", [family.id, member.id, routine.id, JSON.stringify(blocks), date, randomUUID(), "b".repeat(64)])).rows[0];
  return { family, member, routine, session, blocks };
}
test("diary backfill preserves IDs, civil dates, snapshots, null metrics and every old migration hash", { skip: !connectionString, timeout: 60_000 }, async () => {
  let data, previous;
  const db = await diaryDatabase({ beforeDiary: async pool => { data = await seed(pool, "2020-01-01"); previous = (await pool.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows; } });
  try {
    const row = (await db.pool.query("SELECT date::text,version,plan,result,owner_member_id,source_routine_id FROM training_entries WHERE id=$1", [data.session.id])).rows[0];
    assert.equal(row.date, "2020-01-01"); assert.equal(row.version, 7); assert.equal(row.plan, null); assert.deepEqual(row.result.blocks, data.blocks); assert.equal(row.result.durationSeconds, null); assert.equal(row.result.effort, null); assert.equal(row.owner_member_id, data.member.id); assert.equal(row.source_routine_id, data.routine.id);
    assert.deepEqual((await db.pool.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at LIMIT $1", [previous.length])).rows, previous);
    assert.equal((await db.pool.query("SELECT transitioned_at FROM training_diary_state")).rows[0].transitioned_at, null);
    for (const [content, kind] of [[{}, "training"], [{ text: "x", blocks: null }, "training"], [{ durationSeconds: 1 }, "rest"], [{ text: "x", effort: 11 }, "training"], [{ text: "x", unknown: true }, "training"]]) assert.equal((await db.pool.query("SELECT training_diary_content_valid($1::jsonb,$2) AS valid", [JSON.stringify(content), kind])).rows[0].valid, false);
    assert.equal((await db.pool.query("SELECT training_diary_content_valid('{}'::jsonb,'rest') AS valid")).rows[0].valid, true);
    await assert.rejects(db.pool.query("DELETE FROM training_routines WHERE id=$1", [data.routine.id]), e => e.code === "23503");
  } finally { await db.close(); }
});
test("out-of-range history stops the entire additive migration without changing dates or hashes", { skip: !connectionString, timeout: 60_000 }, async () => {
  let id, prior, checked = false;
  await assert.rejects(diaryDatabase({ beforeDiary: async pool => { id = (await seed(pool, "1800-01-01")).session.id; prior = (await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n; }, onMigrationError: async pool => {
    assert.equal((await pool.query("SELECT performed_on::text FROM training_sessions WHERE id=$1", [id])).rows[0].performed_on, "1800-01-01");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n, prior);
    assert.equal((await pool.query("SELECT to_regclass('public.training_entries') AS name")).rows[0].name, null); checked = true;
  } })); assert.equal(checked, true);
});
