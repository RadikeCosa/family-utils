import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
test.skip(!connectionString, "requires isolated PostgreSQL");
const baseURL = "http://localhost:3318";
let pool: pg.Pool, familyId: string, memberId: string, userId: string, api: APIRequestContext;
test.beforeEach(async ({ page }) => {
  pool = new pg.Pool({ connectionString });
  familyId = (await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [`library-ui-${randomUUID()}`])).rows[0].id;
  api = await playwrightRequest.newContext({ baseURL });
  const response = await api.post("/api/access/prepare", { headers: { Origin: baseURL, "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}` } });
  expect(response.status(), await response.text()).toBe(200);
  userId = (await (await api.get("/api/auth/get-session")).json()).user.id;
  memberId = (await pool.query("INSERT INTO members(family_id,name) VALUES($1,'Alex') RETURNING id", [familyId])).rows[0].id;
  await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [memberId, userId]);
  await page.context().addCookies((await api.storageState()).cookies);
});
test.afterEach(async () => {
  await api?.dispose();
  if (familyId) {
    for (const table of ["library_companions", "library_contributions", "library_personal", "library_works", "audit_events"]) await pool.query(`DELETE FROM ${table} WHERE family_id=$1`, [familyId]);
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
  }
  if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await pool?.end();
});
test("mobile library: create, restore draft, find accented titles and accessible navigation", async ({ page }) => {
  await page.goto("/biblioteca");
  await expect(page.getByRole("heading", { name: "Nuestra colección empieza acá" })).toBeVisible();
  await page.getByRole("button", { name: "Agregar obra", exact: true }).click();
  await page.getByLabel(/^Título/).fill("Canción del verano");
  await page.reload();
  await page.getByRole("button", { name: "Agregar obra", exact: true }).click();
  await expect(page.getByLabel(/^Título/)).toHaveValue("Canción del verano");
  await page.getByRole("combobox", { name: "Tipo de obra", exact: true }).selectOption("music");
  await page.getByText("Datos opcionales", { exact: true }).click();
  await page.getByLabel("Autor o creador", { exact: true }).fill("María");
  await page.getByLabel("Enlace de referencia").fill("https://example.com/music");
  await page.getByRole("button", { name: "Guardar ficha", exact: true }).click();
  await expect(page).toHaveURL(/\/biblioteca\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: "Canción del verano" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Abrir enlace de referencia/ })).toHaveAttribute("rel", "noopener noreferrer");
  await page.getByRole("link", { name: "← Volver a la biblioteca" }).click();
  await page.getByLabel("Buscar una obra").fill("cancion");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Canción del verano" })).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
