import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString)
  throw Error("FAMILY_UTILS_TEST_DATABASE_URL required");
test(
  "additive availability migration seeds pending per-family catalogs and preserves existing movies",
  {
    skip: !connectionString && "isolated PostgreSQL required",
    timeout: 120000,
  },
  async () => {
    const admin = new pg.Pool({ connectionString });
    const db = `availability_migration_${randomUUID().replaceAll("-", "")}`;
    const folder = await mkdtemp(join(tmpdir(), "availability-migration-"));
    let pool;
    try {
      await admin.query(`CREATE DATABASE "${db}"`);
      const url = new URL(connectionString);
      url.pathname = `/${db}`;
      pool = new pg.Pool({ connectionString: url.toString() });
      const journal = JSON.parse(
        await readFile("drizzle/meta/_journal.json", "utf8"),
      );
      const old = journal.entries.slice(0, -1);
      await mkdir(join(folder, "meta"));
      await writeFile(
        join(folder, "meta/_journal.json"),
        JSON.stringify({ ...journal, entries: old }),
      );
      for (const e of old)
        await writeFile(
          join(folder, `${e.tag}.sql`),
          await readFile(`drizzle/${e.tag}.sql`),
        );
      await migrate(drizzle(pool), { migrationsFolder: folder });
      const f = (
          await pool.query(
            "INSERT INTO families(name) VALUES('availability-migration') RETURNING id",
          )
        ).rows[0].id,
        m = (
          await pool.query(
            "INSERT INTO members(family_id,name) VALUES($1,'Sentinel') RETURNING id",
            [f],
          )
        ).rows[0].id;
      const w = (
        await pool.query(
          "INSERT INTO library_works(family_id,title,titulo_normalizado,kind,runtime_minutes,\"cast\",synopsis,created_by_member_id,updated_by_member_id) VALUES($1,'Sentinel','sentinel','movie',100,ARRAY['Actor'],'Original synopsis',$2,$2) RETURNING id",
          [f, m],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO library_personal(family_id,work_id,member_id,status,rating) VALUES($1,$2,$3,'finished',5)",
        [f, w, m],
      );
      const before = (
        await pool.query(
          "SELECT to_jsonb(w) AS work,(SELECT jsonb_agg(to_jsonb(p)) FROM library_personal p WHERE p.work_id=w.id) AS personal FROM library_works w WHERE id=$1",
          [w],
        )
      ).rows;
      await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
      assert.deepEqual(
        (
          await pool.query(
            "SELECT to_jsonb(w) AS work,(SELECT jsonb_agg(to_jsonb(p)) FROM library_personal p WHERE p.work_id=w.id) AS personal FROM library_works w WHERE id=$1",
            [w],
          )
        ).rows,
        before,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM streaming_platforms WHERE family_id=$1 AND coverage='pending'",
            [f],
          )
        ).rows[0].n,
        12,
      );
      const youtube = (
        await pool.query(
          "SELECT id FROM streaming_platforms WHERE family_id=$1 AND requires_channel",
          [f],
        )
      ).rows[0].id;
      const c = (
        await pool.query(
          "INSERT INTO library_platform_checks(family_id,work_id,platform_id,checked_on,source_urls,updated_by_member_id) VALUES($1,$2,$3,'2026-01-01',ARRAY['https://example.org'],$4) RETURNING id",
          [f, w, youtube, m],
        )
      ).rows[0].id;
      await assert.rejects(
        pool.query(
          "INSERT INTO library_streaming_offers(family_id,check_id,mode,source_urls,link_kind) VALUES($1,$2,'free',ARRAY['https://example.org'],'none')",
          [f, c],
        ),
        { code: "23514" },
      );
      await assert.rejects(
        pool.query(
          "UPDATE library_platform_checks SET source_urls=ARRAY['javascript:alert(1)'] WHERE id=$1",
          [c],
        ),
        { code: "23514" },
      );
      assert.equal(
        (
          await pool.query(
            "SELECT availability_channel_valid($1::jsonb) AS valid",
            [JSON.stringify({ name: "Missing urls" })],
          )
        ).rows[0].valid,
        false,
      );
    } catch (e) {
      throw e;
    } finally {
      await pool?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH(FORCE)`);
      await admin.end();
      await rm(folder, { recursive: true, force: true });
    }
  },
);
