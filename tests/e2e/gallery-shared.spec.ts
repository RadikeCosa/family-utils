import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const pixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9l8AAAAASUVORK5CYII=", "base64");

test("shared gallery clears its credential and keeps the native viewer accessible", async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/gallery/public/enter", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, shareId: "share-test", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), serverNow: new Date().toISOString() }),
  }));
  await page.route("**/api/gallery/public/session**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ shareId: "share-test", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), serverNow: new Date().toISOString() }),
  }));
  await page.route("**/api/gallery/public/shares/share-test", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      share: { title: "Colección de prueba", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), serverNow: new Date().toISOString() },
      total: 2,
      nextCursor: null,
      drawings: [1, 2].map(position => ({
        id: `drawing-${position}`, width: 1, height: 1, version: 1, position: position - 1,
        thumbnailUrl: `/api/gallery/public/shares/share-test/images/drawing-${position}?variant=thumbnail`,
        displayUrl: `/api/gallery/public/shares/share-test/images/drawing-${position}?variant=display`,
      })),
    }),
  }));
  await page.route("**/api/gallery/public/shares/share-test/images/**", route => route.fulfill({ status: 200, contentType: "image/png", body: pixelPng }));

  await page.goto("/galeria/compartida#token=" + "a".repeat(43));
  await page.getByRole("button", { name: "Entrar a la galería" }).click();
  await expect(page).toHaveURL(/\/galeria\/compartida\?shareId=share-test$/u);
  await expect(page.getByRole("heading", { name: "Colección de prueba" }), "the public page should render the server-frozen collection after redeeming the link").toBeVisible({ timeout: 15_000 });
  for (const [width, expectedColumns] of [[360, 2], [390, 2], [768, 3], [1024, 3], [1440, 4]]) {
    await page.setViewportSize({ width, height: 900 });
    const columnCount = await page.getByRole("region", { name: "Dibujos compartidos" }).evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    expect(columnCount, `${width}px grid columns`).toBe(expectedColumns);
  }

  const firstDrawing = page.getByRole("button", { name: "Abrir dibujo 1" });
  await expect.poll(() => firstDrawing.evaluate(node => getComputedStyle(node).transitionDuration)).toBe("0s");
  await firstDrawing.click();
  const dialog = page.getByRole("dialog", { name: "Dibujo compartido" });
  await expect(dialog, "the native viewer should open after selecting the first drawing").toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("Dibujo 1 de 2"), "the viewer should announce its current position").toBeVisible({ timeout: 15_000 });
  await expect.poll(() => dialog.evaluate(node => node.matches(":modal"))).toBe(true);
  await expect.poll(() => page.getByRole("heading", { name: "Colección de prueba" }).evaluate(node => node.closest("[inert]")?.inert === true)).toBe(true);
  await expect(page.getByRole("button", { name: "Cerrar dibujo" })).toBeFocused();

  const closeButton = page.getByRole("button", { name: "Cerrar dibujo" });
  const box = await closeButton.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  const accessibility = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("button", { name: "Dibujo siguiente" }).click();
  await expect(dialog.getByText("Dibujo 2 de 2"), "the next control should advance the shared viewer").toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByText("Dibujo 1 de 2"), "ArrowLeft should return to the first drawing").toBeVisible({ timeout: 15_000 });

  await page.keyboard.press("Escape");
  await expect(dialog, "Escape should close the native viewer").not.toBeVisible({ timeout: 15_000 });
  await expect(firstDrawing).toBeFocused();
});

test("a display image finishing after revocation cannot repopulate the public viewer", async ({ page }) => {
  let releaseDisplay!: () => void;
  let markDisplayStarted!: () => void;
  const displayHeld = new Promise<void>(resolve => { releaseDisplay = resolve; });
  const displayStarted = new Promise<void>(resolve => { markDisplayStarted = resolve; });

  await page.route("**/api/gallery/public/enter", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, shareId: "share-revoked", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), serverNow: new Date().toISOString() }),
  }));
  await page.route("**/api/gallery/public/session**", route => route.fulfill({
    status: 410, contentType: "application/json", body: JSON.stringify({ error: "LINK_UNAVAILABLE" }),
  }));
  await page.route("**/api/gallery/public/shares/share-revoked", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      share: { title: "PRUEBA revocada", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), serverNow: new Date().toISOString() },
      total: 1, nextCursor: null,
      drawings: [{ id: "drawing-revoked", width: 1, height: 1, version: 1, position: 0,
        thumbnailUrl: "/api/gallery/public/shares/share-revoked/images/drawing-revoked?variant=thumbnail",
        displayUrl: "/api/gallery/public/shares/share-revoked/images/drawing-revoked?variant=display" }],
    }),
  }));
  await page.route("**/api/gallery/public/shares/share-revoked/images/**", async route => {
    if (new URL(route.request().url()).searchParams.get("variant") === "display") {
      markDisplayStarted();
      await displayHeld;
    }
    try { await route.fulfill({ status: 200, contentType: "image/png", body: pixelPng }); }
    catch { /* The browser may cancel the in-flight response after the 410. */ }
  });

  await page.goto("/galeria/compartida#token=" + "b".repeat(43));
  await page.getByRole("button", { name: "Entrar a la galería" }).click();
  const firstDrawing = page.getByRole("button", { name: "Abrir dibujo 1" });
  await firstDrawing.click();
  const dialog = page.getByRole("dialog", { name: "Dibujo compartido" });
  await expect(dialog).toBeVisible();
  await displayStarted;

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Una galería para mirar" })).toBeVisible();
  await expect(dialog).not.toBeVisible();
  releaseDisplay();
  await expect(page.getByRole("region", { name: "Dibujos compartidos" })).not.toBeAttached();
  await expect.poll(() => page.locator("img").count()).toBe(0);
});
