import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions } from "@playwright/test";
import pg from "pg";

const widths = process.env.A11Y_WIDTHS?.split(",").map(Number).filter(Number.isFinite) ?? [320, 360, 375, 430, 760, 761, 820, 821, 1280];
const routes = ["/", "/acceso", "/cocina", "/familia", "/tareas", "/menus", "/compras", "/biblioteca"];
const databaseUrl = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
let fixtureSequence = 0;

type Fixture = {
  api: APIRequestContext;
  context: BrowserContext;
  familyId: string;
  storageState: BrowserContextOptions["storageState"];
  userId: string;
};

async function createFixture(baseURL: string, browser: Browser): Promise<Fixture> {
  if (!databaseUrl) throw new Error("test:a11y requires FAMILY_UTILS_TEST_DATABASE_URL; refusing to use an application database");
  // Independent test identities must not share Better Auth's sign-in rate-limit bucket.
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${++fixtureSequence}` },
  });
  let familyId = "";
  let userId = "";
  try {
    const setupPage = await context.newPage();
    await setupPage.goto("/acceso");
    const anonymous = await setupPage.evaluate(async () => {
      const response = await fetch("/api/access/prepare", { method: "POST" });
      return { ok: response.ok, origin: location.origin, status: response.status, text: await response.text() };
    });
    if (!anonymous.ok) throw new Error(`anonymous access preparation failed from ${anonymous.origin} (${anonymous.status}): ${anonymous.text}`);
    const api = context.request;
    const sessionResponse = await api.get("/api/auth/get-session");
    if (!sessionResponse.ok()) throw new Error(`session read failed (${sessionResponse.status()}): ${await sessionResponse.text()}`);
    const session = await sessionResponse.json() as { user: { id: string } };
    userId = session.user.id;
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const family = await client.query("INSERT INTO families (name) VALUES ('Familia accesibilidad') RETURNING id");
      familyId = family.rows[0].id as string;
      const member = await client.query(
        "INSERT INTO members (family_id, name, role, access_method) VALUES ($1, 'Alex', 'administrator', 'code') RETURNING id",
        [familyId],
      );
      await client.query(
        "INSERT INTO member_devices (member_id, auth_user_id, label) VALUES ($1, $2, 'Playwright')",
        [member.rows[0].id, session.user.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      await pool.end();
    }

    const task = await api.post("/api/tasks", { data: {
      title: "Preparar la mesa",
      description: "Dejar platos, vasos y cubiertos listos.",
      assignmentMode: "shared",
      carryPolicy: "expires_daily",
      repeatWeekdays: [],
      assigneeIds: [],
    } });
    expect(task.ok()).toBeTruthy();
    const meal = await api.post("/api/meals/ideas", { data: {
      title: "Tarta de verduras",
      note: "Con ensalada fresca",
    } });
    expect(meal.ok()).toBeTruthy();

    return { api, context, familyId, storageState: await context.storageState(), userId };
  } catch (error) {
    try {
      await removeFixture({ familyId, userId, context });
    } catch {
      await context.close();
    }
    throw error;
  }
}

async function removeFixture(fixture: Pick<Fixture, "familyId" | "userId" | "context"> | undefined) {
  if (!fixture || !databaseUrl) return;
  if (!fixture.familyId && !fixture.userId) {
    await fixture.context.close();
    return;
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    if (fixture.familyId) {
      await pool.query("DELETE FROM meal_selections WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id = $1)", [fixture.familyId]);
      await pool.query("DELETE FROM meal_attendance WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id = $1)", [fixture.familyId]);
      await pool.query("DELETE FROM meal_groups WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id = $1)", [fixture.familyId]);
      await pool.query("DELETE FROM meal_suggestions WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id = $1)", [fixture.familyId]);
      await pool.query("DELETE FROM meal_ideas WHERE family_id = $1", [fixture.familyId]);
      await pool.query("DELETE FROM meal_slots WHERE family_id = $1", [fixture.familyId]);
      await pool.query("DELETE FROM audit_events WHERE family_id = $1", [fixture.familyId]);
      await pool.query("DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE family_id = $1)", [fixture.familyId]);
      await pool.query("DELETE FROM task_occurrences WHERE family_id = $1", [fixture.familyId]);
      await pool.query("DELETE FROM tasks WHERE family_id = $1", [fixture.familyId]);
      await pool.query("DELETE FROM meal_routines WHERE family_id = $1", [fixture.familyId]);
      await pool.query("DELETE FROM families WHERE id = $1", [fixture.familyId]);
    }
    if (fixture.userId) await pool.query('DELETE FROM "user" WHERE id = $1', [fixture.userId]);
  } finally {
    await pool.end();
    await fixture.context.close();
  }
}

async function inspectControls(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (value: string) => {
      const channels = rgb(value).map((item) => item / 255).map((item) => item <= .04045 ? item / 12.92 : ((item + .055) / 1.055) ** 2.4);
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const contrast = (a: string, b: string) => {
      const [x, y] = [luminance(a), luminance(b)];
      return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
    };
    const background = (element: Element | null): string => {
      for (let current = element; current; current = current.parentElement) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== "rgba(0, 0, 0, 0)" && value !== "transparent") return value;
      }
      return "rgb(255, 255, 255)";
    };
    const visible = (element: HTMLElement) => element.checkVisibility();

    const focusables = [...document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary')].filter(visible);
    for (const element of focusables) {
      element.focus();
      const style = getComputedStyle(element);
      if (style.outlineStyle === "none" || parseFloat(style.outlineWidth) < 2 || contrast(style.outlineColor, background(element.parentElement)) < 3) {
        issues.push(`foco insuficiente: ${element.tagName.toLowerCase()} ${element.textContent?.trim().slice(0, 30) ?? ""}`);
      }
    }

    const bounded = [...document.querySelectorAll<HTMLElement>('input:not([type="checkbox"]),select,textarea,[class*="weekControls"] button,[class*="attendancePerson"]')].filter(visible);
    for (const element of bounded) {
      const style = getComputedStyle(element);
      const outside = background(element.parentElement);
      if (Math.max(contrast(style.borderTopColor, outside), contrast(style.backgroundColor, outside)) < 3) {
        issues.push(`borde insuficiente: ${element.tagName.toLowerCase()}`);
      }
    }

    const placeholders = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder],textarea[placeholder]')].filter(visible);
    for (const element of placeholders) {
      const style = getComputedStyle(element, "::placeholder");
      if (Number(style.opacity) < 1 || contrast(style.color, getComputedStyle(element).backgroundColor) < 4.5) {
        issues.push(`placeholder insuficiente: ${element.getAttribute("placeholder")}`);
      }
    }
    return issues;
  });
}

test("menús diario mantiene personas visibles y permite agregar desde el repertorio a 360 px", async ({ browser, baseURL }) => {
  const fixture = await createFixture(baseURL!, browser);
  try {
    const context = await browser.newContext({ storageState: fixture.storageState, viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    await page.goto("/menus");
    const lunch = page.getByRole("article", { name: "Almuerzo", exact: true });
    await lunch.getByRole("button", { name: "Almuerzo", exact: true }).click();
    await expect(lunch.getByRole("group", { name: "Preparación para Alex" })).toBeVisible();
    await expect(lunch.getByText("Todavía no elegimos qué comer", { exact: true })).toBeVisible();
    await lunch.getByRole("button", { name: "Agregar comida", exact: true }).click();
    const bank = page.getByRole("dialog", { name: "Agregar comida", exact: true });
    await bank.getByLabel("¿Qué vamos a comer?").fill("Tarta de verduras");
    const dish = bank.getByRole("button", { name: /Agregar.*Tarta de verduras/ });
    await expect(dish).toBeVisible();
    expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
    await dish.click();
    await expect(bank).toBeHidden();
    await expect(lunch.getByText("Tarta de verduras", { exact: true }).first()).toBeVisible();
    const group=lunch.getByRole("group",{name:"Preparación para Alex"});
    await group.getByRole("button",{name:"Come en casa",exact:true}).click();
    await expect(group.getByRole("button",{name:"Come en casa",exact:true})).toHaveAttribute("aria-pressed","true");
    await page.keyboard.press("Tab");
    expect(await inspectControls(page)).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
    expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({path:"test-results-a11y/menus-diarios-360.png",fullPage:true});
    await context.close();
  } finally { await removeFixture(fixture); }
});

test("contraste, foco y desbordamiento en las áreas públicas y familiares", async ({ browser, baseURL }) => {
  test.setTimeout(Math.max(120_000, widths.length * 30_000));
  const fixture = await createFixture(baseURL!, browser);
  const failures: string[] = [];
  try {
    for (const width of widths) {
      const scenarios = [
        { routes: routes.slice(0, 3), storageState: undefined },
        { routes: routes.slice(3), storageState: fixture.storageState },
      ];
      for (const scenario of scenarios) {
        const context = await browser.newContext({ storageState: scenario.storageState, viewport: { width, height: 900 } });
        const page = await context.newPage();
        for (const route of scenario.routes) {
          const apiPath = ({ "/familia": "/api/family", "/tareas": "/api/tasks", "/menus": "/api/meals/planner", "/compras": "/api/shopping" } as Record<string, string>)[route];
          const dataReady = apiPath ? page.waitForResponse((response) => new URL(response.url()).pathname === apiPath && response.ok()) : null;
          await page.goto(route, { waitUntil: "domcontentloaded" });
          if (dataReady) await dataReady;
          await expect(page.locator("main")).toBeVisible();
          if (route === "/cocina") {
            await page.getByLabel("Ingrediente", { exact: true }).selectOption("flour");
            await expect(page.getByLabel("Resultado", { exact: true })).toContainText("125 g");
          }
          if (route === "/tareas") await expect(page.getByLabel("Ir a una fecha")).toBeVisible();
          await expect(page).toHaveURL((url) => url.pathname === route);
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
          for (const violation of results.violations) {
            const targets = violation.nodes.flatMap((node) => node.target).join(", ");
            failures.push(`${route} a ${width}px · ${violation.id}: ${targets}`);
          }
          for (const issue of await inspectControls(page)) failures.push(`${route} a ${width}px · ${issue}`);
          const overflow = await page.evaluate(() => ({
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          }));
          if (overflow.scrollWidth > overflow.clientWidth) failures.push(`${route} se desborda a ${width}px (${overflow.scrollWidth} > ${overflow.clientWidth})`);
          if (process.env.A11Y_SCREENSHOTS === "1") {
            const name = route === "/" ? "inicio" : route.slice(1);
            await page.screenshot({ path: `/tmp/family-utils-${name}-${width}.png`, fullPage: true });
          }
        }
        await context.close();
      }
    }
    expect(failures).toEqual([]);
  } finally {
    await removeFixture(fixture);
  }
});

test("navegación diaria accesible en pasado y futuro", async ({ browser, baseURL }) => {
  const fixture = await createFixture(baseURL!, browser);
  try {
    const page = await fixture.context.newPage();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
    const day = new Date(`${today}T12:00:00Z`);
    for (const offset of [-1, 7]) {
      day.setTime(Date.parse(`${today}T12:00:00Z`) + offset * 86400_000);
      for (const width of [320, 375, 820]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${baseURL}/tareas?fecha=${day.toISOString().slice(0, 10)}`, { waitUntil: "networkidle" });
        const date = page.getByLabel("Ir a una fecha");
        await expect(date).toBeVisible();
        await date.focus();
        await expect(date).toBeFocused();
        for (const name of ["Día anterior", "Día siguiente", "Hoy"]) {
          const box = await page.getByRole("button", { name, exact: true }).boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
          expect(box?.width).toBeGreaterThanOrEqual(44);
        }
        await page.keyboard.press("Tab");
    expect(await inspectControls(page)).toEqual([]);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
      }
    }
  } finally { await removeFixture(fixture); }
});
