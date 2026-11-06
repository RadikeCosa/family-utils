import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { commonPendingSql } from "../src/lib/library/queries.ts";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
const options = { skip: !connectionString && "requires isolated PostgreSQL", timeout: 120_000 };

test("cinemateca migration is atomic, times out on locks, and compensation restores its exact CHECK", options, async () => {
  const admin = new pg.Pool({ connectionString });
  const name = `cinemateca_${randomUUID().replaceAll("-", "")}`;
  const folder = await mkdtemp(join(tmpdir(), "cinemateca-migration-"));
  let pool;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(connectionString); url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const index = journal.entries.findIndex((entry) => entry.tag.endsWith("_cinemateca_movies_only"));
    assert.ok(index > 0);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, index) }));
    for (const entry of journal.entries.slice(0, index)) await writeFile(join(folder, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const family = (await pool.query("INSERT INTO families(name) VALUES('migration-test') RETURNING id")).rows[0].id;
    const member = (await pool.query("INSERT INTO members(family_id,name) VALUES($1,'Test') RETURNING id", [family])).rows[0].id;
    const work = (await pool.query("INSERT INTO library_works(family_id,title,titulo_normalizado,kind,created_by_member_id,updated_by_member_id) VALUES($1,'Sentinel','sentinel','book',$2,$2) RETURNING id", [family, member])).rows[0].id;
    const constraint = async () => (await pool.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='library_works_kind'")).rows[0].def;
    const original = await constraint();
    const history = async () => (await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    const before = await history();
    await assert.rejects(migrate(drizzle(pool), { migrationsFolder: "drizzle" }), /no son películas/);
    assert.deepEqual(await history(), before);
    assert.equal(await constraint(), original);
    assert.equal((await pool.query("SELECT kind FROM library_works WHERE id=$1", [work])).rows[0].kind, "book");
    await pool.query("UPDATE library_works SET kind='movie' WHERE id=$1", [work]);
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT * FROM library_works");
      const started = Date.now();
      await assert.rejects(migrate(drizzle(pool), { migrationsFolder: "drizzle" }), (error) => error.cause?.code === "55P03");
      assert.ok(Date.now() - started < 8000, "lock timeout must fail promptly");
      assert.deepEqual(await history(), before);
      assert.equal(await constraint(), original);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    const sentinel = (await pool.query("SELECT * FROM library_works WHERE id=$1", [work])).rows;
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    assert.equal((await history()).length, journal.entries.length);
    await assert.rejects(pool.query("UPDATE library_works SET kind='book' WHERE id=$1", [work]), { code: "23514" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile("ops/cinemateca/restore-work-kinds.sql", "utf8"));
      await client.query("COMMIT");
    } finally { client.release(); }
    assert.equal(await constraint(), original);
    assert.deepEqual((await pool.query("SELECT * FROM library_works WHERE id=$1", [work])).rows, sentinel);
    for (const kind of ["movie", "series", "book", "music", "art", "video_game", "tabletop_game"]) await pool.query("UPDATE library_works SET kind=$1 WHERE id=$2", [kind, work]);
    await assert.rejects(pool.query("UPDATE library_works SET kind='unknown' WHERE id=$1", [work]), { code: "23514" });
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
    await rm(folder, { recursive: true, force: true });
  }
});

test("common pending SQL handles membership, archive independently and scales without repeated personal scans", options, async (t) => {
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const family = (await client.query("INSERT INTO families(name) VALUES('common-stress') RETURNING id")).rows[0].id;
    const members = (await client.query("INSERT INTO members(family_id,name) SELECT $1,'Test '||n FROM generate_series(1,20) n RETURNING id", [family])).rows;
    const movie = (await client.query("INSERT INTO library_works(family_id,title,titulo_normalizado,kind,created_by_member_id,updated_by_member_id) VALUES($1,'One','one','movie',$2,$2) RETURNING id", [family, members[0].id])).rows[0].id;
    const matches = async () => (await client.query(`SELECT w.id FROM library_works w WHERE w.id=$1 AND ${commonPendingSql}`, [movie])).rows.length;
    assert.equal(await matches(), 0);
    await client.query("INSERT INTO library_personal(family_id,work_id,member_id,status) SELECT $1,$2,id,'pending' FROM members WHERE family_id=$1", [family, movie]);
    assert.equal(await matches(), 1);
    await client.query("UPDATE library_works SET archived_at=now() WHERE id=$1", [movie]);
    assert.equal(await matches(), 1, "archive does not alter common membership");
    await client.query("UPDATE library_personal SET status='finished' WHERE member_id=$1", [members[1].id]);
    assert.equal(await matches(), 0);
    await client.query("UPDATE members SET archived_at=now() WHERE id=$1", [members[1].id]);
    assert.equal(await matches(), 1);
    await client.query("UPDATE members SET archived_at=NULL WHERE id=$1", [members[1].id]);
    assert.equal(await matches(), 0);
    await client.query("UPDATE members SET archived_at=now() WHERE family_id=$1", [family]);
    assert.equal(await matches(), 0, "zero active members must not match");
    await client.query("UPDATE members SET archived_at=NULL WHERE id=$1", [members[0].id]);
    assert.equal(await matches(), 1, "one active pending member matches");
    await client.query("UPDATE members SET archived_at=NULL WHERE family_id=$1", [family]);
    await client.query("UPDATE library_personal SET status='pending' WHERE family_id=$1", [family]);
    await client.query("INSERT INTO library_works(family_id,title,titulo_normalizado,kind,created_by_member_id,updated_by_member_id) SELECT $1,'Stress '||n,'stress '||n,'movie',$2,$2 FROM generate_series(1,10000) n", [family, members[0].id]);
    await client.query("INSERT INTO library_personal(family_id,work_id,member_id,status,rating) SELECT $1,w.id,m.id,'pending',3 FROM library_works w JOIN members m ON m.family_id=w.family_id WHERE w.family_id=$1 ON CONFLICT DO NOTHING", [family]);
    const other = (await client.query("INSERT INTO families(name) VALUES('other-stress') RETURNING id")).rows[0].id;
    const otherMember = (await client.query("INSERT INTO members(family_id,name) VALUES($1,'Other') RETURNING id", [other])).rows[0].id;
    await client.query("INSERT INTO library_works(family_id,title,titulo_normalizado,kind,created_by_member_id,updated_by_member_id) SELECT $1,'Other '||n,'other '||n,'movie',$2,$2 FROM generate_series(1,1000) n", [other, otherMember]);
    for (const table of ["library_works", "library_personal", "members"]) await client.query(`ANALYZE ${table}`);
    const activity = "greatest(w.created_at,coalesce((SELECT max(c.created_at) FROM library_contributions c WHERE c.work_id=w.id),w.created_at))";
    const query = `SELECT w.id,${activity} AS activity FROM library_works w WHERE w.family_id=$1 AND w.archived_at IS NULL AND ${commonPendingSql}`;
    const first = (await client.query(`${query} ORDER BY ${activity} DESC,w.id DESC LIMIT 50`, [family])).rows;
    const last = first.at(-1);
    for (const [label, sql, args] of [["first", query, [family]], ["next", `${query} AND (${activity},w.id)<($2::timestamptz,$3::uuid)`, [family, last.activity, last.id]]]) {
      const result = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql} ORDER BY ${activity} DESC,w.id DESC LIMIT 50`, args)).rows[0]["QUERY PLAN"][0];
      function check(node) {
        assert.ok(!(node["Relation Name"] === "library_personal" && node["Node Type"] === "Seq Scan" && node["Actual Loops"] > 1), "no repeated full personal scan per work");
        for (const child of node.Plans ?? []) check(child);
      }
      check(result.Plan);
      t.diagnostic(`${label}: ${result["Execution Time"]} ms; ${result.Plan["Shared Hit Blocks"]} buffer hits`);
    }
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
});
