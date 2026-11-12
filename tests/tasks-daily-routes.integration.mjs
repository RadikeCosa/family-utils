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
  const extraUsers = [];
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
    const code = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
    const digest = createHmac("sha256", secret).update(`invitation\0${code}`).digest("hex");
    await pool.query("INSERT INTO access_codes(family_id,member_id,purpose,digest,expires_at,created_by_member_id) VALUES($1,$2,'invitation',$3,now()+interval '30 minutes',$2)", [familyId, memberId, digest]);
    assert.equal((await fetch(`${origin}/api/access/redeem`, { method: "POST", headers, body: JSON.stringify({ code }) })).status, 200);
    const get = (query = "") => fetch(`${origin}/api/tasks${query}`, { headers });
    const state = async () => (await pool.query("SELECT revision,(SELECT count(*) FROM task_occurrences WHERE family_id=$1) AS occasions,(SELECT count(*) FROM audit_events WHERE family_id=$1) AS audit FROM families WHERE id=$1", [familyId])).rows[0];

    await t.test("editing an overdue simple task preserves its only open occasion and date", async () => {
      const yesterday = addTaskDays(today, -1);
      const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,scheduled_date,created_by_member_id,edited_by_member_id) VALUES($1,'Overdue original',$3,$2,$2) RETURNING *", [familyId, memberId, yesterday]);
      const { rows: [occasion] } = await pool.query("INSERT INTO task_occurrences(task_id,family_id,due_date,generation_date,title_snapshot,assignment_mode_snapshot) VALUES($1,$2,$3,$3,'Overdue original','shared') RETURNING *", [task.id, familyId, yesterday]);
      const response = await fetch(`${origin}/api/tasks/${task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "future", expectedTaskVersion: task.version, title: "Overdue edited", dueDate: yesterday, scheduledTime: null, assignmentMode: "shared", assigneeIds: [], repeatWeekdays: [], carryPolicy: "expires_daily" }) });
      assert.equal(response.status, 200, await response.text());
      const open = (await pool.query("SELECT * FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows;
      assert.equal(open.length, 1, "editing must not duplicate the overdue pending occasion");
      assert.equal(open[0].id, occasion.id);
      assert.equal(open[0].title_snapshot, "Overdue edited");
      assert.equal(open[0].due_date.toISOString().slice(0, 10), yesterday);
    });

    await t.test("simple edits preserve identities across dates and reconcile individual responsibilities", async () => {
      const { rows: [other] } = await pool.query("INSERT INTO members(family_id,name,role,access_method) VALUES($1,'Other fixture','member','code') RETURNING id", [familyId]);
      const patch = (id, body) => fetch(`${origin}/api/tasks/${id}`, { method: "PATCH", headers, body: JSON.stringify(body) });
      for (const date of [null, addTaskDays(today, -3), addTaskDays(today, 2)]) {
        const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,scheduled_date,assignment_mode,created_by_member_id,edited_by_member_id) VALUES($1,'Individual fixture',$3,'individual',$2,$2) RETURNING *", [familyId, memberId, date]);
        await pool.query("INSERT INTO task_assignees(task_id,member_id) VALUES($1,$2)", [task.id, memberId]);
        const { rows: [occasion] } = await pool.query("INSERT INTO task_occurrences(task_id,family_id,due_date,generation_date,title_snapshot,assignment_mode_snapshot,responsibility_member_id) VALUES($1,$2,$3,$3,'Individual fixture','individual',$4) RETURNING *", [task.id, familyId, date, memberId]);
        const body = { scope: "future", expectedTaskVersion: 1, title: "Edited individual", dueDate: date, assignmentMode: "individual", assigneeIds: [memberId, other.id], repeatWeekdays: [], carryPolicy: "expires_daily" };
        let response = await patch(task.id, body);
        assert.equal(response.status, 200, await response.text());
        let open = (await pool.query("SELECT * FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows;
        assert.equal(open.length, 2);
        assert.ok(open.some((item) => item.id === occasion.id && item.responsibility_member_id === memberId));
        assert.equal((await patch(task.id, body)).status, 409);
        response = await patch(task.id, { ...body, expectedTaskVersion: 2, assigneeIds: [memberId], dueDate: addTaskDays(today, 5) });
        assert.equal(response.status, 200, await response.text());
        open = (await pool.query("SELECT * FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows;
        assert.equal(open.length, 1); assert.equal(open[0].id, occasion.id);
        assert.equal(open[0].due_date.toISOString().slice(0,10), addTaskDays(today, 5));
        assert.equal((await pool.query("SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action='edited'", [occasion.id])).rows[0].count, '2');
        assert.equal((await pool.query("SELECT count(*) FROM task_occurrences WHERE task_id=$1 AND status='archived'", [task.id])).rows[0].count, '1');
      }
    });

    await t.test("failed simple occasion update rolls back task, revision and audit", async () => {
      const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,created_by_member_id,edited_by_member_id) VALUES($1,'Rollback simple',$2,$2) RETURNING *", [familyId, memberId]);
      await pool.query("INSERT INTO task_occurrences(task_id,family_id,title_snapshot,assignment_mode_snapshot) VALUES($1,$2,'Rollback simple','shared')", [task.id, familyId]);
      const before = await state();
      await pool.query(`CREATE FUNCTION fail_simple_edit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.task_id = '${task.id}'::uuid THEN RAISE EXCEPTION 'test-only simple failure'; END IF; RETURN NEW; END $$`);
      await pool.query("CREATE TRIGGER fail_simple_edit BEFORE UPDATE ON task_occurrences FOR EACH ROW EXECUTE FUNCTION fail_simple_edit()");
      try {
        const response = await fetch(`${origin}/api/tasks/${task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "future", expectedTaskVersion: 1, title: "Must rollback", assignmentMode: "shared", assigneeIds: [], repeatWeekdays: [], carryPolicy: "expires_daily" }) });
        assert.equal(response.status, 500);
        assert.deepEqual(await state(), before);
        const saved = (await pool.query("SELECT title,version FROM tasks WHERE id=$1", [task.id])).rows[0];
        assert.deepEqual(saved, { title: "Rollback simple", version: 1 });
      } finally {
        await pool.query("DROP TRIGGER fail_simple_edit ON task_occurrences"); await pool.query("DROP FUNCTION fail_simple_edit()");
      }
    });

    const invariantViolations = async () => (await pool.query(`
      SELECT id::text AS violation FROM task_occurrences WHERE family_id=$1
        AND carry_forward <> (carry_policy_snapshot = 'carry_forward')
      UNION ALL
      SELECT o.task_id::text FROM task_occurrences o JOIN tasks t ON t.id=o.task_id
        WHERE o.family_id=$1 AND o.status='open'
          AND (coalesce(cardinality(t.repeat_weekdays),0)=0 OR t.carry_policy='carry_forward')
          AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.family_id=$1
            AND a.entity_type='occurrence' AND a.entity_id=o.id AND a.action='edited' AND a.before ? 'task')
        GROUP BY o.task_id,o.responsibility_member_id HAVING count(*) > 1`, [familyId])).rows;

    await t.test("fixture baseline has consistent policies before exercising conversions", async () => {
      assert.deepEqual(await invariantViolations(), []);
    });

    await t.test("preexisting duplicate simple pending work is reported without silent repair", async () => {
      const yesterday = addTaskDays(today,-1);
      const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,scheduled_date,created_by_member_id,edited_by_member_id) VALUES($1,'Preexisting duplicate',$3,$2,$2) RETURNING id", [familyId, memberId, yesterday]);
      try {
        for (const date of [yesterday,today]) await pool.query("INSERT INTO task_occurrences(task_id,family_id,due_date,generation_date,title_snapshot,assignment_mode_snapshot) VALUES($1,$2,$3,$3,'Preexisting duplicate','shared')", [task.id, familyId, date]);
        assert.ok((await invariantViolations()).some((row) => row.violation === task.id));
        const before = await state();
        const response = await fetch(`${origin}/api/tasks/${task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "future", expectedTaskVersion: 1, title: "Must not silently fix", dueDate: yesterday, assignmentMode: "shared", assigneeIds: [], repeatWeekdays: [] }) });
        assert.equal(response.status, 409);
        assert.deepEqual(await state(), before);
        const rows = (await pool.query("SELECT title_snapshot FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows;
        assert.deepEqual(rows, [{ title_snapshot: "Preexisting duplicate" },{ title_snapshot: "Preexisting duplicate" }]);
      } finally { await pool.query("DELETE FROM tasks WHERE id=$1", [task.id]); }
      assert.deepEqual(await invariantViolations(), []);
    });

    await t.test("explicit carry accepts no repeat, preserves pending through conversions and omitted edit policy", async () => {
      const create = await fetch(`${origin}/api/tasks`, { method: "POST", headers, body: JSON.stringify({ title: "Persistent simple", carryPolicy: "carry_forward" }) });
      assert.equal(create.status, 201, await create.clone().text());
      const { task, occurrences: [occasion] } = await create.json();
      assert.equal(occasion.dueDate, null); assert.equal(occasion.carryForward, true);
      const body = { scope: "future", expectedTaskVersion: task.version, title: task.title, assignmentMode: "shared", assigneeIds: [], repeatWeekdays: [0,1,2,3,4,5,6] };
      const patch = (value) => fetch(`${origin}/api/tasks/${task.id}`, { method: "PATCH", headers, body: JSON.stringify(value) });
      let response = await patch(body); assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).task.carryPolicy, "carry_forward");
      let open = (await pool.query("SELECT * FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows;
      assert.equal(open.length, 1); assert.equal(open[0].id, occasion.id); assert.equal(open[0].due_date, null);
      response = await patch({ ...body, expectedTaskVersion: task.version + 1, repeatWeekdays: [] });
      assert.equal(response.status, 200, await response.text());
      open = (await pool.query("SELECT * FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows;
      assert.equal(open.length, 1); assert.equal(open[0].id, occasion.id);
      const listed = await get(`?date=${today}`).then((res) => res.json());
      const item = listed.tasks.find((row) => row.id === occasion.id);
      assert.equal(item.effectiveDate, today);
      assert.equal(item.dueDate, null);
      assert.deepEqual(await invariantViolations(), []);
    });

    await t.test("renaming a converted overdue routine preserves its occasion date until explicit rescheduling", async () => {
      const yesterday = addTaskDays(today, -1);
      const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,scheduled_date,repeat_weekdays,carry_policy,created_by_member_id,edited_by_member_id) VALUES($1,'Converted overdue',$3,ARRAY[0,1,2,3,4,5,6],'carry_forward',$2,$2) RETURNING *", [familyId, memberId, today]);
      const { rows: [occasion] } = await pool.query("INSERT INTO task_occurrences(task_id,family_id,due_date,generation_date,title_snapshot,assignment_mode_snapshot,carry_policy_snapshot,carry_forward) VALUES($1,$2,$3,$3,'Converted overdue','shared','carry_forward',true) RETURNING *", [task.id, familyId, yesterday]);
      const patch = (expectedTaskVersion, dueDate, title) => fetch(`${origin}/api/tasks/${task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "future", occurrenceId: occasion.id, expectedTaskVersion, title, dueDate, assignmentMode: "shared", assigneeIds: [], repeatWeekdays: [], carryPolicy: "carry_forward" }) });
      let response = await patch(1, today, "Converted simple"); assert.equal(response.status, 200, await response.text());
      response = await patch(2, yesterday, "Renamed simple"); assert.equal(response.status, 200, await response.text());
      let pending = (await pool.query("SELECT id,due_date FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows;
      assert.equal(pending.length, 1); assert.equal(pending[0].id, occasion.id);
      assert.equal(pending[0].due_date.toISOString().slice(0,10), yesterday);
      response = await patch(3, addTaskDays(today, 2), "Rescheduled simple"); assert.equal(response.status, 200, await response.text());
      pending = (await pool.query("SELECT due_date FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows;
      assert.equal(pending[0].due_date.toISOString().slice(0,10), addTaskDays(today, 2));
    });

    await t.test("omitting an undated converted routine advances from the omission day", async () => {
      const { task, occurrences: [occasion] } = await fetch(`${origin}/api/tasks`, { method: "POST", headers, body: JSON.stringify({ title: "Undated omission", carryPolicy: "carry_forward" }) }).then((res) => res.json());
      const converted = await fetch(`${origin}/api/tasks/${task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "future", expectedTaskVersion: task.version, title: task.title, assignmentMode: "shared", assigneeIds: [], repeatWeekdays: [0,1,2,3,4,5,6] }) });
      assert.equal(converted.status, 200);
      const current = (await pool.query("SELECT version FROM task_occurrences WHERE id=$1", [occasion.id])).rows[0];
      const omitted = await fetch(`${origin}/api/tasks/${task.id}/occurrences/${occasion.id}`, { method: "PATCH", headers, body: JSON.stringify({ action: "skip", expectedVersion: current.version }) });
      assert.equal(omitted.status, 200, await omitted.text());
      const open = (await pool.query("SELECT id FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows;
      assert.equal(open.length, 0, "omission must not immediately recreate today's pending work");
      const future = await get(`?date=${addTaskDays(today,1)}`).then((res) => res.json());
      assert.equal(future.tasks.filter((item) => item.taskId === task.id && item.kind === "forecast").length, 1);
    });

    await t.test("removing repetition preserves explicit future exceptions and current pending", async () => {
      const future = addTaskDays(today, 5);
      const { task } = await fetch(`${origin}/api/tasks`, { method: "POST", headers, body: JSON.stringify({ title: "Exception series", dueDate: today, repeatWeekdays: [0,1,2,3,4,5,6], carryPolicy: "expires_daily" }) }).then((res) => res.json());
      const edited = await fetch(`${origin}/api/tasks/${task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "occurrence", expectedTaskVersion: task.version, forecast: { generationDate: future, responsibilityMemberId: null }, title: "Explicit future title", dueDate: future, scheduledTime: "18:00", assignmentMode: "shared", assigneeIds: [] }) });
      assert.equal(edited.status, 200, await edited.clone().text());
      const result = await edited.json();
      const response = await fetch(`${origin}/api/tasks/${task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "future", expectedTaskVersion: result.task.version, title: "Now simple", dueDate: today, assignmentMode: "shared", assigneeIds: [], repeatWeekdays: [], carryPolicy: "carry_forward" }) });
      assert.equal(response.status, 200, await response.text());
      const saved = (await pool.query("SELECT * FROM task_occurrences WHERE id=$1", [result.occurrences[0].id])).rows[0];
      assert.equal(saved.status, "open"); assert.equal(saved.title_snapshot, "Explicit future title"); assert.equal(saved.scheduled_time_snapshot, "18:00:00");
      const second = await fetch(`${origin}/api/tasks/${task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "future", expectedTaskVersion: result.task.version + 1, title: "Second simple edit", dueDate: today, assignmentMode: "shared", assigneeIds: [], repeatWeekdays: [] }) });
      assert.equal(second.status, 200, await second.text());
      const stillExplicit = (await pool.query("SELECT title_snapshot,version FROM task_occurrences WHERE id=$1", [saved.id])).rows[0];
      assert.deepEqual(stillExplicit, { title_snapshot: saved.title_snapshot, version: saved.version });
      const futureList = await get(`?date=${future}`).then((res) => res.json());
      assert.equal(futureList.tasks.find((item) => item.id === saved.id).explicitException, true);

      assert.equal((await pool.query("SELECT count(*) FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows[0].count, "2");
      assert.deepEqual(await invariantViolations(), []);
    });

    await t.test("double completion is serialized and undo blocks persisted successors", async () => {
      const { task, occurrences: [occasion] } = await fetch(`${origin}/api/tasks`, { method: "POST", headers, body: JSON.stringify({ title: "Concurrent carry", dueDate: today, carryPolicy: "carry_forward" }) }).then((res) => res.json());
      const { rows: [other] } = await pool.query("INSERT INTO members(family_id,name,role,access_method) VALUES($1,'Concurrent fixture','member','code') RETURNING id", [familyId]);
      const otherHeaders = { ...headers }; delete otherHeaders.Cookie;
      const prepared = await fetch(`${origin}/api/access/prepare`, { method: "POST", headers: otherHeaders });
      assert.equal(prepared.status, 200);
      otherHeaders.Cookie = prepared.headers.getSetCookie().map((value) => value.split(";",1)[0]).join("; ");
      extraUsers.push((await fetch(`${origin}/api/auth/get-session`, { headers: otherHeaders }).then((res) => res.json())).user.id);
      const code = randomUUID().replaceAll("-", "").slice(0,10).toUpperCase();
      const digest = createHmac("sha256", secret).update(`invitation\0${code}`).digest("hex");
      await pool.query("INSERT INTO access_codes(family_id,member_id,purpose,digest,expires_at,created_by_member_id) VALUES($1,$2,'invitation',$3,now()+interval '30 minutes',$2)", [familyId, other.id, digest]);
      assert.equal((await fetch(`${origin}/api/access/redeem`, { method: "POST", headers: otherHeaders, body: JSON.stringify({ code }) })).status, 200);
      const act = (action, expectedVersion, actorHeaders = headers) => fetch(`${origin}/api/tasks/${task.id}/occurrences/${occasion.id}`, { method: "PATCH", headers: actorHeaders, body: JSON.stringify({ action, expectedVersion }) });
      const responses = await Promise.all([act("complete", occasion.version), act("complete", occasion.version, otherHeaders)]);
      assert.deepEqual(responses.map((res) => res.status).sort(), [200,409]);
      const winnerHeaders = responses[0].status === 200 ? headers : otherHeaders;
      assert.equal((await act("undo", occasion.version + 1, winnerHeaders)).status, 200);
      assert.equal((await act("complete", occasion.version + 2)).status, 200);
      await pool.query("INSERT INTO task_occurrences(task_id,family_id,due_date,generation_date,title_snapshot,assignment_mode_snapshot,carry_policy_snapshot,carry_forward) VALUES($1,$2,$3,$3,'Persisted successor','shared','carry_forward',true)", [task.id, familyId, addTaskDays(today, 1)]);
      assert.equal((await act("undo", occasion.version + 3)).status, 409);
      assert.deepEqual(await invariantViolations(), []);
    });

    await t.test("discarding an individual occasion leaves the other responsibility open", async () => {
      const { rows: [other] } = await pool.query("INSERT INTO members(family_id,name,role,access_method) VALUES($1,'Individual discard fixture','member','code') RETURNING id", [familyId]);
      const { task, occurrences: occasions } = await fetch(`${origin}/api/tasks`, { method: "POST", headers, body: JSON.stringify({ title: "Separate responsibilities", assignmentMode: "individual", assigneeIds: [memberId, other.id], carryPolicy: "carry_forward" }) }).then((res) => res.json());
      const mine = occasions.find((item) => item.responsibilityMemberId === memberId);
      const response = await fetch(`${origin}/api/tasks/${task.id}/occurrences/${mine.id}`, { method: "PATCH", headers, body: JSON.stringify({ action: "skip", expectedVersion: mine.version }) });
      assert.equal(response.status, 200);
      const open = (await pool.query("SELECT responsibility_member_id FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows;
      assert.deepEqual(open, [{ responsibility_member_id: other.id }]);
      const edit = await fetch(`${origin}/api/tasks/${task.id}`, { method: "PATCH", headers, body: JSON.stringify({ scope: "future", expectedTaskVersion: task.version, title: "Still separate", assignmentMode: "individual", assigneeIds: [memberId, other.id], repeatWeekdays: [] }) });
      assert.equal(edit.status, 200, await edit.text());
      assert.equal((await pool.query("SELECT count(*) FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows[0].count, "1");

      assert.deepEqual(await invariantViolations(), []);
    });

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

    await t.test("undated effective dates paginate with stable open-first order", async () => {
      const ids = [];
      try {
        for (let i = 1; i <= 60; i++) {
          const { rows: [task] } = await pool.query("INSERT INTO tasks(family_id,title,created_by_member_id,edited_by_member_id) VALUES($1,'Null page fixture',$2,$2) RETURNING id", [familyId, memberId]);
          ids.push(task.id);
          await pool.query("INSERT INTO task_occurrences(task_id,family_id,title_snapshot,assignment_mode_snapshot,created_at) VALUES($1,$2,'Null page fixture','shared',$3::date + interval '12 hours')", [task.id, familyId, addTaskDays(today, -i)]);
        }
        let cursor, total, all = [];
        do {
          const page = await get(`?date=${today}${cursor ? `&cursor=${cursor}` : ""}`).then((res) => res.json());
          total ??= page.total; assert.equal(page.total, total);
          all.push(...page.tasks); cursor = page.nextCursor;
        } while (cursor);
        assert.equal(all.length, total);
        assert.equal(new Set(all.map((item) => item.key)).size, all.length);
        const undated = all.filter((item) => ids.includes(item.taskId));
        assert.equal(undated.length, 60);
        assert.deepEqual(undated.map((item) => item.effectiveDate), undated.map((item) => item.effectiveDate).sort());
        const firstDone = all.findIndex((item) => item.status === "completed");
        if (firstDone >= 0) assert.ok(all.slice(firstDone).every((item) => item.status === "completed"));
      } finally { await pool.query("DELETE FROM tasks WHERE id=ANY($1::uuid[])", [ids]); }
    });

    await t.test("ordering version invalidates pre-change cursors and cache tags", async () => {
      const response = await get(`?date=${today}`);
      const body = await response.json();
      const cursor = Buffer.from(JSON.stringify({ date: today, revision: body.revision, section: "daily", offset: 0 })).toString("base64url");
      assert.equal((await get(`?date=${today}&cursor=${cursor}`)).status, 409);
      const oldEtag = response.headers.get("etag").replace('"tasks-v2-', '"');
      const fresh = await fetch(`${origin}/api/tasks?date=${today}`, { headers: { ...headers, "if-none-match": oldEtag } });
      assert.equal(fresh.status, 200);
      const unchanged = await fetch(`${origin}/api/tasks?date=${today}`, { headers: { ...headers, "if-none-match": response.headers.get("etag") } });
      assert.equal(unchanged.status, 304);
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
    await pool.query("DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE family_id=$1)", [familyId]);
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
    for (const extraUser of extraUsers) await pool.query('DELETE FROM "user" WHERE id=$1', [extraUser]);
    if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
    await pool.end();
  }
});
