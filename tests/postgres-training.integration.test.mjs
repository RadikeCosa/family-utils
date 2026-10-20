import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
test("training constraints, immutable snapshots and migration hash", { skip: !connectionString && "requires isolated PostgreSQL" }, async () => {
  const pool = new pg.Pool({ connectionString }); const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const families = (await client.query("INSERT INTO families(name) VALUES('training-a'),('training-b') RETURNING id")).rows;
    const [a, b, c] = (await client.query("INSERT INTO members(family_id,name) VALUES($1,'A'),($1,'B'),($2,'C') RETURNING id", [families[0].id, families[1].id])).rows;
    const blocks = [{ name: "", rounds: 3, exercises: [{ name: "Plancha", mode: "time", seconds: 30 }] }];
    const routineArgs = [families[0].id, a.id, "😀".repeat(120), JSON.stringify(blocks), randomUUID(), "a".repeat(64)];
    const routineSql = "INSERT INTO training_routines(family_id,owner_member_id,name,blocks,operation_key,creation_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *";
    const routine = (await client.query(routineSql, routineArgs)).rows[0];
    async function rejected(sql, args, code) {
      await client.query("SAVEPOINT bad_input");
      await assert.rejects(client.query(sql, args), (error) => error.code === code);
      await client.query("ROLLBACK TO SAVEPOINT bad_input");
    }
    await rejected(routineSql, routineArgs, "23505");
    await rejected(routineSql, [families[0].id, c.id, "x", JSON.stringify(blocks), randomUUID(), "a".repeat(64)], "23503");
    await rejected("UPDATE training_routines SET name=$1 WHERE id=$2", ["😀".repeat(121), routine.id], "23514");
    for (const invalid of [[], {}, [{ ...blocks[0], rounds: 1e9 }], [{ ...blocks[0], exercises: [{ name: "X", mode: "time", seconds: 10, repetitions: 3 }] }], [{ ...blocks[0], exercises: [{ mode: "time", seconds: 10 }] }], [{ ...blocks[0], exercises: [] }]]) await rejected("UPDATE training_routines SET blocks=$1 WHERE id=$2", [JSON.stringify(invalid), routine.id], "23514");
    const sessionSql = "INSERT INTO training_sessions(family_id,owner_member_id,source_routine_id,name,blocks,performed_on,duration_seconds,effort,operation_key,creation_hash) VALUES($1,$2,$3,'Session',$4,'2026-10-20',1500,7,$5,$6) RETURNING *";
    const args = [families[0].id, a.id, routine.id, JSON.stringify(blocks), randomUUID(), "b".repeat(64)];
    const session = (await client.query(sessionSql, args)).rows[0];
    await rejected(sessionSql, [families[0].id, b.id, routine.id, JSON.stringify(blocks), randomUUID(), "b".repeat(64)], "23503");
    await rejected("UPDATE training_sessions SET effort=11 WHERE id=$1", [session.id], "23514");
    await rejected("UPDATE training_sessions SET duration_seconds=86401 WHERE id=$1", [session.id], "23514");
    await client.query("UPDATE training_routines SET blocks=$1,archived_at=now() WHERE id=$2", [JSON.stringify([{ ...blocks[0], rounds: 1 }]), routine.id]);
    assert.deepEqual((await client.query("SELECT blocks FROM training_sessions WHERE id=$1", [session.id])).rows[0].blocks, blocks);
    await rejected("DELETE FROM training_routines WHERE id=$1", [routine.id], "23503");
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const migration = journal.entries.find((entry) => entry.tag === "0053_training"); assert.ok(migration);
    const expectedHash = createHash("sha256").update(await readFile("drizzle/0053_training.sql")).digest("hex");
    assert.equal((await client.query("SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at=$1", [migration.when])).rows[0].hash, expectedHash);
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
});

test("training upgrades an existing database without rewriting migration history", { skip: !connectionString && "requires isolated PostgreSQL" }, async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const admin = new pg.Pool({ connectionString });
  const name = `training_upgrade_${randomUUID().replaceAll("-", "")}`;
  const temporary = await mkdtemp(join(tmpdir(), "training-upgrade-")); let pool;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(connectionString); url.pathname = `/${name}`; pool = new pg.Pool({ connectionString: url.toString() });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const index = journal.entries.findIndex((entry) => entry.tag === "0053_training"); assert.ok(index > 0);
    const before = { ...journal, entries: journal.entries.slice(0, index) };
    await mkdir(join(temporary, "meta")); await writeFile(join(temporary, "meta/_journal.json"), JSON.stringify(before));
    for (const entry of before.entries) await writeFile(join(temporary, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: temporary });
    const family = (await pool.query("INSERT INTO families(name) VALUES('pre-training sentinel') RETURNING id")).rows[0];
    const prior = (await pool.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows;
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    assert.equal((await pool.query("SELECT name FROM families WHERE id=$1", [family.id])).rows[0].name, "pre-training sentinel");
    assert.deepEqual((await pool.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at LIMIT $1", [prior.length])).rows, prior);
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    assert.equal(Number((await pool.query("SELECT count(*) FROM drizzle.__drizzle_migrations")).rows[0].count), journal.entries.length);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM training_routines")).rows[0].n, 0);
  } finally {
    await pool?.end(); await admin.query(`DROP DATABASE IF EXISTS "${name}"`); await admin.end(); await rm(temporary, { recursive: true, force: true });
  }
});
