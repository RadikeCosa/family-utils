import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import pg from "pg";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function start(port, enabled) {
  const origin = `http://localhost:${port}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...process.env, NODE_ENV: "production", DATABASE_URL: connectionString, TRAINING_ENABLED: String(enabled), BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "training-test-only-secret-not-production", CODE_PEPPER: "training-test-only-pepper-not-production", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, stdio: "ignore" });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error("Training server failed");
    try { if ((await fetch(origin)).ok) return { origin, server }; } catch { /* waiting for listener */ }
    if (attempt > 150) { server.kill(); throw new Error("Startup timeout"); } await delay(100);
  }
}
async function stop(server) { server.kill(); if (server.exitCode === null) await once(server, "exit"); }
const blocks = [{ name: "Circuito", rounds: 3, exercises: [{ name: "Sentadillas", mode: "repetitions", repetitions: 12 }, { name: "Plancha", mode: "time", seconds: 30 }] }];
test("training authenticated API: gates, isolation, replay, concurrency, history and profile recovery", { skip: !connectionString && "requires isolated PostgreSQL", timeout: 180_000 }, async (t) => {
  const disabled = await start(3350, false);
  try {
    for (const [path, methods] of [["/entrenamiento", ["GET"]], ["/api/training/routines", ["GET", "POST"]], ["/api/training/sessions", ["GET", "POST"]], ["/api/training/routines/123", ["GET", "PATCH"]], ["/api/training/sessions/123", ["GET", "PATCH"]]]) for (const method of methods) assert.equal((await fetch(disabled.origin + path, { method })).status, 404);
    assert.ok(!(await fetch(disabled.origin).then((r) => r.text())).includes('href="/entrenamiento"'));
  } finally { await stop(disabled.server); }
  const { origin, server } = await start(3351, true); const pool = new pg.Pool({ connectionString });
  const families = [], users = [];
  async function family() { const row = (await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [`training-${randomUUID()}`])).rows[0]; families.push(row.id); return row.id; }
  async function identity(familyId, role = "member", existingMember, unbound = false) {
    const r = await fetch(`${origin}/api/access/prepare`, { method: "POST", headers: { Origin: origin, "x-forwarded-for": `192.0.2.${users.length + 100}` } }); assert.equal(r.status, 200);
    const cookie = r.headers.getSetCookie().map((v) => v.split(";", 1)[0]).join("; ");
    const session = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: cookie } }).then((r) => r.json()); users.push(session.user.id);
    if (unbound) return { cookie, userId: session.user.id };
    const id = existingMember ?? (await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,'Test',$2) RETURNING id", [familyId, role])).rows[0].id;
    await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [id, session.user.id]); return { cookie, id, userId: session.user.id };
  }
  async function req(person, path = "routines", method = "GET", body, headers = {}) {
    const r = await fetch(`${origin}/api/training/${path}`, { method, headers: { Cookie: person?.cookie ?? "", Origin: origin, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") };
  }
  const create = (name = "Circuito") => ({ name, blocks: structuredClone(blocks), operationKey: randomUUID() });
  try {
    const familyId = await family(); const owner = await identity(familyId), peer = await identity(familyId), admin = await identity(familyId, "administrator"), outsider = await identity(await family());
    const input = create(); let routine, session, sessionInput;
    await t.test("all active profiles have private data and direct IDs never disclose existence", async () => {
      assert.equal((await req(null)).status, 403);
      assert.ok((await fetch(origin).then((r) => r.text())).includes('href="/entrenamiento"'));
      const created = await req(owner, "routines", "POST", input); assert.equal(created.status, 201, JSON.stringify(created)); routine = created.body.item;
      for (const person of [peer, admin, outsider]) {
        assert.equal((await req(person)).body.items.length, 0);
        assert.deepEqual(await req(person, `routines/${routine.id}`), await req(person, `routines/${randomUUID()}`));
        assert.equal((await req(person, `routines/${routine.id}`, "PATCH", { ...input, operationKey: undefined, version: 1 })).status, 404);
      }
      assert.equal((await req(owner, "routines", "POST", { ...create(), ownerMemberId: peer.id })).status, 400);
      assert.equal((await req(owner, "routines", "POST", create(), { Origin: "https://other.invalid" })).status, 403);
      assert.equal((await req(owner)).cache, "private, no-store");
      const streamed = await fetch(`${origin}/api/training/routines`, { method: "POST", headers: { Cookie: owner.cookie, Origin: origin, "Content-Type": "application/json" }, body: (async function* () { for (let i=0;i<9;i++) yield "x".repeat(65536); })(), duplex: "half" });
      assert.equal(streamed.status,413);
      assert.equal((await req(owner, "routines", "POST", { ...create(), name: "x".repeat(524289) })).status, 413);
    });
    await t.test("create retries serialize and preserve original fingerprint even after edits", async () => {
      const retries = await Promise.all(Array.from({ length: 4 }, () => req(owner, "routines", "POST", input)));
      assert.ok(retries.every((r) => r.status === 200 && r.body.item.id === routine.id));
      assert.equal((await req(owner, "routines", "POST", { ...input, name: "different" })).status, 409);
      const concurrent = create("Concurrent"); const results = await Promise.all([req(owner,"routines","POST",concurrent), req(owner,"routines","POST",concurrent)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200,201]); assert.equal(results[0].body.item.id, results[1].body.item.id);
      const edits = await Promise.all(["A", "B"].map((name) => req(owner, `routines/${routine.id}`, "PATCH", { name, blocks, version: 1 })));
      assert.deepEqual(edits.map((r) => r.status).sort(), [200,409]);
      assert.equal((await req(owner, "routines", "POST", input)).body.item.version, 2);
      routine = (await req(owner, `routines/${routine.id}`)).body.item;
    });
    await t.test("sessions snapshot actuals, allow same day and isolate direct references", async () => {
      const today = (await req(owner)).body.today;
      sessionInput = { name: "Mi entrenamiento", blocks: [{ ...blocks[0], rounds: 2 }], sourceRoutineId: routine.id, performedOn: today, durationSeconds: 1500, effort: 7, note: "Dos vueltas", operationKey: randomUUID() };
      const result = await req(owner, "sessions", "POST", sessionInput); assert.equal(result.status, 201, JSON.stringify(result)); session = result.body.item;
      assert.equal((await req(owner, "sessions", "POST", sessionInput)).body.item.id, session.id);
      assert.equal((await req(owner, "sessions", "POST", { ...sessionInput, operationKey: randomUUID() })).status, 201);
      for (const person of [peer, admin, outsider]) {
        assert.equal((await req(person, "sessions")).body.items.length, 0);
        assert.equal((await req(person, `sessions/${session.id}`)).status, 404);
        assert.equal((await req(person, "sessions", "POST", { ...sessionInput, operationKey: randomUUID() })).status, 404);
        assert.equal((await req(person, `sessions/${session.id}`, "PATCH", { ...sessionInput, operationKey: undefined, version: 1 })).status, 404);
      }
      assert.equal((await req(owner,"sessions","POST",{...sessionInput,performedOn:"9999-01-01",operationKey:randomUUID()})).status,400);
      await req(owner, `routines/${routine.id}`, "PATCH", { name: "Changed", blocks: [{ ...blocks[0], rounds: 9 }], version: routine.version });
      assert.equal((await req(owner, `sessions/${session.id}`)).body.item.blocks[0].rounds, 2);
    });
    await t.test("archive serializes with session creation; replay and full correction still work", async () => {
      routine = (await req(owner, `routines/${routine.id}`)).body.item;
      const blocker = await pool.connect();
      try {
        await blocker.query("BEGIN"); await blocker.query("SELECT id FROM training_routines WHERE id=$1 FOR UPDATE", [routine.id]);
        const pending = req(owner, "sessions", "POST", { ...sessionInput, operationKey: randomUUID() });
        await delay(100); await blocker.query("UPDATE training_routines SET archived_at=now(),version=version+1 WHERE id=$1", [routine.id]); await blocker.query("COMMIT");
        assert.equal((await pending).status, 409);
      } finally { await blocker.query("ROLLBACK"); blocker.release(); }
      assert.equal((await req(owner,"sessions","POST",sessionInput)).status,200);
      const edited = await req(owner, `sessions/${session.id}`, "PATCH", { ...sessionInput, operationKey: undefined, name: "Corregido", blocks, durationSeconds: 1200, effort: 5, note: "Nota corregida", version: 1 });
      assert.equal(edited.status,200,JSON.stringify(edited)); assert.equal(edited.body.item.blocks[0].rounds,3);
      assert.equal((await req(owner, `sessions/${session.id}`, "PATCH", { ...sessionInput, operationKey: undefined, version: 1 })).status,409);
      assert.ok((await req(owner, "routines?archived=true")).body.items.some((r) => r.id === routine.id));
      const archived = (await req(owner, `routines/${routine.id}`)).body.item;
      assert.equal((await req(owner,"routines","POST",create(archived.name))).status,201);
      assert.equal((await req(owner, `routines/${routine.id}`, "PATCH", { action: "restore", version: archived.version })).status,200);
    });
    await t.test("keyset pagination is stable for tied timestamps and scoped to owner/filter", async () => {
      await pool.query("INSERT INTO training_sessions(family_id,owner_member_id,source_routine_id,name,blocks,performed_on,duration_seconds,effort,operation_key,creation_hash,created_at) SELECT $1,$2,$3,'Paged', $4::jsonb,'2020-01-01',60,1,gen_random_uuid(),repeat('a',64),'2020-01-01T00:00:00.123456Z' FROM generate_series(1,47)",[familyId,owner.id,routine.id,JSON.stringify(blocks)]);
      const seen = new Set(); let path = "sessions?limit=20", first;
      do { const result = await req(owner,path); assert.equal(result.status,200); if (!first) first=result.body.nextCursor;
        for (const row of result.body.items) { assert.ok(!seen.has(row.id));seen.add(row.id); }
        path=result.body.nextCursor ? `sessions?limit=20&cursor=${encodeURIComponent(result.body.nextCursor)}` : null;
      } while (path);
      assert.equal(seen.size,49);
      assert.equal((await req(peer,`sessions?cursor=${encodeURIComponent(first)}`)).status,400);
      const page=await req(owner,"routines?limit=1"); assert.ok(page.body.nextCursor);
      assert.equal((await req(owner,`routines?archived=true&cursor=${encodeURIComponent(page.body.nextCursor)}`)).status,400);
    });
    await t.test("profile survives a new device and revocation; archived profile is denied", async () => {
      const secondDevice = await identity(familyId,"member",owner.id);
      assert.equal((await req(secondDevice,`sessions/${session.id}`)).status,200);
      const issued = await fetch(`${origin}/api/members/${owner.id}/codes`, { method: "POST", headers: { Cookie: admin.cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ purpose: "recovery" }) });
      assert.equal(issued.status,201); const code = (await issued.json()).code;
      const recovered = await identity(familyId,"member",undefined,true);
      const redeemed = await fetch(`${origin}/api/access/redeem`, { method: "POST", headers: { Cookie: recovered.cookie, Origin: origin, "Content-Type": "application/json", "x-forwarded-for": "192.0.2.200" }, body: JSON.stringify({ code }) });
      assert.equal(redeemed.status,200);
      assert.equal((await req(secondDevice)).status,403);
      assert.equal((await req(owner)).status,403); assert.equal((await req(recovered,`sessions/${session.id}`)).status,200);
      assert.equal((await req(recovered,`routines/${routine.id}`)).status,200);
      await pool.query("UPDATE members SET archived_at=now() WHERE id=$1",[owner.id]);
      assert.equal((await req(recovered)).status,403); assert.equal((await req(recovered,"routines","POST",create())).status,403);
    });
  } finally {
    await stop(server);
    for (const table of ["training_sessions", "training_routines", "audit_events", "access_codes"]) await pool.query(`DELETE FROM ${table} WHERE family_id=ANY($1::uuid[])`, [families]);
    if (families.length) await pool.query("DELETE FROM families WHERE id=ANY($1::uuid[])",[families]);
    if (users.length) await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[users]);
    await pool.end();
  }
});
