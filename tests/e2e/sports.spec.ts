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
    await pool.query("DELETE FROM audit_events WHERE family_id=$1 AND entity_type IN ('sports_event','sports_comment','sports_formation','sports_week')", [familyId]);
    for (const table of ["sports_formations", "sports_comments", "sports_fights", "sports_weeks", "sports_events"]) {
      await pool.query(`DELETE FROM ${table} WHERE family_id=$1`, [familyId]);
    }
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
  }
  if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await pool?.end();
});

test("Deportes manual: próximo River, formación, reprogramación y UFC semanal", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/");
  await page.getByRole("link", { name: "Abrir Deportes" }).click();
  await expect(page.getByRole("heading", { name: "Próximo partido de River" })).toBeVisible();
  await page.getByRole("button", { name: "Cargar partido" }).click();
  await page.getByLabel("Fecha (opcional)", { exact: true }).fill(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  await page.getByLabel("Rival", { exact: true }).fill("Boca Juniors");
  await page.getByLabel("Competencia", { exact: true }).fill("Liga Profesional");
  await page.getByLabel("Cancha", { exact: true }).fill("Monumental");
  await page.getByRole("button", { name: "Guardar partido" }).click();
  await expect(page.getByRole("heading", { name: "River Plate vs Boca Juniors" })).toBeVisible();
  await expect(page.getByText("A confirmar", { exact: true })).toBeVisible();
  await expect(page.getByText("Cancha: Monumental")).toBeVisible();
  await page.getByLabel("Mi formación deseada").fill("4-3-3: mi once para River");
  await page.getByRole("button", { name: "Guardar formación" }).click();
  await expect(page.getByRole("status")).toHaveText("Formación guardada.");
  await expect(page.getByRole("listitem").getByText("4-3-3: mi once para River", { exact: true })).toBeVisible();
  const dailyThread = page.locator('section[aria-label="Conversación familiar"]').last();
  await dailyThread.getByLabel("Escribí un comentario").fill("Vamos River");
  await dailyThread.getByRole("button", { name: "Comentar" }).click();
  await expect(page.getByText("Vamos River")).toBeVisible();

  await page.getByRole("button", { name: "Editar partido" }).click();
  await page.getByLabel("Fecha (opcional)", { exact: true }).fill("");
  await page.getByRole("combobox", { name: "Estado", exact: true }).selectOption("postponed");
  await page.getByRole("button", { name: "Guardar partido" }).click();
  await expect(page.getByText("Postergado", { exact: true })).toBeVisible();
  await expect(page.getByText("Vamos River", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").getByText("4-3-3: mi once para River", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/river-${test.info().project.name.replaceAll(" ", "-")}.png`, fullPage: true });
  await page.getByRole("button", { name: "UFC", exact: true }).click();
  await expect(page.getByText("No pudimos confirmar la cartelera", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sin evento esta semana", exact: true }).click();
  await expect(page.getByText("No hay evento esta semana", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cargar cartelera" }).click();
  await page.getByLabel("Evento", { exact: true }).fill("UFC Fight Night");
  await page.getByLabel("Fecha oficial", { exact: true }).fill(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  await page.getByLabel("Hora de preliminares").fill("19:00");
  await page.getByLabel("Hora de cartelera principal").fill("22:00");
  await page.getByLabel("Primer peleador").fill("Peleador Uno");
  await page.getByLabel("Segundo peleador").fill("Peleador Dos");
  await page.getByRole("button", { name: "Publicar cartelera" }).click();
  await expect(page.getByRole("heading", { name: "UFC Fight Night" })).toBeVisible();
  await expect(page.getByText("Cartelera principal", { exact: true })).toBeVisible();
  const eventThread = page.locator('section[aria-label="Conversación familiar"]');
  await eventThread.getByLabel("Escribí un comentario").fill("Gran estelar");
  await eventThread.getByRole("button", { name: "Comentar" }).click();
  await expect(page.getByText("Gran estelar")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/ufc-${test.info().project.name.replaceAll(" ", "-")}.png`, fullPage: true });
  await page.getByRole("button", { name: "Ocultar cartelera", exact: true }).click();
  await expect(page.getByText("No pudimos confirmar la cartelera", { exact: true })).toBeVisible();
  expect((await pool.query("SELECT count(*)::int AS n FROM sports_comments WHERE family_id=$1 AND context_kind='ufc_card'", [familyId])).rows[0].n).toBe(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/sports-${test.info().project.name.replaceAll(" ", "-")}.png`, fullPage: true });
  const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, tab: document.querySelector("nav[aria-label='Deportes'] button")?.getBoundingClientRect().height }));
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.tab).toBeGreaterThanOrEqual(44);
  expect(pageErrors).toEqual([]);
});
