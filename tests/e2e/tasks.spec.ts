import { createHmac, randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import { getFamilyDay, taskListEtag } from "../../src/lib/tasks/family-day";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
const baseURL = "http://localhost:3318";
const secret = process.env.CODE_PEPPER ?? "ci-only-pepper-not-used-outside-ci";
test.skip(!connectionString, "requires an isolated PostgreSQL 18 test service");

let pool: pg.Pool;
let familyId: string;
let memberId: string;
let authUserId: string;
let cookies: Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];

test.beforeAll(async () => {
  pool = new pg.Pool({ connectionString });
  const family = await pool.query("INSERT INTO families (name) VALUES ($1) RETURNING id", [`E2E ${randomUUID()}`]);
  familyId = family.rows[0].id;
  const member = await pool.query(
    "INSERT INTO members (family_id, name, role, access_method) VALUES ($1, 'Test member', 'member', 'code') RETURNING id", [familyId],
  );
  memberId = member.rows[0].id;

  const api = await playwrightRequest.newContext({ baseURL });
  const prepared = await api.post("/api/access/prepare", { headers: { Origin: baseURL } });
  expect(prepared.status(), await prepared.text()).toBe(200);
  const session = await api.get("/api/auth/get-session");
  authUserId = (await session.json()).user.id;
  const code = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const digest = createHmac("sha256", secret).update(`invitation\0${code}`).digest("hex");
  await pool.query(
    `INSERT INTO access_codes (family_id, member_id, purpose, digest, expires_at, created_by_member_id)
     VALUES ($1, $2, 'invitation', $3, now() + interval '30 minutes', $2)`, [familyId, memberId, digest],
  );
  const redeemed = await api.post("/api/access/redeem", {
    headers: { Origin: baseURL }, data: { code },
  });
  expect(redeemed.status()).toBe(200);
  cookies = (await api.storageState()).cookies;
  await api.dispose();
});

test.beforeEach(async ({ page }) => {
  await page.context().addCookies(cookies);
});

test.afterAll(async () => {
  if (familyId) await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
  if (authUserId) await pool.query('DELETE FROM "user" WHERE id=$1', [authUserId]);
  await pool?.end();
});

test("mobile completion is visible, handles network failure, and remains fresh after reopening", async ({ page }) => {
  const title = `Mobile test ${randomUUID().slice(0, 6)}`;
  const task = await pool.query(
    "INSERT INTO tasks (family_id, title, created_by_member_id, edited_by_member_id) VALUES ($1, $2, $3, $3) RETURNING id",
    [familyId, title, memberId],
  );
  const occurrence = await pool.query(
    "INSERT INTO task_occurrences (task_id, family_id, title_snapshot, assignment_mode_snapshot) VALUES ($1, $2, $3, 'shared') RETURNING id",
    [task.rows[0].id, familyId, title],
  );
  await page.goto("/tareas");
  const action = page.getByRole("button", { name: `Marcar ${title} como hecha` });
  await expect(action).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const bounds = await action.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(48);
  expect(bounds?.height).toBeGreaterThanOrEqual(48);

  const actionUrl = `**/api/tasks/${task.rows[0].id}/occurrences/${occurrence.rows[0].id}`;
  await page.route(actionUrl, (route) => route.abort("failed"));
  await action.click();
  await expect(page.getByRole("alert").first()).toContainText("No se pudo conectar");
  await expect(action).toBeVisible();
  await page.unroute(actionUrl);

  await action.click();
  await expect(page.getByText("Hecha por Test member")).toBeVisible();
  await expect(page.getByRole("button", { name: `Deshacer finalización de ${title}` })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Hecha por Test member")).toBeVisible();
});

test("a completed routine moves to history at Buenos Aires midnight", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-29T02:59:00.000Z") });
  let day = "2026-09-28";
  const taskId = randomUUID();
  const completed = {
    id: randomUUID(), taskId, title: "Mesa de prueba", taskTitle: "Mesa de prueba",
    description: null, taskDescription: null, taskStatus: "active", taskVersion: 1,
    taskScheduledDate: null, taskScheduledTime: null, taskAssignmentMode: "shared",
    assignmentMode: "shared", repeatWeekdays: [0, 1, 2, 3, 4, 5, 6],
    carryPolicy: "carry_forward", dueDate: "2026-09-28", scheduledTime: null,
    responsibilityMemberId: null, claimedByMemberId: null, completedByMemberId: memberId,
    completedAt: "2026-09-29T02:50:00.000Z", status: "completed", version: 2,
    assignees: [], taskAssignees: [],
  };
  const upcoming = { ...completed, id: randomUUID(), dueDate: "2026-09-29", completedAt: null, completedByMemberId: null, status: "open", version: 1 };
  await page.route("**/api/tasks/revision", async (route) => {
    const etag = taskListEtag(familyId, 1, day);
    if (route.request().headers()["if-none-match"] === etag) {
      await route.fulfill({ status: 304, headers: { ETag: etag } });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", headers: { ETag: etag }, body: JSON.stringify({ revision: 1, familyDay: day }) });
    }
  });
  await page.route("**/api/tasks", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", headers: { ETag: taskListEtag(familyId, 1, day) }, body: JSON.stringify({
      familyDay: day, memberId, revision: 1, tasks: day === "2026-09-28" ? [completed] : [upcoming],
    }) });
  });
  await page.goto("/tareas");
  await expect(page.getByText("Hecha por Test member")).toBeVisible();
  day = "2026-09-29";
  await page.clock.fastForward(120_000);
  expect(getFamilyDay(new Date("2026-09-29T03:01:00.000Z"))).toBe(day);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Marcar Mesa de prueba como hecha" })).toBeVisible();
  await expect(page.getByText("Hecha por Test member")).toHaveCount(0);
});
