import { expect, test } from "@playwright/test";

test("Google sign-in remains usable while the session lookup is stalled", async ({ page }) => {
  let releaseSession!: () => void;
  const sessionGate = new Promise<void>((resolve) => { releaseSession = resolve; });
  let releaseSignIn!: () => void;
  const signInGate = new Promise<void>((resolve) => { releaseSignIn = resolve; });
  let attempts = 0;
  await page.route("**/api/auth/get-session**", async (route) => {
    await sessionGate;
    await route.fulfill({ json: null });
  });
  await page.route("**/api/auth/sign-in/social", async (route) => {
    attempts += 1;
    expect(route.request().postDataJSON()).toMatchObject({
      provider: "google", callbackURL: `${new URL(page.url()).origin}/acceso`,
    });
    await signInGate;
    await route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: "Try again" } });
  });
  try {
    const sessionRequest = page.waitForRequest("**/api/auth/get-session**");
    await page.goto("/acceso");
    await sessionRequest;
    const google = page.getByRole("button", { name: "Continuar con Google", exact: true });
    await expect(google).toBeEnabled();
    await google.click();
    await expect(page.getByRole("button", { name: "Conectando con Google…", exact: true })).toBeDisabled();
    await expect.poll(() => attempts).toBe(1);
    releaseSignIn();
    await expect(page.getByRole("alert").filter({ hasText: "No se pudo iniciar con Google" })).toBeVisible();
    await expect(google).toBeEnabled();
    await google.click();
    await expect.poll(() => attempts).toBe(2);
  } finally {
    releaseSession();
    releaseSignIn();
  }
});

test("Google rate-limit feedback is visible next to the button and uses the retry window", async ({ page }) => {
  await page.route("**/api/auth/get-session**", (route) => route.fulfill({ json: null }));
  await page.route("**/api/auth/sign-in/social", (route) => route.fulfill({
    status: 429,
    headers: { "X-Retry-After": "125" },
    json: { message: "Too many requests. Please try again later." },
  }));
  await page.goto("/acceso");
  const google = page.getByRole("button", { name: "Continuar con Google", exact: true });
  await google.click();
  const alert = page.getByRole("alert").filter({ hasText: "Se alcanzó el límite de intentos" });
  await expect(alert).toContainText("Esperá 3 minutos");
  await expect(alert).toBeInViewport();
  await expect(google).toBeEnabled();
});

test("Google network failures show feedback and let the user retry", async ({ page }) => {
  await page.route("**/api/auth/get-session**", (route) => route.fulfill({ json: null }));
  await page.route("**/api/auth/sign-in/social", (route) => route.abort("failed"));
  await page.goto("/acceso");
  const google = page.getByRole("button", { name: "Continuar con Google", exact: true });
  await google.click();
  await expect(page.getByRole("alert").filter({ hasText: "Comprobá la conexión" })).toBeVisible();
  await expect(google).toBeEnabled();
});

test("Google sign-in times out instead of leaving the button busy", async ({ page }) => {
  await page.route("**/api/auth/get-session**", (route) => route.fulfill({ json: null }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/sign-in/social", async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: { message: "Unavailable" } });
  });
  try {
    await page.goto("/acceso");
    await page.getByRole("button", { name: "Continuar con Google", exact: true }).click();
    await expect(page.getByRole("button", { name: "Conectando con Google…", exact: true })).toBeDisabled();
    await expect(page.getByRole("alert").filter({ hasText: "Comprobá la conexión" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Continuar con Google", exact: true })).toBeEnabled();
  } finally { release(); }
});

test("Google sign-in redirects after a fresh installation with no session", async ({ page }) => {
  await page.route("**/api/auth/get-session**", (route) => route.fulfill({ json: null }));
  await page.route("**/api/auth/sign-in/social", (route) => route.fulfill({
    json: { redirect: true, url: `${new URL(page.url()).origin}/google-sign-in-test` },
  }));
  await page.route("**/google-sign-in-test", (route) => route.fulfill({ contentType: "text/html", body: "Google sign-in" }));
  await page.goto("/acceso");
  await page.getByRole("button", { name: "Continuar con Google", exact: true }).click();
  await expect(page).toHaveURL(/\/google-sign-in-test$/);
});
