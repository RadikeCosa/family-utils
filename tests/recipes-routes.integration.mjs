import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { issueOperation, OPERATION_TTL } from "../src/lib/recipes/operation.ts";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("Isolated PostgreSQL required");
const port = 3389, origin = `http://localhost:${port}`, secret = "recipes-test-secret-at-least-32-not-production";
const delay = ms => new Promise(r => setTimeout(r, ms));
test("recipes real routes: shared catalog, audit, permissions and atomic reviewed shopping", { skip: !connectionString && "requires isolated PostgreSQL", timeout: 120000 }, async t => {
  const pool = new pg.Pool({ connectionString }), familyIds = [], users = [];
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...process.env, NODE_ENV: "production", DATABASE_URL: connectionString, BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: secret, CODE_PEPPER: "recipes-test-pepper-at-least-32-not-production", RECIPES_ENABLED: "true", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, stdio: "ignore" });
  async function request(who, path, method = "GET", body, headers = {}) {
    const response = await fetch(`${origin}${path}`, { method, headers: { Cookie: who.cookie, Origin: origin, ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, etag: response.headers.get("etag"), body: response.status === 304 ? null : await response.json() };
  }
  async function ok(who, path, method, body) { const result = await request(who, path, method, body); assert.ok([200, 201].includes(result.status), JSON.stringify(result)); return result.body; }
  async function family() { const { rows: [f] } = await pool.query("insert into families(name) values('Recipe test family') returning id"); familyIds.push(f.id); return f.id; }
  async function identity(familyId, role = "member") {
    const response = await fetch(`${origin}/api/access/prepare`, { method: "POST", headers: { Origin: origin, "x-forwarded-for": `192.0.2.${40 + users.length}` } });
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().map(c => c.split(";", 1)[0]).join("; ");
    const session = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: cookie } }).then(r => r.json()); users.push(session.user.id);
    const { rows: [member] } = await pool.query("insert into members(family_id,name,role) values($1,'Test cook',$2) returning id", [familyId, role]);
    await pool.query("insert into member_devices(member_id,auth_user_id) values($1,$2)", [member.id, session.user.id]);
    return { cookie, id: member.id, familyId };
  }
  let owner, editor, outsider, recipe, listId, ingredientId, rowId, prepared, command;
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(origin)).ok) break; } catch {} if (server.exitCode !== null || i > 150) throw new Error("Test server startup failed"); await delay(100); }
    const f = await family(); owner = await identity(f); editor = await identity(f); outsider = await identity(await family());
    const detail = async (who = owner) => (await ok(who, `/api/recipes/${recipe.id}`)).recipe;
    await t.test("partial recipe, SQL normalization, literal search and rename collision", async () => {
      recipe = (await ok(owner, "/api/recipes", "POST", { title: "Caña familiar" })).idea;
      assert.equal(recipe.version, 1); assert.deepEqual((await detail()).ingredients, []);
      assert.equal((await request(owner, "/api/recipes", "POST", { title: " CANA\t familiar " })).body.code, "DUPLICATE_NAME");
      const other = (await ok(owner, "/api/recipes", "POST", { title: "Otra receta" })).idea;
      const collision = await request(owner, `/api/recipes/${other.id}`, "PATCH", { title: "Caña familiar", expectedVersion: other.version });
      assert.equal(collision.status, 409); assert.equal(collision.body.existing.id, recipe.id);
      const search = await ok(owner, "/api/recipes?q=cana"); assert.ok(search.ideas.some(i => i.id === recipe.id));
      assert.equal((await ok(owner, "/api/recipes?q=%25")).ideas.length, 0);
      assert.equal((await request(outsider, `/api/recipes/${recipe.id}`)).status, 404);
      const { rows: [normalized] } = await pool.query("select normalize_name_v1($1) as value", ["  CAÑA\n Café  "]); assert.equal(normalized.value, "cana cafe");
    });
    await t.test("collaborative edits, stable ingredient ids, complete audit and legacy partial updates", async () => {
      ingredientId = randomUUID(); const second = randomUUID();
      await ok(editor, `/api/recipes/${recipe.id}`, "PATCH", { expectedVersion: 1, yieldText: "4 personas", preparation: "Mezclar\r\nCocinar", ingredients: [{ id: ingredientId, name: " Harina ", quantity: "½ taza" }, { id: second, name: "Sal", quantity: "a gusto" }] });
      let current = await detail(); assert.equal(current.preparation, "Mezclar\nCocinar"); assert.equal(current.updatedByMemberId, editor.id);
      const noop = await ok(owner, `/api/recipes/${recipe.id}`, "PATCH", { expectedVersion: current.version, ingredients: current.ingredients }); assert.equal(noop.changed, false); assert.equal(noop.idea.version, current.version);
      await ok(owner, `/api/meals/ideas/${recipe.id}`, "PATCH", { title: current.title, note: "Una nota", expectedVersion: current.version });
      current = await detail(); assert.equal(current.ingredients.length, 2); assert.equal(current.yieldText, "4 personas");
      const stale = await request(editor, `/api/recipes/${recipe.id}`, "PATCH", { title: "Stale", expectedVersion: 1 }); assert.equal(stale.body.code, "RECIPE_CONFLICT");
      const { rows: [audit] } = await pool.query("select * from audit_events where entity_id=$1 and action='updated' order by created_at desc limit 1", [recipe.id]);
      assert.equal(audit.before.ingredients.length, 2); assert.equal(audit.after.ingredients.length, 2);
      const race = await Promise.all([request(owner, `/api/recipes/${recipe.id}`, "PATCH", { expectedVersion: current.version, note: "Concurrent A" }), request(editor, `/api/recipes/${recipe.id}`, "PATCH", { expectedVersion: current.version, note: "Concurrent B" })]);
      assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
      const foreign = (await ok(outsider, "/api/recipes", "POST", { title: "Foreign", ingredients: [{ id: randomUUID(), name: "Secret" }] })).idea;
      const foreignDetail = (await ok(outsider, `/api/recipes/${foreign.id}`)).recipe;
      assert.equal((await request(owner, `/api/recipes/${recipe.id}`, "PATCH", { expectedVersion: (await detail()).version, ingredients: foreignDetail.ingredients })).status, 400);
    });
    await t.test("private ETag and calendar confirmation preserve content version and snapshots", async () => {
      const response = await request(owner, `/api/recipes/${recipe.id}`); assert.equal((await request(owner, `/api/recipes/${recipe.id}`, "GET", undefined, { "If-None-Match": response.etag })).status, 304);
      const planner = await ok(owner, "/api/meals/planner"), meal = planner.meals.find(m => m.date === planner.today && m.mealType === "lunch");
      const before = await detail();
      await ok(owner, "/api/meals/planner", "PUT", { date: planner.today, mealType: "lunch", action: "propose", catalogIdeaId: recipe.id, expectedVersion: meal.version });
      const fresh = await ok(owner, "/api/meals/planner"), currentMeal = fresh.meals.find(m => m.date === planner.today && m.mealType === "lunch"), suggestion = currentMeal.suggestions[0];
      await ok(owner, "/api/meals/planner", "PUT", { date: planner.today, mealType: "lunch", action: "confirm", suggestionId: suggestion.id, menu: 1, expectedVersion: currentMeal.version });
      assert.equal((await detail()).version, before.version); assert.equal((await detail()).updatedAt, before.updatedAt);
      await ok(editor, `/api/recipes/${recipe.id}`, "PATCH", { expectedVersion: before.version, title: "Caña renombrada" });
      const after = await ok(owner, "/api/meals/planner"); assert.equal(after.meals.find(m => m.date === planner.today && m.mealType === "lunch").plan.menus[0].selection.title, before.title);
    });
    await t.test("hidden recipes require explicit restoration for new calendar uses", async () => {
      let current = await detail();
      assert.equal((await request(editor, `/api/recipes/${recipe.id}`, "PATCH", { action: "archive", expectedVersion: current.version })).status, 403);
      await ok(owner, `/api/recipes/${recipe.id}`, "PATCH", { action: "archive", expectedVersion: current.version }); current = await detail();
      await ok(editor, `/api/recipes/${recipe.id}`, "PATCH", { expectedVersion: current.version, preparation: "Oculta, corregida" });
      const duplicate = await request(owner, "/api/recipes", "POST", { title: "Caña renombrada" }); assert.equal(duplicate.body.code, "DUPLICATE_HIDDEN");
      const planner = await ok(owner, "/api/meals/planner"), breakfast = planner.meals.find(m => m.date === planner.today && m.mealType === "breakfast");
      assert.equal((await request(owner, "/api/meals/planner", "PUT", { date: planner.today, mealType: "breakfast", action: "confirm", catalogIdeaId: recipe.id, menu: 1, expectedVersion: breakfast.version })).status, 400);
      assert.ok((await detail()).archivedAt);
    });
    await t.test("review matches purchased state, preserves it and adds pending independently", async () => {
      listId = (await ok(owner, "/api/shopping", "POST", { name: "Semana" })).id;
      rowId = (await ok(owner, `/api/shopping/${listId}/items`, "POST", { name: "HARINA", quantity: "1 paquete", brand: "Marca" })).id;
      await ok(owner, `/api/shopping/${listId}/items/${rowId}/purchased`, "PUT", { purchased: true });
      command = { recipeId: recipe.id, destination: { listId }, rows: [{ ingredientId, name: "Harina", quantity: "2 paquetes", brand: null, action: "add", itemId: null, observed: [] }] };
      prepared = await ok(owner, "/api/shopping/recipe-transfer", "POST", { ...command, action: "prepare" });
      assert.equal(prepared.observations[0].observed[0].purchased, true); command.rows[0].observed = prepared.observations[0].observed;
      await ok(owner, `/api/shopping/${listId}/items/${rowId}/purchased`, "PUT", { purchased: false });
      const changed = await request(owner, "/api/shopping/recipe-transfer", "POST", { ...command, action: "confirm", token: prepared.token });
      assert.equal(changed.body.code, "REVIEW_CHANGED"); assert.equal(changed.body.observations[0].observed[0].version, command.rows[0].observed[0].version);
      command.rows[0].observed = changed.body.observations[0].observed;
      const sent = await ok(owner, "/api/shopping/recipe-transfer", "POST", { ...command, action: "confirm", token: prepared.token }); assert.equal(sent.added, 1);
      const replay = await ok(owner, "/api/shopping/recipe-transfer", "POST", { rows: command.rows, destination: command.destination, recipeId: command.recipeId, token: prepared.token, action: "confirm" }); assert.deepEqual(replay, sent);
      assert.equal((await request(owner, "/api/shopping/recipe-transfer", "POST", { ...command, rows: [{ ...command.rows[0], quantity: "3 paquetes" }], action: "confirm", token: prepared.token })).body.code, "IDEMPOTENCY_MISMATCH");
      const { rows: [count] } = await pool.query("select count(*)::int as n from shopping_items where list_id=$1", [listId]); assert.equal(count.n, 2);
      assert.equal((await detail()).ingredients[0].quantity, "½ taza");
    });
    await t.test("permission loss, new coincidences and expired operation cannot write", async () => {
      const other = await request(editor, "/api/shopping/recipe-transfer", "POST", { ...command, action: "prepare" }); assert.equal(other.body.code, "LIST_NOT_EDITABLE");
      const next = await ok(owner, "/api/shopping/recipe-transfer", "POST", { ...command, action: "prepare" }); command.rows[0].observed = next.observations[0].observed;
      await ok(owner, `/api/shopping/${listId}/items`, "POST", { name: "Harina" });
      const result = await request(owner, "/api/shopping/recipe-transfer", "POST", { ...command, token: next.token, action: "confirm" }); assert.equal(result.body.code, "REVIEW_CHANGED");
      const expired = issueOperation(secret, owner.familyId, owner.id, Date.now() - OPERATION_TTL - 1);
      assert.equal((await request(owner, "/api/shopping/recipe-transfer", "POST", { ...command, token: expired, action: "confirm" })).body.code, "OPERATION_EXPIRED");
    });
    await t.test("concurrent confirmations create exactly one new list and receipts survive row deletion", async () => {
      const nextCommand = { ...command, destination: { newListName: "Nueva" }, rows: [{ ...command.rows[0], observed: [] }] };
      const preview = await ok(owner, "/api/shopping/recipe-transfer", "POST", { ...nextCommand, action: "prepare" });
      const send = () => request(owner, "/api/shopping/recipe-transfer", "POST", { ...nextCommand, action: "confirm", token: preview.token });
      const results = await Promise.all([send(), send()]); assert.deepEqual(results[0].body, results[1].body); assert.equal(results[0].status, 200);
      const { rows: [item] } = await pool.query("select id, version from shopping_items where list_id=$1", [results[0].body.listId]);
      await ok(owner, `/api/shopping/${results[0].body.listId}/items/${item.id}`, "DELETE", { expectedVersion: item.version });
      assert.equal((await detail()).ingredients.length, 2); assert.deepEqual((await send()).body, results[0].body);
    });
    await t.test("editing a purchased match retains its state and keep leaves content unchanged", async () => {
      await ok(owner, `/api/shopping/${listId}/items/${rowId}/purchased`, "PUT", { purchased: true });
      const editing = { ...command, rows: [{ ...command.rows[0], action: "edit", itemId: rowId, quantity: "3 paquetes" }] };
      const preview = await ok(owner, "/api/shopping/recipe-transfer", "POST", { ...editing, action: "prepare" }); editing.rows[0].observed = preview.observations[0].observed;
      const saved = await ok(owner, "/api/shopping/recipe-transfer", "POST", { ...editing, action: "confirm", token: preview.token }); assert.equal(saved.edited, 1);
      const item = (await pool.query("select purchased, quantity from shopping_items where id=$1", [rowId])).rows[0]; assert.equal(item.purchased, true); assert.equal(item.quantity, "3 paquetes");
      const keeping = { ...editing, rows: [{ ...editing.rows[0], action: "keep", quantity: "No debe cambiar" }] };
      const keepPreview = await ok(owner, "/api/shopping/recipe-transfer", "POST", { ...keeping, action: "prepare" }); keeping.rows[0].observed = keepPreview.observations[0].observed;
      assert.equal((await ok(owner, "/api/shopping/recipe-transfer", "POST", { ...keeping, token: keepPreview.token, action: "confirm" })).edited, 0);
      assert.equal((await pool.query("select quantity from shopping_items where id=$1", [rowId])).rows[0].quantity, "3 paquetes");
    });
    await t.test("failure during a batch rolls back new list, prior row, audit and receipt; same operation can retry", async () => {
      const current = await detail(), functionName = `recipes_fail_${randomUUID().replaceAll("-", "")}`;
      const marker = `Forced-${functionName}`;
      const batch = { recipeId: recipe.id, destination: { newListName: marker }, rows: current.ingredients.map((ingredient, index) => ({ ingredientId: ingredient.id, name: index ? marker : "Valid first row", brand: null, quantity: null, action: "add", itemId: null, observed: [] })) };
      const preview = await ok(owner, "/api/shopping/recipe-transfer", "POST", { ...batch, action: "prepare" });
      await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name = '${marker}' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${functionName} BEFORE INSERT ON shopping_items FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      try {
        assert.equal((await request(owner, "/api/shopping/recipe-transfer", "POST", { ...batch, action: "confirm", token: preview.token })).status, 500);
        assert.equal((await pool.query("select count(*)::int as n from shopping_lists where family_id=$1 and name=$2", [owner.familyId, marker])).rows[0].n, 0);
      } finally { await pool.query(`DROP TRIGGER ${functionName} ON shopping_items; DROP FUNCTION ${functionName}()`); }
      assert.equal((await ok(owner, "/api/shopping/recipe-transfer", "POST", { ...batch, action: "confirm", token: preview.token })).added, 2);
    });
    await t.test("revoked list permission is revalidated after preparation", async () => {
      let list = (await ok(owner, "/api/shopping")).lists.find(l => l.id === listId);
      await ok(owner, `/api/shopping/${listId}/editors`, "PUT", { expectedVersion: list.version, memberIds: [editor.id] });
      const preview = await ok(editor, "/api/shopping/recipe-transfer", "POST", { ...command, action: "prepare" });
      const reviewed = { ...command, rows: [{ ...command.rows[0], observed: preview.observations[0].observed }] };
      list = (await ok(owner, "/api/shopping")).lists.find(l => l.id === listId);
      await ok(owner, `/api/shopping/${listId}/editors`, "PUT", { expectedVersion: list.version, memberIds: [] });
      assert.equal((await request(editor, "/api/shopping/recipe-transfer", "POST", { ...reviewed, action: "confirm", token: preview.token })).body.code, "LIST_NOT_EDITABLE");
    });
    await t.test("revoked device cannot receive a cached detail", async () => {
      const previous = await request(editor, `/api/recipes/${recipe.id}`);
      await pool.query("update member_devices set revoked_at=now() where member_id=$1", [editor.id]);
      assert.equal((await request(editor, `/api/recipes/${recipe.id}`, "GET", undefined, { "If-None-Match": previous.etag })).status, 403);
    });
  } finally {
    server.kill("SIGTERM");
    for (const familyId of familyIds) {
      for (const table of ["meal_daily_plans", "meal_groups", "meal_selections", "meal_suggestions"]) await pool.query(`delete from ${table} where slot_id in(select id from meal_slots where family_id=$1)`, [familyId]);
      await pool.query("delete from recipe_shopping_operations where family_id=$1", [familyId]);
      await pool.query("delete from shopping_lists where family_id=$1", [familyId]);
      await pool.query("delete from families where id=$1", [familyId]);
    }
    if (users.length) await pool.query('delete from "user" where id=any($1::text[])', [users]); await pool.end();
  }
});
