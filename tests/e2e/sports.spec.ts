import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import pg from "pg";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
test.skip(!connectionString, "requires isolated PostgreSQL");
const baseURL = "http://localhost:3318";
let pool: pg.Pool, familyId: string, memberId: string, userId: string, api: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

function familyDay(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}
function curatedBundle() {
  // Keep the scheduled event safely in the future so this lifecycle regression
  // remains deterministic even if the suite runs after its local kickoff time.
  const eventDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const day = familyDay(eventDay);
  const from = familyDay();
  const throughDate = new Date(`${from}T12:00:00Z`); throughDate.setUTCDate(throughDate.getUTCDate() + 14);
  const through = familyDay(throughDate), checkedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    status: "curated",
    checkedAt,
    timezone: "America/Argentina/Buenos_Aires",
    curation: { completeHorizon: { river: { from, through, complete: true }, ufc: { from, through, complete: true } } },
    events: [
      { kind: "football_match", sourceProvider: "espn", externalReference: "991234", title: "River Plate vs Boca Juniors", competition: "Liga Profesional", firstParticipant: "River Plate", secondParticipant: "Boca Juniors", eventDate: day, startTime: "20:15", venue: "Monumental", channel: "ESPN Premium", status: "scheduled", source: { primary: "https://www.ligaprofesional.ar/", checkedAt } },
      { kind: "ufc_card", sourceProvider: "ufc_official", externalReference: "ufc-test-night", title: "UFC Fight Night: Alpha vs Beta", eventDate: day, preliminaryDate: day, preliminaryTime: "18:00", mainCardDate: day, mainCardTime: "21:00", fights: [{ firstFighter: "Alpha", secondFighter: "Beta", boutBlock: "main", isMainEvent: true }], source: { primary: "https://www.ufc.com/events", checkedAt, validation: { officialCardComplete: true, officialFightCount: 1, independentCrossCheck: "passed" } } },
    ],
  };
}

test.beforeEach(async ({ page }) => {
  pool = new pg.Pool({ connectionString });
  familyId = (await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [`sports-ui-${randomUUID()}`])).rows[0].id;
  api = await playwrightRequest.newContext({ baseURL });
  const response = await api.post("/api/access/prepare", { headers: { Origin: baseURL, "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}` } });
  expect(response.status(), await response.text()).toBe(200);
  userId = (await (await api.get("/api/auth/get-session")).json()).user.id;
  memberId = (await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,'Alex','administrator') RETURNING id", [familyId])).rows[0].id;
  await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [memberId, userId]);
  await page.context().addCookies((await api.storageState()).cookies);
});

test.afterEach(async () => {
  await api?.dispose();
  if (familyId) {
    await pool.query("DELETE FROM audit_events WHERE family_id=$1 AND entity_type IN ('sports_event','sports_comment','sports_formation','sports_week','sports_import')", [familyId]);
    for (const table of ["sports_football_event_sources", "sports_formations", "sports_comments", "sports_fights", "sports_weeks", "sports_events"]) await pool.query(`DELETE FROM ${table} WHERE family_id=$1`, [familyId]);
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
  }
  if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await pool?.end();
});

test("Champions remains available without a family or environment switch", async ({ page }) => {
  const switchRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/sports/champions/switch")) switchRequests.push(request.url());
  });
  await page.goto("/deportes");
  const champions = page.getByRole("button", { name: "Champions", exact: true });
  await expect(champions).toBeVisible();
  await champions.click();
  await expect(champions).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Champions: (encendido|apagado)|Leyendo Champions/ })).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(switchRequests).toEqual([]);
  await expect(page.getByRole("button", { name: "River", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "UFC", exact: true })).toBeVisible();
});

test("Deportes ofrece importación curada y no intenta sincronizar fuentes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Abrir Deportes" }).click();
  await page.getByText("Administrar", { exact: true }).click();
  await page.getByText("Agenda · cargas y resultados", { exact: true }).click();
  await expect(page.getByLabel("Contenido JSON", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Automatización desactivada", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Actualizar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cargar partido", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cargar cartelera", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Actualizar agenda", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Validar y revisar", exact: true }).first()).toBeDisabled();
  const response = await page.request.post(`${baseURL}/api/sports/sync`, { headers: { Origin: baseURL } });
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe("Automatización desactivada");
});

test("JSON curado carga River y UFC y conserva formación, comentario e identidad al reprogramar", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("link", { name: "Abrir Deportes" }).click();
  await page.getByText("Administrar", { exact: true }).click();
  await page.getByText("Agenda · cargas y resultados", { exact: true }).click();
  await page.getByRole("button", { name: "UFC", exact: true }).click();
  await page.getByText("Semana y visibilidad", { exact: true }).click();
  await page.getByRole("button", { name: "Marcar semana actual sin UFC", exact: true }).click();
  await expect(page.getByRole("button", { name: "Quitar marca de semana sin evento", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "UFC", exact: true }).click();
  await expect(page.getByText("No hay UFC esta semana. Podés consultar las próximas carteleras.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "River", exact: true }).click();
  await page.getByText("Administrar", { exact: true }).click();
  const bundle = curatedBundle();
  await page.getByLabel("Contenido JSON", { exact: true }).first().fill(JSON.stringify(bundle));
  await page.getByRole("button", { name: "Validar y revisar", exact: true }).first().click();
  await expect(page.getByText("1 partidos · 1 carteleras · 1 peleas")).toBeVisible().catch(async error => {
    const message = await page.getByRole("alert").textContent().catch(() => "sin mensaje de validación");
    throw new Error(`${error.message}\nError de importación: ${message}`);
  });
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.getByRole("heading", { name: "River Plate vs Boca Juniors" })).toBeVisible();
  await page.getByRole("button", { name: "UFC", exact: true }).click();
  await expect(page.getByRole("heading", { name: "UFC Fight Night: Alpha vs Beta" })).toBeVisible();
  await page.getByText(/Datos revisados el/).click();
  await expect(page.getByText("Información curada desde el chat · UFC oficial", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "River", exact: true }).click();
  await page.getByLabel("Mi formación deseada").fill("4-3-3: once curado en familia");
  await page.getByRole("button", { name: "Guardar formación" }).click();
  await expect(page.getByText("Formación guardada.", { exact: true })).toBeVisible();
  const river = (await pool.query("SELECT id FROM sports_events WHERE family_id=$1 AND kind='football_match'", [familyId])).rows[0];
  const card = (await pool.query("SELECT id FROM sports_events WHERE family_id=$1 AND kind='ufc_card'", [familyId])).rows[0];
  await page.locator('section[aria-label="Conversación familiar"]').last().getByLabel("Escribí un comentario").fill("Seguimos esta estelar");
  await page.locator('section[aria-label="Conversación familiar"]').last().getByRole("button", { name: "Comentar" }).click();
  await expect(page.getByText("Seguimos esta estelar")).toBeVisible();
  await page.request.patch(`${baseURL}/api/sports/events/${card.id}`, { headers: { Origin: baseURL }, data: { action: "hide" } });

  const moved = structuredClone(bundle);
  const movedDate = new Date(`${familyDay()}T12:00:00Z`); movedDate.setUTCDate(movedDate.getUTCDate() + 2);
  const newDate = familyDay(movedDate), checkedAt = new Date(Date.now() + 1_000).toISOString();
  moved.checkedAt = checkedAt;
  for (const event of moved.events) {
    event.source.checkedAt = checkedAt;
    event.eventDate = newDate;
    event.externalReference = event.kind === "football_match" ? "991235" : `${event.externalReference}-moved`;
    if (event.kind === "ufc_card") { event.preliminaryDate = newDate; event.mainCardDate = newDate; }
  }
  const imported = await page.request.post(`${baseURL}/api/sports/import`, { headers: { Origin: baseURL }, data: { mode: "import", bundle: moved } });
  expect(imported.status(), await imported.text()).toBe(200);
  const riverAfter = (await pool.query("SELECT id FROM sports_events WHERE family_id=$1 AND kind='football_match' AND external_reference='991235'", [familyId])).rows[0];
  const cardAfter = (await pool.query("SELECT id,hidden FROM sports_events WHERE family_id=$1 AND kind='ufc_card' AND external_reference='ufc-test-night-moved'", [familyId])).rows[0];
  expect(riverAfter.id).toBe(river.id);
  expect(cardAfter.id).toBe(card.id);
  expect(cardAfter.hidden).toBe(true);
  expect((await pool.query("SELECT count(*)::int AS n FROM sports_formations WHERE event_id=$1", [river.id])).rows[0].n).toBe(1);
  expect((await pool.query("SELECT count(*)::int AS n FROM sports_comments WHERE context_event_id=$1", [river.id])).rows[0].n).toBe(1);
  expect(pageErrors).toEqual([]);
});
