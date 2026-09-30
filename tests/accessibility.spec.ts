import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions } from "@playwright/test";
import pg from "pg";

const widths = process.env.A11Y_WIDTHS?.split(",").map(Number).filter(Number.isFinite) ?? [320, 360, 375, 430, 760, 761, 820, 821, 1280];
const routes = ["/", "/acceso", "/familia", "/tareas", "/menus"];
const databaseUrl = process.env.FAMILY_UTILS_TEST_DATABASE_URL;

type Fixture = {
  api: APIRequestContext;
  context: BrowserContext;
  familyId: string;
  storageState: BrowserContextOptions["storageState"];
  userId: string;
};

async function createFixture(baseURL: string, browser: Browser): Promise<Fixture> {
  if (!databaseUrl) throw new Error("test:a11y requires FAMILY_UTILS_TEST_DATABASE_URL; refusing to use an application database");
  const context = await browser.newContext({ baseURL });
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
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
    const meal = await api.post("/api/meals/suggestions", { data: {
      date: today,
      mealType: "lunch",
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
      await pool.query("DELETE FROM meal_suggestions WHERE slot_id IN (SELECT id FROM meal_slots WHERE family_id = $1)", [fixture.familyId]);
      await pool.query("DELETE FROM meal_slots WHERE family_id = $1", [fixture.familyId]);
      await pool.query("DELETE FROM audit_events WHERE family_id = $1", [fixture.familyId]);
      await pool.query("DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE family_id = $1)", [fixture.familyId]);
      await pool.query("DELETE FROM task_occurrences WHERE family_id = $1", [fixture.familyId]);
      await pool.query("DELETE FROM tasks WHERE family_id = $1", [fixture.familyId]);
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

    const bounded = [...document.querySelectorAll<HTMLElement>('input:not([type="checkbox"]),select,textarea,[class*="weekControls"] button,[class*="person"]')].filter(visible);
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

test("menús permite elegir, quitar y volver a proponer con foco y objetivos táctiles accesibles", async ({ browser, baseURL }) => {
  const fixture = await createFixture(baseURL!, browser);
  try {
    const context = await browser.newContext({ storageState: fixture.storageState, viewport: { width: 375, height: 850 } });
    const page = await context.newPage();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
    await page.goto("/menus?fecha=fecha-invalida");
    await expect(page.getByRole("status").filter({ hasText: "Mostramos hoy" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`fecha=${today}`));

    const dialogs = page.getByRole("dialog");
    const choose = page.getByRole("button", { name: "Elegir comida" }).first();
    await choose.click();
    await expect(dialogs).toBeVisible();
    await expect(page.locator("input[name='meal-choice']").first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Cerrar" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Elegir comida" }).last()).toBeFocused();
    const dialogAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(dialogAxe.violations.map((violation) => violation.id)).toEqual([]);
    const dialogSizes = await page.locator(".dialog button, .dialog input:not([type='radio']):not([type='checkbox']), .choiceOption, .newChoice").evaluateAll((elements) =>
      elements.filter((element) => (element as HTMLElement).checkVisibility()).map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.textContent?.trim() ?? element.tagName, width: rect.width, height: rect.height };
      }));
    expect(dialogSizes.filter((item) => item.width < 44 || item.height < 44)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialogs).toBeHidden();
    await expect(choose).toBeFocused();

    const interactiveSizes = await page.locator("a[href], button, input:not([type='radio']):not([type='checkbox']), .details summary, .statusChoice, .choiceOption, .newChoice").evaluateAll((elements) =>
      elements.filter((element) => (element as HTMLElement).checkVisibility()).map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.textContent?.trim() ?? element.getAttribute("aria-label") ?? element.tagName, width: rect.width, height: rect.height };
      }));
    expect(interactiveSizes.filter((item) => item.width < 44 || item.height < 44)).toEqual([]);

    const lunch = page.locator("#meal-lunch");
    await lunch.getByText("Asistencia", { exact: false }).click();
    const attendanceTargets = await lunch.locator(".statusChoice").evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    expect(attendanceTargets.filter((item) => item.width < 44 || item.height < 44)).toEqual([]);
    await lunch.getByLabel("No estará").click();
    await expect(lunch.getByText("Nadie figura en casa; podés elegir de todos modos.")).toBeVisible();
    await lunch.getByRole("button", { name: "Elegir comida" }).click();
    await page.getByLabel("Escribir otra comida").check();
    await page.getByLabel("Comida").fill("Guiso de prueba UX");
    const resumedRequest = page.waitForRequest((request) => request.url().includes("/api/meals?weekStart="));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await resumedRequest;
    await expect(page.getByLabel("Comida")).toHaveValue("Guiso de prueba UX");
    await page.route("**/api/meals/selection", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "MEAL_DAY_CLOSED", error: "Este día ya no se puede editar." }) }));
    await page.getByRole("button", { name: "Elegir comida" }).last().click();
    await expect(page.getByRole("alert").filter({ hasText: "Este día ya no se puede editar" })).toBeVisible();
    await expect(page.getByLabel("Comida")).toHaveValue("Guiso de prueba UX");
    await page.unroute("**/api/meals/selection");
    await page.getByRole("button", { name: "Elegir comida" }).last().click();
    await expect(lunch.getByText("Guiso de prueba UX")).toBeVisible();

    await lunch.getByRole("button", { name: "Quitar elección" }).click();
    await page.getByRole("button", { name: "Quitar elección" }).last().click();
    await expect(page.getByRole("button", { name: "Sí, quitar elección" })).toBeVisible();
    await page.getByRole("button", { name: "Sí, quitar elección" }).click();
    await expect(lunch.getByText("Todavía no se eligió una comida para este horario.")).toBeVisible();
    await lunch.locator("details").nth(1).locator("summary").click();
    await expect(lunch.getByText("Guiso de prueba UX")).toBeVisible();
    await lunch.getByRole("button", { name: "Elegir comida" }).click();
    await page.locator(".choiceOption").filter({ hasText: "Guiso de prueba UX" }).locator("input").check();
    await page.getByRole("button", { name: "Elegir comida" }).last().click();
    await expect(lunch.getByText("Guiso de prueba UX")).toBeVisible();
    await expect(lunch.getByText(/elegió esta comida/)).toBeVisible();
    await lunch.getByRole("button", { name: "Cambiar comida" }).click();
    await page.getByLabel("Escribir otra comida").check();
    await page.getByLabel("Comida").fill("Borrador ante conflicto");
    let conflictRequests = 0;
    await page.route("**/api/meals/selection", (route) => {
      conflictRequests += 1;
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "MEAL_SELECTION_CONFLICT", error: "Revisá la elección actual." }) });
    });
    await page.getByRole("button", { name: "Guardar cambio" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Alguien cambió esta comida" })).toBeVisible();
    await expect(page.getByLabel("Comida")).toHaveValue("Borrador ante conflicto");
    await page.getByRole("button", { name: "Ver la elección actual" }).click();
    await expect(dialogs).toBeHidden();
    expect(conflictRequests).toBe(1);
    await page.unroute("**/api/meals/selection");
    await expect(lunch.getByText("Guiso de prueba UX")).toBeVisible();

    const requestUrls: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/meals?weekStart=")) requestUrls.push(request.url()); });
    const dateInput = page.getByLabel("Ir a una fecha");
    const nextWithinWeek = new Date(`${today}T12:00:00.000Z`);
    const deltaToStayInWeek = nextWithinWeek.getUTCDay() === 0 ? -1 : 1;
    nextWithinWeek.setUTCDate(nextWithinWeek.getUTCDate() + deltaToStayInWeek);
    const sameWeekDate = nextWithinWeek.toISOString().slice(0, 10);
    await dateInput.fill(sameWeekDate);
    await expect(page).toHaveURL(new RegExp(`fecha=${sameWeekDate}`));
    await page.waitForTimeout(150);
    expect(requestUrls).toHaveLength(0);
    const nextWeek = new Date(`${today}T12:00:00.000Z`);
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const nextWeekDate = nextWeek.toISOString().slice(0, 10);
    await page.route(/\/api\/meals\?weekStart=/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    const weekRequest = page.waitForRequest((request) => request.url().includes("/api/meals?weekStart="));
    await dateInput.fill(nextWeekDate);
    await weekRequest;
    await expect(page.getByText("Cargando…").first()).toBeVisible();
    await context.close();
  } finally {
    await removeFixture(fixture);
  }
});

test("contraste, foco y desbordamiento en las cinco áreas", async ({ browser, baseURL }) => {
  const fixture = await createFixture(baseURL!, browser);
  const failures: string[] = [];
  try {
    for (const width of widths) {
      const scenarios = [
        { routes: routes.slice(0, 2), storageState: undefined },
        { routes: routes.slice(2), storageState: fixture.storageState },
      ];
      for (const scenario of scenarios) {
        const context = await browser.newContext({ storageState: scenario.storageState, viewport: { width, height: 900 } });
        const page = await context.newPage();
        for (const route of scenario.routes) {
          await page.goto(route, { waitUntil: "networkidle" });
          await expect(page).toHaveURL(new RegExp(`${route === "/" ? "/?$" : `${route}$`}`));
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
