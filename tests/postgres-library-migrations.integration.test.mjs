import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
test("library migration upgrades existing data and exactly records timestamp and hash", { skip: !connectionString && "requires isolated PostgreSQL" }, async () => {
  const admin = new pg.Pool({ connectionString });
  const name = `library_upgrade_${randomUUID().replaceAll("-", "")}`;
  const temporary = await mkdtemp(join(tmpdir(), "library-migrations-"));
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  const libraryIndex = journal.entries.findIndex((entry) => entry.tag.endsWith("_family_library"));
  assert.ok(libraryIndex >= 0);
  let pool;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(connectionString); url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    await mkdir(join(temporary, "meta"));
    const preceding = { ...journal, entries: journal.entries.slice(0, libraryIndex) };
    await writeFile(join(temporary, "meta/_journal.json"), JSON.stringify(preceding));
    for (const entry of preceding.entries) await writeFile(join(temporary, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: temporary });
    const { rows: [family] } = await pool.query("INSERT INTO families(name) VALUES('pre-library sentinel') RETURNING id");
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    assert.equal((await pool.query("SELECT name FROM families WHERE id=$1", [family.id])).rows[0].name, "pre-library sentinel");
    const entry = journal.entries[libraryIndex];
    const hash = createHash("sha256").update(await readFile(`drizzle/${entry.tag}.sql`)).digest("hex");
    const { rows: [applied] } = await pool.query("SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at=$1", [entry.when]);
    assert.equal(applied.hash, hash);
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    assert.equal(Number((await pool.query("SELECT count(*) FROM drizzle.__drizzle_migrations")).rows[0].count), journal.entries.length);
    assert.equal((await pool.query("SELECT library_revision FROM families WHERE id=$1", [family.id])).rows[0].library_revision, "0");
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
    await rm(temporary, { recursive: true, force: true });
  }
});
