import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import pg from "pg";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
test.skip(!connectionString, "requires isolated PostgreSQL");
const baseURL = "http://localhost:3318";
let pool: pg.Pool, familyId: string, memberId: string, userId: string, api: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

test.beforeEach(async ({ page }) => {
  pool = new pg.Pool({ connectionString });
  familyId = (await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [`sports-ui-${randomUUID()}`])).rows[0].id;
  api = await playwrightRequest.newContext({ baseURL });
  const response = await api.post("/api/access/prepare", { headers: { Origin: baseURL, "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}` } });
  expect(response.status(), await response.text()).toBe(200);
  userId = (await (await api.get("/api/auth/get-session")).json()).user.id;
  memberId = (await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,'Alex','administrator') RETURNING id", [familyId])).rows[0].id;
  await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [memberId, userId]);
  await page.context().addCookies((await api.storageState()).cookies);
});

test.afterEach(async () => {
  await api?.dispose();
  if (familyId) {
    await pool.query("DELETE FROM audit_events WHERE family_id=$1 AND entity_type IN ('sports_event','sports_comment')", [familyId]);
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
  }
  if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await pool?.end();
});

test("Deportes manual: agenda, hilo diario, cartelera UFC y conversación en el dispositivo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Abrir Deportes" }).click();
  await expect(page.getByRole("heading", { name: "Agenda de hoy" })).toBeVisible();
  await page.getByRole("button", { name: /Partido/ }).click();
  await page.getByLabel("Fecha", { exact: true }).fill(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  await page.getByLabel("Rival", { exact: true }).fill("Boca Juniors");
  await page.getByLabel("Competencia", { exact: true }).fill("Liga Profesional");
  await page.getByRole("button", { name: "Guardar partido" }).click();
  await expect(page.getByRole("heading", { name: "River Plate vs Boca Juniors" })).toBeVisible();
  await expect(page.getByText("A confirmar")).toBeVisible();
  await page.getByLabel("Solo River").check();
  await page.getByLabel("Solo River").uncheck();
  const dailyThread = page.locator('section[aria-label="Conversación familiar"]').last();
  await dailyThread.getByLabel("Escribí un comentario").fill("Vamos River");
  await dailyThread.getByRole("button", { name: "Comentar" }).click();
  await expect(page.getByText("Vamos River")).toBeVisible();

  await page.getByRole("button", { name: "UFC" }).click();
  await page.getByRole("button", { name: /Cartelera/ }).click();
  await page.getByLabel("Evento", { exact: true }).fill("UFC Fight Night");
  await page.getByLabel("Fecha", { exact: true }).fill(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  await page.getByLabel("Hora de preliminares").fill("19:00");
  await page.getByLabel("Hora de cartelera principal").fill("22:00");
  await page.getByLabel("Primer peleador").fill("Peleador Uno");
  await page.getByLabel("Segundo peleador").fill("Peleador Dos");
  await page.getByRole("button", { name: "Publicar cartelera" }).click();
  await expect(page.getByRole("heading", { name: "UFC Fight Night" })).toBeVisible();
  await expect(page.getByText("Cartelera principal")).toBeVisible();
  const eventThread = page.locator('section[aria-label="Conversación familiar"]');
  await eventThread.getByLabel("Escribí un comentario").fill("Gran estelar");
  await eventThread.getByRole("button", { name: "Comentar" }).click();
  await expect(page.getByText("Gran estelar")).toBeVisible();
  const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, tab: document.querySelector("nav[aria-label='Deportes'] button")?.getBoundingClientRect().height }));
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.tab).toBeGreaterThanOrEqual(44);
});
