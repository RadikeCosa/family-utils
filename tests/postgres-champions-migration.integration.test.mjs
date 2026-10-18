import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { championsFixture } from "./helpers/champions.ts";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("Isolated PostgreSQL required");
test("journal preserves production migrations and orders the Champions toggle removal", async () => {
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  assert.ok(journal.entries.length >= 41);
  assert.equal(journal.entries[40].tag, "0050_sports_river_lineups");
  assert.deepEqual(
    journal.entries.slice(27, 38).map(entry => entry.tag),
    ["0037_ufc_card_closure", "0038_sports_champions_identity", "0039_sports_football_predictions", "0040_sports_football_function_access", "0041_sports_function_defaults", "0042_sports_champions_results", "0043_sports_champions_round_comments", "0044_sports_champions_switch", "0045_champions_suspended_resolution", "0046_champions_result_corrections", "0047_champions_managed_grants"],
  );
  assert.equal(journal.entries[38].tag, "0048_sports_ufc_odds");
  assert.equal(journal.entries[39].tag, "0049_champions_always_available");
  assert.equal(journal.entries[27].when, 1792046402706);
  assert.ok(journal.entries.slice(28).every(entry => entry.when > 1792046402706));
  for (let i = 0; i < journal.entries.length; i++) {
    assert.equal(journal.entries[i].idx, i);
    if (i) assert.ok(journal.entries[i].when > journal.entries[i - 1].when);
  }
});
test("permissions check reports pg_trgm separately and rejects an exposed application function", { skip: !connectionString && "requires isolated PostgreSQL", timeout: 30_000 }, async () => {
  const pool = new pg.Pool({ connectionString });
  const extensionWasInstalled = Boolean((await pool.query("SELECT 1 FROM pg_extension WHERE extname='pg_trgm'")).rowCount);
  const runCheck = () => spawnSync("psql", [connectionString, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "sources/champions/permisos-check.sql"], { encoding: "utf8" });
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public");
    const extensionCheck = runCheck();
    assert.equal(extensionCheck.status, 0, extensionCheck.stderr);
    assert.match(extensionCheck.stdout, /extension\|pg_trgm\|[^|]+\|public\.similarity\(/, "extension functions must be reported with their owner");
    assert.match(extensionCheck.stdout, /informational; excluded from application permission failure/);

    await pool.query("CREATE OR REPLACE FUNCTION public.champions_permission_failure_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1'");
    await pool.query("GRANT EXECUTE ON FUNCTION public.champions_permission_failure_probe() TO PUBLIC");
    const failingCheck = runCheck();
    assert.notEqual(failingCheck.status, 0, "an exposed non-extension function must fail the script");
    assert.match(`${failingCheck.stdout}\n${failingCheck.stderr}`, /Permiso EXECUTE inesperado en función no perteneciente a extensión public\.champions_permission_failure_probe\(\)/);
  } finally {
    await pool.query("DROP FUNCTION IF EXISTS public.champions_permission_failure_probe()");
    if (!extensionWasInstalled) await pool.query("DROP EXTENSION IF EXISTS pg_trgm CASCADE");
    await pool.end();
  }
});
test("Champions migration preserves legacy data, defaults and family-scoped identities", { skip: !connectionString && "requires isolated PostgreSQL" }, async () => {
  const admin = new pg.Pool({ connectionString });
  const name = `champions_upgrade_${randomUUID().replaceAll("-", "")}`;
  const folder = await mkdtemp(join(tmpdir(), "champions-upgrade-"));
  const managedRolesCreated = [];
  let pool;
  try {
    for (const role of ["anon", "authenticated"]) {
      if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount) {
        await admin.query(`CREATE ROLE ${role} NOLOGIN`);
        managedRolesCreated.push(role);
      }
    }
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(connectionString); url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const index = journal.entries.findIndex(e => e.tag === "0038_sports_champions_identity");
    assert.ok(index > 0);
    await mkdir(join(folder, "meta"));
    const previous = { ...journal, entries: journal.entries.slice(0, index) };
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(previous));
    for (const entry of previous.entries) await writeFile(join(folder, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const family = (await pool.query("INSERT INTO families(name) VALUES('Legacy sports') RETURNING id")).rows[0].id;
    const member = (await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,'Administrator','administrator') RETURNING id", [family])).rows[0].id;
    const footballSql = "INSERT INTO sports_events(family_id,kind,title,competition,first_participant,second_participant,event_date,source_provider,external_reference,created_by_member_id,updated_by_member_id) VALUES($1,'football_match','River vs Boca','Liga','River Plate','Boca','2026-10-20','espn',$3,$2,$2) RETURNING id";
    const river = (await pool.query(footballSql, [family, member, "12345"])).rows[0].id;
    const ufcSql = "INSERT INTO sports_events(family_id,kind,title,event_date,main_card_starts_at,created_by_member_id,updated_by_member_id) VALUES($1,'ufc_card','UFC sentinel','2026-10-24',clock_timestamp()+interval '1 hour',$2,$2) RETURNING id";
    const ufc = (await pool.query(ufcSql, [family, member])).rows[0].id;
    const fight = (await pool.query("INSERT INTO sports_fights(family_id,event_id,bout_order,first_fighter,second_fighter,bout_block,is_main_event) VALUES($1,$2,1,'A','B','main',true) RETURNING id,first_fighter_id", [family, ufc])).rows[0];
    await pool.query("INSERT INTO sports_predictions(family_id,event_id,fight_id,member_id,winner_id) VALUES($1,$2,$3,$4,$5)", [family, ufc, fight.id, member, fight.first_fighter_id]);
    await pool.query("INSERT INTO sports_formations(family_id,event_id,member_id,body) VALUES($1,$2,$3,'4-3-3')", [family, river, member]);
    await pool.query("INSERT INTO sports_comments(family_id,author_member_id,context_kind,context_event_id,context_date,body) VALUES($1,$2,'river_match',$3,'2026-10-20','Keep this thread')", [family, member, river]);
    const legacyEvents = (await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e ORDER BY id")).rows;
    const tables = ["sports_fights", "sports_predictions", "sports_formations", "sports_comments"];
    const before = {};
    for (const table of tables) {
      const projection = table === "sports_fights" ? "to_jsonb(t)-'prode_eligible'" : "to_jsonb(t)";
      before[table] = (await pool.query(`SELECT ${projection} AS record FROM ${table} t`)).rows;
    }
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    const executableFunctions = await pool.query(`
      SELECT p.oid::regprocedure::text AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'sports\\_%' ESCAPE '\\'
        AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
          OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a
                     WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
      ORDER BY 1`);
    assert.deepEqual(executableFunctions.rows, []);
    const directlyReadableTables = await pool.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND (c.relname LIKE 'sports\\_football\\_%' ESCAPE '\\' OR c.relname='sports_champions_switches')
        AND (has_table_privilege('anon',c.oid,'SELECT') OR has_table_privilege('authenticated',c.oid,'SELECT')
          OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
                     WHERE a.grantee=0 AND a.privilege_type='SELECT'))
      ORDER BY 1`);
    assert.deepEqual(directlyReadableTables.rows, []);
    assert.equal((await pool.query("SELECT enabled FROM sports_champions_switches WHERE family_id=$1", [family])).rows[0].enabled, false);
    for (const row of legacyEvents) {
      const updated = (await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE id=$1", [row.record.id])).rows[0].record;
      for (const [key, value] of Object.entries(row.record)) assert.deepEqual(updated[key], value, key);
      assert.equal(updated.football_category, row.record.kind === "football_match" ? "river" : null);
    }
    for (const table of tables) {
      const expression = table === "sports_fights" ? "to_jsonb(t)-'prode_eligible'" : "to_jsonb(t)";
      assert.deepEqual((await pool.query(`SELECT ${expression} AS record FROM ${table} t`)).rows, before[table], table);
    }
    assert.equal((await pool.query("SELECT prode_eligible FROM sports_fights WHERE id=$1", [fight.id])).rows[0].prode_eligible, true);
    assert.equal((await pool.query(footballSql, [family, member, "12346"])).rowCount, 1);
    const newUfc = (await pool.query(ufcSql, [family, member])).rows[0].id;
    assert.equal((await pool.query("SELECT football_category FROM sports_events WHERE id=$1", [newUfc])).rows[0].football_category, null);
    await assert.rejects(pool.query("UPDATE sports_events SET status='suspended' WHERE id=$1", [newUfc]), { code: "23514" });
    await assert.rejects(pool.query("UPDATE sports_events SET status='suspended' WHERE id=$1", [river]), { code: "23514" });
    const source = (await pool.query("SELECT external_id FROM sports_football_event_sources WHERE event_id=$1", [river])).rows[0];
    assert.equal(source.external_id, "12345");
    await pool.query("UPDATE sports_events SET external_reference='12347' WHERE id=$1", [river]);
    assert.equal((await pool.query("SELECT external_id FROM sports_football_event_sources WHERE event_id=$1", [river])).rows[0].external_id, "12347");
    const champions = await championsFixture(pool, family, member);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM sports_events WHERE family_id=$1 AND football_category='champions'", [family])).rows[0].n, 1);
    for (const provider of ["uefa", "espn"]) await pool.query("INSERT INTO sports_football_team_sources(family_id,team_id,provider,external_id) VALUES($1,$2,$3,$4)", [family, champions.teams[0], provider, `team-${provider}`]);
    await pool.query("INSERT INTO sports_football_event_sources(family_id,event_id,provider,external_id) VALUES($1,$2,'uefa','match-uefa')", [family, champions.event]);
    // Compatibility exception: legacy UFC inserts normalize only their own category.
    const beforeUfcInsert = (await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE id=ANY($1::uuid[]) ORDER BY id", [[river, champions.event]])).rows;
    await pool.query(ufcSql, [family, member]);
    assert.deepEqual((await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE id=ANY($1::uuid[]) ORDER BY id", [[river, champions.event]])).rows, beforeUfcInsert);
    assert.equal((await pool.query("SELECT football_category FROM sports_events WHERE id=$1", [river])).rows[0].football_category, "river");
    assert.equal((await pool.query("SELECT football_category FROM sports_events WHERE id=$1", [champions.event])).rows[0].football_category, "champions");
    const foreignFamily = (await pool.query("INSERT INTO families(name) VALUES('Other family') RETURNING id")).rows[0].id;
    assert.equal((await pool.query("SELECT enabled FROM sports_champions_switches WHERE family_id=$1", [foreignFamily])).rows[0].enabled, false);
    await assert.rejects(pool.query("INSERT INTO sports_football_team_sources(family_id,team_id,provider,external_id) VALUES($1,$2,'uefa','x')", [foreignFamily, champions.teams[0]]), { code: "23503" });
    await assert.rejects(pool.query("INSERT INTO sports_football_event_sources(family_id,event_id,provider,external_id) VALUES($1,$2,'uefa','x')", [foreignFamily, champions.event]), { code: "23503" });
    await assert.rejects(pool.query("INSERT INTO sports_football_rounds(family_id,season_id,reference,name,original_from,original_through) VALUES($1,$2,'x','x','2026-10-20','2026-10-21')", [foreignFamily, champions.season]), { code: "23503" });
    await assert.rejects(pool.query("UPDATE sports_events SET season_id=NULL WHERE id=$1", [champions.event]), { code: "23514" });
    await assert.rejects(pool.query("UPDATE sports_events SET second_team_id=first_team_id WHERE id=$1", [champions.event]), { code: "23514" });
    await assert.rejects(pool.query("UPDATE sports_events SET football_category=NULL WHERE id=$1", [river]), { code: "23514" });
    await assert.rejects(pool.query("INSERT INTO sports_football_team_sources(family_id,team_id,provider,external_id) VALUES($1,$2,'uefa','different')", [family, champions.teams[0]]), { code: "23505" });
    const season2 = (await pool.query("INSERT INTO sports_football_seasons(family_id,competition,name) VALUES($1,'champions','2027/28') RETURNING id", [family])).rows[0].id;
    await assert.rejects(pool.query("UPDATE sports_events SET season_id=$1 WHERE id=$2", [season2, champions.event]), { code: "23503" });
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n, journal.entries.length);
    const entry = journal.entries[index];
    const hash = createHash("sha256").update(await readFile(`drizzle/${entry.tag}.sql`)).digest("hex");
    assert.equal((await pool.query("SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at=$1", [entry.when])).rows[0].hash, hash);
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    for (const role of managedRolesCreated.reverse()) await admin.query(`DROP ROLE ${role}`);
    await admin.end();
    await rm(folder, { recursive: true, force: true });
  }
});
