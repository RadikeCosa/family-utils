import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
let pool: pg.Pool, familyId: string, userId: string, api: APIRequestContext;
test.beforeEach(async ({ page, baseURL }) => {
  pool = new pg.Pool({
    connectionString: process.env.FAMILY_UTILS_TEST_DATABASE_URL,
  });
  familyId = (
    await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [
      `availability-ui-${randomUUID()}`,
    ])
  ).rows[0].id;
  api = await playwrightRequest.newContext({ baseURL });
  const r = await api.post("/api/access/prepare", {
    headers: {
      Origin: baseURL!,
      "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
  userId = (await (await api.get("/api/auth/get-session")).json()).user.id;
  const member = (
    await pool.query(
      "INSERT INTO members(family_id,name,role) VALUES($1,'Alex','administrator') RETURNING id",
      [familyId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)",
    [member, userId],
  );
  await page.context().addCookies((await api.storageState()).cookies);
});
test.afterEach(async () => {
  await api?.dispose();
  if (familyId) {
    for (const table of [
      "library_availability_operations",
      "library_availability_proposals",
      "library_streaming_offers",
      "library_platform_checks",
      "streaming_platform_aliases",
      "streaming_platforms",
      "library_companions",
      "library_contributions",
      "library_personal",
      "library_works",
      "audit_events",
    ])
      await pool.query(`DELETE FROM ${table} WHERE family_id=$1`, [familyId]);
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
  }
  if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await pool?.end();
});
test(
  "mobile availability: preview, confirm, stale results, free/provider AND and coverage",
  { tag: "@availability" },
  async ({ page }) => {
    expect(
      (
        await api.post("/api/library/platforms", {
          data: { action: "initialize" },
        })
      ).ok(),
    ).toBeTruthy();
    const platforms = (await (await api.get("/api/library/platforms")).json())
      .platforms;
    const netflix = platforms.find(
        (p: { name: string }) => p.name === "Netflix",
      ),
      plex = platforms.find((p: { name: string }) => p.name === "Plex");
    for (const p of [netflix, plex]) {
      const { version, ...data } = p;
      expect(
        (
          await api.patch("/api/library/platforms", {
            data: {
              ...data,
              expectedVersion: version,
              coverage: "verified",
              coverageSources: ["https://example.org/ar/coverage"],
            },
          })
        ).ok(),
      ).toBeTruthy();
    }
    const work = (
      await (
        await api.post("/api/library", {
          data: { title: "Una película para revisar", year: 2000 },
        })
      ).json()
    ).id;
    await api.post("/api/library", {
      data: { title: "Otra película sin revisar", year: 2001 },
    });
    await page.goto(`/cinemateca/${work}`);
    await expect(
      page.getByText("Todavía no revisamos esta película."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Revisar dónde verla", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Plataforma", exact: true })
      .selectOption(netflix.id);
    await page.getByLabel("Fecha de revisión en Argentina").fill("2026-01-01");
    await page
      .getByLabel("Fuentes de la revisión, una dirección por línea")
      .fill("https://example.org/ar/source");
    await page
      .getByRole("checkbox", { name: "Con suscripción", exact: true })
      .check();
    await page
      .getByLabel("Enlace de la película")
      .fill("https://example.org/ar/movie");
    await page
      .getByLabel("Fuentes de la oferta, una dirección por línea")
      .fill("https://example.org/ar/source");
    await page
      .getByRole("button", { name: "Ver cambios antes de guardar" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Vista previa de los cambios" }),
    ).toBeVisible();
    expect(
      (await (await api.get(`/api/library/${work}/availability`)).json())
        .checks,
    ).toHaveLength(0);
    await page
      .getByRole("checkbox", {
        name: "Revisé esta propuesta y confirmo sus cambios",
      })
      .check();
    await page
      .getByRole("button", { name: "Confirmar esta propuesta", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Resultado de la carga" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Última disponibilidad conocida. Revisada el 01/01/2026.",
        { exact: false },
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cerrar revisión", exact: true })
      .click();
    let result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    await page.goto("/cinemateca");
    await expect(
      page.getByText(/1 de 2 películas con alguna revisión/),
    ).toBeVisible();
    await page.getByText("Dónde verla", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Netflix", exact: true }).check();
    await page
      .getByRole("checkbox", { name: "Gratis, también con publicidad" })
      .check();
    await expect(
      page.getByText(
        "Las plataformas seleccionadas no tienen modalidades gratuitas.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "No encontramos películas con estos filtros",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Quitar Gratis" }).click();
    await expect(
      page.getByRole("heading", { name: "Una película para revisar" }),
    ).toBeVisible();
    await expect(page.getByText("Revisar", { exact: true })).toBeVisible();
    await page.reload();
    await page.locator("summary").filter({ hasText: "Dónde verla" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Netflix", exact: true }),
    ).toBeChecked();
    expect(page.url()).toContain(`platform=${netflix.id}`);
    result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    const overflow = await page.evaluate(() => ({
      amount:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      nodes: [...document.querySelectorAll("*")]
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => ({
          tag: e.tagName,
          class: e.className,
          right: e.getBoundingClientRect().right,
          scroll: e.scrollWidth,
          client: e.clientWidth,
          overflow: getComputedStyle(e).overflow,
        }))
        .slice(0, 12),
    }));
    await page.screenshot({
      path: "test-results/availability-overflow.png",
      fullPage: true,
    });
    expect(overflow.amount, JSON.stringify(overflow.nodes)).toBeLessThanOrEqual(
      1,
    );
    await page.screenshot({
      path: `test-results/availability-${test.info().project.name.replaceAll(" ", "-")}.png`,
      fullPage: true,
    });
  },
);
