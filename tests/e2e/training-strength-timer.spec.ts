import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { diaryDatabase, diaryServer, diaryProfile } from "../training-diary-fixture.mjs";

let db: Awaited<ReturnType<typeof diaryDatabase>>, server: Awaited<ReturnType<typeof diaryServer>>;
test.skip(!process.env.FAMILY_UTILS_TEST_DATABASE_URL, "requires explicit isolated PostgreSQL");
test.beforeAll(async () => { db = await diaryDatabase(); server = await diaryServer(db.url, true, true, true, true); });
test.afterAll(async () => { await server?.close(); await db?.close(); });
async function open(page: Page, context: BrowserContext, target = server) {
  await db.pool.query("SELECT public.training_diary_transition()");
  const profile = await diaryProfile(target, "Alex", db.pool);
  await context.addCookies(profile.cookie.split("; ").map(item => { const [name, ...value] = item.split("="); return { name, value: value.join("="), url: target.origin }; }));
  await page.goto(`${target.origin}/entrenamiento?seccion=temporizador`);
  await expect(page.getByRole("button", { name: /Intervalos 20\/10/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Intervalos 40\/20/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Por bloques/ })).toBeVisible();
  await page.getByRole("button", { name: /^Fuerza/ }).click();
  return profile;
}
async function shortConfig(page: Page, rounds = 1, change = 0, rest = 0) {
  await page.getByTestId("strength-timer-screen").getByLabel("Vueltas", { exact: true }).fill(String(rounds));
  await page.getByLabel("Segundos por articulación", { exact: true }).fill("1");
  await page.getByLabel("Duración por lado (segundos)", { exact: true }).fill("1");
  await page.getByLabel("Cambios dentro del grupo (segundos)", { exact: true }).fill(String(change));
  await page.getByLabel("Cambios entre grupos (segundos)", { exact: true }).fill(String(change));
  await page.getByLabel("Descanso entre vueltas (segundos)", { exact: true }).fill(String(rest));
}
test("Fuerza previews stages, validates limits and preserves mobile accessibility", async ({ page, context }, info) => {
  await open(page, context);
  const screen = page.getByTestId("strength-timer-screen");
  await expect(screen.getByText("Duración prevista: 55:30")).toBeVisible();
  await expect(screen.getByText("Calentamiento y transición al circuito: 2:00")).toBeVisible();
  await expect(screen.getByText(/Vuelta 3: 17:10/)).toBeVisible();
  await expect(screen.locator("details")).not.toHaveAttribute("open");
  await screen.getByText("Ver circuito de una vuelta").click();
  await expect(screen.getByText("Hombros · Rotación externa · Izquierdo: 0:30", { exact: true })).toBeVisible();
  await screen.getByText("Ver circuito de una vuelta").click();
  expect((await new AxeBuilder({ page }).include('[data-testid="strength-timer-screen"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("strength-setup.png"), fullPage: true });
  const start = page.getByRole("button", { name: "Iniciar fuerza" });
  await page.getByTestId("strength-timer-screen").getByLabel("Vueltas", { exact: true }).fill("");
  await expect(start).toBeDisabled();
  await page.getByTestId("strength-timer-screen").getByLabel("Vueltas", { exact: true }).fill("100");
  await expect(page.getByRole("alert")).toContainText("cuatro horas");
  await expect(start).toBeDisabled();
  await shortConfig(page);
  await expect(screen.getByText("Duración prevista: 0:37")).toBeVisible();
  await expect(start).toBeEnabled();
  await page.getByLabel("Segundos por articulación", { exact: true }).fill("48");
  await page.getByLabel("Duración por lado (segundos)", { exact: true }).fill("452");
  await page.getByLabel("Cambios dentro del grupo (segundos)", { exact: true }).fill("4");
  await expect(screen.getByText("Duración prevista: 240:00")).toBeVisible();
  await expect(start).toBeEnabled();
  await page.getByLabel("Cambios dentro del grupo (segundos)", { exact: true }).fill("5");
  await expect(start).toBeDisabled();
});
test("Fuerza completes, saves a split diary summary once, and repeats original config", async ({ page, context }, info) => {
  const profile = await open(page, context);
  await shortConfig(page);
  await page.clock.install();
  await page.getByRole("button", { name: "Iniciar fuerza" }).click();
  const screen = page.getByTestId("strength-timer-screen");
  await expect(screen.getByText("Entrada en calor", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Segundos por articulación", { exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath("strength-warmup.png"), fullPage: true });
  await page.clock.runFor(8000);
  await expect(screen.getByText("Hombros · Flexión · Izquierdo", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("strength-exercise.png"), fullPage: true });
  await page.clock.runFor(30000);
  await expect(page.getByRole("heading", { name: "Fuerza completa" })).toBeVisible();
  await page.getByRole("button", { name: "Repetir", exact: true }).click();
  await expect(screen.getByText("Entrada en calor", { exact: true })).toBeVisible();
  await page.clock.runFor(38000);
  await page.getByRole("button", { name: "Registrar en mi diario" }).click();
  await expect(page.getByLabel("¿Qué hiciste?")).toHaveValue(/Calentamiento:.*ejercicios:.*descansos:.*cambios:.*pausas:/s);
  const attempts: string[] = [];
  await page.route("**/api/training/entries", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    attempts.push(route.request().postData()!);
    if (attempts.length === 1) { await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "Guardar actividad" }).click();
  await page.getByRole("button", { name: "Reintentar guardado", exact: true }).click();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toBe(attempts[1]);
  await expect(page.getByText("Sesión registrada en el diario.")).toBeVisible();
  expect((await db.pool.query("SELECT count(*)::int AS n FROM training_entries WHERE owner_member_id=$1", [profile.id])).rows[0].n).toBe(1);
});
test("Fuerza pauses hidden at change boundary, resumes change and rest without consuming pauses", async ({ page, context }, info) => {
  await open(page, context);
  await shortConfig(page, 2, 1, 5);
  await page.clock.install();
  await page.getByRole("button", { name: "Iniciar fuerza" }).click();
  await page.clock.runFor(1000);
  const screen = page.getByTestId("strength-timer-screen");
  await expect(screen.getByText("CAMBIO", { exact: true })).toBeVisible();
  await expect(screen.locator('p[class*="hiitClock"]')).toHaveCount(0);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("button", { name: "Reanudar" })).toBeVisible();
  await page.clock.runFor(10000);
  await expect(screen.getByText("CAMBIO", { exact: true })).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
  await page.getByRole("button", { name: "Reanudar" }).click();
  await page.clock.runFor(1000);
  await expect(screen.getByText("Codos", { exact: true })).toBeVisible();
  await page.clock.runFor(71000);
  await expect(screen.getByText("Descanso", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page.screenshot({ path: info.outputPath("strength-rest-paused.png"), fullPage: true });
  const clock = await screen.locator('p[class*="hiitClock"]').textContent();
  await page.clock.runFor(10000);
  await expect(screen.locator('p[class*="hiitClock"]')).toHaveText(clock!);
  await page.getByRole("button", { name: "Reanudar" }).click();
  await page.clock.runFor(5000);
  await expect(screen.getByText("Vuelta 2 de 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Terminar y revisar" }).click();
  await expect(page.getByRole("heading", { name: "Fuerza parcial" })).toBeVisible();
});

test("Fuerza permits partial warmup review but not saving in read-only mode", async ({ page, context }) => {
  const readOnly = await diaryServer(db.url, false, true, true, true);
  try {
    await open(page, context, readOnly);
    await page.clock.install();
    await page.getByRole("button", { name: "Iniciar fuerza" }).click();
    await page.clock.runFor(1200);
    await page.getByRole("button", { name: "Terminar y revisar" }).click();
    await expect(page.getByRole("heading", { name: "Fuerza parcial" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Registrar en mi diario" })).toBeDisabled();
    await expect(page.getByText("Modo de consulta: podés revisar el resumen, pero no registrar en el diario.")).toBeVisible();
  } finally { await readOnly.close(); }
});
