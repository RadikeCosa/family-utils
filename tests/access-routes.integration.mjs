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
  let prepareSequence = 0;
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
    const response = await fetch(`${origin}/api/access/prepare`, { method: "POST", headers: {
      ...headers, "x-forwarded-for": `2001:db8:${randomUUID().slice(0, 4)}:${++prepareSequence}::1`,
    } });
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
        GOOGLE_AUTO_LINK_ENABLED: "true",
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

    // Daily planner replacement, permissions, catalogs and rollback are covered in menus-routes.integration.mjs.
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
      await pool.query("INSERT INTO meal_daily_plans(slot_id,plan,original,updated_by_member_id) VALUES($1,$2,'{}',$3)", [slot.id, JSON.stringify({menus:[{number:1,selection:null}],people:[]}), childId]);
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

    await t.test("administrator fallback codes preserve Google and replace only previous code sessions", async () => {
      const email = `fallback-${randomUUID()}@family-utils.invalid`;
      const { rows: [adult] } = await pool.query(
        "INSERT INTO members (family_id, name, role, access_method, google_email) VALUES ($1, 'Alternate adult', 'administrator', 'google', $2) RETURNING id", [familyId, email],
      );
      const googleCookie = await prepare();
      const googleSession = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: googleCookie } }).then((r) => r.json());
      await pool.query('UPDATE "user" SET email=$2, is_anonymous=false, email_verified=true WHERE id=$1', [googleSession.user.id, email]);
      await pool.query("INSERT INTO account (account_id, provider_id, user_id) VALUES ($1, 'google', $2)", [`provider-${randomUUID()}`, googleSession.user.id]);
      await pool.query("INSERT INTO member_devices (member_id, auth_user_id, identity_kind) VALUES ($1, $2, 'google')", [adult.id, googleSession.user.id]);
      const generate = (memberId, purpose = "recovery", cookie = memberCookie, requestOrigin = origin) => fetch(`${origin}/api/members/${memberId}/codes`, {
        method: "POST", headers: { ...headers, Cookie: cookie, Origin: requestOrigin }, body: JSON.stringify({ purpose }),
      });
      const redeem = (code, cookie) => fetch(`${origin}/api/access/redeem`, {
        method: "POST", headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ code }),
      });
      assert.equal((await generate(childId)).status, 409, "self-issued administrator codes are refused");
      assert.equal((await generate(adult.id, "recovery", memberCookie, "https://untrusted.invalid")).status, 403);
      assert.equal((await generate(adult.id, "invitation")).status, 409, "linked Google adults do not receive another onboarding invitation");
      const firstResponse = await generate(adult.id);
      assert.equal(firstResponse.status, 201, await firstResponse.clone().text());
      const first = await firstResponse.json();
      assert.equal(first.purpose, "recovery");
      assert.ok(new Date(first.expiresAt).getTime() - Date.now() <= 30 * 60 * 1000);
      assert.equal((await redeem(first.code, googleCookie)).status, 400, "fallback requires a separate code session");
      const firstCookie = await prepare();
      assert.equal((await redeem(first.code, firstCookie)).status, 200);
      assert.equal((await redeem(first.code, firstCookie)).status, 200, "same-session retries remain idempotent");
      const family = await fetch(`${origin}/api/family`, { headers: { Cookie: firstCookie } }).then((r) => r.json());
      assert.equal(family.currentMemberId, adult.id);
      const profile = family.members.find((m) => m.id === adult.id);
      assert.equal(profile.role, "administrator");
      assert.equal(profile.accessMethod, "google");
      assert.equal(profile.hasGoogleAccess, true);
      assert.equal(profile.googleEmail, email);
      const otherCookie = await prepare();
      assert.equal((await redeem(first.code, otherCookie)).status, 400, "a used code cannot bind another identity");
      assert.equal((await generate(adult.id, "recovery", otherCookie)).status, 403, "unlinked users cannot issue administrator codes");
      const regularCookie = await prepare();
      const regularSession = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: regularCookie } }).then((r) => r.json());
      const regularMember = (await pool.query("INSERT INTO members (family_id, name, role, access_method) VALUES ($1, 'Regular member', 'member', 'code') RETURNING id", [familyId])).rows[0];
      await pool.query("INSERT INTO member_devices (member_id, auth_user_id) VALUES ($1, $2)", [regularMember.id, regularSession.user.id]);
      assert.equal((await generate(adult.id, "recovery", regularCookie)).status, 403, "regular members cannot issue administrator codes");
      const otherFamily = (await pool.query("INSERT INTO families (name) VALUES ('Other fallback family') RETURNING id")).rows[0];
      try {
        const otherAdult = (await pool.query("INSERT INTO members (family_id, name, role, access_method, google_email) VALUES ($1, 'Other adult', 'administrator', 'google', $2) RETURNING id", [otherFamily.id, `other-${email}`])).rows[0];
        assert.equal((await generate(otherAdult.id)).status, 404, "codes cannot cross family boundaries");
      } finally { await pool.query("DELETE FROM families WHERE id=$1", [otherFamily.id]); }
      const expiredResponse = await generate(adult.id);
      const expired = await expiredResponse.json();
      await pool.query("UPDATE access_codes SET expires_at=now()-interval '1 minute' WHERE member_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL", [adult.id]);
      assert.equal((await redeem(expired.code, otherCookie)).status, 400);
      const secondResponse = await generate(adult.id);
      assert.equal(secondResponse.status, 201);
      const second = await secondResponse.json();
      assert.equal((await redeem(second.code, regularCookie)).status, 400, "a code cannot replace a different member's bound identity");
      const competingCookie = await prepare();
      const [one, two] = await Promise.all([redeem(second.code, otherCookie), redeem(second.code, competingCookie)]);
      assert.deepEqual([one.status, two.status].sort(), [200, 400], "concurrent fallback redemption has exactly one winner");
      const winningCookie = one.status === 200 ? otherCookie : competingCookie;
      assert.equal((await fetch(`${origin}/api/family`, { headers: { Cookie: firstCookie } })).status, 403, "older fallback sessions are revoked");
      assert.equal((await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: firstCookie } }).then((r) => r.json())), null, "older fallback session tokens are deleted");
      assert.equal((await fetch(`${origin}/api/family`, { headers: { Cookie: googleCookie } })).status, 200, "Google identity and sessions are preserved");
      assert.equal((await fetch(`${origin}/api/family`, { headers: { Cookie: winningCookie } })).status, 200);
    });

    await t.test("an adult who first enters by fallback can still link Google later", async () => {
      const email = `first-code-${randomUUID()}@family-utils.invalid`;
      const adult = (await pool.query("INSERT INTO members (family_id, name, role, access_method, google_email) VALUES ($1, 'Code first adult', 'administrator', 'google', $2) RETURNING id", [familyId, email])).rows[0];
      const issued = await fetch(`${origin}/api/members/${adult.id}/codes`, {
        method: "POST", headers: { ...headers, Cookie: memberCookie }, body: JSON.stringify({ purpose: "recovery" }),
      });
      assert.equal(issued.status, 201);
      const { code } = await issued.json();
      const fallbackCookie = await prepare();
      const redeemed = await fetch(`${origin}/api/access/redeem`, { method: "POST", headers: { ...headers, Cookie: fallbackCookie }, body: JSON.stringify({ code }) });
      assert.equal(redeemed.status, 200);
      const googleCookie = await prepare();
      const session = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: googleCookie } }).then((r) => r.json());
      await pool.query('UPDATE "user" SET email=$2, is_anonymous=false, email_verified=true WHERE id=$1', [session.user.id, email]);
      await pool.query("INSERT INTO account (account_id, provider_id, user_id) VALUES ($1, 'google', $2)", [`provider-${randomUUID()}`, session.user.id]);
      const linked = await fetch(`${origin}/api/access/link-google`, { method: "POST", headers: { ...headers, Cookie: googleCookie } });
      assert.equal(linked.status, 200);
      assert.equal((await linked.json()).linked, true);
      for (const cookie of [fallbackCookie, googleCookie]) {
        const family = await fetch(`${origin}/api/family`, { headers: { Cookie: cookie } }).then((r) => r.json());
        assert.equal(family.currentMemberId, adult.id);
      }
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
      await pool.query("DELETE FROM meal_ideas WHERE family_id=$1", [familyId]);
      await pool.query("DELETE FROM meal_slots WHERE family_id=$1", [familyId]);
      await pool.query("DELETE FROM meal_routines WHERE family_id=$1", [familyId]);
      await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
    }
    const idsToDelete = [...new Set([...authIds, ...preparedUserIds])];
    if (idsToDelete.length) await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [idsToDelete]);
    await pool.end();
  }
});
