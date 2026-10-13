import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { getFamilyDay, taskListEtag } from "../src/lib/tasks/family-day.ts";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) {
  throw new Error("FAMILY_UTILS_TEST_DATABASE_URL is required in CI");
}
const port = Number(process.env.FAMILY_UTILS_TEST_PORT ?? 3317);
const origin = `http://localhost:${port}`;
const secret = process.env.CODE_PEPPER ?? "ci-only-pepper-not-used-outside-ci";

test("real prepare/redeem handlers invite and recover an anonymous family member", { skip: !connectionString && "requires an isolated PostgreSQL 18 test service" }, async (t) => {
  const pool = new pg.Pool({ connectionString });
  const familyName = `route-it-${randomUUID()}`;
  let familyId;
  let server;
  let memberCookie;
  const preparedUserIds = [];
  const headers = { Origin: origin, "Content-Type": "application/json", "x-forwarded-for": `2001:db8:${randomUUID().slice(0, 4)}::1` };

  async function waitForServer() {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`Next server exited with ${server.exitCode}`);
      try {
        const response = await fetch(origin);
        if (response.ok) return;
      } catch { /* Server is still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error("Next server did not start in time");
  }

  async function prepare() {
    const response = await fetch(`${origin}/api/access/prepare`, { method: "POST", headers });
    assert.equal(response.status, 200, await response.text());
    const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]);
    assert.ok(cookies.some((cookie) => cookie.startsWith("better-auth.session_token=")), "prepare must issue an anonymous session");
    const cookie = cookies.join("; ");
    const session = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: cookie } }).then((value) => value.json());
    assert.equal(typeof session.user?.id, "string");
    preparedUserIds.push(session.user.id);
    return cookie;
  }

  async function issueCode(memberId, purpose) {
    const code = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
    const digest = createHmac("sha256", secret).update(`${purpose}\0${code}`).digest("hex");
    const { rows: [row] } = await pool.query(
      `INSERT INTO access_codes (family_id, member_id, purpose, digest, expires_at, created_by_member_id)
       VALUES ($1, $2, $3, $4, now() + interval '30 minutes', $5) RETURNING id`,
      [familyId, memberId, purpose, digest, adminId],
    );
    return { id: row.id, code };
  }

  let adminId;
  let childId;
  try {
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: connectionString,
        DATABASE_URL_UNPOOLED: connectionString,
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: "ci-only-secret-not-used-outside-ci",
        CODE_PEPPER: secret,
      },
      stdio: "ignore",
    });
    await waitForServer();

    const { rows: [family] } = await pool.query("INSERT INTO families (name) VALUES ($1) RETURNING id", [familyName]);
    familyId = family.id;
    const { rows: [admin] } = await pool.query(
      "INSERT INTO members (family_id, name, role, access_method) VALUES ($1, 'Admin test', 'administrator', 'google') RETURNING id", [familyId],
    );
    adminId = admin.id;
    const { rows: [child] } = await pool.query(
      "INSERT INTO members (family_id, name, role, access_method) VALUES ($1, 'Member test', 'member', 'code') RETURNING id", [familyId],
    );
    childId = child.id;

    await t.test("prepare is session setup only; redeem consumes invitation once and retries idempotently", async () => {
      const invitation = await issueCode(childId, "invitation");
      const firstCookie = await prepare();
      memberCookie = firstCookie;
      assert.equal((await pool.query("SELECT consumed_at FROM access_codes WHERE id=$1", [invitation.id])).rows[0].consumed_at, null);

      const redeem = (cookie) => fetch(`${origin}/api/access/redeem`, {
        method: "POST", headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ code: invitation.code }),
      });
      const secondCookie = await prepare();
      const [firstResponse, secondResponse] = await Promise.all([redeem(firstCookie), redeem(secondCookie)]);
      assert.deepEqual([firstResponse.status, secondResponse.status].sort(), [200, 400]);
      memberCookie = firstResponse.status === 200 ? firstCookie : secondCookie;
      assert.equal((await redeem(memberCookie)).status, 200, "the winning identity may safely retry the same redemption");

      const state = (await pool.query(
        `SELECT c.consumed_by_auth_user_id, d.auth_user_id, d.revoked_at
         FROM access_codes c JOIN member_devices d ON d.member_id=c.member_id WHERE c.id=$1`, [invitation.id],
      )).rows;
      assert.equal(state.length, 1);
      assert.equal(state[0].consumed_by_auth_user_id, state[0].auth_user_id);
      assert.equal(state[0].revoked_at, null);
    });

    await t.test("a regular family member cannot choose the shared meal", async () => {
      const response = await fetch(`${origin}/api/meals/selection`, {
        method: "PUT", headers: { ...headers, Cookie: memberCookie },
        body: JSON.stringify({ date: "2099-05-12", mealType: "dinner", title: "No debería guardarse", expectedVersion: 0 }),
      });
      assert.equal(response.status, 403);
      assert.equal((await pool.query(
        `SELECT count(*) FROM meal_suggestions ms JOIN meal_slots s ON s.id=ms.slot_id
         WHERE s.family_id=$1 AND s.meal_date='2099-05-12' AND s.meal_type='dinner'`, [familyId],
      )).rows[0].count, "0");
    });

    await t.test("task editing handler writes configuration, occasion and audit atomically and rejects stale versions", async () => {
      const { rows: [task] } = await pool.query(
        `INSERT INTO tasks (family_id, title, created_by_member_id, edited_by_member_id)
         VALUES ($1, 'Before edit', $2, $2) RETURNING id`, [familyId, childId],
      );
      const { rows: [occurrence] } = await pool.query(
        `INSERT INTO task_occurrences (task_id, family_id, title_snapshot, assignment_mode_snapshot)
         VALUES ($1, $2, 'Before edit', 'shared') RETURNING id`, [task.id, familyId],
      );
      const body = {
        scope: "future", expectedTaskVersion: 1, occurrenceId: occurrence.id, expectedOccurrenceVersion: 1,
        title: "Edited by route", description: "Saved by the API", dueDate: null, scheduledTime: null,
        assignmentMode: "shared", assigneeIds: [], repeatWeekdays: [], carryPolicy: "expires_daily",
      };
      const update = () => fetch(`${origin}/api/tasks/${task.id}`, {
        method: "PATCH", headers: { ...headers, Cookie: memberCookie }, body: JSON.stringify(body),
      });
      const response = await update();
      assert.equal(response.status, 200, await response.text());
      const state = (await pool.query(
        `SELECT t.title, t.version, o.title_snapshot, o.status,
           (SELECT count(*) FROM audit_events WHERE entity_type='task' AND entity_id=t.id AND action='edited_from_today') AS edits
         FROM tasks t JOIN task_occurrences o ON o.task_id=t.id WHERE t.id=$1 AND o.status='open'`, [task.id],
      )).rows[0];
      assert.equal(state.title, "Edited by route");
      assert.equal(state.title_snapshot, "Edited by route");
      assert.equal(state.version, 2);
      assert.equal(state.edits, "1");
      assert.equal((await update()).status, 409);
    });

    await t.test("suggestion withdrawal handler reads expectedVersion from DELETE body", async () => {
      const today = getFamilyDay();
      const { rows: [slot] } = await pool.query(
        "INSERT INTO meal_slots (family_id, meal_date, meal_type) VALUES ($1, $2, 'dinner') RETURNING id",
        [familyId, today],
      );
      const { rows: [suggestion] } = await pool.query(
        "INSERT INTO meal_suggestions (slot_id, author_member_id, title) VALUES ($1, $2, 'Withdrawal route test') RETURNING id",
        [slot.id, childId],
      );
      const response = await fetch(`${origin}/api/meals/suggestions/${suggestion.id}`, {
        method: "DELETE", headers: { ...headers, Cookie: memberCookie }, body: JSON.stringify({ expectedVersion: 1 }),
      });
      assert.equal(response.status, 204, await response.clone().text());

      const { rows: [state] } = await pool.query(
        `SELECT withdrawn_at, version,
           (SELECT count(*) FROM audit_events WHERE entity_type='meal_suggestion' AND entity_id=$1 AND action='withdrawn') AS withdrawals
         FROM meal_suggestions WHERE id=$1`, [suggestion.id],
      );
      assert.ok(state.withdrawn_at);
      assert.equal(state.version, 2);
      assert.equal(state.withdrawals, "1");
    });

    await t.test("carried routine completes once, can be undone, and waits for the next scheduled day", async () => {
      const today = getFamilyDay();
      const previous = new Date(`${today}T00:00:00.000Z`);
      previous.setUTCDate(previous.getUTCDate() - 1);
      const previousDay = previous.toISOString().slice(0, 10);
      const { rows: [task] } = await pool.query(
        `INSERT INTO tasks (family_id, title, assignment_mode, repeat_weekdays, carry_policy, scheduled_date, created_by_member_id, edited_by_member_id)
         VALUES ($1, 'Daily carry test', 'shared', ARRAY[0,1,2,3,4,5,6], 'carry_forward', $3, $2, $2) RETURNING id`,
        [familyId, childId, previousDay],
      );
      const { rows: [occurrence] } = await pool.query(
        `INSERT INTO task_occurrences (task_id, family_id, due_date, generation_date, title_snapshot, assignment_mode_snapshot, carry_policy_snapshot, carry_forward)
         VALUES ($1, $2, $3, $3, 'Daily carry test', 'shared', 'carry_forward', true) RETURNING id`,
        [task.id, familyId, previousDay],
      );
      const update = (action, expectedVersion) => fetch(`${origin}/api/tasks/${task.id}/occurrences/${occurrence.id}`, {
        method: "PATCH", headers: { ...headers, Cookie: memberCookie }, body: JSON.stringify({ action, expectedVersion }),
      });
      const list = () => fetch(`${origin}/api/tasks`, { headers: { Cookie: memberCookie } });
      const before = await list();
      assert.equal(before.status, 200);
      const beforeBody = await before.json();
      assert.equal(before.headers.get("etag"), taskListEtag(familyId, beforeBody.revision, today, today, "daily-0", "explicit_sync"));
      assert.equal(beforeBody.tasks.filter((item) => item.taskId === task.id && item.status === "open").length, 1);
      await assert.rejects(
        pool.query(
          `INSERT INTO task_occurrences (task_id, family_id, due_date, generation_date, title_snapshot, assignment_mode_snapshot, carry_policy_snapshot, carry_forward)
           VALUES ($1, $2, $3, $3, 'Duplicate carry test', 'shared', 'carry_forward', true)`,
          [task.id, familyId, today],
        ),
        { code: "23505" },
        "PostgreSQL must reject a second open carry-forward occasion for the same responsibility",
      );
      assert.equal((await update("complete", 1)).status, 200);
      await list();
      assert.deepEqual((await pool.query("SELECT status FROM task_occurrences WHERE task_id=$1 ORDER BY generation_date", [task.id])).rows.map(({ status }) => status), ["completed"]);
      assert.equal((await update("undo", 2)).status, 200);
      assert.equal((await pool.query("SELECT count(*) FROM task_occurrences WHERE task_id=$1 AND status='open'", [task.id])).rows[0].count, "1");
      const [first, second] = await Promise.all([update("complete", 3), update("complete", 3)]);
      assert.deepEqual([first.status, second.status].sort(), [200, 409]);
      const after = await list();
      const afterBody = await after.json();
      assert.equal(afterBody.tasks.filter((item) => item.taskId === task.id && item.status === "completed").length, 1);
      assert.equal((await pool.query("SELECT count(*) FROM task_occurrences WHERE task_id=$1", [task.id])).rows[0].count, "1");
      const anonymousUndo = await fetch(`${origin}/api/tasks/${task.id}/occurrences/${occurrence.id}`, {
        method: "PATCH", headers, body: JSON.stringify({ action: "undo", expectedVersion: 4 }),
      });
      assert.equal(anonymousUndo.status, 403);
    });

    await t.test("daily expiry creates today's item and old completions live in history", async () => {
      const today = getFamilyDay();
      const yesterday = new Date(`${today}T00:00:00.000Z`);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const previousDay = yesterday.toISOString().slice(0, 10);
      const { rows: [task] } = await pool.query(
        `INSERT INTO tasks (family_id, title, assignment_mode, repeat_weekdays, carry_policy, scheduled_date, created_by_member_id, edited_by_member_id)
         VALUES ($1, 'Daily expiry test', 'shared', ARRAY[0,1,2,3,4,5,6], 'expires_daily', $3, $2, $2) RETURNING id`,
        [familyId, childId, previousDay],
      );
      await pool.query(
        `INSERT INTO task_occurrences (task_id, family_id, due_date, generation_date, title_snapshot, assignment_mode_snapshot)
         VALUES ($1, $2, $3, $3, 'Daily expiry test', 'shared')`, [task.id, familyId, previousDay],
      );
      assert.equal((await fetch(`${origin}/api/tasks/sync`, { method: "POST", headers: { ...headers, Cookie: memberCookie } })).status, 200);
      const list = await fetch(`${origin}/api/tasks`, { headers: { Cookie: memberCookie } });
      assert.equal(list.status, 200, await list.clone().text().then((body) => body.slice(0, 200)));
      const items = (await list.json()).tasks.filter((item) => item.taskId === task.id);
      assert.equal(items.filter((item) => item.dueDate === today && item.status === "open").length, 1);
      assert.equal((await pool.query("SELECT status FROM task_occurrences WHERE task_id=$1 AND due_date=$2", [task.id, previousDay])).rows[0].status, "missed");
      const { rows: [pastTask] } = await pool.query(
        `INSERT INTO tasks (family_id, title, created_by_member_id, edited_by_member_id)
         VALUES ($1, 'Past completion test', $2, $2) RETURNING id`, [familyId, childId],
      );
      await pool.query(
        `INSERT INTO task_occurrences (task_id, family_id, due_date, generation_date, title_snapshot, assignment_mode_snapshot, status, completed_by_member_id, completed_at)
         VALUES ($1, $2, $3, $3, 'Past completion test', 'shared', 'completed', $4, $5)`,
        [pastTask.id, familyId, previousDay, childId, new Date(`${previousDay}T15:00:00.000Z`)],
      );
      const refreshed = await fetch(`${origin}/api/tasks`, { headers: { Cookie: memberCookie } });
      assert.equal(refreshed.status, 200, await refreshed.clone().text().then((body) => body.slice(0, 200)));
      assert.equal((await refreshed.json()).tasks.some((item) => item.taskId === pastTask.id), false);
      const history = await fetch(`${origin}/api/tasks/history`, { headers: { Cookie: memberCookie } });
      assert.equal(history.status, 200, await history.clone().text().then((body) => body.slice(0, 200)));
      assert.equal((await history.json()).items.some((item) => item.taskId === pastTask.id), true);
    });

    await t.test("members propose breakfast but cannot confirm it or register its attendance", async () => {
      const date = "2099-05-12";
      const proposed = await fetch(`${origin}/api/meals/suggestions`, {
        method: "POST", headers: { ...headers, Cookie: memberCookie },
        body: JSON.stringify({ date, mealType: "breakfast", title: "Yogurt con frutas" }),
      });
      assert.equal(proposed.status, 201);
      const confirmation = await fetch(`${origin}/api/meals/selection`, {
        method: "PUT", headers: { ...headers, Cookie: memberCookie },
        body: JSON.stringify({ date, mealType: "breakfast", title: "Yogurt", expectedVersion: 0 }),
      });
      assert.equal(confirmation.status, 403);
      const attendance = await fetch(`${origin}/api/meals/attendance`, {
        method: "PUT", headers: { ...headers, Cookie: memberCookie },
        body: JSON.stringify({ date, mealType: "breakfast", memberId: childId, status: "home" }),
      });
      assert.equal(attendance.status, 400);
    });

    await t.test("recovery from a new PWA identity revokes the previous session, not the new one", async () => {
      const { rows: [oldDevice] } = await pool.query("SELECT auth_user_id FROM member_devices WHERE member_id=$1 AND revoked_at IS NULL", [childId]);
      const oldSession = (await pool.query("SELECT token FROM session WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [oldDevice.auth_user_id])).rows[0];
      assert.ok(oldSession, "invite should have established the first device session");
      const recovery = await issueCode(childId, "recovery");
      const replacementCookie = await prepare();
      memberCookie = replacementCookie;
      const recovered = await fetch(`${origin}/api/access/redeem`, {
        method: "POST", headers: { ...headers, Cookie: replacementCookie }, body: JSON.stringify({ code: recovery.code }),
      });
      assert.equal(recovered.status, 200, await recovered.text());
      assert.equal((await pool.query("SELECT count(*) FROM session WHERE token=$1", [oldSession.token])).rows[0].count, "0");
      assert.equal((await pool.query("SELECT count(*) FROM member_devices WHERE member_id=$1 AND revoked_at IS NULL", [childId])).rows[0].count, "1");
      const familyResponse = await fetch(`${origin}/api/family`, { headers: { Cookie: replacementCookie } });
      assert.equal(familyResponse.status, 200);
    });

    await t.test("last reachable administrator is protected while an unlinked invitation does not count", async () => {
      const { rows: [device] } = await pool.query("SELECT auth_user_id FROM member_devices WHERE member_id=$1 AND revoked_at IS NULL", [childId]);
      const email = `adult-${randomUUID()}@family-utils.invalid`;
      await pool.query('UPDATE "user" SET email=$2, is_anonymous=false, email_verified=true WHERE id=$1', [device.auth_user_id, email]);
      await pool.query("UPDATE member_devices SET identity_kind='google' WHERE member_id=$1 AND auth_user_id=$2", [childId, device.auth_user_id]);
      await pool.query("UPDATE members SET role='administrator', access_method='google', google_email=$2 WHERE id=$1", [childId, email]);
      await pool.query(
        "INSERT INTO account (account_id, provider_id, user_id) VALUES ($1, 'google', $2)",
        [`provider-${randomUUID()}`, device.auth_user_id],
      );

      const patchMember = (memberId) => fetch(`${origin}/api/members/${memberId}`, {
        method: "PATCH", headers: { ...headers, Cookie: memberCookie },
        body: JSON.stringify({ action: "archive", expectedVersion: 1 }),
      });
      assert.equal((await patchMember(childId)).status, 409, "the sole administrator with a verified Google identity cannot be archived");
      assert.equal((await patchMember(adminId)).status, 200, "an administrator profile with no linked identity is not treated as recoverable access");
      assert.equal((await pool.query("SELECT archived_at IS NULL AS active FROM members WHERE id=$1", [childId])).rows[0].active, true);
      assert.equal((await pool.query("SELECT archived_at IS NOT NULL AS archived FROM members WHERE id=$1", [adminId])).rows[0].archived, true);
    });

    await t.test("real meal creation and confirmation is single-winner under concurrent HTTP requests", async () => {
      const date = "2099-05-12";
      const absent = await fetch(`${origin}/api/meals/attendance`, {
        method: "PUT", headers: { ...headers, Cookie: memberCookie },
        body: JSON.stringify({ date, mealType: "dinner", memberId: childId, status: "away" }),
      });
      assert.equal(absent.status, 200, "attendance is informational and may mark everyone absent");
      const revisionBefore = Number((await pool.query("SELECT menus_revision FROM families WHERE id=$1", [familyId])).rows[0].menus_revision);
      const confirm = () => fetch(`${origin}/api/meals/selection`, {
        method: "PUT", headers: { ...headers, Cookie: memberCookie },
        body: JSON.stringify({ date, mealType: "dinner", title: "PRUEBA concurrencia", expectedVersion: 0 }),
      });
      const [first, second] = await Promise.all([confirm(), confirm()]);
      assert.deepEqual([first.status, second.status].sort(), [200, 409]);
      const winner = await (first.status === 200 ? first : second).json();
      assert.equal(winner.pendingAttendance, false);
      const [selection] = (await pool.query(
        `SELECT s.version, s.suggestion_id, s.confirmed_by_member_id, count(a.id)::int AS audit_count,
           (SELECT count(*)::int FROM meal_suggestions ms WHERE ms.slot_id=s.slot_id AND ms.title='PRUEBA concurrencia') AS ideas
         FROM meal_groups s JOIN meal_slots ms ON ms.id=s.slot_id
         LEFT JOIN audit_events a ON a.entity_id=s.slot_id AND a.entity_type='meal_selection' AND a.action='confirmed'
         WHERE ms.family_id=$1 AND ms.meal_date=$2 AND ms.meal_type='dinner'
         GROUP BY s.slot_id, s.version, s.suggestion_id, s.confirmed_by_member_id`, [familyId, date],
      )).rows;
      assert.equal(selection.version, 1);
      assert.equal(selection.suggestion_id, winner.suggestion.id);
      assert.equal(selection.confirmed_by_member_id, childId);
      assert.equal(selection.audit_count, 1);
      assert.equal(selection.ideas, 1, "the losing request must not leave an orphan idea");
      assert.equal(Number((await pool.query("SELECT menus_revision FROM families WHERE id=$1", [familyId])).rows[0].menus_revision), revisionBefore + 1);

      await pool.query("UPDATE meal_groups SET confirmed_by_member_id=$1 WHERE suggestion_id=$2", [adminId, winner.suggestion.id]);
      const weekStart = "2099-05-11";
      const mealsResponse = await fetch(`${origin}/api/meals?weekStart=${weekStart}`, { headers: { Cookie: memberCookie } });
      assert.equal(mealsResponse.status, 200, await mealsResponse.clone().text());
      const mealsBody = await mealsResponse.json();
      const selectedMeal = mealsBody.meals.find((meal) => meal.date === date && meal.mealType === "dinner");
      assert.deepEqual(
        {
          proposedById: selectedMeal.selection.proposedById,
          proposedByName: selectedMeal.selection.proposedByName,
          confirmedByMemberId: selectedMeal.selection.confirmedByMemberId,
          confirmedByName: selectedMeal.selection.confirmedByName,
        },
        { proposedById: childId, proposedByName: "Member test", confirmedByMemberId: adminId, confirmedByName: "Admin test" },
      );
      assert.equal(selectedMeal.selection.title, "PRUEBA concurrencia");
    });

    await t.test("four-meal weeks are read-only, cache varies by week, and compact meals have no attendance", async () => {
      const before = (await pool.query("SELECT count(*)::int AS count FROM meal_slots WHERE family_id=$1", [familyId])).rows[0].count;
      const week = await fetch(`${origin}/api/meals?weekStart=2099-05-11`, { headers: { Cookie: memberCookie } });
      assert.equal(week.status, 200);
      const etag = week.headers.get("etag");
      const data = await week.json();
      assert.equal(data.meals.length, 28);
      assert.deepEqual(data.meals.slice(0, 4).map((meal) => meal.mealType), ["breakfast", "lunch", "snack", "dinner"]);
      assert.ok(data.meals.filter((meal) => ["breakfast", "snack"].includes(meal.mealType)).every((meal) => meal.attendance.length === 0));
      const cached = await fetch(`${origin}/api/meals?weekStart=2099-05-11`, { headers: { Cookie: memberCookie, "If-None-Match": etag } });
      assert.equal(cached.status, 304);
      const nextWeek = await fetch(`${origin}/api/meals?weekStart=2099-05-18`, { headers: { Cookie: memberCookie, "If-None-Match": etag } });
      assert.equal(nextWeek.status, 200);
      assert.notEqual(nextWeek.headers.get("etag"), etag);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM meal_slots WHERE family_id=$1", [familyId])).rows[0].count, before);
      for (const mealType of ["breakfast", "snack"]) {
        const confirmation = await fetch(`${origin}/api/meals/selection`, {
          method: "PUT", headers: { ...headers, Cookie: memberCookie },
          body: JSON.stringify({ date: "2099-05-12", mealType, title: "Frutas", expectedVersion: 0 }),
        });
        assert.equal(confirmation.status, 200);
        assert.equal((await confirmation.json()).pendingAttendance, false);
      }
    });

    await t.test("a failed selection after inserting a new idea rolls the whole transaction back", async () => {
      const date = "2099-05-14";
      await pool.query("DROP TRIGGER IF EXISTS fail_test_meal_selection_insert ON meal_groups");
      await pool.query("DROP FUNCTION IF EXISTS fail_test_meal_selection_insert()");
      await pool.query(`CREATE OR REPLACE FUNCTION fail_test_meal_selection_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM meal_slots WHERE id=NEW.slot_id AND family_id='${familyId}'::uuid AND meal_date='${date}'::date) THEN
            RAISE EXCEPTION 'forced selection failure';
          END IF;
          RETURN NEW;
        END
      $$`);
      await pool.query(`CREATE TRIGGER fail_test_meal_selection_insert BEFORE UPDATE OF suggestion_id ON meal_groups
        FOR EACH ROW EXECUTE FUNCTION fail_test_meal_selection_insert()`);
      try {
        const response = await fetch(`${origin}/api/meals/selection`, {
          method: "PUT", headers: { ...headers, Cookie: memberCookie },
          body: JSON.stringify({ date, mealType: "dinner", title: "No debe quedar suelta", expectedVersion: 0 }),
        });
        assert.equal(response.status, 500);
        const state = await pool.query(
          `SELECT
             (SELECT count(*) FROM meal_slots WHERE family_id=$1 AND meal_date=$2 AND meal_type='dinner') AS slots,
             (SELECT count(*) FROM meal_suggestions ms JOIN meal_slots s ON s.id=ms.slot_id WHERE s.family_id=$1 AND s.meal_date=$2 AND s.meal_type='dinner') AS ideas,
             (SELECT count(*) FROM meal_groups ms JOIN meal_slots s ON s.id=ms.slot_id WHERE s.family_id=$1 AND s.meal_date=$2 AND s.meal_type='dinner') AS selections,
             (SELECT count(*) FROM audit_events ae JOIN meal_suggestions ms ON ms.id=ae.entity_id JOIN meal_slots s ON s.id=ms.slot_id
              WHERE ae.family_id=$1 AND ae.entity_type='meal_suggestion' AND ae.action='created_and_confirmed' AND s.meal_date=$2 AND s.meal_type='dinner') AS creation_audits`, [familyId, date],
        );
        assert.deepEqual(state.rows[0], { slots: "0", ideas: "0", selections: "0", creation_audits: "0" });
      } finally {
        await pool.query("DROP TRIGGER IF EXISTS fail_test_meal_selection_insert ON meal_groups");
        await pool.query("DROP FUNCTION IF EXISTS fail_test_meal_selection_insert()");
      }
    });

    await t.test("attendance is last-write-wins, rejects cross-family targets, and past meals are closed", async () => {
      const date = "2099-05-13";
      const updateAttendance = (status, memberId = childId, day = date) => fetch(`${origin}/api/meals/attendance`, {
        method: "PUT", headers: { ...headers, Cookie: memberCookie },
        body: JSON.stringify({ date: day, mealType: "lunch", memberId, status }),
      });
      const [first, second] = await Promise.all([updateAttendance("away"), updateAttendance("home")]);
      assert.deepEqual([first.status, second.status], [200, 200]);
      const current = (await pool.query(
        `SELECT a.status,a.updated_by_member_id FROM meal_exceptions a JOIN meal_slots s ON s.id=a.slot_id
         WHERE s.family_id=$1 AND s.meal_date=$2 AND s.meal_type='lunch' AND a.member_id=$3`, [familyId,date,childId],
      )).rows[0];
      assert.ok(["home","away"].includes(current.status));
      assert.equal(current.updated_by_member_id,childId);

      const { rows: [otherFamily] } = await pool.query("INSERT INTO families (name) VALUES ($1) RETURNING id", [`foreign-${randomUUID()}`]);
      const { rows: [foreignMember] } = await pool.query(
        "INSERT INTO members (family_id, name, role, access_method) VALUES ($1, 'Foreign member', 'member', 'code') RETURNING id", [otherFamily.id],
      );
      assert.equal((await updateAttendance("away", foreignMember.id)).status, 400);

      const past = new Date(`${getFamilyDay()}T00:00:00Z`);
      past.setUTCDate(past.getUTCDate() - 1);
      const pastDate = past.toISOString().slice(0, 10);
      const closed = await updateAttendance("home", childId, pastDate);
      assert.equal(closed.status, 403);
      assert.equal((await closed.json()).code, "MEAL_DAY_CLOSED");
      const closedSelection = await fetch(`${origin}/api/meals/selection`, {
        method: "PUT", headers: { ...headers, Cookie: memberCookie },
        body: JSON.stringify({ date: pastDate, mealType: "dinner", title: "Día cerrado", expectedVersion: 0 }),
      });
      assert.equal(closedSelection.status, 403);
      assert.equal((await closedSelection.json()).code, "MEAL_DAY_CLOSED");
      const closedIdea = await fetch(`${origin}/api/meals/suggestions`, {
        method: "POST", headers: { ...headers, Cookie: memberCookie },
        body: JSON.stringify({ date: pastDate, mealType: "dinner", title: "Día cerrado" }),
      });
      assert.equal(closedIdea.status, 403);
      assert.equal((await closedIdea.json()).code, "MEAL_DAY_CLOSED");
      await pool.query("DELETE FROM members WHERE id=$1", [foreignMember.id]);
      await pool.query("DELETE FROM families WHERE id=$1", [otherFamily.id]);
    });

    await t.test("lunch groups, routines, snapshots and holidays preserve planned dishes", async () => {
      const date="2099-06-03";
      const send=(path,method,body)=>fetch(`${origin}/api/meals/${path}`,{method,headers:{...headers,Cookie:memberCookie},body:JSON.stringify(body)});
      const read=async(day=date)=>{
        const response=await fetch(`${origin}/api/meals?weekStart=${day}`,{headers:{Cookie:memberCookie}});
        assert.equal(response.status,200);
        return (await response.json()).meals.find(meal=>meal.date===day&&meal.mealType==="lunch");
      };
      const routine=async(startsOn,status)=>{
        const response=await send("routines","PUT",{memberId:childId,mealType:"lunch",startsOn,name:status==="home"?"Vacaciones":"Colegio",weekdays:Array(7).fill(status)});
        assert.equal(response.status,200,await response.clone().text());
      };
      await routine("2099-06-01","packed");
      let meal=await read();
      assert.equal(meal.attendance.find(p=>p.memberId===childId).status,"packed");
      assert.equal(meal.groups.find(g=>g.kind==="packed").id,null,"pure reads synthesize the routine's lunch group");
      const home=await send("selection","PUT",{date,mealType:"lunch",title:"Tarta en casa",expectedVersion:0});
      assert.equal(home.status,200,await home.clone().text());
      meal=await read();
      assert.equal(meal.distributionOrigin,"Guardada");
      const homeGroup=meal.groups.find(g=>g.kind==="home");
      const packed=meal.groups.find(g=>g.kind==="packed");
      assert.ok(packed.id);
      const linked=await send("selection","PUT",{date,mealType:"lunch",groupId:packed.id,mode:"link",expectedVersion:0});
      assert.equal(linked.status,200);
      await routine("2099-06-03","home");
      meal=await read();
      assert.equal(meal.attendance.find(p=>p.memberId===childId).status,"packed","confirmations freeze participants");
      assert.equal(meal.groups.find(g=>g.id===packed.id).selection.title,"Tarta en casa");
      const reset=await send("distribution","DELETE",{date,mealType:"lunch"});
      assert.equal(reset.status,200);
      meal=await read();
      assert.equal(meal.distributionSaved,false);
      assert.equal(meal.attendance.find(p=>p.memberId===childId).status,"home");
      assert.equal(meal.groups.find(g=>g.id===packed.id).selection.title,"Tarta en casa","reset preserves linked dishes");
      await routine("2099-06-03","away");
      assert.equal((await read()).attendance.find(p=>p.memberId===childId).status,"away","reads after reset do not freeze again");
      const next=await send("selection","PUT",{date,mealType:"lunch",title:"Pasta en casa",groupId:homeGroup.id,expectedVersion:homeGroup.selectionVersion});
      assert.equal(next.status,200);
      const assigned=await send("attendance","PUT",{date,mealType:"lunch",memberId:childId,status:"packed",groupId:packed.id});
      assert.equal(assigned.status,200);
      meal=await read();
      assert.equal(meal.distributionOrigin,"Guardada · ajustada");
      const unlink=await send("selection","PUT",{date,mealType:"lunch",groupId:packed.id,mode:"unlink",expectedVersion:meal.groups.find(g=>g.id===packed.id).selectionVersion});
      assert.equal(unlink.status,200);
      meal=await read();
      const copy=meal.groups.find(g=>g.id===packed.id);
      assert.equal(copy.followsHome,false);assert.equal(copy.selection.title,"Pasta en casa");
      const relink=await send("selection","PUT",{date,mealType:"lunch",groupId:packed.id,mode:"link",expectedVersion:copy.selectionVersion});
      assert.equal(relink.status,200);
      meal=await read();
      const currentHome=meal.groups.find(g=>g.id===homeGroup.id);
      const cleared=await send("selection","PUT",{date,mealType:"lunch",groupId:homeGroup.id,suggestionId:null,expectedVersion:currentHome.selectionVersion});
      assert.equal(cleared.status,200);
      meal=await read();assert.equal(meal.groups.find(g=>g.id===packed.id).selection,null);
      const occupied=await send("groups","DELETE",{date,mealType:"lunch",groupId:packed.id});assert.equal(occupied.status,409);
      assert.equal((await send("attendance","PUT",{date,mealType:"lunch",memberId:childId,status:"away"})).status,200);
      assert.equal((await send("groups","DELETE",{date,mealType:"lunch",groupId:packed.id})).status,200);
      assert.equal((await read()).groups.some(g=>g.id===packed.id),false);
      const future=await read("2099-06-04");
      assert.equal(future.attendance.find(p=>p.memberId===childId).status,"away");
      assert.equal((await send("attendance","PUT",{date:"2099-06-04",mealType:"lunch",memberId:childId,status:"unknown"})).status,200);
      assert.equal((await read("2099-06-04")).attendance.find(p=>p.memberId===childId).status,"unknown");
      assert.equal((await send("attendance","PUT",{date:"2099-06-04",mealType:"lunch",memberId:childId,status:"inherit"})).status,200);
      assert.equal((await read("2099-06-04")).attendance.find(p=>p.memberId===childId).status,"away");
      const pastRoutine=await send("routines","PUT",{memberId:childId,mealType:"lunch",startsOn:"2000-01-01",weekdays:Array(7).fill("home")});
      assert.equal(pastRoutine.status,400);
      // Regular members may organize lunch groups, but cannot confirm or change routines.
      await pool.query("UPDATE members SET role='member' WHERE id=$1",[childId]);
      try {
        assert.equal((await send("groups","POST",{date,mealType:"lunch",name:"Lunchera alternativa"})).status,200);
        assert.equal((await send("selection","PUT",{date,mealType:"lunch",title:"No permitido",expectedVersion:0})).status,403);
        assert.equal((await send("routines","PUT",{memberId:childId,mealType:"lunch",startsOn:"2099-06-05",weekdays:Array(7).fill("home")})).status,403);
      } finally {await pool.query("UPDATE members SET role='administrator' WHERE id=$1",[childId]);}
    });

    await t.test("task archive and restore handlers keep overdue work visible without retroactive debt", async () => {
      const { rows: [task] } = await pool.query(
        `INSERT INTO tasks (family_id, title, created_by_member_id, edited_by_member_id)
         VALUES ($1, 'Restore route check', $2, $2) RETURNING id`, [familyId, childId],
      );
      const { rows: [occurrence] } = await pool.query(
        `INSERT INTO task_occurrences (task_id, family_id, due_date, generation_date, title_snapshot, assignment_mode_snapshot)
         VALUES ($1, $2, current_date - 1, current_date - 1, 'Restore route check', 'shared') RETURNING id`, [task.id, familyId],
      );
      const updateStatus = (action, expectedVersion) => fetch(`${origin}/api/tasks/${task.id}/status`, {
        method: "PATCH", headers: { ...headers, Cookie: memberCookie }, body: JSON.stringify({ action, expectedVersion }),
      });
      const archivedResponse = await updateStatus("archive", 1);
      assert.equal(archivedResponse.status, 200);
      const archivedTask = await archivedResponse.json();
      assert.equal((await pool.query("SELECT status FROM task_occurrences WHERE id=$1", [occurrence.id])).rows[0].status, "archived");
      const restoredResponse = await updateStatus("restore", archivedTask.version);
      assert.equal(restoredResponse.status, 200);
      const familyDay = getFamilyDay();
      const restored = (await pool.query("SELECT status, due_date >= $2::date AS not_overdue FROM task_occurrences WHERE id=$1", [occurrence.id, familyDay])).rows[0];
      assert.equal(restored.status, "open");
      assert.equal(restored.not_overdue, true);
    });

    await t.test("undo handler refuses to reopen a carried routine after its next occasion exists", async () => {
      const { rows: [task] } = await pool.query(
        `INSERT INTO tasks (family_id, title, assignment_mode, repeat_weekdays, carry_policy, scheduled_date, created_by_member_id, edited_by_member_id)
         VALUES ($1, 'Carry route check', 'shared', ARRAY[1], 'carry_forward', current_date, $2, $2) RETURNING id`, [familyId, childId],
      );
      const { rows: [older] } = await pool.query(
        `INSERT INTO task_occurrences (task_id, family_id, due_date, generation_date, title_snapshot, assignment_mode_snapshot, carry_policy_snapshot, carry_forward, status, completed_by_member_id, completed_at)
         VALUES ($1, $2, current_date - 7, current_date - 7, 'Carry route check', 'shared', 'carry_forward', true, 'completed', $3, now()) RETURNING id`, [task.id, familyId, childId],
      );
      await pool.query(
        `INSERT INTO task_occurrences (task_id, family_id, due_date, generation_date, title_snapshot, assignment_mode_snapshot, carry_policy_snapshot, carry_forward, status)
         VALUES ($1, $2, current_date, current_date, 'Carry route check', 'shared', 'carry_forward', true, 'open')`, [task.id, familyId],
      );
      const response = await fetch(`${origin}/api/tasks/${task.id}/occurrences/${older.id}`, {
        method: "PATCH", headers: { ...headers, Cookie: memberCookie }, body: JSON.stringify({ action: "undo", expectedVersion: 1 }),
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error, "No se puede deshacer: la siguiente ocasión ya fue asumida, modificada o completada. Abrila para corregirla o pedí ayuda a un administrador.");
      assert.equal((await pool.query("SELECT status FROM task_occurrences WHERE id=$1", [older.id])).rows[0].status, "completed");
    });
  } finally {
    server?.kill("SIGTERM");
    const authIds = familyId
      ? (await pool.query("SELECT auth_user_id FROM member_devices WHERE member_id IN (SELECT id FROM members WHERE family_id=$1)", [familyId])).rows.map(({ auth_user_id }) => auth_user_id)
      : [];
    if (familyId) {
      await pool.query("DELETE FROM meal_selections WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id=$1)", [familyId]);
      await pool.query("DELETE FROM meal_attendance WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id=$1)", [familyId]);
      await pool.query("DELETE FROM meal_groups WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id=$1)", [familyId]);
      await pool.query("DELETE FROM meal_suggestions WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id=$1)", [familyId]);
      await pool.query("DELETE FROM meal_slots WHERE family_id=$1", [familyId]);
      await pool.query("DELETE FROM meal_routines WHERE family_id=$1", [familyId]);
      await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
    }
    const idsToDelete = [...new Set([...authIds, ...preparedUserIds])];
    if (idsToDelete.length) await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [idsToDelete]);
    await pool.end();
  }
});
