import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { championsFixture, championsCleanupTables, championsIdentityTables } from "./helpers/champions.ts";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("Isolated PostgreSQL required");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const origin = "http://localhost:3348";

test("football predictions: PostgreSQL authority with real member and administrator sessions", { skip: !connectionString && "requires isolated PostgreSQL", timeout: 120_000 }, async t => {
  // Privileged connection is ONLY for fixture creation, deterministic schedule changes,
  // permission setup and storage assertions. Every privacy read uses limited + real token,
  // or HTTP with the actual administrator/member cookie. No service-key privacy tests.
  const setup = new pg.Pool({ connectionString });
  const role = `football_client_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID();
  const families = [], users = [];
  let limited, server;
  let createdAnon = false;
  const serverLogs = [];
  async function family() {
    const id = (await setup.query("INSERT INTO families(name) VALUES($1) RETURNING id", [`football-${randomUUID()}`])).rows[0].id;
    families.push(id); return id;
  }
  async function identity(familyId, role = "member") {
    const prepared = await fetch(`${origin}/api/access/prepare`, { method: "POST", headers: { Origin: origin, "x-forwarded-for": `198.51.100.${users.length + 10}` } });
    assert.equal(prepared.status, 200);
    const cookie = prepared.headers.getSetCookie().map(x => x.split(";", 1)[0]).join("; ");
    const session = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: cookie } }).then(x => x.json());
    assert.equal(typeof session.session.token, "string");
    users.push(session.user.id);
    const member = (await setup.query("INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id", [familyId, `Player ${users.length}`, role])).rows[0].id;
    await setup.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [member, session.user.id]);
    return { id: member, cookie, token: session.session.token, userId: session.user.id };
  }
  async function http(person, event, method = "GET", body) {
    const response = await fetch(`${origin}/api/sports/champions/events/${event}/predictions`, { method, headers: { Origin: origin, Cookie: person?.cookie ?? "", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, data: await response.json() };
  }
  async function sql(person, event, action = "read", choice = null) {
    return (await limited.query("SELECT public.sports_football_predictions_api($1,$2,$3,$4) AS response", [person.token, event, action, choice])).rows[0].response;
  }
  let base, familyId, admin, member, outsider;
  async function event(time = "clock_timestamp()+interval '2 hours'") {
    return (await setup.query(`INSERT INTO sports_events(family_id,kind,football_category,season_id,round_id,first_team_id,second_team_id,title,competition,first_participant,second_participant,event_date,starts_at,created_by_member_id,updated_by_member_id)
      SELECT family_id,kind,football_category,season_id,round_id,first_team_id,second_team_id,'Football prediction fixture',competition,first_participant,second_participant,event_date,${time},created_by_member_id,updated_by_member_id
      FROM sports_events WHERE id=$1 RETURNING id`, [base.event])).rows[0].id;
  }
  try {
    await setup.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await setup.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await setup.query(`GRANT EXECUTE ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) TO "${role}"`);
    if (!(await setup.query("SELECT 1 FROM pg_roles WHERE rolname='anon'")).rowCount) {
      await setup.query("CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS"); createdAnon = true;
    }
    const url = new URL(connectionString); url.username = role; url.password = password;
    limited = new pg.Pool({ connectionString: url.toString() });
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3348"], { env: { ...process.env, NODE_ENV: "production", DATABASE_URL: connectionString, SPORTS_ENABLED: "true", SPORTS_AGENDA_ENABLED: "true", SPORTS_CHAMPIONS_ENABLED: "true", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "football-only-test-secret-at-least-32-characters", CODE_PEPPER: "football-only-test-pepper-at-least-32-characters", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", chunk => serverLogs.push(chunk.toString()));
    server.stderr.on("data", chunk => serverLogs.push(chunk.toString()));
    for (let i = 0; ; i++) {
      if (server.exitCode !== null) throw new Error("Football test server failed");
      try { if ((await fetch(origin)).ok) break; } catch { /* Await server. */ }
      if (i > 100) throw new Error("Football server startup timeout");
      await pause(100);
    }
    familyId = await family();
    admin = await identity(familyId, "administrator"); member = await identity(familyId);
    outsider = await identity(await family(), "administrator");
    base = await championsFixture(setup, familyId, admin.id);

    await t.test("real administrator has no raw table or helper bypass", async () => {
      const roleFlags = (await limited.query("SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
      assert.deepEqual(roleFlags, { rolsuper: false, rolbypassrls: false, rolcreaterole: false });
      assert.equal((await setup.query("SELECT role FROM members WHERE id=$1", [admin.id])).rows[0].role, "administrator");
      for (const table of ["sports_football_predictions", "sports_football_closures", "session", "audit_events"])
        await assert.rejects(limited.query(`SELECT * FROM ${table}`), { code: "42501" });
      await assert.rejects(limited.query("SELECT public.sports_football_materialize_close($1,$2,now(),'scheduled')", [familyId, base.event]), { code: "42501" });
      await assert.rejects(limited.query("SELECT public.sports_football_choice_view(e,$2) FROM sports_events e WHERE id=$1", [base.event, member.token]), { code: "42501" });
      const permissions = (await limited.query("SELECT has_function_privilege(current_user,'public.sports_football_choice_view(public.sports_events,text)','EXECUTE') AS helper,has_function_privilege(current_user,'public.sports_football_predictions_api(text,uuid,text,text)','EXECUTE') AS api")).rows[0];
      assert.deepEqual(permissions, { helper: false, api: true });
      assert.equal((await sql(admin, base.event)).status, 200);
      assert.equal((await http(admin, base.event)).status, 200);
    });

    await t.test("definers pin search_path, accept no user ID and deny PUBLIC and anon", async () => {
      await setup.query("CREATE OR REPLACE FUNCTION public.champions_default_acl_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1'");
      const functions = (await setup.query(`SELECT p.proname,p.proargnames,p.proconfig,p.prosecdef,
        EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
        has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'`)).rows;
      assert.ok(functions.length >= 5);
      for (const fn of functions) {
        if (fn.prosecdef) assert.ok(fn.proconfig.includes('search_path=pg_catalog, public'), fn.proname);
        assert.equal(fn.public_execute, false, fn.proname);
        assert.equal(fn.anon_execute, false, fn.proname);
        if (fn.prosecdef) assert.ok(!(fn.proargnames ?? []).some(name => /^(p_member|p_user|p_actor)/.test(name)), fn.proname);
      }
      await setup.query("DROP FUNCTION public.champions_default_acl_probe()");
      const client = await setup.connect();
      try {
        await client.query('BEGIN'); await client.query('SET LOCAL ROLE anon');
        assert.equal((await client.query('SELECT current_user AS role')).rows[0].role,'anon');
        await assert.rejects(client.query('SELECT public.sports_football_predictions_api($1,$2)',[admin.token,base.event]),{code:'42501'});
      } finally { await client.query('ROLLBACK'); client.release(); }
    });

    await t.test("database response is identical with or without someone else's open pick, even for admin", async () => {
      const id = await event();
      const emptyAdmin = await sql(admin, id), emptyHttp = await http(admin, id);
      assert.equal((await http(member, id, "PUT", { choice: "home" })).status, 200);
      assert.deepEqual(await sql(admin, id), emptyAdmin);
      assert.deepEqual(await http(admin, id), emptyHttp);
      const own = await sql(member, id);
      assert.equal(own.data.ownChoice, "home"); assert.deepEqual(own.data.choices, []);
      const result = await sql(admin, id, "put", "draw");
      assert.equal(result.status, 200); assert.equal(result.data.ownChoice, "draw"); assert.deepEqual(result.data.choices, []);
      assert.deepEqual(Object.keys(result.data).sort(), ["canPredict", "choices", "closed", "closesAt", "eventId", "ownChoice"]);
      assert.deepEqual((await sql(member, id)).data.choices, []);
      assert.equal((await http(admin, id, "PUT", { choice: "away", memberId: member.id })).status, 400);
      const final = (await sql(member, id, "delete")).data;
      assert.equal(final.ownChoice, null); assert.deepEqual(final.choices, []);
      assert.equal((await sql(member, id, "delete")).status, 200);
      await sql(member, id, "put", "away");
      await setup.query("UPDATE sports_events SET starts_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
      for (const person of [member, admin]) {
        const closed = await sql(person, id);
        assert.equal(closed.data.closed, true); assert.equal(closed.data.canPredict, false);
        assert.deepEqual(closed.data.choices.map(x => x.choice).sort(), ["away", "draw"]);
      }
      assert.equal((await sql(admin, id, "put", "home")).status, 409);
      assert.equal((await sql(member, id, "delete")).status, 409);
      const audits = (await setup.query("SELECT actor_member_id,entity_id,action,\"after\" FROM audit_events WHERE entity_type='sports_football_prediction' AND entity_id=$1 ORDER BY created_at,id", [id])).rows;
      assert.ok(audits.length >= 4);
      for (const audit of audits) {
        assert.ok([member.id, admin.id].includes(audit.actor_member_id));
        assert.deepEqual(audit.after, { eventId: id });
        assert.ok(["saved", "changed", "deleted"].includes(audit.action));
      }
      const logs = serverLogs.join("");
      assert.doesNotMatch(logs, /"(?:choice|ownChoice)"\s*:/);
      for (const person of [admin, member, outsider]) assert.equal(logs.includes(person.token), false);
    });

    await t.test("family isolation, missing sessions, invalid inputs and direct table writes", async () => {
      const missing = await sql(outsider, randomUUID());
      assert.deepEqual(await sql(outsider, base.event), missing);
      assert.equal(missing.status, 404);
      assert.equal((await sql({ token: "not-a-session" }, base.event)).status, 403);
      assert.equal((await http(null, base.event)).status, 403);
      assert.equal((await http(outsider, base.event, "PUT", { choice: "home" })).status, 404);
      assert.equal((await sql(admin, base.event, "put", "invalid")).status, 400);
      assert.equal((await sql(admin, base.event, "impersonate", "home")).status, 400);
      await assert.rejects(limited.query("INSERT INTO sports_football_predictions(family_id,event_id,member_id,choice) VALUES($1,$2,$3,'home')", [familyId, base.event, admin.id]), { code: "42501" });
      const river = (await setup.query("INSERT INTO sports_events(family_id,kind,title,competition,first_participant,second_participant,created_by_member_id,updated_by_member_id) VALUES($1,'football_match','River legacy','Liga','River Plate','Boca',$2,$2) RETURNING id", [familyId, admin.id])).rows[0].id;
      assert.equal((await sql(admin, river)).status, 404);
    });

    await t.test("unconfirmed kickoff and postponed state prevent writes without deleting choices", async () => {
      const id = await event("NULL");
      const view = await sql(admin, id); assert.equal(view.data.canPredict, false); assert.equal(view.data.closesAt, null);
      assert.equal((await sql(admin, id, "put", "home")).status, 409);
      await setup.query("UPDATE sports_events SET starts_at=clock_timestamp()+interval '1 day' WHERE id=$1", [id]);
      assert.equal((await sql(member, id, "put", "home")).status, 200);
      await setup.query("UPDATE sports_events SET status='postponed',starts_at=NULL WHERE id=$1", [id]);
      const postponed = await sql(member, id);
      assert.equal(postponed.data.ownChoice, "home"); assert.equal(postponed.data.closed, false); assert.equal(postponed.data.canPredict, false);
      assert.equal((await sql(member, id, "put", "draw")).status, 409);
      await setup.query("UPDATE sports_events SET status='scheduled',starts_at=clock_timestamp()+interval '7 days' WHERE id=$1", [id]);
      assert.equal((await sql(member, id, "put", "draw")).status, 200);
      assert.deepEqual((await sql(admin, id)).data.choices, []);
    });

    await t.test("single PostgreSQL predicate rejects exact equality and accepts only strictly before", async () => {
      const { rows: [row] } = await setup.query(`SELECT
        public.sports_football_choice_open('2026-10-20T18:00Z',NULL,'scheduled','2026-10-20T17:59:59.999999Z') AS before,
        public.sports_football_choice_open('2026-10-20T18:00Z',NULL,'scheduled','2026-10-20T18:00Z') AS exact,
        public.sports_football_choice_open('2026-10-20T18:00Z',NULL,'scheduled','2026-10-20T18:00:00.000001Z') AS after,
        public.sports_football_choice_open(NULL,NULL,'scheduled',clock_timestamp()) AS unknown,
        public.sports_football_choice_open(clock_timestamp()+interval '1 day',clock_timestamp(),'scheduled',clock_timestamp()) AS persisted`);
      assert.deepEqual(row, { before: true, exact: false, after: false, unknown: false, persisted: false });
      // The caller cannot supply a fake clock through the protected public contract.
      await assert.rejects(limited.query("SELECT public.sports_football_choice_open(now(),NULL,'scheduled',now()-interval '1 day')"), { code: "42501" });
    });

    await t.test("lazy read and rejected write persist the intended kickoff, not observation time", async () => {
      for (const action of ["read", "put", "http-put"]) {
        const id = await event("clock_timestamp()-interval '2 minutes'");
        const start = (await setup.query("SELECT starts_at FROM sports_events WHERE id=$1", [id])).rows[0].starts_at;
        assert.equal((await setup.query("SELECT count(*)::int AS n FROM sports_football_closures WHERE event_id=$1", [id])).rows[0].n, 0);
        const result = action === "http-put" ? await http(admin,id,"PUT",{choice:"draw"}) : await sql(admin, id, action, action === "put" ? "draw" : null);
        assert.equal(result.status, action === "read" ? 200 : 409);
        assert.deepEqual((await setup.query("SELECT closed_at FROM sports_football_closures WHERE event_id=$1", [id])).rows[0].closed_at, start);
      }
    });

    await t.test("postponement after original kickoff preserves closure with no previous visit", async () => {
      const id = await event("clock_timestamp()-interval '3 minutes'");
      const original = (await setup.query("SELECT starts_at FROM sports_events WHERE id=$1", [id])).rows[0].starts_at;
      await setup.query("UPDATE sports_events SET status='postponed',starts_at=NULL WHERE id=$1", [id]);
      assert.deepEqual((await setup.query("SELECT closed_at FROM sports_football_closures WHERE event_id=$1", [id])).rows[0].closed_at, original);
      await setup.query("UPDATE sports_events SET status='scheduled',starts_at=clock_timestamp()+interval '1 week' WHERE id=$1", [id]);
      const view = await sql(admin, id);
      assert.equal(view.data.closed, true);
      assert.equal(new Date(view.data.closesAt).getTime(), original.getTime());
      assert.equal((await sql(admin, id, "put", "home")).status, 409);
    });

    await t.test("earlier correction closes at corrected kickoff and cannot reopen later", async () => {
      const id = await event(); await sql(member, id, "put", "home");
      await setup.query("UPDATE sports_events SET starts_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [id]);
      const first = await sql(member, id);
      assert.equal(first.data.closed, true); assert.equal(first.data.ownChoice, "home");
      await setup.query("UPDATE sports_events SET starts_at=clock_timestamp()+interval '1 day' WHERE id=$1", [id]);
      assert.equal((await sql(member, id)).data.closesAt, first.data.closesAt);
      assert.equal((await sql(member, id, "put", "away")).status, 409);
    });

    await t.test("suspended and cancelled matches retain choices and irreversible closure", async () => {
      for (const status of ["suspended", "cancelled"]) {
        const id = await event(); await sql(member, id, "put", "away");
        await setup.query("UPDATE sports_events SET status=$2 WHERE id=$1", [id, status]);
        const initial = await sql(member, id);
        assert.equal(initial.data.closed, true); assert.equal(initial.data.ownChoice, "away");
        await setup.query("UPDATE sports_events SET status='scheduled',starts_at=clock_timestamp()+interval '1 day' WHERE id=$1", [id]);
        assert.equal((await sql(member, id, "delete")).status, 409);
        assert.equal((await sql(member, id)).data.closesAt, initial.data.closesAt);
      }
    });

    await t.test("simultaneous writes serialize to one own choice; event identity stays fixed", async () => {
      const id = await event();
      const writes = await Promise.all([sql(member, id, "put", "home"), sql(member, id, "put", "away")]);
      assert.deepEqual(writes.map(x => x.status), [200, 200]);
      assert.equal((await setup.query("SELECT count(*)::int AS n FROM sports_football_predictions WHERE event_id=$1 AND member_id=$2", [id, member.id])).rows[0].n, 1);
      assert.ok(["home", "away"].includes((await sql(member, id)).data.ownChoice));
      assert.deepEqual((await sql(admin, id)).data.choices, []);
      await assert.rejects(setup.query("UPDATE sports_events SET first_team_id=second_team_id,second_team_id=first_team_id WHERE id=$1", [id]), { code: "23514" });
    });

    await t.test("queued request cannot use its earlier request/transaction time after kickoff", async () => {
      const id = await event();
      const lock = await setup.connect();
      try {
        await lock.query("BEGIN");
        await lock.query("UPDATE sports_events SET starts_at=clock_timestamp()+interval '400 milliseconds' WHERE id=$1", [id]);
        const waiting = http(member, id, "PUT", { choice: "draw", now: "2000-01-01T00:00:00Z" });
        // Wait until the actual SQL API call is blocked on this row.
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          blocked = (await setup.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT public.sports_football_predictions_api%') AS blocked")).rows[0].blocked;
          if (blocked) break;
          await pause(10);
        }
        assert.equal(blocked, true);
        await lock.query("SELECT pg_sleep(0.5)");
        await lock.query("COMMIT");
        assert.equal((await waiting).status, 409);
        assert.equal((await sql(member, id)).data.ownChoice, null);
        assert.equal((await sql(admin, id)).data.closed, true);
      } finally { await lock.query("ROLLBACK"); lock.release(); }
    });

    await t.test("expired, revoked and archived sessions are rejected in PostgreSQL itself", async () => {
      for (const invalidation of ["expired", "revoked", "archived"]) {
        const person = await identity(familyId);
        assert.equal((await sql(person, base.event)).status, 200);
        if (invalidation === "expired") await setup.query("UPDATE session SET expires_at=clock_timestamp()-interval '1 second' WHERE token=$1", [person.token]);
        if (invalidation === "revoked") await setup.query("UPDATE member_devices SET revoked_at=clock_timestamp() WHERE auth_user_id=$1", [person.userId]);
        if (invalidation === "archived") await setup.query("UPDATE members SET archived_at=clock_timestamp() WHERE id=$1", [person.id]);
        assert.equal((await sql(person, base.event)).status, 403);
      }
    });
  } finally {
    server?.kill();
    await limited?.end();
    if (families.length) {
      await setup.query("DELETE FROM audit_events WHERE family_id=ANY($1::uuid[])", [families]);
      for (const table of [...championsCleanupTables, "sports_events", ...championsIdentityTables]) await setup.query(`DELETE FROM ${table} WHERE family_id=ANY($1::uuid[])`, [families]);
      await setup.query("DELETE FROM families WHERE id=ANY($1::uuid[])", [families]);
    }
    if (users.length) await setup.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [users]);
    await setup.query(`DROP OWNED BY "${role}"`);
    await setup.query(`DROP ROLE "${role}"`);
    if (createdAnon) await setup.query("DROP ROLE anon");
    await setup.end();
  }
});
