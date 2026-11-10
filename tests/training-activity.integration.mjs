import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { connectionString, diaryDatabase, diaryServer, diaryProfile, diaryCall } from "./training-diary-fixture.mjs";
import { timingFromClocks, activityTiming, timingDuration } from "../src/lib/training/timing.ts";
import { validateDiary } from "../src/lib/training/diary.ts";

test("activity migration, old bundle compatibility and timing contract", { skip: !connectionString, timeout: 180_000 }, async t => {
  let historic;
  const database = await diaryDatabase({ beforeTiming: async pool => {
    await pool.query("SELECT public.training_diary_transition()");
    const family = (await pool.query("INSERT INTO families(name) VALUES('Historical timing test') RETURNING id")).rows[0].id;
    const member = (await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,'History','member') RETURNING id", [family])).rows[0].id;
    historic = (await pool.query("INSERT INTO training_entries(family_id,owner_member_id,date,kind,result) VALUES($1,$2,'2020-01-02','training','{\"text\":\"Legacy duration\",\"durationSeconds\":1234}') RETURNING id", [family, member])).rows[0].id;
  } });
  let server, compatible;
  try {
    assert.deepEqual((await database.pool.query("SELECT result FROM training_entries WHERE id=$1", [historic])).rows[0].result, { text: "Legacy duration", durationSeconds: 1234 });
    await database.pool.query("SELECT public.training_diary_transition()");
    server = await diaryServer(database.url, true, true, true);
    compatible = await diaryServer(database.url, true, true, false);
    const owner = await diaryProfile(server, "Timing owner", database.pool);
    await database.pool.query("UPDATE families SET time_zone='UTC' WHERE id=$1", [owner.familyId]);
    const call = (path, method, body, target = server) => diaryCall(target, owner, path, method, body);
    const timing = timingFromClocks("2020-01-02", "10:00", "11:00", false, "UTC");
    const make = (patch = {}) => ({ date: "2020-01-02", kind: "training", plan: null, result: { text: "Activity", timing }, disposition: "open", sourceRoutineId: null, ...patch });
    const create = input => call("entries", "POST", { input, operationKey: randomUUID() });
    const edit = (item, input, target = server) => call(`entries/${item.id}`, "PATCH", { action: "edit", input, version: item.version, operationKey: randomUUID() }, target);
    let item;
    await t.test("server computes duration; overlaps and changed operation payloads", async () => {
      const input = make({ result: { text: "Run", timing, durationSeconds: 7 } }), operationKey = randomUUID();
      const first = await call("entries", "POST", { input, operationKey }); assert.equal(first.status, 201, JSON.stringify(first)); item = first.body.item;
      assert.equal(item.result.durationSeconds, 3600);
      assert.equal((await call("entries", "POST", { input, operationKey })).body.replayed, true);
      assert.equal((await call("entries", "POST", { input: make({ result: { text: "Run", timing: { ...timing, endAt: "2020-01-02T12:00:00.000Z" } } }), operationKey })).body.code, "OPERATION_CONFLICT");
      assert.equal((await create(make())).status, 201);
    });
    await t.test("cached pre-step-one bundle preserves timing even when sending another duration", async () => {
      const oldResponse = await fetch(`${compatible.origin}/api/training/entries/${item.id}`, { headers: { Cookie: owner.cookie, "X-Training-Contract": "3" } });
      const oldItem = (await oldResponse.json()).item;
      assert.equal(oldItem.result.timing, undefined);
      assert.ok(Object.keys(oldItem.result).every(key => ["title", "text", "blocks", "durationSeconds", "effort"].includes(key)), "the old bundle's strict validator must accept this projection");
      // Exact shape of the old editor: no timing, full plan/result, explicit duration.
      const oldInput = make({ result: { text: "Old bundle edit", durationSeconds: 5, effort: null } });
      let response = await edit(item, oldInput, compatible); assert.equal(response.status, 200, JSON.stringify(response)); item = response.body.item;
      assert.deepEqual(item.result.timing, timing); assert.equal(item.result.durationSeconds, 3600); assert.equal(response.body.activityFormEnabled, false);
      response = await edit(item, { ...oldInput, date: "2020-01-03" }, compatible);
      assert.equal(response.status, 409); assert.equal(response.body.code, "TIMING_REQUIRED_FOR_DATE_CHANGE");
      assert.equal((await call(`entries/${item.id}`)).body.item.version, item.version);
      const movedTiming = timingFromClocks("2020-01-03", "10:00", "11:00", false, "UTC");
      response = await edit(item, make({ date: "2020-01-03", result: { text: "Moved", timing: movedTiming } })); assert.equal(response.status, 200); item = response.body.item;
      response = await edit(item, make({ date: item.date, result: { text: "Clear", timing: null } })); assert.equal(response.status, 200); item = response.body.item;
      assert.equal(item.result.timing, null); assert.equal(item.result.durationSeconds, null);
    });
    await t.test("historical duration omission and explicit null differ", async () => {
      let entry = (await create(make({ result: { text: "No hours", durationSeconds: 99 } }))).body.item;
      entry = (await edit(entry, make({ result: { text: "Preserved" } }))).body.item; assert.equal(entry.result.durationSeconds, 99);
      entry = (await edit(entry, make({ result: { text: "Cleared", durationSeconds: null } }))).body.item; assert.equal(entry.result.durationSeconds, null);
    });
    await t.test("move and result are atomic, retaining the original planned interval", async () => {
      const plan = (await create(make({ plan: { text: "Planned", timing }, result: null }))).body.item;
      const real = timingFromClocks("2020-01-03", "10:00", "10:30", false, "UTC");
      assert.equal((await call(`entries/${plan.id}`, "PATCH", { action: "result", date: "2020-01-03", content: { text: "Done" }, version: plan.version, operationKey: randomUUID() })).body.code, "TIMING_REQUIRED_FOR_DATE_CHANGE");
      const response = await call(`entries/${plan.id}`, "PATCH", { action: "result", date: "2020-01-03", content: { text: "Done", timing: real }, version: plan.version, operationKey: randomUUID() });
      assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.body.item.id, plan.id); assert.equal(response.body.item.date, "2020-01-03"); assert.deepEqual(response.body.item.plan, plan.plan);
    });
    await t.test("copy and reschedule require replacement intervals in the destination date", async () => {
      const source = (await create(make())).body.item;
      const nextTiming = timingFromClocks("2199-01-02", "10:00", "10:30", false, "UTC");
      assert.equal((await call("entries", "POST", { action: "copy", sourceId: source.id, content: "result", date: "2199-01-02", operationKey: randomUUID() })).body.code, "TIMING_REQUIRED_FOR_DATE_CHANGE");
      const copied = await call("entries", "POST", { action: "copy", sourceId: source.id, content: "result", date: "2199-01-02", timing: nextTiming, operationKey: randomUUID() });
      assert.equal(copied.status, 201, JSON.stringify(copied)); assert.equal(copied.body.item.result, null); assert.equal(copied.body.item.plan.durationSeconds, 1800);
      const plan = (await create(make({ plan: { text: "Move plan", timing }, result: null }))).body.item;
      const moved = await call(`entries/${plan.id}`, "PATCH", { action: "reschedule", date: "2199-01-02", timing: nextTiming, version: plan.version, operationKey: randomUUID() });
      assert.equal(moved.status, 200, JSON.stringify(moved)); assert.equal(moved.body.item.id, plan.id); assert.deepEqual(moved.body.item.plan.timing, nextTiming);
    });
    await t.test("shared boundary examples agree in JS and PostgreSQL", async () => {
      const examples = [timing, { ...timing, endAt: timing.startAt }, { ...timing, endAt: "2020-01-04T10:00:00.000Z" }, { ...timing, startAt: "2020-02-30T10:00:00Z" }, { ...timing, startAt: "2020-01-01T24:00:00Z", endAt: "2020-01-02T01:00:00Z" }, { ...timing, timeZone: "Invalid/Zone" }, { startAt: timing.startAt }, timingFromClocks("2026-03-07", "12:00", "12:00", true, "America/New_York")];
      for (const sample of examples) {
        let valid = true; try { activityTiming(sample); } catch { valid = false; }
        assert.equal((await database.pool.query("SELECT public.training_activity_timing_valid($1::jsonb) AS valid", [JSON.stringify(sample)])).rows[0].valid, valid, JSON.stringify(sample));
      }
      const invalid = make({ date: "2020-01-03" }); assert.throws(() => validateDiary(invalid, "2026-11-10")); assert.equal((await create(invalid)).status, 400);
      assert.equal((await database.pool.query("SELECT public.training_activity_date_valid('2020-01-03',NULL,$1::jsonb) AS valid", [JSON.stringify({ text: "Wrong date", timing, durationSeconds: timingDuration(timing) })])).rows[0].valid, false);
    });
    await t.test("future times and family zone are enforced; unchanged old zone is retained", async () => {
      const future = timingFromClocks("2199-01-02", "10:00", "11:00", false, "UTC");
      assert.equal((await create(make({ date: "2199-01-02", result: { text: "Future", timing: future } }))).status, 400);
      assert.equal((await create(make({ date: "2199-01-02", plan: { text: "Future plan", timing: future }, result: null }))).status, 201);
      const existing = (await create(make())).body.item;
      await database.pool.query("UPDATE families SET time_zone='America/Argentina/Buenos_Aires' WHERE id=$1", [owner.familyId]);
      const response = await edit(existing, make({ result: { text: "Zone retained" } })); assert.equal(response.status, 200); assert.equal(response.body.item.result.timing.timeZone, "UTC");
      assert.equal((await create(make())).status, 400);
      await database.pool.query("UPDATE families SET time_zone='UTC' WHERE id=$1", [owner.familyId]);
    });
    await t.test("text-only edits never recheck the clock of an unchanged stored interval", async () => {
      const now = new Date(), date = now.toISOString().slice(0, 10);
      const timing = { startAt: new Date(now.getTime() - 3600_000).toISOString(), endAt: new Date(now.getTime() + 3600_000).toISOString(), timeZone: "UTC" };
      // Simulate an old stored interval after a clock adjustment. Only this isolated fixture bypasses the guard.
      const client = await database.pool.connect(); let id;
      try {
        await client.query("BEGIN"); await client.query("ALTER TABLE training_entries DISABLE TRIGGER training_activity_guard");
        id = (await client.query("INSERT INTO training_entries(family_id,owner_member_id,date,kind,result) VALUES($1,$2,$3,'training',$4) RETURNING id", [owner.familyId, owner.id, timing.startAt.slice(0,10), JSON.stringify({ text: "Clock adjusted", timing, durationSeconds: 7200 })])).rows[0].id;
        await client.query("ALTER TABLE training_entries ENABLE TRIGGER training_activity_guard"); await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      const original = (await call(`entries/${id}`)).body.item;
      const edited = await edit(original, make({ date: original.date, result: { text: `Clock unchanged ${date}` } }));
      assert.equal(edited.status, 200, JSON.stringify(edited)); assert.deepEqual(edited.body.item.result.timing, timing);
    });
    await t.test("capacity 100 and idempotent replay at the limit", async () => {
      await database.pool.query("INSERT INTO training_entries(family_id,owner_member_id,date,kind,result) SELECT $1,$2,'2020-02-01','training','{\"text\":\"Capacity\"}' FROM generate_series(1,99)", [owner.familyId, owner.id]);
      const input = make({ date: "2020-02-01", result: { text: "Hundred" } }), operationKey = randomUUID();
      const results = await Promise.all([call("entries", "POST", { input, operationKey }), call("entries", "POST", { input, operationKey })]); assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
      assert.equal((await create(input)).body.code, "DAY_FULL");
    });
  } finally { await server?.close(); await compatible?.close(); await database.close(); }
});
