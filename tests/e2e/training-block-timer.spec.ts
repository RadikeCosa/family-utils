import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { diaryDatabase, diaryServer, diaryProfile } from "../training-diary-fixture.mjs";

let db: Awaited<ReturnType<typeof diaryDatabase>>, server: Awaited<ReturnType<typeof diaryServer>>;
test.skip(!process.env.FAMILY_UTILS_TEST_DATABASE_URL, "requires explicit isolated PostgreSQL");
test.beforeAll(async () => { db = await diaryDatabase(); server = await diaryServer(db.url, true, true, true, true); });
test.afterAll(async () => { await server?.close(); await db?.close(); });

async function openTimer(page: import("@playwright/test").Page, context: import("@playwright/test").BrowserContext, targetServer = server) {
  await db.pool.query("SELECT public.training_diary_transition()");
  const profile = await diaryProfile(targetServer, "Alex", db.pool);
  const cookies = profile.cookie.split("; ").map(item => { const [name, ...rest] = item.split("="); return { name, value: rest.join("="), url: targetServer.origin }; });
  await context.addCookies(cookies);
  await page.goto(`${targetServer.origin}/entrenamiento?seccion=temporizador`);
  await expect(page.getByRole("heading", { name: "Temporizador" })).toBeVisible();
}

async function openBlockTimer(page: import("@playwright/test").Page, context: import("@playwright/test").BrowserContext, targetServer = server) {
  await openTimer(page, context, targetServer);
  await page.getByRole("button", { name: "Por bloques" }).click();
  await expect(page.getByRole("heading", { name: "Temporizador por bloques" })).toBeVisible();
}

test("Por bloques muestra el circuito inicial y pasa accesibilidad en configuración", async ({ page, context }) => {
  await openTimer(page, context);
  await expect(page.getByRole("region", { name: "Programas de intervalos" }).getByRole("button")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /Por bloques.*Circuito editable.*63:30 iniciales/ })).toBeVisible();
  await page.getByRole("button", { name: "Por bloques" }).click();
  await expect(page.getByRole("heading", { name: "Temporizador por bloques" })).toBeVisible();
  await page.getByRole("button", { name: "Volver a HIIT" }).click();
  await expect(page.getByRole("button", { name: "Iniciar entrenamiento" })).toBeVisible();
  await page.getByRole("button", { name: "Por bloques" }).click();
  await expect(page.getByText("Duración prevista: 63:30")).toBeVisible();
  await expect(page.getByLabel("Cambio (segundos)")).toHaveValue("3");
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  await expect(page.getByLabel("Duración del bloque 8 (segundos)")).toHaveValue("300");
  await expect(page.getByLabel("Duración del bloque 1 (segundos)")).toHaveValue("260");
  await expect(page.getByLabel("Omitir el último descanso al finalizar el circuito")).toBeChecked();
  const results = await new AxeBuilder({ page }).include('[data-testid="block-timer-screen"]').analyze();
  expect(results.violations).toEqual([]);
});

test("Por bloques permite ordenar, pausar, reanudar y revisar una sesión parcial", async ({ page, context }) => {
  await openBlockTimer(page, context);
  await page.getByRole("button", { name: "Subir bloque 2" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Nombre", { exact: false }).first()).toHaveValue("Descanso");
  await page.getByRole("button", { name: "Bajar bloque 1" }).focus();
  await page.keyboard.press("Enter");
  for (let index = 0; index < 6; index++) await page.getByRole("button", { name: "Eliminar" }).last().click();
  await page.getByLabel("Duración del bloque 1 (segundos)").fill("5");
  await page.getByLabel("Vueltas").fill("1");
  await page.getByLabel("Cambio (segundos)").fill("0");
  await page.getByLabel("Duración del bloque 1 (segundos)").fill("0");
  await expect(page.getByRole("button", { name: "Iniciar circuito" })).toBeDisabled();
  await page.getByLabel("Duración del bloque 1 (segundos)").fill("5");
  await page.getByRole("button", { name: "Volver a HIIT" }).click();
  await page.getByRole("button", { name: "Por bloques" }).click();
  await expect(page.getByLabel("Duración del bloque 1 (segundos)")).toHaveValue("5");
  await page.getByRole("button", { name: "Iniciar circuito" }).click();
  await page.waitForTimeout(1100);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("button", { name: "Reanudar" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Pausado");
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.getByRole("button", { name: "Reanudar" }).click();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Terminar y revisar" }).click();
  await expect(page.getByRole("heading", { name: "Circuito parcial" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar en mi diario" })).toBeEnabled();
  await page.getByRole("button", { name: "Registrar en mi diario" }).click();
  await expect(page.getByLabel("¿Qué hiciste?")).toHaveValue(/Entrenamiento por bloques/);
  await expect(page.getByLabel("Duración (minutos, opcional)")).toHaveValue("1");
  await page.getByRole("button", { name: "Guardar actividad" }).click();
  await expect(page.getByText("Sesión registrada en el diario.")).toBeVisible();
  await page.getByRole("button", { name: "Cambiar a HIIT" }).click();
  await expect(page.getByRole("button", { name: "Iniciar entrenamiento" })).toBeVisible();
  await page.getByRole("button", { name: "Por bloques" }).click();
  await expect(page.getByRole("heading", { name: "Temporizador por bloques" })).toBeVisible();
});

test("Por bloques permite pausar durante Cambio y retoma el tiempo restante", async ({ page, context }) => {
  await openBlockTimer(page, context);
  await page.getByLabel("Duración del bloque 1 (segundos)").fill("2");
  await page.getByLabel("Vueltas").fill("1");
  await page.getByRole("button", { name: "Iniciar circuito" }).click();
  await expect(page.getByText("CAMBIO", { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.locator("p[class*=hiitClock]")).toHaveCount(0);
  await page.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByRole("status")).toContainText("Pausado · Cambio");
  await page.waitForTimeout(1100);
  await expect(page.getByText("CAMBIO", { exact: true })).toBeVisible();
  await expect(page.locator("p[class*=hiitClock]")).toHaveCount(0);
  await page.getByRole("button", { name: "Reanudar" }).click();
  await expect(page.getByRole("status")).toContainText("Descanso", { timeout: 5000 });
  await page.getByRole("button", { name: "Terminar y revisar" }).click();
});

test("Por bloques resume el circuito largo sin truncar los tiempos ejecutados", async ({ page, context }) => {
  await openBlockTimer(page, context);
  const longName = `Ejercicio ${"ficticio ".repeat(8)}`.slice(0, 80);
  await page.locator('input[maxlength="80"]').first().fill(longName);
  for (let count = 7; count < 50; count++) {
    await page.getByRole("button", { name: "Agregar bloque" }).click();
    await page.locator('input[maxlength="80"]').last().fill(longName);
  }
  await page.getByLabel("Duración del bloque 1 (segundos)", { exact: true }).fill("3");
  await page.getByLabel("Vueltas").fill("1");
  await page.getByRole("button", { name: "Iniciar circuito" }).click();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Terminar y revisar" }).click();
  await page.getByRole("button", { name: "Registrar en mi diario" }).click();
  const diaryText = page.getByLabel("¿Qué hiciste?");
  await expect(diaryText).toHaveValue(/Circuito \(50 bloques\).*nombres resumidos/s);
  await expect(diaryText).toHaveValue(/Ejecutado: trabajo .*; descansos .*; cambios .*; pausas/s);
});

test("Por bloques permite revisar el resumen pero bloquea el registro en modo de consulta", async ({ page, context }) => {
  const readOnlyServer = await diaryServer(db.url, false, true, true, true);
  try {
    await openBlockTimer(page, context, readOnlyServer);
    await page.getByLabel("Duración del bloque 1 (segundos)").fill("3");
    await page.getByLabel("Vueltas").fill("1");
    await page.getByRole("button", { name: "Iniciar circuito" }).click();
    await page.waitForTimeout(1100);
    await page.getByRole("button", { name: "Terminar y revisar" }).click();
    await expect(page.getByRole("button", { name: "Registrar en mi diario" })).toBeDisabled();
    await expect(page.getByText("Modo de consulta: podés revisar el resumen, pero no registrar en el diario.")).toBeVisible();
  } finally {
    await readOnlyServer.close();
  }
});
