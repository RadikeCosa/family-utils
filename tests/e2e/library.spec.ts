import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
test.skip(!connectionString, "requires isolated PostgreSQL");
const baseURL = "http://localhost:3318";
let pool: pg.Pool, familyId: string, memberId: string, userId: string, api: APIRequestContext;
test.beforeEach(async ({ page }) => {
  pool = new pg.Pool({ connectionString });
  familyId = (await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [`library-ui-${randomUUID()}`])).rows[0].id;
  api = await playwrightRequest.newContext({ baseURL });
  const response = await api.post("/api/access/prepare", { headers: { Origin: baseURL, "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}` } });
  expect(response.status(), await response.text()).toBe(200);
  userId = (await (await api.get("/api/auth/get-session")).json()).user.id;
  memberId = (await pool.query("INSERT INTO members(family_id,name) VALUES($1,'Alex') RETURNING id", [familyId])).rows[0].id;
  await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [memberId, userId]);
  await page.context().addCookies((await api.storageState()).cookies);
});
test.afterEach(async () => {
  await api?.dispose();
  if (familyId) {
    for (const table of ["library_companions", "library_contributions", "library_personal", "library_works", "audit_events"]) await pool.query(`DELETE FROM ${table} WHERE family_id=$1`, [familyId]);
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
  }
  if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await pool?.end();
});
test("mobile library: create, restore draft, find accented titles and accessible navigation", async ({ page }) => {
  await page.goto("/cinemateca");
  await expect(page.getByRole("heading", { name: "Nuestra colección empieza acá" })).toBeVisible();
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Agregar película" })).toBeVisible();
  await page.getByLabel(/^Título/).fill("Canción del verano");
  await page.reload();
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(page.getByLabel(/^Título/)).toHaveValue("Canción del verano");
  await page.getByText("Agregar más detalles", { exact: true }).click();
  await page.getByLabel("Dirección (director/a)", { exact: true }).fill("María");
  await page.getByLabel("Enlace", { exact: true }).fill("https://example.com/music");
  await page.getByRole("button", { name: "Agregar película", exact: true }).last().click();
  await expect(page).toHaveURL(/\/cinemateca\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: "Canción del verano" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Abrir enlace de referencia/ })).toHaveAttribute("rel", "noopener noreferrer");
  await page.getByRole("link", { name: "← Volver a la cinemateca" }).click();
  await page.getByLabel("Buscar en la cinemateca").fill("cancion");
  await expect(page).toHaveURL(/q=cancion/);
  await expect(page.getByRole("heading", { name: "Canción del verano" })).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("mobile shared management: duplicate confirmation, edit and archive/restore", async ({ page }) => {
  const seeded = await api.post("/api/library", { data: { title: "La obra", kind: "movie" } });
  expect(seeded.status()).toBe(201);
  await page.goto("/cinemateca");
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  await page.getByLabel(/^Título/).fill("LA OBRA");
  await page.getByRole("button", { name: "Agregar película", exact: true }).last().click();
  await expect(page.getByText("Ya hay algo parecido en la cinemateca.")).toBeVisible();
  await page.getByRole("button", { name: "Agregar de todos modos" }).click();
  await expect(page).toHaveURL(/\/cinemateca\/[a-f0-9-]+$/);
  await page.getByRole("button", { name: "Editar datos", exact: true }).click();
  await page.getByLabel(/^Título/).fill("Otra mirada");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Otra mirada" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Archivar", exact: true }).click();
  await expect(page.getByText("Este contenido está archivado. Podés restaurarlo o retirar tus aportes.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar datos", exact: true })).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restaurar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Editar datos", exact: true })).toBeVisible();
});

test("work dialog preserves drafts on close and requires an explicit discard", async ({ page }) => {
  await page.goto("/cinemateca");
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Agregar película" });
  const title = page.getByLabel(/^Título/);
  await title.fill("Un borrador que quiero conservar");
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(a11y.violations).toEqual([]);
  await title.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(page.getByLabel(/^Título/)).toHaveValue("Un borrador que quiero conservar");
  await page.getByRole("button", { name: "Descartar borrador" }).click();
  await expect(page.getByRole("group", { name: "Confirmar descarte" })).toBeVisible();
  await page.getByRole("button", { name: "Seguir editando" }).click();
  await expect(page.getByLabel(/^Título/)).toHaveValue("Un borrador que quiero conservar");
  await page.getByRole("button", { name: "Descartar borrador" }).click();
  await page.getByRole("button", { name: "Descartar y cerrar" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(page.getByLabel(/^Título/)).toHaveValue("");
});

test("work form warns when browser storage cannot keep a draft", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("family-library-draft:")) throw new DOMException("blocked", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/cinemateca");
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  await page.getByLabel(/^Título/).fill("Sigue siendo posible guardar");
  await expect(page.getByRole("status").filter({ hasText: "No podemos conservar tu borrador al cerrar o recargar." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar película", exact: true }).last()).toBeEnabled();
});

test("dialog keeps its CSS fallback and ignores invalid visual viewport dimensions", async ({ page }) => {
  await page.goto("/cinemateca");
  await page.evaluate(() => Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined }));
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.style.getPropertyValue("--dialog-available-height"))).toBe("");
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await page.evaluate(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { width: 390, height: 0, offsetTop: 0 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(window, "__testViewport", { configurable: true, value: viewport });
  });
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  expect(await dialog.evaluate((element) => element.style.getPropertyValue("--dialog-available-height"))).toBe("");
  await page.evaluate(() => {
    const viewport = (window as typeof window & { __testViewport: EventTarget & { height: number } }).__testViewport;
    viewport.height = 500;
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect.poll(() => dialog.evaluate((element) => element.style.getPropertyValue("--dialog-available-height"))).toBe("500px");
  const dialogElement = await dialog.elementHandle();
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  expect(await dialogElement!.evaluate((element) => element.style.getPropertyValue("--dialog-available-height"))).toBe("");
});

test("collection chips restore URL filters and text search avoids server navigations", async ({ page }) => {
  const created = await api.post("/api/library", { data: { title: "Lectura consultada", kind: "movie" } });
  const id = (await created.json()).id;
  await api.put(`/api/library/${id}/personal`, { data: { status: "finished", rating: null, expectedVersion: 0 } });
  await page.goto("/cinemateca?kind=book&status=finished");
  await expect(page.getByRole("combobox", { name: "Mi estado", exact: true })).toHaveValue("finished");
  await page.getByText("Más filtros", { exact: true }).click();
  const serverNavigations: string[] = [];
  page.on("request", (request) => { if (request.url().includes("_rsc")) serverNavigations.push(request.url()); });
  const search = page.getByLabel("Buscar en la cinemateca");
  await search.fill("consultada");
  await expect(page).toHaveURL(/q=consultada/);
  expect(serverNavigations).toHaveLength(0);
  await page.getByRole("button", { name: "Limpiar filtros adicionales" }).click();
  await expect(page.getByRole("combobox", { name: "Mi estado", exact: true })).toHaveValue("finished");
  await expect(page).not.toHaveURL(/kind=/);
  await expect(page).toHaveURL(/q=consultada/);
  await expect(page.getByRole("heading", { name: "Lectura consultada" })).toBeVisible();
});

test("collection cards keep fixed columns and readable content at four widths", async ({ page }, testInfo) => {
  const response = await api.post("/api/library", { data: { title: "Una película", kind: "movie", creator: "Equipo familiar", year: 2024 } });
  expect(response.status()).toBe(201);
  await page.goto("/cinemateca");
  for (const [width, columns] of [[320, 1], [390, 1], [768, 2], [1280, 3]]) {
    await page.setViewportSize({ width, height: 900 });
    const grid = page.locator("ul").filter({ has: page.getByRole("link", { name: /Una película/ }) }).first();
    await expect(grid).toBeVisible();
    expect((await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).split(" ").length).toBe(columns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (width === 390) console.info(`Biblioteca card at 390 px: ${(await grid.locator("a").first().boundingBox())?.height}px`);
    await page.screenshot({ path: testInfo.outputPath(`biblioteca-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("text input waits for IME composition to finish", async ({ page }) => {
  await page.goto("/cinemateca");
  const search = page.getByLabel("Buscar en la cinemateca");
  await search.dispatchEvent("compositionstart", { data: "" });
  await search.fill("kana");
  await expect(page).not.toHaveURL(/q=kana/);
  await search.dispatchEvent("compositionend", { data: "kana" });
  await expect(page).toHaveURL(/q=kana/);
});

test("editing compares current values before accepting a newer version", async ({ page }) => {
  const response = await api.post("/api/library", { data: { title: "Versión inicial", kind: "movie", creator: "Autora", year: 2001 } });
  const id = (await response.json()).id;
  await pool.query("UPDATE library_works SET version=3 WHERE id=$1", [id]);
  await page.goto(`/cinemateca/${id}`);
  await page.getByRole("button", { name: "Editar datos" }).click();
  await page.getByLabel(/^Título/).fill("Mi borrador nuevo");
  await pool.query("UPDATE library_works SET title='Título actualizado',titulo_normalizado='titulo actualizado',version=5,updated_at=now() WHERE id=$1", [id]);
  await pool.query("UPDATE families SET library_revision=library_revision+1 WHERE id=$1", [familyId]);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("heading", { name: "El contenido cambió mientras lo editabas" })).toBeVisible();
  await expect(page.getByText("Mi borrador nuevo", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Título actualizado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Revisé los cambios: conservar mi borrador" }).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("heading", { name: "Mi borrador nuevo" })).toBeFocused();
});

test("editing keeps its draft and blocks saving when the work disappears", async ({ page }) => {
  const response = await api.post("/api/library", { data: { title: "Contenido compartido", kind: "movie" } });
  const id = (await response.json()).id;
  await page.goto(`/cinemateca/${id}`);
  await page.getByRole("button", { name: "Editar datos" }).click();
  await page.getByLabel(/^Título/).fill("Borrador local");
  await pool.query("DELETE FROM library_works WHERE id=$1", [id]);
  await pool.query("UPDATE families SET library_revision=library_revision+1 WHERE id=$1", [familyId]);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("dialog").getByText("Este contenido ya no está disponible. Conservamos tu borrador.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  await expect(page.getByLabel(/^Título/)).toHaveValue("Borrador local");
});

test("mobile personal experience can be set and cleared", async ({ page }) => {
  const response = await api.post("/api/library", { data: { title: "Mi lectura", kind: "movie" } });
  const id = (await response.json()).id;
  await page.goto(`/cinemateca/${id}`);
  await page.getByRole("combobox", { name: "Mi estado", exact: true }).selectOption("in_progress");
  await page.getByRole("combobox", { name: "Mi valoración", exact: true }).selectOption("4");
  await page.getByRole("button", { name: "Guardar mi experiencia" }).click();
  await expect(page.getByText("Guardamos tu estado y valoración.")).toBeVisible();
  await expect(page.getByText("Viendo · 4/5 estrellas", { exact: false })).toBeVisible();
  await page.getByRole("combobox", { name: "Mi estado", exact: true }).selectOption("");
  await page.getByRole("combobox", { name: "Mi valoración", exact: true }).selectOption("");
  await page.getByRole("button", { name: "Guardar mi experiencia" }).click();
  await expect(page.getByText("Sin estado · Sin valorar", { exact: false })).toBeVisible();
});

test("mobile memories preserve partial dates, drafts, accessible spoilers and retirement", async ({ page }) => {
  const response=await api.post("/api/library",{data:{title:"Nuestro juego",kind:"movie"}});
  const id=(await response.json()).id;
  await page.goto(`/cinemateca/${id}`);
  await page.getByLabel("Tu aporte",{exact:true}).fill("Una tarde inolvidable 👨‍👩‍👧‍👦");
  await page.reload();
  await expect(page.getByLabel("Tu aporte",{exact:true})).toHaveValue("Una tarde inolvidable 👨‍👩‍👧‍👦");
  await page.getByLabel("Contiene spoilers").check();
  await page.getByLabel("Año",{exact:true}).fill("2015");
  await page.getByLabel("Alex",{exact:true}).check();
  await page.getByRole("button",{name:"Publicar aporte",exact:true}).click();
  const show=page.getByRole("button",{name:"Mostrar spoiler"});
  await expect(show).toHaveAttribute("aria-expanded","false");
  await expect(page.getByText("Una tarde inolvidable 👨‍👩‍👧‍👦",{exact:true})).toBeHidden();
  await expect(page.getByText("Experiencia: 2015",{exact:true})).toBeVisible();
  await page.setViewportSize({width:320,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const result=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();
  expect(result.violations).toEqual([]);
  await show.click();
  await expect(page.getByRole("button",{name:"Ocultar spoiler"})).toHaveAttribute("aria-expanded","true");
  await expect(page.getByText("Una tarde inolvidable 👨‍👩‍👧‍👦",{exact:true})).toBeVisible();
  page.once("dialog",(dialog)=>dialog.accept()); await page.getByRole("button",{name:"Archivar",exact:true}).click();
  await expect(page.getByRole("button",{name:"Publicar aporte",exact:true})).toHaveCount(0);
  page.once("dialog",(dialog)=>dialog.accept()); await page.getByRole("button",{name:"Retirar aporte",exact:true}).click();
  await expect(page.getByText("Todavía no hay aportes. Cada mirada tiene su lugar.")).toBeVisible();
});

test("drafts are isolated by identity and cleared on sign out", async ({page}) => {
  await page.goto("/cinemateca");
  await page.evaluate(() => sessionStorage.setItem("family-library-draft:v1:other-family:other-profile:new-work", JSON.stringify({title:"Privado"})));
  await page.reload();
  await expect(page.getByRole("heading",{name:"Nuestra colección empieza acá"})).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("family-library-draft:v1:other-family:other-profile:new-work"))).toBeNull();
  await page.getByRole("button",{name:"Agregar película",exact:true}).click();
  await page.getByLabel(/^Título/).fill("Mi borrador privado");
  expect(await page.evaluate(() => Object.keys(sessionStorage).some((key)=>key.startsWith("family-library-draft:v1:")))).toBe(true);
  await page.goto("/familia");
  await page.getByRole("button",{name:"Salir",exact:true}).click();
  await expect(page).toHaveURL(/\/acceso/);
  expect(await page.evaluate(() => Object.keys(sessionStorage).some((key)=>key.startsWith("family-library-draft:v1:")))).toBe(false);
});

test("legacy drafts become movies and unknown fields never reach writes", async ({ page }) => {
  await page.goto("/cinemateca");
  await expect(page.getByRole("heading", { name: "Cinemateca familiar", exact: true })).toBeVisible();
  await page.evaluate(({ familyId, memberId }) => sessionStorage.setItem(`family-library-draft:v1:${familyId}:${memberId}:new-work`, JSON.stringify({ title: "Old draft", kind: "book", creator: "Director", year: "2000", referenceUrl: "", expectedVersion: 0, unexpected: "discard me" })), { familyId, memberId });
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(page.getByLabel(/^Título/)).toHaveValue("Old draft");
  await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(0);
  const write = page.waitForRequest((request) => request.url().endsWith("/api/library") && request.method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "Agregar película", exact: true }).click();
  const body = (await write).postDataJSON();
  expect(body.kind).toBe("movie"); expect(body.unexpected).toBeUndefined();
  await expect(page.getByRole("heading", { name: "Old draft", exact: true })).toBeVisible();
});

test("common view explains empty results and displays family ratings", async ({ page }) => {
  const response = await api.post("/api/library", { data: { title: "Para esta noche" } });
  const id = (await response.json()).id;
  await page.goto("/cinemateca");
  await expect(page.getByRole("heading", { name: "Para esta noche" })).toBeVisible();
  await page.getByText("Pendientes en común", { exact: true }).click();
  await expect(page.getByText("Aparecen cuando todos los integrantes activos las marcan como Quiero ver")).toBeVisible();
  await api.put(`/api/library/${id}/personal`, { data: { status: "pending", rating: 4, expectedVersion: 0 } });
  await page.reload();
  const card = page.getByRole("link", { name: /Para esta noche/ });
  await expect(card).toContainText("Quiero ver");
  await expect(card).toContainText("Familia · 4,0/5 · 1 valoración");
  await expect(page).toHaveURL(/view=common_pending/);
});

test("canonical cursor normalization replaces history and handles popstate", async ({ page }) => {
  await page.goto("/cinemateca?cursor=old&kind=book&type=music&q=history");
  await expect(page).toHaveURL(/\/cinemateca\?q=history$/);
  await expect(page.getByText(/Cursor inválido/)).toHaveCount(0);
  const length = await page.evaluate(() => history.length);
  await page.evaluate(() => { history.pushState({}, "", "/cinemateca?cursor=older&q=back"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page).toHaveURL(/\/cinemateca\?q=back$/);
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
  await page.goBack();
  await expect(page).toHaveURL(/\/cinemateca\?q=history$/);
  await expect(page.getByLabel("Buscar en la cinemateca")).toHaveValue("history");
});

test("membership-only revisions show refresh notice without discarding loaded cards", async ({ page }) => {
  await api.post("/api/library", { data: { title: "Loaded card" } });
  await page.goto("/cinemateca");
  await expect(page.getByRole("heading", { name: "Loaded card" })).toBeVisible();
  await pool.query("UPDATE families SET revision=revision+1 WHERE id=$1", [familyId]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Hay cambios. Actualizá para ver la colección al día.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Loaded card" })).toBeVisible();
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(page.getByText("Hay cambios. Actualizá para ver la colección al día.", { exact: false })).toHaveCount(0);
});

test("loading another page notices membership changes and retains both pages", async ({ page }) => {
  await pool.query("INSERT INTO library_works(family_id,title,titulo_normalizado,kind,created_by_member_id,updated_by_member_id) SELECT $1,'Paginated '||n,'paginated '||n,'movie',$2,$2 FROM generate_series(1,55) n", [familyId, memberId]);
  await page.goto("/cinemateca");
  const cards = page.getByRole("link", { name: /Paginated/ });
  await expect(cards).toHaveCount(50);
  await pool.query("UPDATE families SET revision=revision+1 WHERE id=$1", [familyId]);
  await page.getByRole("button", { name: "Cargar más películas", exact: true }).click();
  await expect(cards).toHaveCount(55);
  await expect(page.getByText("Hay cambios. Actualizá para ver la colección al día.", { exact: false })).toBeVisible();
});

test("compact collection and canonical filters retain archive and common semantics", async ({ page }) => {
  const response = await api.post("/api/library", { data: { title: "Una película", creator: "Dirección familiar", year: 2024 } });
  const id = (await response.json()).id;
  await api.put(`/api/library/${id}/personal`, { data: { status: "pending", rating: 4, expectedVersion: 0 } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/cinemateca?status=invalid&archived=false&view=wrong&extra=keep");
  await page.evaluate(() => document.fonts.ready);
  const card = page.getByRole("link", { name: /Una película/ });
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!;
  expect(box.y).toBeLessThan(560); expect(box.y + box.height).toBeLessThanOrEqual(844);
  await expect(page).toHaveURL(/\/cinemateca\?extra=keep$/);
  await expect(page.getByRole("combobox", { name: "Mi estado", exact: true })).toHaveValue("");
  for (const status of ["pending", "in_progress", "finished", "none", ""]) {
    await page.getByRole("combobox", { name: "Mi estado", exact: true }).selectOption(status);
    if (status) await expect(page).toHaveURL(new RegExp(`status=${status}`));
    else await expect(page).not.toHaveURL(/status=/);
  }
  await page.getByRole("button", { name: "Pendientes en común", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pendientes en común" })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Más filtros", { exact: true }).click();
  await page.getByText("Archivadas", { exact: true }).click();
  await expect(page).toHaveURL(/archived=true/); await expect(page).toHaveURL(/view=common_pending/);
  await page.getByRole("button", { name: "Limpiar filtros adicionales" }).click();
  await expect(page).not.toHaveURL(/archived=/); await expect(page).toHaveURL(/view=common_pending/);
  await page.getByRole("combobox", { name: "Mi estado", exact: true }).selectOption("none");
  await expect(page).not.toHaveURL(/view=/); await expect(page).toHaveURL(/status=none/);
  await page.goto("/cinemateca?view=common_pending&status=finished&extra=keep");
  await expect(page).not.toHaveURL(/status=/); await expect(page).toHaveURL(/extra=keep/);
});
