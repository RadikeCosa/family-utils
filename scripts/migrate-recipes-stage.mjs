import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
const stages = { base: "0056_recipes_base", normalization: "0057_recipe_name_normalization", shopping: "0059_recipe_family_integrity" };
const tag = stages[process.argv[2]];
if (!tag || !process.env.DATABASE_URL_UNPOOLED) throw new Error("Usage: DATABASE_URL_UNPOOLED=<verified direct target> node scripts/migrate-recipes-stage.mjs base|normalization|shopping. No .env file is loaded.");
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
const entries = journal.entries.slice(0, journal.entries.findIndex(e => e.tag === tag) + 1);
const folder = await mkdtemp(join(tmpdir(), "family-recipes-stage-"));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1, connectionTimeoutMillis: 15_000, options: "-c lock_timeout=5000 -c statement_timeout=120000" });
try {
  await mkdir(join(folder, "meta")); await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) await writeFile(join(folder, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
  await migrate(drizzle(pool), { migrationsFolder: folder }); console.log(`Applied through ${tag}.`);
} finally { await pool.end(); await rm(folder, { recursive: true, force: true }); }
