import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL is required in CI");
const port = 3319;
const origin = `http://localhost:${port}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("shopping real endpoints: permissions, catalog and concurrent transactions", { skip: !connectionString && "requires isolated PostgreSQL 18", timeout: 90_000 }, async (t) => {
  const pool = new pg.Pool({ connectionString });
  const users = [];
  const familyIds = [];
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: connectionString, BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "shopping-test-secret-not-production", CODE_PEPPER: "shopping-test-pepper-not-production", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, stdio: "ignore",
  });
  async function request(cookie, path = "", method = "GET", body, extra = {}) {
    const response = await fetch(`${origin}/api/shopping${path}`, { method, headers: { Cookie: cookie, Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, etag: response.headers.get("etag"), body: response.status === 304 ? null : await response.json() };
  }
  async function ok(cookie, path, method, body) {
    const result = await request(cookie, path, method, body);
    assert.ok(result.status === 200 || result.status === 201, JSON.stringify(result));
    return result.body;
  }
  async function family() {
    const { rows: [value] } = await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [`shopping-${randomUUID()}`]);
    familyIds.push(value.id); return value.id;
  }
  async function identity(familyId, name, role = "member") {
    const response = await fetch(`${origin}/api/access/prepare`, { method: "POST", headers: { Origin: origin, "x-forwarded-for": `192.0.2.${users.length + 1}` } });
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    const session = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: cookie } }).then((value) => value.json());
    users.push(session.user.id);
    const { rows: [member] } = await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id", [familyId, name, role]);
    await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [member.id, session.user.id]);
    return { cookie, id: member.id };
  }
  async function waitForBlocked(count = 1) {
    for (let i = 0; i < 100; i++) {
      const { rows: [row] } = await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()");
      if (row.count >= count) return;
      await delay(20);
    }
    throw new Error("Expected concurrent request to wait on a real PostgreSQL lock");
  }
  let listId, firstId, secondId, familyId, owner, editor, viewer, admin, outsider;
  try {
    for (let i = 0; ; i++) {
      if (server.exitCode !== null) throw new Error("Test server failed to start");
      try { if ((await fetch(origin)).ok) break; } catch { /* Wait for listen. */ }
      if (i > 100) throw new Error("Server timeout");
      await delay(100);
    }
    familyId = await family();
    owner = await identity(familyId, "Dueña"); editor = await identity(familyId, "Editor"); viewer = await identity(familyId, "Lector"); admin = await identity(familyId, "Admin", "administrator"); outsider = await identity(await family(), "Otra familia");
    const state = async (who = owner) => (await ok(who.cookie)).lists.find((list) => list.id === listId);
    await t.test("default name, family isolation, explicit editors, optional fields and repeated products", async () => {
      listId = (await ok(owner.cookie, "", "POST", { name: " " })).id;
      assert.equal((await state()).name, "Dueña");
      assert.equal((await request(viewer.cookie, `/${listId}/items`, "POST", { name: "Leche" })).status, 403);
      assert.equal((await request(outsider.cookie, `/${listId}`, "PATCH", { action: "rename", name: "Intruso", expectedVersion: 1 })).status, 404);
      assert.equal((await ok(outsider.cookie)).lists.length, 0);
      assert.equal((await request(owner.cookie, `/${listId}/editors`, "PUT", { expectedVersion: 1, memberIds: [outsider.id] })).status, 400);
      await ok(owner.cookie, `/${listId}/editors`, "PUT", { expectedVersion: 1, memberIds: [editor.id] });
      firstId = (await ok(editor.cookie, `/${listId}/items`, "POST", { name: "Café", quantity: "500 g" })).id;
      secondId = (await ok(owner.cookie, `/${listId}/items`, "POST", { name: "Café" })).id;
      assert.equal((await state()).items.length, 2);
      assert.equal((await ok(owner.cookie)).suggestions.length, 0, "adding does not learn names");
      assert.equal((await request(editor.cookie, `/${listId}`, "PATCH", { action: "rename", name: "Otra", expectedVersion: 2 })).status, 403);
      assert.equal((await request(owner.cookie, `/${listId}/items`, "POST", { name: " " })).status, 400);
      assert.equal((await request(owner.cookie, `/${listId}/items`, "POST", null)).status, 400);
    });
    await t.test("per-product conflicts, independent purchased state, idempotency and ETag", async () => {
      const results = await Promise.all(["Café molido", "Café tostado"].map((name) => request(editor.cookie, `/${listId}/items/${firstId}`, "PATCH", { name, expectedVersion: 1 })));
      assert.deepEqual(results.map((value) => value.status).sort(), [200, 409]);
      await ok(editor.cookie, `/${listId}/items/${firstId}/purchased`, "PUT", { purchased: true });
      const before = await ok(owner.cookie);
      const auditBefore = (await pool.query("SELECT count(*) FROM audit_events WHERE family_id=$1", [familyId])).rows[0].count;
      await ok(editor.cookie, `/${listId}/items/${firstId}/purchased`, "PUT", { purchased: true });
      assert.equal((await ok(owner.cookie)).revision, before.revision);
      assert.equal((await pool.query("SELECT count(*) FROM audit_events WHERE family_id=$1", [familyId])).rows[0].count, auditBefore);
      assert.equal((await state()).items.find((item) => item.id === firstId).version, 2);
      await ok(owner.cookie, `/${listId}/items/${firstId}`, "PATCH", { name: "CAFÉ", expectedVersion: 2 });
      await ok(owner.cookie, `/${listId}/items/${secondId}/purchased`, "PUT", { purchased: true });
      await ok(owner.cookie, `/${listId}/items/${firstId}/purchased`, "PUT", { purchased: false });
      await ok(owner.cookie, `/${listId}/items/${firstId}/purchased`, "PUT", { purchased: true });
      const catalog = (await ok(owner.cookie)).suggestions;
      assert.equal(catalog.filter((value) => value.normalizedName === "cafe").length, 1);
      assert.equal(catalog.find((value) => value.normalizedName === "cafe").name, "Café");
      const snapshot = await request(owner.cookie);
      assert.equal((await request(owner.cookie, "", "GET", undefined, { "If-None-Match": snapshot.etag })).status, 304);
      assert.notEqual((await request(editor.cookie)).etag, snapshot.etag);
      await ok(editor.cookie, `/${listId}/reset`, "POST", {});
      assert.deepEqual((await state()).items.map((item) => item.id), [firstId, secondId]);
    });
    await t.test("hidden suggestions remain hidden after purchases; any active member restores", async () => {
      const suggestion = (await ok(viewer.cookie)).suggestions.find((value) => value.normalizedName === "cafe");
      await ok(viewer.cookie, `/suggestions/${suggestion.id}`, "PATCH", { hidden: true, expectedVersion: suggestion.version });
      await ok(editor.cookie, `/${listId}/items/${secondId}/purchased`, "PUT", { purchased: true });
      assert.equal((await ok(owner.cookie)).suggestions.find((value) => value.id === suggestion.id).hidden, true);
      await ok(viewer.cookie, `/suggestions/${suggestion.id}`, "PATCH", { hidden: false, expectedVersion: suggestion.version + 1 });
      assert.equal((await ok(owner.cookie)).suggestions.find((value) => value.id === suggestion.id).hidden, false);
      assert.equal((await request(outsider.cookie, `/suggestions/${suggestion.id}`, "PATCH", { hidden: true, expectedVersion: suggestion.version + 2 })).status, 404);
    });
    await t.test("revocation commits before a blocked editor writes", async () => {
      const client = await pool.connect(); let writing;
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [familyId]);
        await client.query("SELECT id FROM shopping_lists WHERE id=$1 FOR UPDATE", [listId]);
        await client.query("DELETE FROM shopping_editors WHERE list_id=$1", [listId]);
        writing = request(editor.cookie, `/${listId}/items`, "POST", { name: "No debe guardarse" });
        await waitForBlocked();
        await client.query("COMMIT");
        assert.equal((await writing).status, 403);
        assert.equal((await state()).items.some((item) => item.name === "No debe guardarse"), false);
      } finally { await client.query("ROLLBACK"); client.release(); if (writing) await writing; }
    });
    await t.test("an already serialized write finishes before concurrent HTTP revocation", async () => {
      let list = await state();
      await ok(owner.cookie, `/${listId}/editors`, "PUT", { expectedVersion: list.version, memberIds: [editor.id] });
      list = await state();
      const blocker = await pool.connect(); let writing, revoking;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM shopping_lists WHERE id=$1 FOR UPDATE", [listId]);
        writing = request(editor.cookie, `/${listId}/items`, "POST", { name: "Antes de revocar" });
        await waitForBlocked();
        revoking = request(owner.cookie, `/${listId}/editors`, "PUT", { expectedVersion: list.version, memberIds: [] });
        await waitForBlocked(2);
        await blocker.query("COMMIT");
        assert.equal((await writing).status, 201); assert.equal((await revoking).status, 200);
        assert.equal((await request(editor.cookie, `/${listId}/reset`, "POST", {})).status, 403);
      } finally { await blocker.query("ROLLBACK"); blocker.release(); await Promise.all([writing, revoking].filter(Boolean)); }
    });
    await t.test("profile archival blocks a concurrent write, preserves lists and does not transfer", async () => {
      const doomed = await identity(familyId, "Perfil archivado");
      const doomedList = (await ok(doomed.cookie, "", "POST", {})).id;
      const client = await pool.connect(); let writing;
      try {
        await client.query("BEGIN"); await client.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [familyId]);
        await client.query("UPDATE members SET archived_at=now(),version=version+1 WHERE id=$1", [doomed.id]);
        await client.query("UPDATE member_devices SET revoked_at=now() WHERE member_id=$1", [doomed.id]);
        writing = request(doomed.cookie, `/${doomedList}/items`, "POST", { name: "Bloqueado" });
        await waitForBlocked(); await client.query("COMMIT"); assert.equal((await writing).status, 403);
        assert.equal((await ok(admin.cookie)).lists.find((list) => list.id === doomedList).ownerMemberId, doomed.id);
      } finally { await client.query("ROLLBACK"); client.release(); if (writing) await writing; }
    });
    await t.test("a serialized write finishes before concurrent profile archival", async () => {
      const profile = await identity(familyId, "Antes de archivar");
      const ownedList = (await ok(profile.cookie, "", "POST", {})).id;
      const blocker = await pool.connect(); let writing, archiving;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM shopping_lists WHERE id=$1 FOR UPDATE", [ownedList]);
        writing = request(profile.cookie, `/${ownedList}/items`, "POST", { name: "Compra previa" });
        await waitForBlocked();
        archiving = fetch(`${origin}/api/members/${profile.id}`, {
          method: "PATCH", headers: { Cookie: admin.cookie, Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive", expectedVersion: 1 }),
        });
        await waitForBlocked(2);
        await blocker.query("COMMIT");
        assert.equal((await writing).status, 201);
        const archived = await archiving;
        assert.equal(archived.status, 200, await archived.text());
        assert.equal((await request(profile.cookie, `/${ownedList}/reset`, "POST", {})).status, 403);
        const preserved = (await ok(admin.cookie)).lists.find((list) => list.id === ownedList);
        assert.equal(preserved.ownerMemberId, profile.id);
        assert.equal(preserved.items[0].name, "Compra previa");
      } finally { await blocker.query("ROLLBACK"); blocker.release(); await Promise.all([writing, archiving].filter(Boolean)); }
    });
    await t.test("archive preserves editors; transfer requires admin and reason, retains creator and revokes editors", async () => {
      let list = await state();
      await ok(owner.cookie, `/${listId}/editors`, "PUT", { expectedVersion: list.version, memberIds: [editor.id] });
      list = await state();
      await ok(owner.cookie, `/${listId}`, "PATCH", { action: "archive", expectedVersion: list.version });
      assert.equal((await request(editor.cookie, `/${listId}/reset`, "POST", {})).status, 403);
      list = await state(); assert.deepEqual(list.editorIds, [editor.id]);
      await ok(owner.cookie, `/${listId}`, "PATCH", { action: "restore", expectedVersion: list.version });
      list = await state();
      assert.equal((await request(owner.cookie, `/${listId}/transfer`, "POST", { expectedVersion: list.version, ownerMemberId: viewer.id, reason: "Recuperación" })).status, 403);
      assert.equal((await request(admin.cookie, `/${listId}/transfer`, "POST", { expectedVersion: list.version, ownerMemberId: viewer.id, reason: "" })).status, 400);
      await ok(admin.cookie, `/${listId}/transfer`, "POST", { expectedVersion: list.version, ownerMemberId: viewer.id, reason: "Pérdida de acceso" });
      list = await state(viewer);
      assert.equal(list.ownerMemberId, viewer.id); assert.equal(list.createdByMemberId, owner.id); assert.deepEqual(list.editorIds, []);
      assert.equal((await state(owner)).canEdit, false); assert.equal((await state(editor)).canEdit, false);
      const item = list.items[0];
      assert.equal((await request(viewer.cookie, `/${listId}/items/${item.id}`, "DELETE", { expectedVersion: 999 })).status, 409);
      await ok(viewer.cookie, `/${listId}/items/${item.id}`, "DELETE", { expectedVersion: item.version });
      const events = (await pool.query("SELECT * FROM audit_events WHERE entity_id=$1 AND action='transferred'", [listId])).rows;
      assert.equal(events[0].actor_member_id, admin.id); assert.equal(events[0].after.reason, "Pérdida de acceso");
    });
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once("exit", resolve); });
    for (const id of familyIds) {
      await pool.query("DELETE FROM shopping_lists WHERE family_id=$1", [id]);
      await pool.query("DELETE FROM families WHERE id=$1", [id]);
    }
    for (const id of users) await pool.query('DELETE FROM "user" WHERE id=$1', [id]);
    await pool.end();
  }
});
