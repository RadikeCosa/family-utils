// Adopt ONLY the already-present 0055 state. Never rerun its data backfill.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import pg from "pg";
export async function reconcileMealCatalog(pool, { apply = false } = {}) {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  const index = journal.entries.findIndex(e => e.tag === "0055_meal_catalog");
  if (index < 0) throw new Error("Catalog migration missing from journal");
  const expected = journal.entries.map(e => ({ timestamp: String(e.when), hash: createHash("sha256").update(readFileSync(`drizzle/${e.tag}.sql`)).digest("hex") }));
  const source = readFileSync("drizzle/0055_meal_catalog.sql", "utf8");
  const expression = source.match(/UPDATE meal_ideas i SET normalized_title = ([^;]+);/)?.[1];
  if (!expression) throw new Error("Catalog canonical expression missing");
  const client = await pool.connect();
  try {
    await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='30s'");
    if (apply) {
      await client.query("LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE");
      await client.query("LOCK TABLE meal_slots,meal_ideas,meal_suggestions,meal_daily_plans,meal_groups,meal_selections IN SHARE MODE");
    }
    const history = (await client.query("SELECT hash,created_at::text AS timestamp FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows;
    if (history.length > expected.length || history.some((r, i) => r.hash !== expected[i].hash || r.timestamp !== expected[i].timestamp)) throw new Error("Migration history is not an exact known prefix");
    if (history.length > index) { await client.query("ROLLBACK"); return { alreadyRecorded: true, changed: false }; }
    if (history.length !== index) throw new Error("An earlier migration is missing; refusing adoption");
    const columns = (await client.query("SELECT column_name,data_type,character_maximum_length,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='meal_ideas' AND column_name=ANY($1::text[])", [["normalized_title", "merged_into_id", "last_used_at"]])).rows;
    const normalized = columns.find(c => c.column_name === "normalized_title"), merged = columns.find(c => c.column_name === "merged_into_id"), used = columns.find(c => c.column_name === "last_used_at");
    if (columns.length !== 3 || normalized.data_type !== "character varying" || normalized.character_maximum_length !== 160 || normalized.is_nullable !== "NO" || normalized.column_default !== "''::character varying" || merged.data_type !== "uuid" || merged.is_nullable !== "YES" || merged.column_default !== null || used.data_type !== "timestamp with time zone" || used.is_nullable !== "YES" || used.column_default !== null) throw new Error("Catalog columns do not match 0055");
    const indexes = (await client.query("SELECT c.relname,i.indisvalid,i.indisready,i.indisunique,pg_get_expr(i.indpred,i.indrelid) AS predicate,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='meal_ideas'::regclass AND c.relname=ANY($1::text[])", [["meal_ideas_catalog_order_idx", "meal_ideas_merged_idx"]])).rows;
    for (const [name, keys] of [["meal_ideas_catalog_order_idx", "(family_id, last_used_at)"], ["meal_ideas_merged_idx", "(merged_into_id)"]]) {
      const row = indexes.find(i => i.relname === name);
      if (!row || !row.indisvalid || !row.indisready || row.indisunique || row.predicate !== null || !row.definition.includes(`USING btree ${keys}`)) throw new Error("Catalog indexes do not match 0055");
    }
    const checks = {};
    checks.invalidNames = (await client.query(`SELECT count(*)::int AS count FROM meal_ideas i WHERE normalized_title IS DISTINCT FROM ${expression}`)).rows[0].count;
    checks.mergedRows = (await client.query("SELECT count(*)::int AS count FROM meal_ideas WHERE merged_into_id IS NOT NULL")).rows[0].count;
    checks.duplicateNames = (await client.query("SELECT count(*)::int AS count FROM (SELECT 1 FROM meal_ideas GROUP BY family_id,normalized_title HAVING count(*)>1) d")).rows[0].count;
    checks.invalidLinks = (await client.query(`SELECT count(*)::int AS count FROM meal_suggestions s JOIN meal_slots sl ON sl.id=s.slot_id LEFT JOIN meal_ideas i ON i.id=s.catalog_idea_id
      WHERE (s.withdrawn_at IS NULL OR EXISTS(SELECT 1 FROM meal_selections ms WHERE ms.suggestion_id=s.id) OR EXISTS(SELECT 1 FROM meal_groups mg WHERE mg.suggestion_id=s.id) OR EXISTS(SELECT 1 FROM meal_daily_plans dp,jsonb_array_elements(dp.plan->'menus') m WHERE m->'selection'->>'suggestionId'=s.id::text))
      AND (i.id IS NULL OR i.family_id<>sl.family_id OR i.merged_into_id IS NOT NULL)`)).rows[0].count;
    checks.invalidLastUse = (await client.query(`SELECT count(*)::int AS count FROM meal_ideas i JOIN (
      SELECT s.catalog_idea_id,max(s.created_at) AS last_used FROM meal_suggestions s
      WHERE s.catalog_idea_id IS NOT NULL AND (EXISTS(SELECT 1 FROM meal_selections ms WHERE ms.suggestion_id=s.id) OR EXISTS(SELECT 1 FROM meal_groups mg WHERE mg.suggestion_id=s.id) OR EXISTS(SELECT 1 FROM meal_daily_plans dp,jsonb_array_elements(dp.plan->'menus') m WHERE m->'selection'->>'suggestionId'=s.id::text)) GROUP BY s.catalog_idea_id
      ) usage ON usage.catalog_idea_id=i.id WHERE i.last_used_at IS NULL OR i.last_used_at<usage.last_used`)).rows[0].count;
    if (Object.values(checks).some(Boolean)) throw new Error(`Catalog state is not fully adoptable: ${JSON.stringify(checks)}`);
    if (apply) { await client.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)", [expected[index].hash, expected[index].timestamp]); await client.query("COMMIT"); }
    else await client.query("ROLLBACK");
    return { alreadyRecorded: false, changed: apply, verifiedEquivalentState: true, checks, tag: "0055_meal_catalog", ...expected[index] };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL_UNPOOLED || process.argv.slice(2).some(a => a !== "--apply")) throw new Error("Supply verified DATABASE_URL_UNPOOLED explicitly. Default check only; --apply appends the guarded baseline record.");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  try { console.log(JSON.stringify(await reconcileMealCatalog(pool, { apply: process.argv.includes("--apply") }))); }
  finally { await pool.end(); }
}
