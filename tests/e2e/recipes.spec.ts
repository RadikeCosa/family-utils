import { expect, test, request, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { randomUUID } from "node:crypto";
const baseURL = "http://localhost:3390";
test.skip(!process.env.FAMILY_UTILS_TEST_DATABASE_URL, "requires isolated PostgreSQL");
let pool: pg.Pool, api: APIRequestContext, familyId: string, userId: string;
test.beforeEach(async ({ page }) => {
  pool = new pg.Pool({ connectionString: process.env.FAMILY_UTILS_TEST_DATABASE_URL });
  const { rows: [family] } = await pool.query("insert into families(name) values('Recipes browser fixture') returning id"); familyId = family.id;
  api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  expect((await api.post("/api/access/prepare", { headers: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}` } })).status()).toBe(200);
  const session = await api.get("/api/auth/get-session").then(r => r.json()); userId = session.user.id;
  const { rows: [member] } = await pool.query("insert into members(family_id,name,role) values($1,'Cook','administrator') returning id", [familyId]);
  await pool.query("insert into member_devices(member_id,auth_user_id) values($1,$2)", [member.id, userId]);
  await page.context().addCookies((await api.storageState()).cookies);
});
test.afterEach(async () => {
  await api?.dispose();
  try {
    for (const table of ["meal_daily_plans", "meal_groups", "meal_selections", "meal_suggestions"]) await pool.query(`delete from ${table} where slot_id in(select id from meal_slots where family_id=$1)`, [familyId]);
    await pool.query("delete from recipe_shopping_operations where family_id=$1", [familyId]);
      await pool.query("delete from shopping_lists where family_id=$1", [familyId]);
      await pool.query("delete from families where id=$1", [familyId]); await pool.query('delete from "user" where id=$1', [userId]);
  } finally { await pool?.end(); }
});
test("mobile recipe → Menus → reviewed Shopping, reorder announcements and accessible forms", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/recetas"); await page.getByLabel("Nombre del nuevo plato").fill("Tarta familiar"); await page.getByRole("button", { name: "Crear receta", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tarta familiar", exact: true })).toBeVisible();
  const recipeURL = page.url();
  await page.getByRole("button", { name: "Editar receta", exact: true }).click();
  await page.getByLabel("Porciones o rendimiento").fill("4 personas"); await page.getByRole("textbox", { name: "Preparación", exact: true }).fill("Mezclar y cocinar.");
  await page.getByRole("button", { name: "Agregar ingrediente", exact: true }).click(); await page.getByLabel("Ingrediente 1", { exact: true }).fill("Harina"); await page.getByLabel("Cantidad 1", { exact: true }).fill("500 g");
  await page.getByRole("button", { name: "Agregar ingrediente", exact: true }).click(); await page.getByLabel("Ingrediente 2", { exact: true }).fill("Sal"); await page.getByLabel("Cantidad 2", { exact: true }).fill("a gusto");
  await page.getByRole("button", { name: "Bajar ingrediente 1", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Harina, posición 2 de 2." })).toBeVisible();
  await expect(page.getByLabel("Ingrediente 1", { exact: true })).toHaveValue("Sal");
  await expect(page.getByRole("button", { name: "Subir ingrediente 2", exact: true })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Guardar receta", exact: true }).click(); await expect(page.getByText("Receta guardada.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Usar en Menús", exact: true }).click(); await page.getByRole("button", { name: "Proponer plato", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Plato propuesto." })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar comida", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Comida confirmada." })).toBeVisible();
  await page.getByRole("button", { name: "Pasar ingredientes a Compras", exact: true }).click();
  const shopping = page.getByRole("region", { name: "Pasar ingredientes a Compras", exact: true });
  await shopping.getByRole("checkbox", { name: /Harina/ }).check(); await shopping.getByRole("button", { name: "Revisar ingredientes", exact: true }).click();
  await shopping.getByRole("combobox", { name: "Lista de compras", exact: true }).selectOption("new"); await shopping.getByLabel("Nombre de la nueva lista").fill("Supermercado"); await shopping.getByLabel("Cantidad de compra", { exact: true }).fill("1 paquete");
  await shopping.getByRole("button", { name: "Consultar coincidencias", exact: true }).click(); await expect(shopping.getByRole("button", { name: "Confirmar envío", exact: true })).toBeEnabled();
  await shopping.getByRole("button", { name: "Confirmar envío", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Envío confirmado: 1 filas agregadas" })).toBeVisible();
  await page.getByRole("link", { name: "Abrir lista de compras", exact: true }).click(); await expect(page.getByText("1 paquete", { exact: false }).first()).toBeVisible();
  await page.goto(recipeURL); await expect(page.getByText("Harina · 500 g", { exact: false })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.screenshot({ path: `test-results/recipes-${test.info().project.name.replaceAll(" ", "-")}.png`, fullPage: true });
  expect(errors).toEqual([]);
});
test("conflicting edit retains copyable draft while displaying server version", async ({ page }) => {
  const created = await api.post("/api/recipes", { data: { title: `Sopa ${randomUUID()}` } }).then(r => r.json());
  await page.goto(`/recetas/${created.idea.id}`); await page.getByRole("button", { name: "Editar receta", exact: true }).click();
  await page.getByRole("textbox", { name: "Preparación", exact: true }).fill("Mi borrador");
  expect((await api.patch(`/api/recipes/${created.idea.id}`, { data: { expectedVersion: 1, preparation: "Cambio del servidor" } })).status()).toBe(200);
  await page.getByRole("button", { name: "Guardar receta", exact: true }).click(); await expect(page.getByRole("alert").filter({ hasText: "La receta cambió" })).toContainText("La receta cambió");
  await expect(page.getByRole("textbox", { name: "Preparación", exact: true })).toHaveValue("Mi borrador");
  await page.getByRole("button", { name: "Consultar versión actual", exact: true }).click(); await expect(page.getByRole("region", { name: "Versión actual del servidor", exact: true })).toContainText("Cambio del servidor");
  await page.getByText("Texto del borrador para copiar", { exact: true }).click(); await expect(page.locator("pre").filter({ hasText: "Mi borrador" })).toBeVisible();
});
