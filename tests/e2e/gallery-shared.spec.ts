import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

async function png(width: number, height: number, color: { r: number; g: number; b: number; alpha: number }, mark = "#df8950") {
  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><circle cx="${width / 2}" cy="${height / 2}" r="${Math.max(3, Math.min(width, height) / 3)}" fill="${mark}"/></svg>`);
  return sharp({ create: { width, height, channels: 4, background: color } }).composite([{ input: svg }]).png().toBuffer();
}

test("shared gallery clears its credential and keeps the native viewer accessible", async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    type WindowWithLayoutShifts = Window & { __galleryLayoutShift: number; __galleryShiftObserver?: PerformanceObserver };
    const target = window as WindowWithLayoutShifts;
    target.__galleryLayoutShift = 0;
    if ("PerformanceObserver" in window) {
      target.__galleryShiftObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!entry.hadRecentInput) target.__galleryLayoutShift += entry.value;
        }
      });
      target.__galleryShiftObserver.observe({ type: "layout-shift", buffered: true });
    }
  });
  const fixtures = new Map([
    ["drawing-1", await png(1600, 240, { r: 221, g: 229, b: 220, alpha: 255 })],
    ["drawing-2", await png(240, 1600, { r: 216, g: 233, b: 239, alpha: 255 })],
    ["drawing-3", await png(32, 24, { r: 0, g: 0, b: 0, alpha: 0 }, "#52745c")],
    ["drawing-4", await png(800, 600, { r: 0, g: 0, b: 0, alpha: 0 }, "#8b5687")],
  ]);
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
      total: 4,
      nextCursor: null,
      drawings: [
        ["drawing-1", 1600, 240], ["drawing-2", 240, 1600], ["drawing-3", 32, 24], ["drawing-4", 800, 600],
      ].map(([id, width, height], position) => ({
        id, width, height, version: 1, position,
        thumbnailUrl: `/api/gallery/public/shares/share-test/images/${id}?variant=thumbnail`,
        displayUrl: `/api/gallery/public/shares/share-test/images/${id}?variant=display`,
      })),
    }),
  }));
  await page.route("**/api/gallery/public/shares/share-test/images/**", route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    return route.fulfill({ status: 200, contentType: "image/png", body: fixtures.get(id)! });
  });

  await page.goto("/galeria/compartida#token=" + "a".repeat(43));
  await page.getByRole("button", { name: "Entrar a la galería" }).click();
  await expect(page).toHaveURL(/\/galeria\/compartida\?shareId=share-test$/u);
  await expect(page.getByRole("heading", { name: "Colección de prueba" }), "the public page should render the server-frozen collection after redeeming the link").toBeVisible({ timeout: 15_000 });
  for (const [width, expectedColumns] of [[360, 2], [390, 2], [768, 3], [1024, 3], [1440, 4]]) {
    await page.setViewportSize({ width, height: 900 });
    const columnCount = await page.getByRole("region", { name: "Dibujos compartidos" }).evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    expect(columnCount, `${width}px grid columns`).toBe(expectedColumns);
  }
  await page.setViewportSize({ width: 390, height: 844 });

  const firstDrawing = page.getByRole("button", { name: "Abrir dibujo 1" });
  await expect.poll(() => firstDrawing.evaluate(node => getComputedStyle(node).transitionDuration)).toBe("0s");
  await firstDrawing.click();
  const dialog = page.getByRole("dialog", { name: "Dibujo compartido" });
  await expect(dialog, "the native viewer should open after selecting the first drawing").toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("Dibujo 1 de 4"), "the viewer should announce its current position").toBeVisible({ timeout: 15_000 });
  await expect.poll(() => dialog.evaluate(node => node.matches(":modal"))).toBe(true);
  await expect.poll(() => dialog.getAttribute("aria-modal")).toBe("true");
  await expect.poll(() => page.getByRole("heading", { name: "Colección de prueba" }).evaluate(node => node.closest("[inert]")?.inert === true)).toBe(true);
  await expect(page.getByRole("button", { name: "Cerrar dibujo" })).toBeFocused();

  const closeButton = page.getByRole("button", { name: "Cerrar dibujo" });
  const box = await closeButton.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(48);
  expect(box?.height).toBeGreaterThanOrEqual(48);
  const accessibility = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(accessibility.violations).toEqual([]);

  const stage = dialog.getByTestId("gallery-viewer-stage");
  const controls = dialog.getByTestId("gallery-viewer-controls");
  const initialStage = await stage.boundingBox();
  const initialControls = await controls.boundingBox();
  await page.evaluate(() => { (window as Window & { __galleryLayoutShift: number }).__galleryLayoutShift = 0; });
  const verifyImage = async () => {
    const image = dialog.getByRole("img");
    await expect(image).toBeVisible();
    const [stageBox, imageBox, natural] = await Promise.all([
      stage.boundingBox(), image.boundingBox(), image.evaluate(node => ({ width: (node as HTMLImageElement).naturalWidth, height: (node as HTMLImageElement).naturalHeight })),
    ]);
    expect(stageBox).not.toBeNull(); expect(imageBox).not.toBeNull();
    expect(Math.abs((imageBox!.x + imageBox!.width / 2) - (stageBox!.x + stageBox!.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs((imageBox!.y + imageBox!.height / 2) - (stageBox!.y + stageBox!.height / 2))).toBeLessThanOrEqual(1);
    const scale = Math.min(1, stageBox!.width / natural.width, stageBox!.height / natural.height);
    expect(Math.abs(imageBox!.width - natural.width * scale)).toBeLessThanOrEqual(1);
    expect(Math.abs(imageBox!.height - natural.height * scale)).toBeLessThanOrEqual(1);
  };
  await verifyImage();
  await page.screenshot({ path: "/tmp/family-utils-viewer-after.png", scale: "css" });
  await closeButton.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText("Dibujo 2 de 4")).toBeVisible();
  await verifyImage();
  const portraitStage = await stage.boundingBox();
  const portraitControls = await controls.boundingBox();
  expect(Math.abs(portraitStage!.x - initialStage!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(portraitStage!.y - initialStage!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(portraitStage!.width - initialStage!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(portraitStage!.height - initialStage!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(portraitControls!.x - initialControls!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(portraitControls!.y - initialControls!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(portraitControls!.width - initialControls!.width)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Dibujo siguiente" }).click();
  await expect(dialog.getByText("Dibujo 3 de 4")).toBeVisible();
  await verifyImage();
  const stageClass = (await stage.getAttribute("class"))?.split(" ")[0];
  expect(stageClass).toBeTruthy();
  await page.addStyleTag({ content: `dialog .${stageClass} { background: #17212b; }` });
  await page.getByRole("button", { name: "Dibujo siguiente" }).click();
  await expect(dialog.getByText("Dibujo 4 de 4")).toBeVisible();
  await verifyImage();
  await page.getByRole("button", { name: "Dibujo anterior" }).click();
  await page.getByRole("button", { name: "Dibujo anterior" }).click();
  await page.getByRole("button", { name: "Dibujo anterior" }).click();
  const cls = await page.evaluate(() => (window as Window & { __galleryLayoutShift: number }).__galleryLayoutShift);
  expect(cls).toBeLessThanOrEqual(0.001);

  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [768, 1024], [1440, 900], [1280, 600]]) {
    await page.setViewportSize({ width, height });
    await verifyImage();
    for (const name of ["Cerrar dibujo", "Dibujo anterior", "Dibujo siguiente"]) {
      const bounds = await page.getByRole("button", { name }).boundingBox();
      expect(bounds?.width, `${name} width at ${width}x${height}`).toBeGreaterThanOrEqual(48);
      expect(bounds?.height, `${name} height at ${width}x${height}`).toBeGreaterThanOrEqual(48);
    }
    await page.getByRole("button", { name: "Dibujo siguiente" }).click();
    await verifyImage();
    await page.getByRole("button", { name: "Dibujo anterior" }).click();
    await expect(dialog.getByText("Dibujo 1 de 4")).toBeVisible();
  }
  await page.getByRole("button", { name: "Dibujo siguiente" }).click();
  await expect(dialog.getByText("Dibujo 2 de 4"), "the next control should advance the shared viewer").toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Shift+ArrowRight");
  await expect(dialog.getByText("Dibujo 2 de 4"), "modified arrows should not change the selected drawing").toBeVisible();
  await dialog.evaluate(node => {
    const input = document.createElement("input");
    input.setAttribute("aria-label", "campo de prueba");
    input.style.position = "fixed";
    input.style.left = "-10000px";
    node.append(input);
    input.focus();
  });
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText("Dibujo 2 de 4"), "arrows focused in a field should not change the selected drawing").toBeVisible();
  await dialog.evaluate(node => node.querySelector("input")?.remove());
  await closeButton.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByText("Dibujo 1 de 4"), "ArrowLeft should return to the first drawing").toBeVisible({ timeout: 15_000 });

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
    try { await route.fulfill({ status: 200, contentType: "image/png", body: await png(1, 1, { r: 255, g: 255, b: 255, alpha: 1 }) }); }
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

test("a failed shared image stays in the viewer and can be retried", async ({ page }) => {
  let displayAttempts = 0;
  const image = await png(80, 120, { r: 0, g: 0, b: 0, alpha: 0 }, "#52745c");
  await page.route("**/api/gallery/public/enter", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, shareId: "share-retry", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), serverNow: new Date().toISOString() }),
  }));
  await page.route("**/api/gallery/public/session**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ shareId: "share-retry", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), serverNow: new Date().toISOString() }),
  }));
  await page.route("**/api/gallery/public/shares/share-retry", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      share: { title: "Colección de reintento", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), serverNow: new Date().toISOString() },
      total: 1, nextCursor: null,
      drawings: [{ id: "drawing-retry", width: 80, height: 120, version: 1, position: 0,
        thumbnailUrl: "/api/gallery/public/shares/share-retry/images/drawing-retry?variant=thumbnail",
        displayUrl: "/api/gallery/public/shares/share-retry/images/drawing-retry?variant=display" }],
    }),
  }));
  await page.route("**/api/gallery/public/shares/share-retry/images/**", route => {
    const variant = new URL(route.request().url()).searchParams.get("variant");
    if (variant === "display") {
      displayAttempts += 1;
      if (displayAttempts === 1) return route.fulfill({ status: 503, body: "temporary failure" });
      if (displayAttempts === 2) return route.fulfill({ status: 200, contentType: "image/png", body: "not a decodable image" });
    }
    return route.fulfill({ status: 200, contentType: "image/png", body: image });
  });

  await page.goto("/galeria/compartida#token=" + "c".repeat(43));
  await page.getByRole("button", { name: "Entrar a la galería" }).click();
  await page.getByRole("button", { name: "Abrir dibujo 1" }).click();
  const dialog = page.getByRole("dialog", { name: "Dibujo compartido" });
  await expect(dialog.getByRole("status").filter({ hasText: "No se pudo cargar el dibujo." })).toBeVisible({ timeout: 45_000 });
  await expect(dialog.getByRole("button", { name: "Dibujo anterior" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Dibujo siguiente" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cerrar dibujo" })).toBeVisible();
  await dialog.getByRole("button", { name: "Reintentar carga" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "No se pudo cargar el dibujo." })).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Reintentar carga" }).click();
  await expect(dialog.getByRole("img")).toBeVisible();
  await expect(dialog.getByRole("status").filter({ hasText: "No se pudo cargar el dibujo." })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
