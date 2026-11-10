import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import { connectionString, diaryDatabase, diaryServer, diaryProfile, diaryCall } from "./training-diary-fixture.mjs";
const blocks = [{ name: "Fuerza", rounds: 2, exercises: [{ name: "Sentadíllas", mode: "repetitions", repetitions: 12 }] }];
function shift(day, days) { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function monday(day) { const n = new Date(`${day}T12:00:00Z`).getUTCDay(); return shift(day, n === 0 ? -6 : 1 - n); }
test("diary migration, authenticated contract, isolation, transition and rollback", { skip: !connectionString && "requires explicit isolated PostgreSQL", timeout: 300_000 }, async t => {
  const database = await diaryDatabase(); let server, reader;
  try {
    server = await diaryServer(database.url, true); reader = await diaryServer(database.url, false);
    const owner = await diaryProfile(server, "Diary owner", database.pool), peer = await diaryProfile(server, "Peer", database.pool, owner.familyId), admin = await diaryProfile(server, "Admin", database.pool, owner.familyId, "administrator"), outsider = await diaryProfile(server, "Outsider", database.pool);
    const call = (path, method = "GET", body, person = owner, contract = "3") => diaryCall(server, person, path, method, body, contract);
    const routine = (await call("routines", "POST", { name: "Plantilla", blocks, operationKey: randomUUID() }, owner, "2")).body.item;
    assert.ok(routine);
    const today = (await call("routines")).body.today, future = shift(today, 1), past = shift(today, -1);
    const legacyBody = { name: "Histórica", blocks, sourceRoutineId: routine.id, performedOn: past, durationSeconds: null, effort: null, note: "Sesión anterior", operationKey: randomUUID() };
    let historical;
    await t.test("flag alone cannot transition; legacy contract writes mirror dates and edits", async () => {
      assert.equal((await call(`entries?date=${today}`)).status, 404);
      const legacy = await call("sessions", "POST", legacyBody, owner, "2"); assert.equal(legacy.status, 201, JSON.stringify(legacy)); historical = legacy.body.item;
      const migrated = (await database.pool.query("SELECT date::text,version,result,plan FROM training_entries WHERE id=$1", [historical.id])).rows[0];
      assert.equal(migrated.date, past); assert.equal(migrated.plan, null); assert.equal(migrated.result.durationSeconds, null);
      await database.pool.query("UPDATE families SET time_zone='Asia/Tokyo' WHERE id=$1", [owner.familyId]);
      const edited = await call(`sessions/${historical.id}`, "PATCH", { ...legacyBody, operationKey: undefined, note: "Corregida", version: historical.version }, owner, "2"); assert.equal(edited.status, 200);
      const mirrored = (await database.pool.query("SELECT date::text,version,result FROM training_entries WHERE id=$1", [historical.id])).rows[0]; assert.equal(mirrored.date, past); assert.equal(mirrored.version, 2); assert.equal(mirrored.result.text, "Corregida");
      await database.pool.query("UPDATE families SET time_zone='America/Argentina/Buenos_Aires' WHERE id=$1", [owner.familyId]);
    });
    await t.test("cutover waits for old transactions and verifies the last mirrored edit", async () => {
      const blocker = await database.pool.connect();
      try {
        await blocker.query("BEGIN"); await blocker.query("SELECT singleton FROM training_diary_state FOR SHARE");
        let done = false; const cutover = database.pool.query("SELECT public.training_diary_transition()").then(() => { done = true; });
        await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(done, false);
        await blocker.query("UPDATE training_sessions SET note='Última corrección',version=version+1 WHERE id=$1", [historical.id]);
        await blocker.query("COMMIT"); await cutover;
      } finally { blocker.release(); }
      assert.equal((await call("sessions", "GET", undefined, owner, "2")).status, 409);
      await assert.rejects(database.pool.query("UPDATE training_sessions SET note='blocked' WHERE id=$1", [historical.id]), e => e.code === "P3001");
      assert.equal((await call(`entries/${historical.id}`)).body.item.result.text, "Última corrección");
    });
    const make = (patch = {}) => ({ date: today, kind: "training", plan: null, result: { text: "Caminé 40 minutos" }, disposition: "open", sourceRoutineId: null, ...patch });
    const create = input => call("entries", "POST", { input, operationKey: randomUUID() });
    let entry, plan, rest;
    await t.test("phrase-only entries, rest presence, unknown fields and future validation", async () => {
      const result = await create(make()); assert.equal(result.status, 201, JSON.stringify(result)); entry = result.body.item;
      rest = (await create(make({ kind: "rest", result: {} }))).body.item; assert.ok(rest);
      for (const patch of [{ plan: null, result: null }, { result: {} }, { result: { text: "x", unknown: 1 } }, { date: future }, { date: "2026-02-30" }]) assert.equal((await create(make(patch))).status, 400);
      assert.equal((await create(make({ kind: "rest", result: {} }))).body.code, "REST_ALREADY_EXISTS");
      assert.equal((await call(`entries?date=${today}`, "GET", undefined, owner, "2")).status, 409);
    });
    await t.test("every mutation is idempotent before version checks, including lost responses", async () => {
      const operationKey = randomUUID(), input = make({ result: { text: "  Movilidad  " } });
      const results = await Promise.all([call("entries", "POST", { input, operationKey }), call("entries", "POST", { input: make({ result: { text: "Movilidad", effort: null } }), operationKey })]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 201]); assert.equal(results[0].body.item.id, results[1].body.item.id);
      const payload = { action: "edit", input: make({ result: { text: "Caminé 45 minutos" } }), version: entry.version, operationKey: randomUUID() };
      const first = await call(`entries/${entry.id}`, "PATCH", payload), retry = await call(`entries/${entry.id}`, "PATCH", payload);
      assert.equal(first.status, 200); assert.equal(retry.status, 200); assert.equal(retry.body.replayed, true); entry = retry.body.item;
      assert.equal((await call(`entries/${entry.id}`, "PATCH", { ...payload, input: make({ result: { text: "Otro texto" } }) })).body.code, "OPERATION_CONFLICT");
      const edits = await Promise.all([1, 2].map(n => call(`entries/${entry.id}`, "PATCH", { action: "edit", input: make({ result: { text: `Concurrente ${n}` } }), version: entry.version, operationKey: randomUUID() })));
      assert.deepEqual(edits.map(result => result.status).sort(), [200, 409]); entry = edits.find(result => result.status === 200).body.item;
    });
    await t.test("plan/result preserve snapshots; future results require explicit reschedule", async () => {
      plan = (await create(make({ date: future, plan: { text: "Correr 5 km", blocks }, result: null }))).body.item;
      assert.equal((await call(`entries/${plan.id}`, "PATCH", { action: "result", content: { text: "Corrí 3 km" }, version: plan.version, operationKey: randomUUID() })).status, 400);
      assert.equal((await call(`entries/${plan.id}`, "PATCH", { action: "reschedule", date: past, version: plan.version, operationKey: randomUUID() })).status, 400);
      const moved = await call(`entries/${plan.id}`, "PATCH", { action: "reschedule", date: today, version: plan.version, operationKey: randomUUID() }); assert.equal(moved.body.item.id, plan.id); plan = moved.body.item;
      const completed = await call(`entries/${plan.id}`, "PATCH", { action: "result", content: { text: "Corrí 3 km" }, version: plan.version, operationKey: randomUUID() }); assert.equal(completed.status, 200); plan = completed.body.item;
      assert.equal(plan.plan.text, "Correr 5 km"); assert.equal(plan.result.text, "Corrí 3 km");
      assert.equal((await call(`entries/${plan.id}`, "PATCH", { action: "edit", input: { ...make(), plan: { text: "Changed" } }, version: plan.version, operationKey: randomUUID() })).status, 400);
      const expired = await create(make({ date: past, plan: { text: "No lo hice" }, result: null })); assert.equal(expired.body.item.status, "missed");
    });
    await t.test("rest collisions for copy, move and restore preserve identity and version", async () => {
      assert.equal((await call("entries", "POST", { action: "copy", sourceId: rest.id, content: "result", date: today, operationKey: randomUUID() })).body.code, "REST_ALREADY_EXISTS");
      let other = (await create(make({ date: future, kind: "rest", plan: {}, result: null }))).body.item;
      assert.equal((await call(`entries/${other.id}`, "PATCH", { action: "reschedule", date: today, version: other.version, operationKey: randomUUID() })).body.code, "REST_ALREADY_EXISTS");
      other = (await call(`entries/${other.id}`, "PATCH", { action: "archive", version: other.version, operationKey: randomUUID() })).body.item;
      const replacement = await create(make({ date: future, kind: "rest", plan: {}, result: null })); assert.equal(replacement.status, 201);
      const restored = await call(`entries/${other.id}`, "PATCH", { action: "restore", version: other.version, operationKey: randomUUID() }); assert.equal(restored.body.code, "REST_ALREADY_EXISTS");
      assert.equal((await call(`entries/${other.id}`)).body.item.version, other.version);
    });
    await t.test("copy chooses content; archived templates never alter historical content", async () => {
      const copied = await call("entries", "POST", { action: "copy", sourceId: plan.id, content: "plan", date: future, operationKey: randomUUID() }); assert.equal(copied.status, 201); assert.equal(copied.body.item.plan.text, "Correr 5 km"); assert.equal(copied.body.item.result, null);
      await call(`routines/${routine.id}`, "PATCH", { action: "archive", version: routine.version }, owner, "2");
      assert.equal((await call(`entries/${historical.id}`)).body.item.result.blocks[0].rounds, 2);
      assert.equal((await create(make({ sourceRoutineId: routine.id }))).body.code, "ROUTINE_ARCHIVED");
    });
    await t.test("search accents, summaries, cursor invalidation and privacy include administrators", async () => {
      const secret = "diaryprivacytoken";
      await create(make({ result: { title: "Movilidad", text: `${secret} Caminé rápido`, blocks } }));
      const search = await call("search", "POST", { query: "CAMINE RAPIDO" }); assert.equal(search.status, 200); assert.equal(search.body.items.length, 1); assert.equal(search.body.items[0].result.blocks, undefined);
      assert.ok((await call("search", "POST", { query: "sentadillas" })).body.items.length >= 1);
      assert.equal((await call("search?q=private", "POST", { query: "correr" })).status, 400);
      assert.equal((await call(`summary?weekStart=${today}`)).status, new Date(`${today}T12:00:00Z`).getUTCDay() === 1 ? 200 : 400);
      const summary = await call(`summary?weekStart=${monday(today)}`); assert.equal(summary.status, 200); assert.ok(summary.body.days.find(day => day.date === today).counts.training_completed > 0);
      for (const person of [peer, admin, outsider]) {
        assert.equal((await call(`entries/${entry.id}`, "GET", undefined, person)).status, 404);
        assert.equal((await call("search", "POST", { query: secret }, person)).body.items.length, 0);
        const otherSummary = await call(`summary?weekStart=${monday(today)}`, "GET", undefined, person); assert.equal(otherSummary.body.days.reduce((n, day) => n + Object.values(day.counts).reduce((a, b) => a + b, 0), 0), 0);
      }
      const firstPage = await call(`entries?date=${today}&limit=1`); assert.ok(firstPage.body.nextCursor);
      const foreignCursor = await call(`entries?date=${today}&limit=1&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`, "GET", undefined, peer); assert.equal(foreignCursor.status, 400);
      await create(make()); assert.equal((await call(`entries?date=${today}&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`)).body.code, "LIST_CHANGED");
      assert.ok(!server.logs.join("").includes(secret));
    });
    await t.test("daily capacity and reader rollback keep new types readable and prevent writes", async () => {
      const fullDate = shift(today, -10);
      await database.pool.query("INSERT INTO training_entries(family_id,owner_member_id,date,kind,result) SELECT $1,$2,$3::date,'training','{\"text\":\"Synthetic capacity\"}'::jsonb FROM generate_series(1,100)", [owner.familyId, owner.id, fullDate]);
      assert.equal((await create(make({ date: fullDate }))).body.code, "DAY_FULL");
      const read = await diaryCall(reader, owner, `entries?date=${today}`); assert.equal(read.status, 200); assert.equal(read.body.writable, false);
      assert.equal((await diaryCall(reader, owner, `entries/${rest.id}`)).body.item.kind, "rest");
      assert.equal((await diaryCall(reader, owner, "search", "POST", { query: "Correr" })).status, 200);
      assert.equal((await diaryCall(reader, owner, "entries", "POST", { input: make(), operationKey: randomUUID() })).body.code, "DIARY_READ_ONLY");
      assert.equal((await diaryCall(reader, owner, "sessions", "GET", undefined, "2")).body.code, "CLIENT_UPDATE_REQUIRED");
      const payloads = (await database.pool.query("SELECT hash,action,confirmed_version FROM training_diary_operations WHERE owner_member_id=$1", [owner.id])).rows; assert.ok(payloads.length > 0);
    });
    if (process.env.TRAINING_DIARY_PERFORMANCE === "1") await t.test("performance acceptance: 100k history, 700-entry week and private query logs", { timeout: 180_000 }, async () => {
      const person = await diaryProfile(server, "Performance owner", database.pool);
      await database.pool.query(`INSERT INTO training_entries(family_id,owner_member_id,date,kind,result) SELECT $1,$2,DATE '2020-01-01'+((g-1)/100)::int,'training',jsonb_build_object('text',CASE WHEN g%3=0 THEN 'Correr movilidad piernas' ELSE 'Caminar fuerza sentadillas' END || ' synthetic ' || g) FROM generate_series(1,100000) g`, [person.familyId, person.id]);
      const maxBlocks = Array.from({ length: 20 }, () => ({ name: "Bloque".repeat(10), rounds: 100, exercises: Array.from({ length: 30 }, () => ({ name: "z".repeat(120), mode: "repetitions", repetitions: 1000 })) }));
      const maximal = { title: "T".repeat(120), text: "M".repeat(2000), blocks: maxBlocks, durationSeconds: 86400, effort: 10 };
      const maxResult = await diaryCall(server, person, "entries", "POST", { input: { ...make(), plan: maximal, result: maximal }, operationKey: randomUUID() }); assert.equal(maxResult.status, 201, JSON.stringify(maxResult));
      assert.equal((await diaryCall(server, person, "search", "POST", { query: "zzz" })).body.items.length, 1);
      await database.pool.query("ANALYZE training_entries");
      async function measure(query) { const times = []; for (let i = 0; i < 25; i++) { const start = performance.now(); const result = await diaryCall(server, person, ...query); assert.equal(result.status, 200, JSON.stringify(result)); times.push(performance.now() - start); } return { p95: times.sort((a, b) => a - b)[Math.ceil(times.length * .95) - 1], samples: times.length }; }
      const measurements = { summary: await measure(["summary?weekStart=2020-01-06"]), day: await measure(["entries?date=2020-01-06"]), commonSearch: await measure(["search", "POST", { query: "cam" }]), rareSearch: await measure(["search", "POST", { query: "synthetic 12345" }]), maximalBlocks: await measure(["search", "POST", { query: "zzz" }]) };
      await mkdir("test-results-training-diary", { recursive: true }); await writeFile("test-results-training-diary/performance.json", JSON.stringify({ measurements, environment: "Local PostgreSQL 18, production Next server, 100000 synthetic entries", measured: "HTTP including authentication and JSON response" }, null, 2));
      for (const measurement of Object.values(measurements)) assert.ok(measurement.p95 <= 500, JSON.stringify(measurements));
    });
  } finally { await server?.close(); await reader?.close(); await database.close(); }
});
