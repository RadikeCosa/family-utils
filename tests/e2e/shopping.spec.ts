import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL is required in CI");
test.skip(!connectionString, "requires isolated PostgreSQL 18");
const baseURL = "http://localhost:3318";
let pool: pg.Pool;
let familyId: string;
let editorId: string;
let owner: APIRequestContext;
let editor: APIRequestContext;
let userIds: string[];

test.beforeEach(async ({ page }) => {
  pool = new pg.Pool({ connectionString }); userIds = [];
  familyId = (await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [`shopping-e2e-${randomUUID()}`])).rows[0].id;
  async function identity(name: string) {
    const api = await playwrightRequest.newContext({ baseURL });
    const prepared = await api.post("/api/access/prepare", { headers: { Origin: baseURL, "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}` } });
    expect(prepared.status(), await prepared.text()).toBe(200);
    const user = (await (await api.get("/api/auth/get-session")).json()).user;
    userIds.push(user.id);
    const id = (await pool.query("INSERT INTO members(family_id,name) VALUES($1,$2) RETURNING id", [familyId, name])).rows[0].id;
    await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [id, user.id]);
    return { api, id };
  }
  const a = await identity("Alex"); owner = a.api;
  const b = await identity("Sam"); editor = b.api; editorId = b.id;
  await page.context().addCookies((await owner.storageState()).cookies);
});
test.afterEach(async () => {
  await owner?.dispose(); await editor?.dispose();
  if (familyId) {
    await pool.query("DELETE FROM shopping_lists WHERE family_id=$1", [familyId]);
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
  }
  for (const id of userIds ?? []) await pool.query('DELETE FROM "user" WHERE id=$1', [id]);
  await pool?.end();
});
async function seed() {
  const response = await owner.post("/api/shopping", { data: { name: "Supermercado" } }); expect(response.status()).toBe(201);
  const listId = (await response.json()).id;
  const added = await owner.post(`/api/shopping/${listId}/items`, { data: { name: "Leche", brand: "Marca de prueba", quantity: "2 paquetes" } }); expect(added.status()).toBe(201);
  return { listId, itemId: (await added.json()).id };
}

test("mobile shopping: create, purchase, suggestions, reuse, archive and accessible controls", async ({ page }) => {
  await page.goto("/compras");
  await page.getByRole("button", { name: "Crear lista", exact: true }).click();
  await expect(page).toHaveURL(/\/compras\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: "Alex", exact: true })).toBeVisible();
  await page.getByLabel("Nombre del producto", { exact: true }).fill("Café");
  await page.getByLabel("Cantidad (opcional)").fill("500 g");
  await page.getByRole("button", { name: "Agregar producto", exact: true }).click();
  const purchase = page.getByRole("button", { name: "Marcar comprado Café", exact: true });
  await expect(purchase).toBeVisible();
  const bounds = await purchase.boundingBox(); expect(bounds?.width).toBeGreaterThanOrEqual(44); expect(bounds?.height).toBeGreaterThanOrEqual(44);
  await purchase.click();
  await expect(page.getByText("Comprado por Alex", { exact: true })).toBeVisible();
  await expect(page.locator("datalist option")).toHaveAttribute("value", "Café");
  await page.getByRole("button", { name: "Editar Café", exact: true }).click();
  await page.getByLabel("Marca (opcional)").fill("Otra marca");
  await page.getByRole("button", { name: "Guardar producto", exact: true }).click();
  await expect(page.getByText("Otra marca · 500 g", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Desmarcar todos", exact: true }).click();
  await expect(page.getByRole("button", { name: "Marcar comprado Café", exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Archivar lista", exact: true }).click();
  await expect(page.getByText("Archivada · solo lectura", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Marcar comprado Café", exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restaurar lista", exact: true }).click();
  await page.getByRole("button", { name: "Administrar lista", exact: true }).click();
  await page.getByLabel("Sam", { exact: true }).check();
  await page.getByRole("button", { name: "Guardar editores", exact: true }).click();
  await expect(page.getByRole("button", { name: "Guardar editores", exact: true })).toHaveCount(0);
  const state = await (await editor.get("/api/shopping")).json(); expect(state.lists[0].canEdit).toBe(true);
  await page.getByText("Administrar sugerencias de la familia", { exact: true }).click();
  await page.getByRole("button", { name: "Ocultar sugerencia Café", exact: true }).click();
  await expect(page.locator("datalist option")).toHaveCount(0);
  await page.getByRole("button", { name: "Restaurar sugerencia Café", exact: true }).click();
  await expect(page.locator("datalist option")).toHaveCount(1);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `/tmp/family-utils-compras-${test.info().project.name.startsWith("iPhone") ? "iphone" : "android"}.png`, fullPage: true });
});

test("revocation and conflicts keep an editor's draft; network failures keep a new product", async ({ page }) => {
  const { listId, itemId } = await seed();
  const granted = await owner.put(`/api/shopping/${listId}/editors`, { data: { expectedVersion: 1, memberIds: [editorId] } }); expect(granted.ok()).toBeTruthy();
  await page.context().clearCookies(); await page.context().addCookies((await editor.storageState()).cookies);
  await page.goto(`/compras/${listId}`);
  await page.getByRole("button", { name: "Editar Leche", exact: true }).click();
  await page.getByLabel("Nombre del producto", { exact: true }).fill("Leche descremada");
  const changed = await owner.patch(`/api/shopping/${listId}/items/${itemId}`, { data: { name: "Leche entera", expectedVersion: 1 } }); expect(changed.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Guardar producto", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Hubo otro cambio");
  await expect(page.getByLabel("Nombre del producto", { exact: true })).toHaveValue("Leche descremada");
  await expect(page.getByText(/Datos actuales: Leche entera/)).toBeVisible();
  await page.getByRole("button", { name: "Revisé los cambios: habilitar reintento", exact: true }).click();
  await page.getByRole("button", { name: "Guardar producto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Leche descremada", exact: true })).toBeVisible();
  await page.getByLabel("Nombre del producto", { exact: true }).fill("Pan para mañana");
  const revoked = await owner.put(`/api/shopping/${listId}/editors`, { data: { expectedVersion: 2, memberIds: [] } }); expect(revoked.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Agregar producto", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("permiso");
  await expect(page.getByLabel("Nombre del producto", { exact: true })).toHaveValue("Pan para mañana");
  await expect(page.getByRole("button", { name: "Copiar borrador", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar producto", exact: true })).toBeDisabled();
  await page.context().clearCookies(); await page.context().addCookies((await owner.storageState()).cookies);
  await page.reload();
  await page.getByLabel("Nombre del producto", { exact: true }).fill("Arroz");
  await page.route(`**/api/shopping/${listId}/items`, (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Agregar producto", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("No se pudo conectar");
  await expect(page.getByLabel("Nombre del producto", { exact: true })).toHaveValue("Arroz");
});

test("polling pauses with inactivity, hidden tab and offline; resumes immediately", async ({ page }) => {
  const { listId } = await seed();
  await page.clock.install();
  let reads = 0;
  page.on("request", (request) => { if (request.url() === `${baseURL}/api/shopping` && request.method() === "GET") reads++; });
  await page.goto(`/compras/${listId}`);
  await expect(page.getByRole("heading", { name: "Supermercado", exact: true })).toBeVisible();
  const initial = reads;
  const firstPoll = page.waitForResponse((response) => response.url() === `${baseURL}/api/shopping`);
  await page.clock.runFor(31_000); await firstPoll; await page.waitForLoadState("networkidle"); expect(reads).toBe(initial + 1);
  await page.clock.runFor(121_000);
  const idle = reads; await page.clock.runFor(90_000); expect(reads).toBe(idle);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nombre del producto", { exact: true }).click();
  await page.getByLabel("Nombre del producto", { exact: true }).fill("Borrador");
  await expect.poll(() => reads).toBe(idle + 1);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForLoadState("networkidle");
  const hidden = reads; await page.clock.runFor(90_000); expect(reads).toBe(hidden);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => reads).toBe(hidden + 1);
  await page.waitForLoadState("networkidle");
  await page.context().setOffline(true); const offline = reads;
  await page.clock.runFor(60_000); expect(reads).toBe(offline);
  await page.clock.resume();
  await page.context().setOffline(false); await expect.poll(() => reads).toBe(offline + 1);
  await expect(page.getByLabel("Nombre del producto", { exact: true })).toHaveValue("Borrador");
});

test("a delayed snapshot cannot undo a purchase confirmed by the server", async ({ page }) => {
  const { listId } = await seed();
  const oldResponse = await owner.get("/api/shopping"); const oldSnapshot = await oldResponse.json();
  await page.goto(`/compras/${listId}`);
  await expect(page.getByRole("button", { name: "Marcar comprado Leche", exact: true })).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = false;
  await page.route("**/api/shopping", async (route) => {
    if (!intercepted) { intercepted = true; await held; try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(oldSnapshot) }); } catch { /* The client canceled the obsolete request. */ } }
    else await route.continue();
  });
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect.poll(() => intercepted).toBe(true);
  await page.getByRole("button", { name: "Marcar comprado Leche", exact: true }).click();
  await expect(page.getByText("Comprado por Alex", { exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "Desmarcar Leche", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Marcar comprado Leche", exact: true })).toHaveCount(0);
});
