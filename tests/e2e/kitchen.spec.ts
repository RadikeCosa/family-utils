import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("anonymous home card and direct kitchen access", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Abrir Conversor de cocina", exact: true }).click();
  await expect(page).toHaveURL(/\/cocina$/);
  await expect(page.getByRole("heading", { name: "Conversor de cocina" })).toBeVisible();
  await page.getByLabel("Ingrediente", { exact: true }).selectOption("flour");
  await expect(page.getByLabel("Resultado", { exact: true })).toContainText("125 g");
  await page.screenshot({ path: test.info().outputPath("kitchen.png"), fullPage: true });
  await page.goto("/cocina");
  await expect(page).toHaveURL(/\/cocina$/);
  await expect(page.getByLabel("Ingrediente", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Cantidad", { exact: true })).toHaveAttribute("inputmode", "decimal");
  expect(await page.context().cookies()).toHaveLength(0);
});

test("fractions, cup sizes, interpreted input and swap", async ({ page }) => {
  await page.goto("/cocina");
  const quantity = page.getByLabel("Cantidad", { exact: true });
  const result = page.getByLabel("Resultado", { exact: true });
  await page.getByLabel("Ingrediente", { exact: true }).selectOption("flour");
  await quantity.fill("1.000");
  await expect(result).toContainText("1 taza (250 ml) de harina común");
  await page.getByRole("button", { name: "Usar fracción ½", exact: true }).click();
  await expect(quantity).toHaveValue("1 1/2");
  await expect(result).toContainText("1,5 tazas (250 ml)");
  await page.getByRole("button", { name: "Medidas e ingredientes", exact: true }).click();
  await expect(quantity).toHaveValue("1 1/2");
  await quantity.fill("1 ½");
  await expect(result).toContainText("1,5 tazas (250 ml)");
  await quantity.fill("");
  await expect(result).not.toContainText("≈");
  await page.getByRole("button", { name: "Usar fracción ½", exact: true }).click();
  await expect(quantity).toHaveValue("1/2");
  await quantity.fill("1");
  await page.getByLabel("Tamaño de taza").selectOption("240");
  await expect(result).toContainText("120 g");
  await page.getByLabel("Tamaño de taza").selectOption("236.588");
  await expect(result).toContainText("120 g");
  await page.getByRole("button", { name: "Intercambiar unidades" }).click();
  await expect(quantity).toHaveValue("1");
  await expect(page.getByLabel("De", { exact: true })).toHaveValue("g");
  await expect(page.getByLabel("A", { exact: true })).toHaveValue("cup");
  await quantity.fill("1.000,5");
  await expect(quantity).toHaveAttribute("aria-invalid", "true");
  await expect(result).not.toContainText("≈");
});

test("visible result is immediate and only announcements wait 300ms", async ({ page }) => {
  // Use one clock origin instead of comparing the runner's real time with
  // the browser clock: CI scheduling can otherwise pause slightly in the past.
  await page.clock.install({ time: new Date("2026-10-13T12:00:00Z") });
  await page.goto("/cocina");
  await page.clock.pauseAt(new Date("2026-10-13T13:00:00Z"));
  await page.getByLabel("Ingrediente", { exact: true }).selectOption("flour");
  const live = page.locator('[aria-live="polite"]');
  await expect(page.getByLabel("Resultado", { exact: true })).toContainText("125 g");
  await expect(live).toHaveText("");
  await page.clock.runFor(299);
  await expect(live).toHaveText("");
  await page.clock.runFor(1);
  await expect(live).toHaveText("1 taza (250 ml) de harina común, aproximadamente 125 g.");
  await page.getByLabel("Cantidad", { exact: true }).fill("2");
  await expect(page.getByLabel("Resultado", { exact: true })).toContainText("255 g");
  await page.clock.runFor(150);
  await page.getByLabel("Cantidad", { exact: true }).fill("1");
  await expect(live).toHaveText("");
  await page.clock.runFor(299);
  await expect(live).toHaveText("");
  await page.clock.runFor(1);
  await expect(live).toHaveText("1 taza (250 ml) de harina común, aproximadamente 125 g.");
  await page.getByLabel("Cantidad", { exact: true }).fill("");
  await page.clock.runFor(500);
  await expect(live).toHaveText("");
  await page.getByLabel("Cantidad", { exact: true }).fill("3");
  await page.clock.runFor(150);
  await page.getByLabel("Cantidad", { exact: true }).fill("4");
  await page.clock.runFor(300);
  await expect(live).toHaveText("4 tazas (250 ml) de harina común, aproximadamente 505 g.");
});

test("volume, temperatures, keyboard, accessibility and responsive layout", async ({ page }) => {
  await page.goto("/cocina");
  await page.getByLabel("De", { exact: true }).selectOption("l");
  await page.getByLabel("A", { exact: true }).selectOption("ml");
  await page.getByLabel("Cantidad", { exact: true }).fill("1,25");
  await expect(page.getByLabel("Resultado", { exact: true })).toContainText("1250 ml");
  await expect(page.getByLabel("Ingrediente", { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Temperatura", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Resultado", { exact: true })).toContainText("356 °F");
  await page.getByLabel("Cantidad", { exact: true }).fill("-40");
  await expect(page.getByLabel("Resultado", { exact: true })).toContainText("-40 °F");
  await page.getByRole("button", { name: "Temperatura", exact: true }).click();
  await expect(page.getByLabel("Cantidad", { exact: true })).toHaveValue("-40");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  for (const viewport of [{ width: 320, height: 740 }, { width: 375, height: 812 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.getByRole("button", { name: "Medidas e ingredientes", exact: true }).click();
  await page.getByLabel("Ingrediente", { exact: true }).selectOption("salt");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.context().setOffline(true);
  await page.getByLabel("Cantidad", { exact: true }).fill("2");
  await expect(page.getByLabel("Resultado", { exact: true })).toContainText("610 g");
  await page.context().setOffline(false);
});

test("all ingredient references render and calculations make no API requests", async ({ page }) => {
  const errors: string[] = [];
  const backendRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/")) backendRequests.push(request.url());
  });
  await page.goto("/cocina");
  const result = page.getByLabel("Resultado", { exact: true });
  for (const [ingredient, grams] of [
    ["water", 250], ["milk", 260], ["oil", 230], ["flour", 125], ["whole-flour", 120],
    ["sugar", 210], ["icing-sugar", 120], ["brown-sugar", 225], ["butter", 240],
    ["honey", 355], ["rice", 210], ["oats", 94], ["salt", 305], ["cocoa", 89],
  ] as const) {
    await page.getByLabel("Ingrediente", { exact: true }).selectOption(ingredient);
    await expect(result).toContainText(`≈ ${grams} g`);
    await page.locator("details").evaluate(element => { (element as HTMLDetailsElement).open = true; });
    await expect(page.getByText("Medida original:", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Fuente:/ })).toHaveAttribute("href", /^https:\/\//);
  }
  await page.getByLabel("Cantidad", { exact: true }).fill("-1");
  await expect(page.getByLabel("Cantidad", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(result).not.toContainText("≈");
  await page.getByLabel("Cantidad", { exact: true }).fill("0");
  await expect(result).toContainText("≈ 0 g");
  await page.getByLabel("Cantidad", { exact: true }).fill("0,00001");
  await expect(result).toContainText("< 0,01 g");
  for (const width of [320, 375, 430, 760, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
  expect(backendRequests).toEqual([]);
});
