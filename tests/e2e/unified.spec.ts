import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  expect,
  request,
  test,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
const base = "http://localhost:3411";
const memberId = "11111111-1111-4111-8111-111111111111";
let pool: pg.Pool,
  api: APIRequestContext,
  familyId: string,
  userId: string,
  listId: string,
  recipeId: string,
  movieId: string,
  routineId: string,
  sessionId: string;
let cookies: Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];
test.beforeAll(async () => {
  pool = new pg.Pool({
    connectionString: process.env.FAMILY_UTILS_TEST_DATABASE_URL,
  });
  familyId = (
    await pool.query(
      "INSERT INTO families(name) VALUES('Familia de prueba de interfaz') RETURNING id",
    )
  ).rows[0].id;
  api = await request.newContext({ baseURL: base });
  const prepared = await api.post("/api/access/prepare", {
    headers: {
      Origin: base,
      "x-forwarded-for": `2001:db8:${randomUUID().slice(0, 4)}::1`,
    },
  });
  expect(prepared.status(), await prepared.text()).toBe(200);
  userId = (await (await api.get("/api/auth/get-session")).json()).user.id;
  await pool.query(
    "INSERT INTO members(id,family_id,name,role) VALUES($1,$2,'Alex','administrator')",
    [memberId, familyId],
  );
  await pool.query(
    "INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)",
    [memberId, userId],
  );
  const list = await api.post("/api/shopping", {
    data: { name: "Compra semanal" },
  });
  expect(list.status(), await list.text()).toBe(201);
  listId = (await list.json()).id;
  const recipe = await api.post("/api/recipes", {
    data: { title: "Tarta de prueba" },
  });
  expect(recipe.status(), await recipe.text()).toBe(201);
  recipeId = (await recipe.json()).idea.id;
  const movie = await api.post("/api/library", {
    data: { title: "Una película en familia", genres: ["drama"], year: 2024 },
  });
  expect(movie.status(), await movie.text()).toBe(201);
  movieId = (await movie.json()).id;
  const routineInput = {
    name: "Rutina de prueba",
    blocks: [
      {
        name: "Fuerza",
        rounds: 2,
        exercises: [
          { name: "Sentadillas", mode: "repetitions", repetitions: 10 },
        ],
      },
    ],
  };
  const routine = await api.post("/api/training/routines", {
    data: { ...routineInput, operationKey: randomUUID() },
  });
  expect(routine.status(), await routine.text()).toBe(201);
  const routineBody = await routine.json();
  routineId = routineBody.item.id;
  const session = await api.post("/api/training/sessions", {
    data: {
      ...routineInput,
      operationKey: randomUUID(),
      sourceRoutineId: routineId,
      performedOn: routineBody.today,
      durationSeconds: 600,
      effort: 5,
      note: "Entrenamiento de prueba",
    },
  });
  expect(session.status(), await session.text()).toBe(201);
  sessionId = (await session.json()).item.id;
  cookies = (await api.storageState()).cookies;
});
test.beforeEach(async ({ page }) => {
  await page.context().addCookies(cookies);
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});
test.afterAll(async () => {
  if (familyId) {
    await pool.query("DELETE FROM shopping_lists WHERE family_id=$1", [
      familyId,
    ]);
    for (const table of [
      "training_sessions",
      "training_routines",
      "library_works",
    ])
      await pool.query(`DELETE FROM ${table} WHERE family_id=$1`, [familyId]);
    for (const table of [
      "meal_daily_plans",
      "meal_groups",
      "meal_selections",
      "meal_suggestions",
    ])
      await pool.query(
        `DELETE FROM ${table} WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id=$1)`,
        [familyId],
      );
    await pool.query("DELETE FROM meal_ideas WHERE family_id=$1", [familyId]);
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
  }
  if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await api?.dispose();
  await pool?.end();
});
test("activation: off, member preview and public presentation", async ({
  page,
}) => {
  await page.goto("http://localhost:3412/");
  await expect(page.locator("[data-unified-ui]")).toHaveCount(0);
  await page.goto("http://localhost:3413/");
  await expect(page.locator("[data-unified-ui]")).toBeVisible();
  await page.goto("http://localhost:3414/");
  await expect(
    page.locator("aside").getByRole("link", { name: "Recetas", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("aside").getByRole("link", { name: "Deportes", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator("aside")
      .getByRole("link", { name: "Mi familia", exact: true }),
  ).toBeVisible();
  const unavailable = await page.goto("http://localhost:3414/recetas");
  expect(unavailable?.status()).toBe(404);
  await page.context().clearCookies();
  await page.goto("http://localhost:3413/");
  await expect(page.locator("[data-unified-public]")).toHaveCount(0);
  await page.goto("/cocina");
  await expect(page.locator("[data-unified-public]")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Conversor de cocina", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-unified-ui]")).toHaveCount(0);
});
test("drawer shares triggers, traps focus and restores opener", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/compras?archived=true");
  const menu = page.getByRole("button", { name: "Abrir menú de aplicaciones" });
  const menuBounds = await menu.boundingBox();
  expect(menuBounds?.width).toBeGreaterThanOrEqual(44);
  expect(menuBounds?.height).toBeGreaterThanOrEqual(44);
  const profileBounds = await page
    .locator('summary[aria-label="Perfil de Alex"]')
    .boundingBox();
  expect(profileBounds?.width).toBeGreaterThanOrEqual(44);
  expect(profileBounds?.height).toBeGreaterThanOrEqual(44);
  await menu.click();
  const drawer = page.getByRole("dialog", { name: "Menú de aplicaciones" });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("link", { name: "Archivadas", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await drawer.getByRole("button", { name: "Cerrar menú" }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await drawer.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(menu).toBeFocused();
  const section = page.getByRole("button", { name: "Archivadas", exact: true });
  await section.click();
  await expect(drawer).toBeVisible();
  await drawer
    .getByRole("link", { name: "Listas activas", exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  await expect(page).toHaveURL(/\/compras$/);
});
test("recipe filter, direct detail, native history, origin and parent have distinct behavior", async ({
  page,
}) => {
  await page.goto("/recetas?q=Tarta");
  await expect(
    page.getByRole("searchbox", { name: "Buscar recetas" }),
  ).toHaveValue("Tarta");
  await page
    .getByRole("link", { name: "Tarta de prueba", exact: true })
    .click();
  await expect(page.locator('nav[aria-label="Ubicación"]')).toContainText(
    "Tarta de prueba",
  );
  await page
    .getByRole("link", {
      name: "Volver a la vista anterior de Recetas",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/recetas\?q=Tarta$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/recetas/${recipeId}`));
  await page
    .locator('nav[aria-label="Ubicación"]')
    .getByRole("link", { name: "Recetas", exact: true })
    .click();
  await expect(page).toHaveURL(/\/recetas$/);
  await page.goto(`/recetas/${recipeId}?unknown=remove`);
  await expect(page).toHaveURL(new RegExp(`/recetas/${recipeId}$`));
});
test("section navigation and back preserve menu date", async ({ page }) => {
  await page.goto("/menus?fecha=2026-11-10&vista=dia");
  await page
    .locator("aside")
    .getByRole("link", { name: "Semana", exact: true })
    .click();
  await expect(page).toHaveURL(/fecha=2026-11-10/);
  await expect(page).toHaveURL(/vista=semana/);
  await expect(
    page.getByRole("button", { name: "Día anterior", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/vista=dia/);
  await expect(
    page.getByRole("group", { name: "Vista del planificador" }),
  ).toHaveCount(0);
});
test("recent views are four distinct apps and restore exact view", async ({
  page,
}) => {
  for (const route of [
    "/cocina",
    "/entrenamiento?seccion=historial",
    "/recetas?q=Tarta",
    "/menus?vista=semana",
    "/compras?archived=true",
  ]) {
    await page.goto(route);
    await expect(page.locator("[data-unified-ui]")).toBeVisible();
  }
  await page.goto("/");
  const recent = page.getByRole("region", { name: "Retomar" });
  await expect(recent.getByRole("link")).toHaveCount(4);
  await recent.getByRole("link", { name: /Compras/ }).click();
  await expect(page).toHaveURL(/compras\?archived=true$/);
});
test("blocked storage, inaccessible detail and invalid parameters remain navigable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  await page.goto("/compras?archived=invalid&unknown=x");
  await expect(page).toHaveURL(/\/compras$/);
  await page.goto(`/compras/${randomUUID()}`);
  await expect(
    page.getByRole("heading", { name: "No encontramos esta lista" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Volver a las listas" }).click();
  await expect(page).toHaveURL(/\/compras$/);
});
test("converter mode survives reload and history without storing inputs", async ({
  page,
}) => {
  await page.goto("/cocina");
  await page.getByRole("button", { name: "Temperatura", exact: true }).click();
  await expect(page).toHaveURL(/temperatura=true/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Temperatura", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("De", { exact: true })).toHaveValue("C");
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Medidas e ingredientes", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
for (const width of [360, 390, 768, 1024, 1440]) {
  test(`screen inventory and accessibility at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const routes = [
      "/",
      "/tareas",
      "/tareas?seccion=historial",
      "/menus",
      "/menus?vista=semana",
      "/recetas",
      `/recetas/${recipeId}`,
      "/compras",
      `/compras/${listId}`,
      "/cinemateca",
      `/cinemateca/${movieId}`,
      "/deportes",
      "/deportes?sport=ufc",
      "/deportes?sport=champions",
      "/deportes/river/campeonato",
      "/deportes/champions/tabla",
      "/deportes/ufc-dashboard",
      "/entrenamiento",
      "/entrenamiento?seccion=historial",
      `/entrenamiento?detalle=${routineId}`,
      `/entrenamiento?seccion=historial&detalle=${sessionId}`,
      "/cocina",
      "/familia",
      "/acceso",
    ];
    for (const [index, route] of routes.entries()) {
      await page.goto(route);
      await expect(page.locator("h1").first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        route,
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${index}-${width}.png`),
        fullPage: true,
      });
      const result = await new AxeBuilder({ page }).analyze();
      expect(
        result.violations.map((item) => ({
          id: item.id,
          nodes: item.nodes.map((node) => node.target),
        })),
        route,
      ).toEqual([]);
    }
    for (const [route, action, name] of [
      [`/recetas/${recipeId}`, "Editar receta", "recipe-editor"],
      [`/cinemateca/${movieId}`, "Editar datos", "movie-editor"],
      [
        `/entrenamiento?detalle=${routineId}`,
        "Editar rutina",
        "training-editor",
      ],
      ["/tareas", "Nueva tarea", "task-editor"],
    ]) {
      await page.goto(route);
      await page.getByRole("button", { name: action, exact: true }).click();
      await page.screenshot({
        path: info.outputPath(`${name}-${width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        name,
      ).toBe(true);
      const formAudit = await new AxeBuilder({ page }).analyze();
      expect(
        formAudit.violations.map((item) => ({
          id: item.id,
          nodes: item.nodes.map((node) => node.target),
        })),
        name,
      ).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
}
test("profile change without logout isolates recent views", async ({
  page,
}) => {
  await page.goto("/compras?archived=true");
  await expect(page.locator("[data-unified-ui]")).toBeVisible();
  const otherId = (
    await pool.query(
      "INSERT INTO members(family_id,name) VALUES($1,'Sam') RETURNING id",
      [familyId],
    )
  ).rows[0].id;
  try {
    await pool.query(
      "UPDATE member_devices SET member_id=$1 WHERE auth_user_id=$2",
      [otherId, userId],
    );
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /Perfil de Alex/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Retomar" }).getByRole("link"),
    ).toHaveCount(0);
    await page.goto("/cocina");
    await expect
      .poll(() =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          `family-navigation:v1:${familyId}:${otherId}`,
        ),
      )
      .toContain("kitchen");
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Retomar" }).getByRole("link"),
    ).toHaveCount(1);
  } finally {
    await pool.query(
      "UPDATE member_devices SET member_id=$1 WHERE auth_user_id=$2",
      [memberId, userId],
    );
  }
  await page.goto("/");
  await expect(
    page
      .getByRole("region", { name: "Retomar" })
      .getByRole("link", { name: /Compras/ }),
  ).toBeVisible();
});
test("sign out from access clears only the outgoing profile navigation", async ({
  page,
}) => {
  const secondary = await request.newContext({ baseURL: base });
  let secondaryUser: string | undefined;
  try {
    const prepared = await secondary.post("/api/access/prepare", {
      headers: {
        Origin: base,
        "x-forwarded-for": `2001:db8:${randomUUID().slice(0, 4)}::1`,
      },
    });
    expect(prepared.status(), await prepared.text()).toBe(200);
    secondaryUser = (
      await (await secondary.get("/api/auth/get-session")).json()
    ).user.id;
    await pool.query(
      "INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)",
      [memberId, secondaryUser],
    );
    await page.context().clearCookies();
    await page.context().addCookies((await secondary.storageState()).cookies);
    const scope = `family-navigation:v1:${familyId}:${memberId}`;
    const other = `family-navigation:v1:${familyId}:another-profile`;
    await page.goto("/compras?archived=true");
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), scope))
      .toContain("shopping");
    await page.evaluate(
      ({ scope, other }) => {
        localStorage.setItem(
          other,
          JSON.stringify([{ appId: "kitchen", href: "/cocina" }]),
        );
        sessionStorage.setItem(
          `${scope}:origin:/compras/example`,
          "/compras?archived=true",
        );
      },
      { scope, other },
    );
    await page.goto("/acceso");
    await page
      .getByRole("button", {
        name: "Cerrar sesión para usar otro perfil",
        exact: true,
      })
      .click();
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), scope))
      .toBeNull();
    expect(
      await page.evaluate(
        (key) => sessionStorage.getItem(`${key}:origin:/compras/example`),
        scope,
      ),
    ).toBeNull();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), other),
    ).toContain("kitchen");
    const session = await secondary.get("/api/auth/get-session");
    // The browser session is signed out; the primary fixture's separate session still works.
    expect((await api.get("/api/family")).status()).toBe(200);
    expect(session.status()).toBe(200);
    expect(await session.json()).toBeNull();
  } finally {
    if (secondaryUser) {
      await pool.query("DELETE FROM member_devices WHERE auth_user_id=$1", [
        secondaryUser,
      ]);
      await pool.query('DELETE FROM "user" WHERE id=$1', [secondaryUser]);
    }
    await secondary.dispose();
  }
});
test("Home performance budget, five cold navigations per variant", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const report: Record<string, { lcp: number; cls: number }[]> = {};
  for (const signedIn of [false, true]) {
    const prefix = signedIn ? "member" : "public";
    report[`${prefix}-3411`] = [];
    report[`${prefix}-3412`] = [];
    for (let run = 0; run < 5; run++) {
      for (const port of run % 2 ? [3411, 3412] : [3412, 3411]) {
        const key = `${prefix}-${port}`;
        const context = await browser.newContext();
        if (signedIn) await context.addCookies(cookies);
        const sample = await context.newPage();
        await sample.route("https://fonts.googleapis.com/**", (route) =>
          route.abort(),
        );
        await sample.addInitScript(() => {
          const metrics = { lcp: 0, cls: 0 };
          Object.assign(window, { __uiMetrics: metrics });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              metrics.lcp = entry.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as (PerformanceEntry & {
              hadRecentInput: boolean;
              value: number;
            })[])
              if (!entry.hadRecentInput) metrics.cls += entry.value;
          }).observe({ type: "layout-shift", buffered: true });
        });
        await sample.goto(`http://localhost:${port}/`);
        await sample.waitForLoadState("networkidle");
        report[key].push(
          await sample.evaluate(
            () =>
              (
                window as unknown as {
                  __uiMetrics: { lcp: number; cls: number };
                }
              ).__uiMetrics,
          ),
        );
        await context.close();
      }
    }
  }
  const performancePath = info.outputPath("performance.json");
  await writeFile(performancePath, JSON.stringify(report, null, 2));
  await info.attach("performance.json", {
    path: performancePath,
    contentType: "application/json",
  });
  console.log("Home performance samples", JSON.stringify(report));
  for (const signedIn of [false, true]) {
    const median = (values: number[]) => values.sort((a, b) => a - b)[2];
    const prefix = signedIn ? "member" : "public";
    expect(
      median(report[`${prefix}-3411`].map((item) => item.lcp)) -
        median(report[`${prefix}-3412`].map((item) => item.lcp)),
    ).toBeLessThanOrEqual(200);
    expect(
      Math.max(...report[`${prefix}-3411`].map((item) => item.cls)),
    ).toBeLessThanOrEqual(0.1);
  }
  await page.close();
});
