import { createHmac, randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import { getFamilyDay, taskListEtag } from "../../src/lib/tasks/family-day";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) {
  throw new Error("FAMILY_UTILS_TEST_DATABASE_URL is required in CI");
}
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

  const api = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `2001:db8:${randomUUID().slice(0, 4)}::1` } });
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
  await page.route("**/api/tasks/revision?*", async (route) => {
    const etag = taskListEtag(familyId, 1, day);
    if (route.request().headers()["if-none-match"] === etag) {
      await route.fulfill({ status: 304, headers: { ETag: etag } });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", headers: { ETag: etag }, body: JSON.stringify({ revision: 1, familyDay: day }) });
    }
  });
  await page.route("**/api/tasks?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", headers: { ETag: taskListEtag(familyId, 1, day) }, body: JSON.stringify({
      familyDay: day, selectedDate: day, familyId, generationMode: "explicit_sync", counts: { open: day === "2026-09-28" ? 0 : 1, completed: day === "2026-09-28" ? 1 : 0 }, nextCursor: null, memberId, revision: 1, tasks: day === "2026-09-28" ? [completed] : [upcoming],
    }) });
  });
  await page.route("**/api/tasks/sync", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ changed: false }) }));
  await page.goto("/tareas");
  await expect(page.getByText("Hecha por Test member")).toBeVisible();
  day = "2026-09-29";
  await page.clock.fastForward(120_000);
  expect(getFamilyDay(new Date("2026-09-29T03:01:00.000Z"))).toBe(day);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Marcar Mesa de prueba como hecha" })).toBeVisible();
  await expect(page.getByText("Hecha por Test member")).toHaveCount(0);
});

async function mockDaily(page: import("@playwright/test").Page, sync: "fast" | "slow" | "fail" = "fast") {
  await page.clock.install({ time: new Date("2026-10-12T15:00:00Z") });
  let generated = false;
  let syncCalls = 0;
  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/tasks/sync") {
      syncCalls++;
      if (sync === "fail") return route.abort("failed");
      if (sync === "slow") await new Promise((resolve) => setTimeout(resolve, 1200));
      generated = true;
      return route.fulfill({ json: { changed: true } });
    }
    if (url.pathname === "/api/tasks/revision") return route.fulfill({ status: 304 });
    if (url.pathname !== "/api/tasks") return route.fallback();
    const selectedDate = url.searchParams.get("date") ?? "2026-10-12";
    const taskId = "calendar-task";
    return route.fulfill({ json: {
      familyId, memberId, familyDay: "2026-10-12", selectedDate, generationMode: "explicit_sync", revision: generated ? 2 : 1,
      counts: { open: 1, completed: 0 }, total: 1, possibleTotal: 0, nextCursor: null,
      tasks: [{ id: generated ? "calendar-occurrence" : null, kind: generated ? "occurrence" : "forecast", key: JSON.stringify([taskId, null, selectedDate]), generationDate: selectedDate,
        taskId, title: "Calendario compartido", taskTitle: "Calendario compartido", taskStatus: "active", taskVersion: 1,
        description: null, taskDescription: null, taskScheduledDate: selectedDate, taskScheduledTime: null, taskAssignmentMode: "shared", assignmentMode: "shared",
        repeatWeekdays: [0,1,2,3,4,5,6], carryPolicy: "expires_daily", dueDate: selectedDate, scheduledTime: null,
        responsibilityMemberId: null, claimedByMemberId: null, status: "open", version: generated ? 1 : null, assignees: [], taskAssignees: [] }],
    }, headers: { ETag: '"calendar"' } });
  });
  return () => syncCalls;
}

test("date selection fixes today, Hoy resumes following, history preserves the date", async ({ page }) => {
  const syncCalls = await mockDaily(page);
  await page.goto("/tareas");
  await expect(page.getByRole("button", { name: "Marcar Calendario compartido como hecha" })).toBeVisible();
  await page.getByLabel("Ir a una fecha").fill("2026-10-11");
  await page.getByLabel("Ir a una fecha").fill("2026-10-12");
  await expect(page).toHaveURL(/fecha=2026-10-12/);
  await page.getByRole("button", { name: "Día anterior" }).click();
  await expect(page.getByText("Solo lectura", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Marcar Calendario/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Historial", exact: true }).click();
  await page.getByRole("button", { name: "Volver a tareas" }).click();
  await expect(page).toHaveURL(/fecha=2026-10-11/);
  await page.getByRole("button", { name: "Hoy", exact: true }).click();
  await expect(page).toHaveURL(/\/tareas$/);
  expect(syncCalls()).toBe(1);
});

test("failed sync leaves a pure reading and disabled forecasts visible", async ({ page }) => {
  const syncCalls = await mockDaily(page, "fail");
  await page.goto("/tareas");
  await expect(page.getByRole("heading", { name: "Calendario compartido" })).toBeVisible();
  await expect(page.getByText("Pendiente de actualizar", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Marcar Calendario/ })).toHaveCount(0);
  await expect(page.getByText("Puede faltar actualizar las tareas de hoy.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Reintentar actualización" }).click();
  await expect(page.getByRole("button", { name: "Reintentar actualización" })).toHaveCount(0);
  expect(syncCalls()).toBe(2);
});

test("fast sync does not flash the delayed notice", async ({ page }) => {
  await mockDaily(page);
  await page.goto("/tareas");
  await expect(page.getByRole("button", { name: "Marcar Calendario compartido como hecha" })).toBeVisible();
  await page.clock.fastForward(900);
  await expect(page.getByText("Puede faltar actualizar las tareas de hoy.", { exact: false })).toHaveCount(0);
});

test("family date stays in Buenos Aires on a device in Auckland", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "Pacific/Auckland", storageState: { cookies, origins: [] } });
  const page = await context.newPage();
  try {
    await mockDaily(page);
    await page.goto(`${baseURL}/tareas`);
    await expect(page.getByLabel("Ir a una fecha")).toHaveValue("2026-10-12");
    await expect(page.getByRole("button", { name: "Marcar Calendario compartido como hecha" })).toBeVisible();
  } finally { await context.close(); }
});

test("choosing today explicitly generates a missing daily occasion through the shared loader", async ({ page }) => {
  const today = getFamilyDay();
  const prior = new Date(`${today}T12:00:00Z`); prior.setUTCDate(prior.getUTCDate() - 1);
  const title = `Missing daily ${randomUUID().slice(0, 6)}`;
  await pool.query(`INSERT INTO tasks(family_id,title,created_by_member_id,edited_by_member_id,scheduled_date,repeat_weekdays)
    VALUES($1,$2,$3,$3,$4,ARRAY[0,1,2,3,4,5,6])`, [familyId, title, memberId, today]);
  await page.goto(`/tareas?fecha=${prior.toISOString().slice(0, 10)}`);
  await expect(page.getByText("Solo lectura", { exact: true })).toBeVisible();
  await page.getByLabel("Ir a una fecha").fill(today);
  await expect(page).toHaveURL(new RegExp(`fecha=${today}`));
  await expect(page.getByRole("button", { name: `Marcar ${title} como hecha` })).toBeVisible();
  await page.getByRole("button", { name: "Historial", exact: true }).click();
  await page.getByRole("button", { name: "Volver a tareas" }).click();
  await expect(page).toHaveURL(new RegExp(`fecha=${today}`));
  await expect(page.getByRole("button", { name: `Marcar ${title} como hecha` })).toBeVisible();
  const todayRead = page.waitForResponse((response) => response.url().includes("/api/tasks?date="));
  await page.getByRole("button", { name: "Hoy", exact: true }).click();
  await todayRead;
  await expect(page).toHaveURL(/\/tareas$/);
});
