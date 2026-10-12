import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";
const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
let previous = -1;
const expected = journal.entries.map((entry, index) => {
  if (entry.idx !== index || !Number.isSafeInteger(entry.when) || entry.when <= previous) throw new Error("Migration journal must have consecutive indices and strictly increasing timestamps");
  previous = entry.when;
  return { timestamp: String(entry.when), hash: createHash("sha256").update(readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url))).digest("hex") };
});
if (process.argv.includes("--applied")) {
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED required to verify applied migrations");
  const pool = new pg.Pool({ connectionString });
  try {
    const { rows } = await pool.query("SELECT hash, created_at::text AS timestamp FROM drizzle.__drizzle_migrations ORDER BY created_at, id");
    if (JSON.stringify(rows) !== JSON.stringify(expected.map(({ hash, timestamp }) => ({ hash, timestamp })))) throw new Error("Applied migration history does not exactly match journal timestamps and SQL hashes");
    console.log(`Verified ${rows.length} applied migrations and hashes`);
  } finally { await pool.end(); }
} else console.log(`Verified ${expected.length} ordered migrations`);
