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
  const headers = { Origin: origin, "Content-Type": "application/json" };
  try {
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
      env: { ...process.env, DATABASE_URL: connectionString, DATABASE_URL_UNPOOLED: connectionString, BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "daily-tests-only-secret-1234567890", CODE_PEPPER: secret, TASK_GENERATION_MODE: "legacy_today" }, stdio: "ignore",
    });
    for (let attempt = 0; attempt < 150; attempt++) {
      try { if ((await fetch(origin)).ok) break; } catch { /* starting */ }
      if (server.exitCode !== null) throw new Error("test server exited");
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
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
  } finally {
    server?.kill("SIGTERM");
    if (server && server.exitCode === null) await new Promise((resolve) => server.once("exit", resolve));
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
    if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
    await pool.end();
  }
});
