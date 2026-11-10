import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
test("Cine con Cami migration preserves data, defaults false and aborts atomically on locks", { skip: !connectionString && "requires isolated PostgreSQL", timeout: 120000 }, async () => {
  const admin = new pg.Pool({ connectionString });
  const database = `cami_${randomUUID().replaceAll("-", "")}`;
  const folder = await mkdtemp(join(tmpdir(), "cami-migration-"));
  let pool;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(connectionString); url.pathname = `/${database}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const index = journal.entries.findIndex(entry => entry.tag.endsWith("_cine_con_cami"));
    assert.ok(index > 0);
    await mkdir(join(folder,"meta"));
    await writeFile(join(folder,"meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0,index) }));
    for (const entry of journal.entries.slice(0,index)) await writeFile(join(folder,`${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const family = (await pool.query("INSERT INTO families(name) VALUES('cami-test') RETURNING id")).rows[0].id;
    const member = (await pool.query("INSERT INTO members(family_id,name) VALUES($1,'Test') RETURNING id",[family])).rows[0].id;
    const work = (await pool.query("INSERT INTO library_works(family_id,title,titulo_normalizado,kind,genres,created_by_member_id,updated_by_member_id) VALUES($1,'Sentinel','sentinel','movie',ARRAY['drama'],$2,$2) RETURNING id",[family,member])).rows[0].id;
    await pool.query("INSERT INTO library_personal(family_id,work_id,member_id,status,rating) VALUES($1,$2,$3,'finished',5)",[family,work,member]);
    await pool.query("INSERT INTO library_contributions(family_id,work_id,author_member_id,body) VALUES($1,$2,$3,'Preserved')",[family,work,member]);
    const snapshot = async () => (await pool.query("SELECT row_to_json(w) AS work,(SELECT json_agg(p) FROM library_personal p WHERE p.work_id=w.id) AS personal,(SELECT json_agg(c) FROM library_contributions c WHERE c.work_id=w.id) AS contributions FROM library_works w WHERE w.id=$1",[work])).rows[0];
    const history = async () => (await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    const before = await snapshot(), historyBefore = await history();
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT * FROM library_works");
      await assert.rejects(migrate(drizzle(pool),{ migrationsFolder:"drizzle" }), error => error.cause?.code === "55P03");
      assert.deepEqual(await snapshot(),before); assert.deepEqual(await history(),historyBefore);

    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    await migrate(drizzle(pool), { migrationsFolder:"drizzle" });
    assert.deepEqual(await snapshot(),{ ...before,work:{ ...before.work,cine_with_cami:false } });
    assert.equal((await history()).length,journal.entries.length);
    await pool.query("UPDATE library_works SET cine_with_cami=true WHERE id=$1",[work]);
    assert.equal((await snapshot()).work.cine_with_cami,true);
    await assert.rejects(pool.query("UPDATE library_works SET cine_with_cami=NULL WHERE id=$1",[work]),{code:"23502"});
    await migrate(drizzle(pool),{ migrationsFolder:"drizzle" });
    assert.equal((await history()).length,journal.entries.length);
  } finally {
    await pool?.end(); await admin.query(`DROP DATABASE IF EXISTS "${database}"`); await admin.end(); await rm(folder,{recursive:true,force:true});
  }
});
