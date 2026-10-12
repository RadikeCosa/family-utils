import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { addTaskDays, getFamilyDay } from "../src/lib/tasks/family-day.ts";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("Isolated test database required");
const port = 3320;
const origin = `http://localhost:${port}`;
const secret = "daily-tests-only-code-pepper-1234567890";

test("daily task routes", { skip: !connectionString && "requires isolated PostgreSQL" }, async (t) => {
  const pool = new pg.Pool({ connectionString });
  let server;
  const familyId = randomUUID(), memberId = randomUUID();
  let userId;
  const today = getFamilyDay();
  const headers = { Origin: origin, "Content-Type": "application/json", "x-forwarded-for": `2001:db8:${randomUUID().slice(0, 4)}::1` };
  try {
    async function startServer(mode) {
      if (server) { server.kill("SIGTERM"); await new Promise((resolve) => server.once("exit", resolve)); }
      server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
      env: { ...process.env, DATABASE_URL: connectionString, DATABASE_URL_UNPOOLED: connectionString, BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "daily-tests-only-secret-1234567890", CODE_PEPPER: secret, TASK_GENERATION_MODE: mode }, stdio: "ignore",
    });
    for (let attempt = 0; attempt < 150; attempt++) {
      try { if ((await fetch(origin)).ok) break; } catch { /* starting */ }
      if (server.exitCode !== null) throw new Error("test server exited");
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    }
    await startServer("legacy_today");
    await pool.query("INSERT INTO families(id,name) VALUES ($1,'Daily route fixture')", [familyId]);
    await pool.query("INSERT INTO members(id,family_id,name,role,access_method) VALUES ($1,$2,'Daily member','member','code')", [memberId, familyId]);
    const prepared = await fetch(`${origin}/api/access/prepare`, { method: "POST", headers });
    assert.equal(prepared.status, 200);
    headers.Cookie = prepared.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    userId = (await fetch(`${origin}/api/auth/get-session`, { headers }).then((response) => response.json())).user.id;
    const code = "0123456789";
    const digest = createHmac("sha256", secret).update(`invitation\0${code}`).digest("hex");
    await pool.query("INSERT INTO access_codes(family_id,member_id,purpose,digest,expires_at,created_by_member_id) VALUES($1,$2,'invitation',$3,now()+interval '30 minutes',$2)", [familyId, memberId, digest]);
    assert.equal((await fetch(`${origin}/api/access/redeem`, { method: "POST", headers, body: JSON.stringify({ code }) })).status, 200);
    const get = (query = "") => fetch(`${origin}/api/tasks${query}`, { headers });
    const state = async () => (await pool.query("SELECT revision,(SELECT count(*) FROM task_occurrences WHERE family_id=$1) AS occasions,(SELECT count(*) FROM audit_events WHERE family_id=$1) AS audit FROM families WHERE id=$1", [familyId])).rows[0];

    await t.test("explicit dates are pure; only absent date takes legacy generation path", async () => {
      const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,repeat_weekdays,scheduled_date,created_by_member_id,edited_by_member_id) VALUES($1,'New daily routine',ARRAY[0,1,2,3,4,5,6],$3,$2,$2) RETURNING id", [familyId, memberId, today]);
      const before = await state();
      for (const day of [today, addTaskDays(today, -1), addTaskDays(today, 1)]) assert.equal((await get(`?date=${day}`)).status, 200);
      assert.equal((await get("?date=invalid")).status, 400);
      assert.deepEqual(await state(), before);
      assert.equal((await get()).status, 200);
      assert.notDeepEqual(await state(), before);
      const explicit = await get(`?date=${today}`).then((response) => response.json());
      assert.equal(explicit.tasks.filter((item) => item.taskId === task.id).length, 1);
    });

    await t.test("past includes due day and completion activity once each, with archived tasks visible", async () => {
      const due = addTaskDays(today, -4), done = addTaskDays(today, -2);
      const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,status,created_by_member_id,edited_by_member_id) VALUES($1,'Late task','archived',$2,$2) RETURNING id", [familyId, memberId]);
      const { rows: [occasion] } = await pool.query("INSERT INTO task_occurrences(task_id,family_id,due_date,generation_date,title_snapshot,assignment_mode_snapshot,status,completed_at) VALUES($1,$2,$3,$3,'Historical snapshot','individual','completed',$4) RETURNING id", [task.id, familyId, due, `${done}T15:00:00Z`]);
      for (const day of [due, done]) {
        const body = await get(`?date=${day}`).then((response) => response.json());
        assert.equal(body.tasks.filter((item) => item.id === occasion.id).length, 1);
        assert.equal(body.tasks.find((item) => item.id === occasion.id).title, "Historical snapshot");
      }
    });

    await t.test("pagination returns all 175 occasions without silent truncation", async () => {
      const day = addTaskDays(today, -10);
      for (let i = 0; i < 175; i++) {
        const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,created_by_member_id,edited_by_member_id) VALUES($1,'Many tasks',$2,$2) RETURNING id", [familyId, memberId]);
        await pool.query("INSERT INTO task_occurrences(task_id,family_id,due_date,generation_date,title_snapshot,assignment_mode_snapshot,status) VALUES($1,$2,$3,$3,'Many tasks','shared','missed')", [task.id, familyId, day]);
      }
      let cursor, ids = [];
      do {
        const body = await get(`?date=${day}${cursor ? `&cursor=${cursor}` : ""}`).then((response) => response.json());
        assert.equal(body.total, 175);
        assert.ok(body.tasks.length <= 50);
        ids.push(...body.tasks.map((item) => item.id));
        cursor = body.nextCursor;
      } while (cursor);
      assert.equal(new Set(ids).size, 175);
    });
    await startServer("explicit_sync");
    const sync = () => fetch(`${origin}/api/tasks/sync`, { method: "POST", headers });
    await t.test("all GETs are pure in explicit mode; concurrent clients converge", async () => {
      const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,repeat_weekdays,scheduled_date,created_by_member_id,edited_by_member_id) VALUES($1,'Concurrent daily',ARRAY[0,1,2,3,4,5,6],$3,$2,$2) RETURNING id", [familyId, memberId, today]);
      const before = await state();
      const raw = await get().then((response) => response.json());
      assert.equal(raw.generationMode, "explicit_sync");
      assert.equal(raw.tasks.find((item) => item.taskId === task.id).kind, "forecast");
      assert.deepEqual(await state(), before);
      const responses = await Promise.all([sync(), sync(), get(`?date=${addTaskDays(today, 30)}`)]);
      for (const response of responses) assert.equal(response.status, 200, await response.text());
      assert.equal((await pool.query("SELECT count(*) FROM task_occurrences WHERE task_id=$1", [task.id])).rows[0].count, "1");
      const converged = await state();
      assert.equal((await sync().then((response) => response.json())).changed, false);
      assert.deepEqual(await state(), converged);
    });

    await t.test("sync with no work does not wait for task row locks or write anything", async () => {
      await sync();
      const before = await state();
      const lock = await pool.connect();
      try {
        await lock.query("BEGIN");
        await lock.query("SELECT id FROM tasks WHERE family_id=$1 FOR UPDATE", [familyId]);
        const started = performance.now();
        const response = await fetch(`${origin}/api/tasks/sync`, { method: "POST", headers, signal: AbortSignal.timeout(2000) });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).changed, false);
        t.diagnostic(`no-work sync: ${Math.round(performance.now() - started)} ms`);
        assert.deepEqual(await state(), before);
      } finally { await lock.query("ROLLBACK"); lock.release(); }
    });

    await t.test("carry preview becomes exactly the same persisted occasion on its real day", async () => {
      const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,repeat_weekdays,carry_policy,scheduled_date,created_by_member_id,edited_by_member_id) VALUES($1,'Carry contract',ARRAY[0,1,2,3,4,5,6],'carry_forward',$3,$2,$2) RETURNING id", [familyId, memberId, today]);
      const forecast = (await get(`?date=${today}`).then((response) => response.json())).tasks.find((item) => item.taskId === task.id);
      assert.equal(forecast.kind, "forecast");
      await sync();
      const actual = (await get(`?date=${today}`).then((response) => response.json())).tasks.find((item) => item.taskId === task.id);
      assert.equal(actual.kind, "occurrence"); assert.equal(actual.key, forecast.key);
      const future = await get(`?date=${addTaskDays(today, 100)}&section=possible`).then((response) => response.json());
      assert.equal(future.tasks.filter((item) => item.taskId === task.id).length, 1);
      assert.equal((await get(`?date=${addTaskDays(today, 100)}`).then((response) => response.json())).tasks.filter((item) => item.taskId === task.id).length, 0);
    });

    await t.test("user completion concurrent with sync preserves versions and unique generation", async () => {
      const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,repeat_weekdays,scheduled_date,created_by_member_id,edited_by_member_id) VALUES($1,'Concurrent write',ARRAY[0,1,2,3,4,5,6],$3,$2,$2) RETURNING id", [familyId, memberId, today]);
      await sync();
      const { rows: [occasion] } = await pool.query("SELECT id,version FROM task_occurrences WHERE task_id=$1", [task.id]);
      const [completed, synchronized] = await Promise.all([
        fetch(`${origin}/api/tasks/${task.id}/occurrences/${occasion.id}`, { method: "PATCH", headers, body: JSON.stringify({ action: "complete", expectedVersion: occasion.version }) }), sync(),
      ]);
      assert.equal(completed.status, 200, await completed.text()); assert.equal(synchronized.status, 200);
      assert.equal((await pool.query("SELECT count(*) FROM task_occurrences WHERE task_id=$1", [task.id])).rows[0].count, "1");
    });

    await t.test("future routine creation stays virtual and single-occasion edits persist once", async () => {
      const date = addTaskDays(today, 7);
      const create = await fetch(`${origin}/api/tasks`, { method: "POST", headers, body: JSON.stringify({ title: "Future routine", dueDate: date, repeatWeekdays: [0,1,2,3,4,5,6], assignmentMode: "shared", assigneeIds: [], carryPolicy: "expires_daily" }) });
      assert.equal(create.status, 201, await create.clone().text());
      const task = (await create.json()).task;
      assert.equal((await pool.query("SELECT count(*) FROM task_occurrences WHERE task_id=$1", [task.id])).rows[0].count, "0");
      const forecast = (await get(`?date=${date}`).then((response) => response.json())).tasks.find((item) => item.taskId === task.id);
      assert.equal(forecast.kind, "forecast");
      const body = { scope: "occurrence", expectedTaskVersion: task.version, forecast: { generationDate: date, responsibilityMemberId: null }, title: "Exception", description: "Only this date", dueDate: date, scheduledTime: "10:00", assignmentMode: "shared", assigneeIds: [] };
      const edit = () => fetch(`${origin}/api/tasks/${task.id}`, { method: "PATCH", headers, body: JSON.stringify(body) });
      const concurrent = await Promise.all([edit(), edit()]);
      assert.deepEqual(concurrent.map((response) => response.status).sort(), [200,409]);
      const result = (await get(`?date=${date}`).then((response) => response.json())).tasks.filter((item) => item.taskId === task.id);
      assert.equal(result.length, 1); assert.equal(result[0].kind, "occurrence"); assert.equal(result[0].title, "Exception");
      assert.equal(result[0].key, forecast.key);
      const invalidAction = await fetch(`${origin}/api/tasks/${task.id}/occurrences/${result[0].id}`, { method: "PATCH", headers, body: JSON.stringify({ action: "complete", expectedVersion: result[0].version }) });
      assert.equal(invalidAction.status, 403);
      await sync();
      assert.equal((await pool.query("SELECT count(*) FROM task_occurrences WHERE task_id=$1", [task.id])).rows[0].count, "1");
    });

    await t.test("moving an exception suppresses its original forecast and recovery mode respects it", async () => {
      const date = addTaskDays(today, 8), movedDate = addTaskDays(today, 9);
      const created = await fetch(`${origin}/api/tasks`, { method: "POST", headers, body: JSON.stringify({ title: "Movable", dueDate: date, repeatWeekdays: [0,1,2,3,4,5,6] }) }).then((response) => response.json());
      const response = await fetch(`${origin}/api/tasks/${created.task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "occurrence", expectedTaskVersion: created.task.version, forecast: { generationDate: date, responsibilityMemberId: null }, title: "Moved exception", dueDate: movedDate, assignmentMode: "shared", assigneeIds: [] }) });
      assert.equal(response.status, 200, await response.text());
      assert.equal((await get(`?date=${date}`).then((response) => response.json())).tasks.filter((item) => item.taskId === created.task.id).length, 0);
      const future = await get(`?date=${movedDate}`).then((response) => response.json());
      assert.equal(future.tasks.filter((item) => item.taskId === created.task.id && item.title === "Moved exception").length, 1);
      // A separate ordinary occasion of the next day remains valid.
      await startServer("legacy_today");
      await get();
      assert.equal((await pool.query("SELECT count(*) FROM task_occurrences WHERE task_id=$1", [created.task.id])).rows[0].count, "1");
      await startServer("explicit_sync");
    });

    await t.test("omissions stay suppressed while a series edit replaces obsolete occasions", async () => {
      const created = await fetch(`${origin}/api/tasks`, { method: "POST", headers, body: JSON.stringify({ title: "Omitted", dueDate: today, repeatWeekdays: [0,1,2,3,4,5,6] }) }).then((response) => response.json());
      const { rows: [occasion] } = await pool.query("SELECT * FROM task_occurrences WHERE task_id=$1 AND generation_date=$2", [created.task.id, today]);
      assert.equal((await fetch(`${origin}/api/tasks/${created.task.id}/occurrences/${occasion.id}`, { method: "PATCH", headers, body: JSON.stringify({ action: "skip", expectedVersion: occasion.version }) })).status, 200);
      const before = await state(); await sync(); assert.deepEqual(await state(), before);
      assert.equal((await get(`?date=${today}`).then((response) => response.json())).tasks.filter((item) => item.taskId === created.task.id).length, 0);
      const regular = await fetch(`${origin}/api/tasks`, { method: "POST", headers, body: JSON.stringify({ title: "Old series", dueDate: today, repeatWeekdays: [0,1,2,3,4,5,6] }) }).then((response) => response.json());
      assert.equal((await fetch(`${origin}/api/tasks/${regular.task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "future", expectedTaskVersion: regular.task.version, title: "New series", dueDate: today, assignmentMode: "shared", assigneeIds: [], repeatWeekdays: [0,1,2,3,4,5,6], carryPolicy: "expires_daily" }) })).status, 200);
      const rows = (await get(`?date=${today}`).then((response) => response.json())).tasks.filter((item) => item.taskId === regular.task.id);
      assert.equal(rows.length, 1); assert.equal(rows[0].title, "New series");
    });

    await t.test("failed exception edit rolls back its materialization, version and audit", async () => {
      const date = addTaskDays(today, 12);
      const created = await fetch(`${origin}/api/tasks`, { method: "POST", headers, body: JSON.stringify({ title: "Rollback exception", dueDate: date, repeatWeekdays: [0,1,2,3,4,5,6] }) }).then((response) => response.json());
      const before = await state();
      await pool.query(`CREATE FUNCTION fail_daily_exception() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.task_id = '${created.task.id}'::uuid AND NEW.title_snapshot = 'Fail this edit' THEN RAISE EXCEPTION 'test-only forced exception failure'; END IF; RETURN NEW; END $$`);
      await pool.query("CREATE TRIGGER fail_daily_exception BEFORE UPDATE ON task_occurrences FOR EACH ROW EXECUTE FUNCTION fail_daily_exception()");
      try {
        const response = await fetch(`${origin}/api/tasks/${created.task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "occurrence", expectedTaskVersion: created.task.version, forecast: { generationDate: date, responsibilityMemberId: null }, title: "Fail this edit", dueDate: date, assignmentMode: "shared", assigneeIds: [] }) });
        assert.equal(response.status, 500);
        assert.deepEqual(await state(), before);
        assert.equal((await pool.query("SELECT version FROM tasks WHERE id=$1", [created.task.id])).rows[0].version, created.task.version);
      } finally { await pool.query("DROP TRIGGER fail_daily_exception ON task_occurrences"); await pool.query("DROP FUNCTION fail_daily_exception()"); }
    });

  } finally {
    server?.kill("SIGTERM");
    if (server && server.exitCode === null) await new Promise((resolve) => server.once("exit", resolve));
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
    if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
    await pool.end();
  }
});
