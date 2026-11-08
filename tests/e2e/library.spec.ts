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
  await page.getByLabel("Director/a", { exact: true }).fill("María");
  await page.getByRole("button", { name: "Agregar película", exact: true }).last().click();
  await expect(page).toHaveURL(/\/cinemateca\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: "Canción del verano" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Abrir enlace de referencia/ })).toHaveCount(0);
  await page.getByRole("link", { name: "← Volver a la cinemateca" }).click();
  await page.getByLabel("Buscar películas").fill("cancion");
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

test("collection filters restore URLs and text search avoids server navigations", async ({ page }) => {
  const created = await api.post("/api/library", { data: { title: "Lectura consultada" } });
  const id = (await created.json()).id;
  await api.put(`/api/library/${id}/personal`, { data: { status: "finished", rating: null, expectedVersion: 0 } });
  await page.goto("/cinemateca?kind=book&status=finished&extra=keep");
  await expect(page.getByRole("button", { name: "Vistas", exact: true })).toHaveAttribute("aria-pressed", "true");
  const serverNavigations: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    // Navigation-link prefetches are independent of typing in the search field.
    if (request.isNavigationRequest() || (url.pathname === "/cinemateca" && url.searchParams.get("q") === "consultada" && url.searchParams.has("_rsc") && request.headers()["next-router-prefetch"] !== "1")) serverNavigations.push(request.url());
  });
  await page.getByLabel("Buscar películas").fill("consultada");
  await expect(page).toHaveURL(/q=consultada/); expect(serverNavigations).toHaveLength(0);
  await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
  await expect(page).toHaveURL(/cinemateca\?extra=keep$/);
  await expect(page.getByRole("button", { name: "Todas", exact: true })).toHaveAttribute("aria-pressed", "true");
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
  const search = page.getByLabel("Buscar películas");
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
  await page.getByRole("button", { name: "Conservar mi borrador" }).click();
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
  await page.getByRole("radio", { name: "Viendo", exact: true }).check();
  await page.getByRole("radio", { name: "4 de 5 estrellas", exact: true }).press("Space");
  await page.getByRole("button", { name: "Guardar estado y valoración" }).click();
  await expect(page.getByText("Guardamos tu estado y valoración.")).toBeVisible();
  await expect(page.getByText("Viendo · 4/5 estrellas", { exact: false })).toBeVisible();
  await page.getByRole("radio", { name: "Sin estado", exact: true }).check();
  await page.getByRole("button", { name: "Quitar valoración", exact: true }).click();
  await page.getByRole("button", { name: "Guardar estado y valoración" }).click();
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
  await page.getByText("¿Con quién la viste?", { exact: false }).click();
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
  await page.evaluate(({ familyId, memberId }) => sessionStorage.setItem(`family-library-draft:v1:${familyId}:${memberId}:new-work`, JSON.stringify({ title: "Old draft", kind: "book", creator: "Director", year: "2000", referenceUrl: "javascript:old-draft", expectedVersion: 0, unexpected: "discard me" })), { familyId, memberId });
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(page.getByLabel(/^Título/)).toHaveValue("Old draft");
  await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(0);
  const write = page.waitForRequest((request) => request.url().endsWith("/api/library") && request.method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "Agregar película", exact: true }).click();
  const body = (await write).postDataJSON();
  expect(body.kind).toBe("movie"); expect(body.unexpected).toBeUndefined(); expect(body.referenceUrl).toBeNull(); expect(body.genres).toEqual([]);
  await expect(page.getByRole("heading", { name: "Old draft", exact: true })).toBeVisible();
});

test("common view explains empty results and displays family ratings", async ({ page }) => {
  const response = await api.post("/api/library", { data: { title: "Para esta noche" } });
  const id = (await response.json()).id;
  await page.goto("/cinemateca");
  await expect(page.getByRole("heading", { name: "Para esta noche" })).toBeVisible();
  await page.getByRole("button", { name: "Todos queremos ver", exact: true }).click();
  await expect(page.getByText("Aparecen cuando todos los integrantes activos las marcan como Quiero ver")).toBeVisible();
  await api.put(`/api/library/${id}/personal`, { data: { status: "pending", rating: 4, expectedVersion: 0 } });
  await page.reload();
  const card = page.getByRole("link", { name: /Para esta noche/ });
  await expect(card).toContainText("Quiero ver");
  await expect(card.getByRole("img", { name: "Familia · 4,0/5 · 1 valoración", exact: true })).toBeVisible();
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
  await expect(page.getByLabel("Buscar películas")).toHaveValue("history");
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

test("compact collection and canonical filters retain archive and common semantics", async ({ page }, testInfo) => {
  const title = "Una película para compartir en familia";
  const response = await api.post("/api/library", { data: { title, creator: "Una dirección familiar de prueba completa", year: 2024, genres: ["ciencia_ficcion", "documental"] } });
  const id = (await response.json()).id;
  await api.put(`/api/library/${id}/personal`, { data: { status: "pending", rating: 4, expectedVersion: 0 } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/cinemateca?status=invalid&archived=false&view=wrong&extra=keep");
  await page.evaluate(() => document.fonts.ready);
  const card = page.getByRole("link", { name: new RegExp(title) });
  await expect(card).toBeVisible(); const box = (await card.boundingBox())!;
  console.info(JSON.stringify({ firstCardTop: box.y, firstCardBottom: box.y + box.height }));
  await page.screenshot({ path: testInfo.outputPath("coleccion-generos-390.png"), fullPage: false });
  expect(box.y).toBeLessThan(560); expect(box.y + box.height).toBeLessThanOrEqual(844);
  await expect(page).toHaveURL(/cinemateca\?extra=keep$/);
  const show = page.getByRole("button", { name: "Todos queremos ver", exact: true });
  for (const [status, label] of [["pending", "Quiero ver"], ["in_progress", "Viendo"], ["finished", "Vistas"], ["none", "Sin estado"], ["", "Todas"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("group", { name: "Mostrar películas" }).getByRole("button", { pressed: true })).toHaveCount(1);
    if (status) await expect(page).toHaveURL(new RegExp(`status=${status}`)); else await expect(page).not.toHaveURL(/status=/);
  }
  await show.click(); await expect(page).toHaveURL(/view=common_pending/);
  await page.getByRole("button", { name: "Género: Todos los géneros", exact: true }).click();
  const genres = page.getByRole("dialog", { name: "Elegí un género" });
  await expect(genres).toBeVisible();
  await genres.getByRole("button", { name: "Documental", exact: true }).click();
  await expect(genres).toBeHidden();
  await expect(page.getByRole("button", { name: "Género: Documental", exact: true })).toBeFocused();
  await expect(card).toBeVisible();
  await api.patch(`/api/library/${id}`, { data: { action: "archive", expectedVersion: 1 } });
  await page.getByRole("button", { name: "Archivadas", exact: true }).click();
  await expect(page).toHaveURL(/archived=true/); await expect(card).toBeVisible();
  await expect(show).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
  await expect(page).toHaveURL(/cinemateca\?extra=keep$/); await expect(card).toHaveCount(0);
  await page.goto("/cinemateca?view=common_pending&status=finished&extra=keep");
  await expect(show).toHaveAttribute("aria-pressed", "true"); await expect(page).not.toHaveURL(/status=/);
  for (const genre of ["", "wrong", "drama&genre=terror", "drama&genre=drama"]) {
    await page.goto(`/biblioteca?kind=book&type=music&cursor=old&genre=${genre}&extra=keep`);
    await expect(page).toHaveURL(/cinemateca\?extra=keep$/);
    await expect(page.getByRole("button", { name: "Género: Todos los géneros", exact: true })).toBeVisible();
  }
});

test("rating uses native keyboard radios, explicit clearing and manual save", async ({ page }) => {
  const response = await api.post("/api/library", { data: { title: "Mi experiencia primero" } });
  const id = (await response.json()).id;
  await page.goto(`/cinemateca/${id}`);
  const experience = page.getByRole("heading", { name: "Mi estado y valoración", exact: true });
  const family = page.getByRole("heading", { name: "Las miradas de la familia", exact: true });
  await expect(experience).toBeVisible();
  expect((await experience.boundingBox())!.y).toBeLessThan((await family.boundingBox())!.y);
  const first = page.getByRole("radio", { name: "1 de 5 estrellas", exact: true });
  await first.focus(); await first.press("Space"); await first.press("ArrowRight");
  const second = page.getByRole("radio", { name: "2 de 5 estrellas", exact: true });
  await expect(second).toBeChecked(); await expect(second).toBeFocused();
  await second.press("ArrowDown");
  const third = page.getByRole("radio", { name: "3 de 5 estrellas", exact: true });
  await expect(third).toBeChecked();
  await third.press("Space"); await expect(third).toBeChecked();
  await third.locator("..").click(); await expect(third).toBeChecked();
  expect((await (await api.get(`/api/library/${id}`)).json()).work.personal).toHaveLength(0);
  await page.getByRole("button", { name: "Guardar estado y valoración", exact: true }).click();
  await expect(page.getByText("Guardamos tu estado y valoración.")).toBeVisible();
  expect((await (await api.get(`/api/library/${id}`)).json()).work.personal[0].rating).toBe(3);
  await page.getByRole("button", { name: "Quitar valoración", exact: true }).click();
  await expect(first).toBeFocused();
  await expect(page.getByRole("button", { name: "Quitar valoración", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: /^Sin valorar$/ })).toBeVisible();
  await page.getByRole("button", { name: "Guardar estado y valoración", exact: true }).click();
  await expect(page.getByText("Guardamos tu estado y valoración.")).toBeVisible();
  expect((await (await api.get(`/api/library/${id}`)).json()).work.personal[0].rating).toBeNull();
});

test("companions fold compactly, preserve drafts, sort names and include archived profiles", async ({ page }, testInfo) => {
  await pool.query("INSERT INTO members(family_id,name,archived_at) VALUES($1,'Vicky',NULL),($1,'Bea',NULL),($1,'Carla',NULL),($1,'Diego',NULL),($1,'Eva',now())", [familyId]);
  const response = await api.post("/api/library", { data: { title: "Acompañantes" } }); const id = (await response.json()).id;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/cinemateca/${id}`);
  const details = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "¿Con quién la viste?" }) });
  const summary = details.locator("summary");
  await expect(details).not.toHaveAttribute("open", "");
  expect((await details.boundingBox())!.height).toBeLessThanOrEqual(80);
  await summary.focus(); await summary.press("Enter");
  const checks = details.getByRole("checkbox"); await expect(checks).toHaveCount(6);
  const labels = await details.locator("label").allTextContents();
  expect(labels).toEqual(["Alex", "Bea", "Carla", "Diego", "Eva (perfil archivado)", "Vicky"]);
  for (const checkbox of await checks.all()) await checkbox.check();
  await summary.click(); await expect(summary).toContainText("Alex, Bea +4");
  console.info(JSON.stringify({ companionsClosedHeight: (await details.boundingBox())!.height }));
  await page.screenshot({ path: testInfo.outputPath("acompanantes-plegados.png"), fullPage: true });
  expect((await details.boundingBox())!.height).toBeLessThanOrEqual(80);
  await page.reload(); await expect(summary).toContainText("Alex, Bea +4");
  await expect(details).not.toHaveAttribute("open", "");
  await summary.click(); for (const checkbox of await checks.all()) await expect(checkbox).toBeChecked();
  await summary.click();
  await page.getByLabel("Tu aporte", { exact: true }).fill("Una noche juntos");
  let finishSave!: () => void;
  const saveGate = new Promise<void>(resolve => { finishSave = resolve; });
  await page.route(`**/api/library/${id}/contributions`, async route => { await saveGate; await route.continue(); });
  await page.getByRole("button", { name: "Publicar aporte", exact: true }).click();
  try {
    await expect(page.getByRole("button", { name: "Publicar aporte", exact: true })).toBeDisabled();
    await expect(summary).toContainText("Alex, Bea +4");
  } finally { finishSave(); }
  await expect(page.getByText("Una noche juntos", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Editar mi aporte", exact: true }).click();
  const editing = page.getByRole("listitem").filter({ hasText: "Una noche juntos" }).locator("details");
  await expect(editing.locator("summary")).toContainText("Alex, Bea +4");
  await expect(editing).not.toHaveAttribute("open", "");
});

test("work validation revalidates reported fields without exposing the removed link", async ({ page }) => {
  await page.goto("/cinemateca"); await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  const dialog = page.getByRole("dialog"), title = dialog.getByLabel(/^Título/);
  await expect(title).toHaveAttribute("aria-invalid", "false");
  await dialog.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(title).toBeFocused(); await expect(title).toHaveAttribute("aria-describedby", /work-error-title/);
  await title.fill("Una película"); await expect(title).toHaveAttribute("aria-invalid", "false");
  const year = dialog.getByLabel("Año de estreno", { exact: true });
  await year.fill("10000"); await expect(year).toHaveAttribute("aria-invalid", "false");
  await dialog.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(year).toBeFocused(); await expect(year).toHaveAttribute("aria-invalid", "true");
  await year.fill("2000"); await expect(year).toHaveAttribute("aria-invalid", "false");
  await expect(dialog.getByLabel("Enlace", { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Una película", exact: true })).toBeVisible();
});

test("form errors stay local and never reveal server messages; retry preserves the draft", async ({ page }) => {
  await page.goto("/cinemateca");
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Título/).fill("Borrador protegido");
  await page.route("**/api/library", async route => {
    if (route.request().method() === "POST") await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "UNEXPECTED_SQL_FAILURE", error: "private PostgreSQL connection token=secret" }) });
    else await route.continue();
  });
  await dialog.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("No pudimos completar la operación");
  await expect(page.getByText(/private PostgreSQL|token=secret/)).toHaveCount(0);
  await expect(dialog.getByLabel(/^Título/)).toHaveValue("Borrador protegido");
  await page.unroute("**/api/library");
  await dialog.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Borrador protegido", exact: true })).toBeVisible();
});

test("contribution dates focus and describe the invalid field before publishing", async ({ page }) => {
  const response = await api.post("/api/library", { data: { title: "Fecha válida" } }); const id = (await response.json()).id;
  await page.goto(`/cinemateca/${id}`);
  await page.getByLabel("Tu aporte", { exact: true }).fill("Un recuerdo");
  const year = page.getByLabel("Año", { exact: true });
  await year.fill("9999");
  await expect(year).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: "Publicar aporte", exact: true }).click();
  await expect(year).toBeFocused(); await expect(year).toHaveAttribute("aria-invalid", "true");
  await expect(year).toHaveAttribute("aria-describedby", /error-year/);
  await year.fill("2024"); await expect(year).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("combobox", { name: "Mes", exact: true }).selectOption("2");
  const day = page.getByLabel("Día", { exact: true }); await day.fill("30");
  await page.getByRole("button", { name: "Publicar aporte", exact: true }).click();
  await expect(day).toBeFocused(); await expect(day).toHaveAttribute("aria-invalid", "true");
  await day.fill("29"); await expect(day).toHaveAttribute("aria-invalid", "false");
  const published = page.waitForResponse(response => new URL(response.url()).pathname === `/api/library/${id}/contributions` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Publicar aporte", exact: true }).click();
  expect((await published).status()).toBe(201);
  await expect(page.getByRole("listitem").getByText("Un recuerdo", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Tu aporte", { exact: true })).toHaveValue("");
});

test("text enlargement, forced colors, long names and touch targets remain usable", async ({ page, browserName }, testInfo) => {
  const name = "Un nombre familiar muy largo ".repeat(3);
  await pool.query("INSERT INTO members(family_id,name) VALUES($1,$2)", [familyId, name]);
  const response = await api.post("/api/library", { data: { title: "Lectura accesible" } }); const id = (await response.json()).id;
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/cinemateca/${id}`);
  const toggle = page.locator("summary").filter({ hasText: "¿Con quién la viste?" });
  await toggle.click();
  const longLabel = page.getByLabel(name, { exact: true }); await longLabel.check();
  for (const target of [page.getByRole("radio", { name: "Quiero ver", exact: true }).locator(".."), toggle]) {
    const box = (await target.boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(44); expect(box.width).toBeGreaterThanOrEqual(44);
  }
  for (const radio of await page.getByRole("radio").all()) {
    const box = await radio.evaluate(element => { const r = element.closest("label")!.getBoundingClientRect(); return { width: r.width, height: r.height }; });
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("radio", { name: "3 de 5 estrellas", exact: true }).press("Space");
  if (browserName === "chromium") {
    await page.emulateMedia({ forcedColors: "active" });
    await expect(page.getByRole("radio", { name: "3 de 5 estrellas", exact: true })).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath("contraste-forzado.png"), fullPage: true });
    await page.emulateMedia({ forcedColors: "none" });
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.getByRole("radio", { name: "Quiero ver", exact: true }).locator("..").locator("span").evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(28);
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) console.info(await page.locator("*").evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(element => ({ tag: element.tagName, className: element.className, width: element.getBoundingClientRect().width }))));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("texto-200.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; document.documentElement.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("known personal errors use safe copy inside the affected form and preserve the rating", async ({ page }) => {
  const response = await api.post("/api/library", { data: { title: "Errores propios" } }); const id = (await response.json()).id;
  await page.goto(`/cinemateca/${id}`);
  await page.getByRole("radio", { name: "4 de 5 estrellas", exact: true }).press("Space");
  await page.route(`**/api/library/${id}/personal`, route => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "INVALID", error: "private database detail" }) }));
  await page.getByRole("button", { name: "Guardar estado y valoración", exact: true }).click();
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Mi estado y valoración", exact: true }) });
  await expect(section.getByRole("alert")).toContainText("Revisá los datos del formulario");
  await expect(page.getByText(/private database/)).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "4 de 5 estrellas", exact: true })).toBeChecked();
  await page.unroute(`**/api/library/${id}/personal`);
  await section.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByText("Guardamos tu estado y valoración.")).toBeVisible();
});

test("enlarged dialog keeps invalid-field focus clear of its sticky header and footer", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/cinemateca");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Título/).fill("Texto ampliado");
  const year = dialog.getByLabel("Año de estreno", { exact: true });
  await year.fill("0");
  await dialog.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(year).toBeFocused();
  const bounds = await year.evaluate(element => {
    const form = element.closest("form")!;
    return { top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, header: form.querySelector("header")!.getBoundingClientRect().bottom, footer: form.querySelector("footer")!.getBoundingClientRect().top };
  });
  await page.screenshot({ path: testInfo.outputPath("dialogo-texto-200.png"), fullPage: false });
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.header - 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.footer + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("genre form preserves selections through drafts and edits, wraps labels and uses large targets", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/cinemateca"); await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel(/^Título/).fill("Géneros compartidos");
  const genres = dialog.locator("details").filter({ hasText: "Elegir géneros" }); await expect(genres).not.toHaveAttribute("open", "");
  await genres.locator("summary").click();
  for (const label of ["Terror", "Drama", "Ciencia ficción"]) await genres.getByLabel(label, { exact: true }).check();
  await expect(dialog.getByRole("region", { name: "Géneros", exact: true })).toContainText("Ciencia ficciónDramaTerror");
  const labels = genres.locator("label");
  const columns = await labels.evaluateAll(elements => new Set(elements.map(e => Math.round(e.getBoundingClientRect().x))).size);
  expect(columns).toBe(2);
  for (const label of await labels.all()) expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await labels.evaluateAll(elements => new Set(elements.map(e => Math.round(e.getBoundingClientRect().x))).size)).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("generos-texto-200.png"), fullPage: false });
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.reload(); await page.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Géneros", exact: true })).toContainText("Ciencia ficciónDramaTerror");
  await expect(genres).not.toHaveAttribute("open", "");
  await dialog.getByRole("button", { name: "Agregar película", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Géneros compartidos", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Editar datos", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Géneros", exact: true })).toContainText("Ciencia ficciónDramaTerror");
  await genres.locator("summary").click(); await expect(genres.getByLabel("Drama", { exact: true })).toBeChecked();
  await genres.getByLabel("Drama", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const id = page.url().split("/").at(-1);
  expect((await (await api.get(`/api/library/${id}`)).json()).work.genres).toEqual(["ciencia_ficcion", "terror"]);
});

test("genre filter resets loaded pages and survives back and forward navigation", async ({ page }) => {
  await pool.query("INSERT INTO library_works(family_id,title,titulo_normalizado,kind,genres,created_by_member_id,updated_by_member_id) SELECT $1,'Género '||n,'genero '||n,'movie',CASE WHEN n<=55 THEN ARRAY['drama'] ELSE ARRAY['terror'] END,$2,$2 FROM generate_series(1,110) n", [familyId, memberId]);
  await page.goto("/cinemateca?genre=drama&extra=keep");
  const cards = page.locator("ul").filter({ has: page.getByRole("heading", { level: 2 }).filter({ hasText: "Género " }) }).getByRole("link");
  await expect(cards).toHaveCount(50);
  await page.getByRole("button", { name: "Cargar más películas", exact: true }).click(); await expect(cards).toHaveCount(55);
  await page.getByRole("button", { name: "Género: Drama", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Terror", exact: true }).click(); await expect(cards).toHaveCount(50);
  await expect(page).toHaveURL(/genre=terror/);
  const selectedTitle = await cards.first().getByRole("heading").innerText();
  await cards.first().click();
  await expect(page.getByRole("heading", { name: selectedTitle, level: 1, exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: "Género: Terror", exact: true })).toBeVisible();
  await page.goForward(); await expect(page.getByRole("heading", { name: selectedTitle, level: 1, exact: true })).toBeVisible();
});

test("personal status has compact native choices, explicit unsaved feedback and Vista creates no memory", async ({ page }, testInfo) => {
  const response = await api.post("/api/library", { data: { title: "Estado sin diario" } }); const id = (await response.json()).id;
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto(`/cinemateca/${id}`);
  const state = page.getByRole("group", { name: "Mi estado", exact: true });
  const choices = state.getByRole("radio"); await expect(choices).toHaveCount(4);
  expect(await choices.evaluateAll(elements => new Set(elements.map(e => Math.round(e.closest("label")!.getBoundingClientRect().x))).size)).toBe(2);
  await expect(page.getByText("Cambios sin guardar", { exact: true })).toHaveCount(0);
  await state.getByRole("radio", { name: "Quiero ver", exact: true }).focus();
  await state.getByRole("radio", { name: "Quiero ver", exact: true }).press("Space");
  await state.getByRole("radio", { name: "Quiero ver", exact: true }).press("ArrowRight");
  await expect(state.getByRole("radio", { name: "Viendo", exact: true })).toBeChecked();
  await state.getByRole("radio", { name: "Vista", exact: true }).check();
  await expect(page.getByText("Cambios sin guardar", { exact: true })).toBeVisible();
  expect((await (await api.get(`/api/library/${id}`)).json()).work.personal).toHaveLength(0);
  await page.reload(); await expect(state.getByRole("radio", { name: "Vista", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Guardar estado y valoración", exact: true }).click();
  await expect(page.getByText("Guardamos tu estado y valoración.")).toBeVisible();
  await expect(page.getByText("Cambios sin guardar", { exact: true })).toHaveCount(0);
  const detail = await (await api.get(`/api/library/${id}`)).json();
  expect(detail.work.personal[0].status).toBe("finished"); expect(detail.contributions).toEqual([]);
  expect((await pool.query("SELECT COUNT(*)::int AS count FROM library_contributions WHERE work_id=$1", [id])).rows[0].count).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: testInfo.outputPath("estado-y-valoracion.png"), fullPage: true });
});

test("two clients preserve an updated hidden link through conflict review and retry", async ({ page }) => {
  const response = await api.post("/api/library", { data: { title: "Enlace conservado", genres: ["drama"], referenceUrl: "https://example.com/original" } }); const id = (await response.json()).id;
  await page.goto(`/cinemateca/${id}`);
  await expect(page.getByRole("link", { name: /Abrir enlace de referencia/ })).toHaveCount(0);
  await page.evaluate(({ familyId, memberId, id }) => sessionStorage.setItem(`family-library-draft:v1:${familyId}:${memberId}:${id}:edit-work`, JSON.stringify({ title: "Mi título local", kind: "book", creator: "", year: "", referenceUrl: "javascript:stale-draft", expectedVersion: 1 })), { familyId, memberId, id });
  await page.getByRole("button", { name: "Editar datos", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/^Título/)).toHaveValue("Mi título local");
  await expect(dialog.getByRole("region", { name: "Géneros", exact: true })).toContainText("Drama");
  await expect(dialog.getByLabel("Enlace", { exact: true })).toHaveCount(0);
  const changed = await api.patch(`/api/library/${id}`, { data: { action: "edit", title: "Enlace conservado", referenceUrl: "https://example.com/new", expectedVersion: 1 } }); expect(changed.status()).toBe(200);
  await dialog.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "El contenido cambió mientras lo editabas" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Guardar cambios", exact: true })).toBeDisabled();
  let saved = (await (await api.get(`/api/library/${id}`)).json()).work;
  expect(saved.title).toBe("Enlace conservado"); expect(saved.referenceUrl).toBe("https://example.com/new"); expect(saved.genres).toEqual(["drama"]);
  await dialog.getByRole("button", { name: "Conservar mi borrador", exact: true }).click();
  await dialog.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mi título local", exact: true })).toBeVisible();
  saved = (await (await api.get(`/api/library/${id}`)).json()).work;
  expect(saved.referenceUrl).toBe("https://example.com/new"); expect(saved.genres).toEqual(["drama"]);
});

test("genre dialog and archive switch preserve independent filters and keyboard focus", async ({ page }, testInfo) => {
  await page.goto("/cinemateca?q=noche&status=pending&genre=drama&archived=true&extra=keep");
  const trigger = page.getByRole("button", { name: "Género: Drama", exact: true });
  const genres = page.getByRole("dialog", { name: "Elegí un género" });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole("button", { name: "Archivadas", exact: true })).toHaveAttribute("aria-pressed", "true");
  await trigger.focus(); await trigger.press("Enter");
  await expect(genres.getByRole("heading")).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("selector-generos.png") });
  await expect(genres.getByRole("button", { name: "Drama", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(genres).toBeHidden(); await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/genre=drama/);
  await trigger.press("Space");
  await genres.getByRole("button", { name: "Todos los géneros", exact: true }).click();
  await expect(page.getByRole("button", { name: "Género: Todos los géneros", exact: true })).toBeFocused();
  await expect(page).toHaveURL(/q=noche&status=pending&archived=true$/);
  await page.getByRole("button", { name: "Colección", exact: true }).click();
  await expect(page).toHaveURL(/extra=keep&q=noche&status=pending$/);
  await page.getByRole("button", { name: "Género: Todos los géneros", exact: true }).click();
  await genres.getByRole("button", { name: "Sin género", exact: true }).click();
  await expect(page).toHaveURL(/genre=none/);
  await page.getByRole("button", { name: "Archivadas", exact: true }).click();
  await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
  await expect(page).toHaveURL(/cinemateca\?extra=keep$/);
  await expect(page.getByLabel("Buscar películas")).toBeFocused();
  await expect(page.getByRole("button", { name: "Género: Todos los géneros", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Colección", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Todas", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("movie cards show personal badges and accessible proportional family stars", async ({ page }, testInfo) => {
  const titles = ["Sin aportes todavía", "Una estrella", "Cinco estrellas", "Promedio familiar con perfil archivado"];
  const ids: string[] = [];
  for (const title of titles) {
    const response = await api.post("/api/library", { data: { title } });
    ids.push((await response.json()).id);
  }
  await api.put(`/api/library/${ids[1]}/personal`, { data: { status: "pending", rating: 1, expectedVersion: 0 } });
  await api.put(`/api/library/${ids[2]}/personal`, { data: { status: "finished", rating: 5, expectedVersion: 0 } });
  await api.put(`/api/library/${ids[3]}/personal`, { data: { status: "in_progress", rating: 4, expectedVersion: 0 } });
  const other = (await pool.query("INSERT INTO members(family_id,name,archived_at) VALUES($1,'Perfil anterior',now()) RETURNING id", [familyId])).rows[0].id;
  await pool.query("INSERT INTO library_personal(family_id,work_id,member_id,rating) VALUES($1,$2,$3,3)", [familyId, ids[3], other]);
  await page.goto("/cinemateca");
  const empty = page.getByRole("link", { name: /Sin aportes todavía/ });
  await expect(empty).toContainText("Sin estado"); await expect(empty).toContainText("Sin valorar"); await expect(empty).toContainText("Sin valoraciones");
  await expect(empty.getByRole("img")).toHaveCount(0);
  const low = page.getByRole("link", { name: /Una estrella/ });
  await expect(low).toContainText("Quiero ver");
  await expect(low.getByRole("img", { name: "Mi valoración: 1 de 5 estrellas", exact: true })).toBeVisible();
  const high = page.getByRole("link", { name: /Cinco estrellas/ });
  await expect(high).toContainText("Vista");
  await expect(high.getByRole("img", { name: "Mi valoración: 5 de 5 estrellas", exact: true })).toBeVisible();
  const mixed = page.getByRole("link", { name: /Promedio familiar con perfil archivado/ });
  await expect(mixed).toContainText("Viendo");
  const family = mixed.getByRole("img", { name: "Familia · 3,5/5 · 2 valoraciones", exact: true });
  await expect(family).toBeVisible();
  const fills = await family.locator('[style]').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.width));
  expect(fills).toEqual(["100%", "100%", "100%", "50%", "0%"]);
  await expect(high.getByRole("img", { name: "Familia · 5,0/5 · 1 valoración", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("tarjetas-estrellas.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("tarjetas-escritorio.png"), fullPage: true });
  await api.patch(`/api/library/${ids[2]}`, { data: { action: "archive", expectedVersion: 1 } });
  await page.goto("/cinemateca?archived=true");
  await expect(high).toContainText("Archivada"); await expect(high).toContainText("Vista");
  await high.click(); await expect(page).toHaveURL(new RegExp(`/cinemateca/${ids[2]}$`));
});

test("quick filters and movie cards reflow with enlarged text and keyboard focus", async ({ page, browserName }, testInfo) => {
  await api.post("/api/library", { data: { title: "Un título muy largo para compartir una noche de películas con toda nuestra familia", creator: "Una directora con un nombre extenso", genres: ["ciencia_ficcion", "documental"] } });
  await page.goto("/cinemateca?genre=ciencia_ficcion");
  const trigger = page.getByRole("button", { name: "Género: Ciencia ficción", exact: true });
  await trigger.focus(); await trigger.press("Enter");
  const genres = page.getByRole("dialog", { name: "Elegí un género" });
  await expect(genres).toBeVisible();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.setViewportSize({ width: 390, height: 844 });
  const pending = page.getByRole("button", { name: "Quiero ver", exact: true });
  await pending.focus(); await pending.press("Space");
  await expect(pending).toBeFocused(); await expect(pending).toHaveAttribute("aria-pressed", "true");
  for (const button of await page.getByRole("group", { name: "Mostrar películas", exact: true }).getByRole("button").all()) {
    const box = (await button.boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(44); expect(box.width).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: "Todas", exact: true }).click();
  if (browserName === "chromium") {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.screenshot({ path: testInfo.outputPath("coleccion-contraste-forzado.png"), fullPage: true });
    await page.emulateMedia({ forcedColors: "none" });
  }
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
});

test("manual movie form restores partial metadata, commits pending cast and shows genre badges", async ({ page }, testInfo) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto("/cinemateca");
  await page.getByRole("button",{name:"Agregar película",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await expect(dialog.getByRole("heading",{name:"Agregar película",exact:true})).toBeFocused();
  await expect(dialog.getByRole("button",{name:"Descartar borrador",exact:true})).toHaveCount(0);
  await dialog.getByLabel(/^Título/).fill("Una historia completa");
  await dialog.getByLabel("Director/a",{exact:true}).fill("Una directora");
  await dialog.getByLabel("Año de estreno",{exact:true}).fill("2020");
  await dialog.getByLabel("Duración (minutos)",{exact:true}).fill("148");
  await page.screenshot({path:testInfo.outputPath("formulario-manual-390.png"),fullPage:false});
  const more=dialog.locator("details").filter({hasText:"Sinopsis y reparto"});
  await expect(more).not.toHaveAttribute("open","");
  await more.locator("summary").click();
  await dialog.getByRole("textbox",{name:"Sinopsis",exact:true}).fill("Una historia\ncon sorpresas.");
  const cast=dialog.getByRole("textbox",{name:"Nombres del reparto",exact:true});
  await cast.fill("  Jose\u0301   Pérez\nJOSÉ PÉREZ\nAna");
  await dialog.getByRole("button",{name:"Agregar nombres",exact:true}).click();
  await expect(dialog.getByText("Se omitió 1 nombre duplicado.",{exact:true})).toBeVisible();
  await expect(dialog.getByRole("button",{name:"Quitar del reparto: José Pérez",exact:true})).toBeVisible();
  await cast.fill("Un nombre pendiente");
  await dialog.getByRole("button",{name:"Cerrar",exact:true}).click();
  await page.reload(); await page.getByRole("button",{name:"Agregar película",exact:true}).click();
  await expect(dialog.getByLabel("Duración (minutos)",{exact:true})).toHaveValue("148");
  await more.locator("summary").click();
  await expect(cast).toHaveValue("Un nombre pendiente");
  await expect(dialog.getByRole("textbox",{name:"Sinopsis",exact:true})).toHaveValue("Una historia\ncon sorpresas.");
  await dialog.locator("summary").filter({hasText:"Elegir géneros"}).click();
  for(const label of ["Ciencia ficción","Drama"]) await dialog.getByLabel(label,{exact:true}).check();
  await dialog.locator("summary").filter({hasText:"Elegir géneros"}).click();
  await dialog.locator("form").evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({path:testInfo.outputPath("formulario-datos-completos.png"),fullPage:false});
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
  await dialog.getByRole("button",{name:"Agregar película",exact:true}).click();
  await expect(page).toHaveURL(/\/cinemateca\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading",{name:"Una historia completa",level:1,exact:true})).toBeVisible();
  const id=page.url().split("/").at(-1);
  const saved=(await(await api.get(`/api/library/${id}`)).json()).work;
  expect(saved.runtimeMinutes).toBe(148); expect(saved.cast).toEqual(["José Pérez","Ana","Un nombre pendiente"]); expect(saved.synopsis).toBe("Una historia\ncon sorpresas.");
  await expect(page.getByRole("heading",{name:"Sinopsis",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Reparto",exact:true})).toBeVisible();
  await expect(page.getByText("2 horas y 28 minutos",{exact:true})).toHaveCount(1);
  await page.getByRole("link",{name:"← Volver a la cinemateca",exact:true}).click();
  const card=page.getByRole("link",{name:/Una historia completa/});
  await expect(card).toContainText("2 h 28 min");
  await expect(card.locator('[aria-label="Géneros"] > span')).toHaveText(["Ciencia ficción","Drama"]);
});

test("cast capacity is atomic after deduplication and discarding restores focus", async ({page}) => {
  const names=Array.from({length:29},(_,index)=>`Actor ${index}`);
  const id=(await(await api.post("/api/library",{data:{title:"Reparto límite",cast:names}})).json()).id;
  await page.goto(`/cinemateca/${id}`); await page.getByRole("button",{name:"Editar datos",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.locator("summary").filter({hasText:"Sinopsis y reparto"}).click();
  const pending=dialog.getByRole("textbox",{name:"Nombres del reparto",exact:true});
  await pending.fill("Actor 0\nNuevo A\nNuevo B"); await dialog.getByRole("button",{name:"Agregar nombres",exact:true}).click();
  await expect(dialog.getByText("Podés agregar hasta 30 integrantes al reparto.",{exact:true})).toBeVisible();
  await expect(pending).toHaveValue("Actor 0\nNuevo A\nNuevo B");
  await expect(dialog.getByRole("button",{name:/Quitar del reparto:/})).toHaveCount(29);
  await pending.fill("Actor 0\nACTOR 1\nNuevo A"); await dialog.getByRole("button",{name:"Agregar nombres",exact:true}).click();
  await expect(dialog.getByRole("button",{name:/Quitar del reparto:/})).toHaveCount(30);
  const discard=dialog.getByRole("button",{name:"Descartar borrador",exact:true});
  await discard.click(); await expect(dialog.getByRole("button",{name:"Seguir editando",exact:true})).toBeFocused();
  await dialog.getByRole("button",{name:"Seguir editando",exact:true}).click(); await expect(discard).toBeFocused();
  // Replace the opener as a render would, then verify that restoration finds its current replacement.
  await page.evaluate(()=>{const button=[...document.querySelectorAll("main > div button")].find(b=>b.textContent==="Editar datos");if(button)button.replaceWith(button.cloneNode(true));});
  await discard.click(); await dialog.getByRole("button",{name:"Descartar y cerrar",exact:true}).click();
  await expect(page.getByRole("button",{name:"Editar datos",exact:true})).toBeFocused();
  expect((await(await api.get(`/api/library/${id}`)).json()).work.cast).toEqual(names);
});

test("metadata errors open their section and counters announce thresholds only", async ({page}) => {
  await page.goto("/cinemateca"); await page.getByRole("button",{name:"Agregar película",exact:true}).click();
  const dialog=page.getByRole("dialog"); await dialog.getByLabel(/^Título/).fill("Errores de metadatos");
  const section=dialog.locator("details").filter({hasText:"Sinopsis y reparto"});
  await section.locator("summary").click();
  const synopsis=dialog.getByRole("textbox",{name:"Sinopsis",exact:true});
  await synopsis.fill("x".repeat(4000)); await expect(dialog.getByRole("status").filter({hasText:"Sinopsis: 4000 de 5000."})).toBeAttached();
  await synopsis.fill("x".repeat(4001)); await expect(dialog.getByRole("status").filter({hasText:/Sinopsis:/})).toHaveCount(0);
  await synopsis.fill("x".repeat(5000)); await expect(dialog.getByRole("status").filter({hasText:"Sinopsis: 5000 de 5000."})).toBeAttached();
  await synopsis.fill("x".repeat(5001)); await section.locator("summary").click();
  await dialog.getByRole("button",{name:"Agregar película",exact:true}).click();
  await expect(section).toHaveAttribute("open",""); await expect(synopsis).toBeFocused();
  await expect(synopsis).toHaveAttribute("aria-describedby",/work-error-synopsis/);
  await expect(dialog.getByRole("alert")).toContainText("Revisá el campo indicado");
  await synopsis.fill("Breve");
  const pending=dialog.getByRole("textbox",{name:"Nombres del reparto",exact:true});
  await pending.fill("a".repeat(201)); await section.locator("summary").click();
  await dialog.getByRole("button",{name:"Agregar película",exact:true}).click(); await expect(pending).toBeFocused();
  await pending.fill("Ana"); await dialog.getByLabel("Duración (minutos)",{exact:true}).fill("0");
  await dialog.getByRole("button",{name:"Agregar película",exact:true}).click();
  await expect(dialog.getByLabel("Duración (minutos)",{exact:true})).toBeFocused();
});

test("metadata drafts in independent tabs do not read or overwrite one another", async ({page,context}) => {
  await page.goto("/cinemateca"); await page.getByRole("button",{name:"Agregar película",exact:true}).click();
  await page.getByRole("dialog").getByLabel(/^Título/).fill("Borrador primera pestaña");
  await page.getByRole("dialog").locator("summary").filter({hasText:"Sinopsis y reparto"}).click();
  await page.getByRole("textbox",{name:"Sinopsis",exact:true}).fill("Sinopsis primera");
  const other=await context.newPage();
  try {
    await other.goto("/cinemateca"); await other.getByRole("button",{name:"Agregar película",exact:true}).click();
    await expect(other.getByRole("dialog").getByLabel(/^Título/)).toHaveValue("");
    await other.getByRole("dialog").getByLabel(/^Título/).fill("Borrador segunda pestaña");
    await page.reload(); await page.getByRole("button",{name:"Agregar película",exact:true}).click();
    await expect(page.getByRole("dialog").getByLabel(/^Título/)).toHaveValue("Borrador primera pestaña");
    await page.getByRole("dialog").locator("summary").filter({hasText:"Sinopsis y reparto"}).click();
    await expect(page.getByRole("textbox",{name:"Sinopsis",exact:true})).toHaveValue("Sinopsis primera");
    await other.reload(); await other.getByRole("button",{name:"Agregar película",exact:true}).click();
    await expect(other.getByRole("dialog").getByLabel(/^Título/)).toHaveValue("Borrador segunda pestaña");
  } finally {await other.close();}
});

test("conflicts process pending cast and expose server changes in untouched metadata", async ({page}) => {
  const id=(await(await api.post("/api/library",{data:{title:"Conflictos completos",runtimeMinutes:45,cast:["Ana"],synopsis:"Original"}})).json()).id;
  await page.goto(`/cinemateca/${id}`); await page.getByRole("button",{name:"Editar datos",exact:true}).click();
  const dialog=page.getByRole("dialog"); await dialog.getByLabel(/^Título/).fill("Mi título");
  await dialog.locator("summary").filter({hasText:"Sinopsis y reparto"}).click();
  await dialog.getByRole("textbox",{name:"Nombres del reparto",exact:true}).fill("Ana\nBea");
  await api.patch(`/api/library/${id}`,{data:{action:"edit",title:"Conflictos completos",runtimeMinutes:61,cast:["Carla"],synopsis:"Servidor".repeat(100),expectedVersion:1}});
  await dialog.getByRole("button",{name:"Guardar cambios",exact:true}).click();
  await expect(dialog.getByRole("heading",{name:"El contenido cambió mientras lo editabas",exact:true})).toBeVisible();
  await expect(dialog.getByText("Al guardar se reemplazarán todos los datos editables actuales por los de tu borrador, incluidos los campos que no modificaste.",{exact:true})).toBeVisible();
  const comparison=dialog.locator("section").filter({has:page.getByRole("heading",{name:"Reparto · cambió",exact:true})}).last();
  await expect(comparison).toContainText("Ana"); await expect(comparison).toContainText("Bea"); await expect(comparison).toContainText("Carla");
  await expect(dialog.getByRole("heading",{name:"Duración (minutos) · cambió",exact:true})).toBeVisible();
  const pendingCast=dialog.getByRole("textbox",{name:"Nombres del reparto",exact:true});
  await pendingCast.fill("x".repeat(201));
  await expect(dialog.getByRole("button",{name:"Conservar mi borrador",exact:true})).toBeDisabled();
  await expect(dialog.getByText("Revisá los nombres pendientes del reparto antes de comparar y conservar tu borrador.",{exact:true})).toBeVisible();
  await pendingCast.fill("");
  await dialog.getByRole("button",{name:"Conservar mi borrador",exact:true}).click();
  let saved=(await(await api.get(`/api/library/${id}`)).json()).work; expect(saved.runtimeMinutes).toBe(61);
  await api.patch(`/api/library/${id}`,{data:{action:"edit",title:saved.title,synopsis:"Otro cambio",expectedVersion:saved.version}});
  await dialog.getByRole("button",{name:"Guardar cambios",exact:true}).click();
  await expect(dialog.getByRole("button",{name:"Guardar cambios",exact:true})).toBeDisabled();
  await dialog.getByRole("button",{name:"Conservar mi borrador",exact:true}).click(); await dialog.getByRole("button",{name:"Guardar cambios",exact:true}).click();
  await expect(dialog).not.toBeVisible(); saved=(await(await api.get(`/api/library/${id}`)).json()).work;
  expect(saved.cast).toEqual(["Ana","Bea"]); expect(saved.runtimeMinutes).toBe(45); expect(saved.synopsis).toBe("Original");
});

test("maximum movie metadata and every genre reflow with enlarged text", async ({page},testInfo) => {
  const {GENRES}=await import("../../src/lib/library/genres");
  const id=(await(await api.post("/api/library",{data:{title:"Metadatos completos",runtimeMinutes:1440,genres:GENRES.map(g=>g.id),cast:Array.from({length:30},(_,i)=>`Actor ${i} ${"Nombre".repeat(25)}`),synopsis:"Una historia ".repeat(380)}})).json()).id;
  await page.goto("/cinemateca");
  const card=page.getByRole("link",{name:/Metadatos completos/}); await expect(card.locator('[aria-label="Géneros"] > span')).toHaveCount(GENRES.length);
  await expect(card).toContainText("24 h"); await card.click(); await page.getByRole("button",{name:"Editar datos",exact:true}).click();
  const dialog=page.getByRole("dialog"); await dialog.locator("summary").filter({hasText:"Sinopsis y reparto"}).click();
  for(const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:900}); await page.evaluate(()=>{document.documentElement.style.fontSize="200%";});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.evaluate(()=>{document.documentElement.style.fontSize="";}); await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:testInfo.outputPath("formulario-reparto-maximo.png"),fullPage:true});
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
  await dialog.getByRole("button",{name:"Cerrar",exact:true}).click();
  await expect(page.getByRole("button",{name:"Editar datos",exact:true})).toBeFocused();
  expect(id).toBeTruthy();
});
