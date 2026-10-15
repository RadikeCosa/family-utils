import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function start(port, enabled) {
  const origin = `http://localhost:${port}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...process.env, NODE_ENV: "production", DATABASE_URL: connectionString, SPORTS_ENABLED: enabled ? "true" : "false", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "sports-test-only-secret-not-production", CODE_PEPPER: "sports-test-only-pepper-not-production", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, stdio: "ignore" });
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error("Sports test server failed");
    try { if ((await fetch(origin)).ok) break; } catch { /* Wait for listening. */ }
    if (i > 100) { server.kill(); throw new Error("Server startup timeout"); }
    await wait(100);
  }
  return { origin, server };
}

test("sports permissions and family isolation", { skip: !connectionString && "requires isolated PostgreSQL", timeout: 120_000 }, async (t) => {
  const disabled = await start(3346, false);
  try {
    assert.equal((await fetch(`${disabled.origin}/deportes`)).status, 404);
    assert.equal((await fetch(`${disabled.origin}/api/sports`)).status, 404);
    assert.ok(!(await fetch(disabled.origin).then((response) => response.text())).includes('href="/deportes"'));
  } finally { disabled.server.kill(); }

  const { origin, server } = await start(3347, true);
  const pool = new pg.Pool({ connectionString });
  const families = [], users = [];
  async function family() {
    const { rows: [row] } = await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [`sports-${randomUUID()}`]);
    families.push(row.id); return row.id;
  }
  async function identity(familyId, role = "member") {
    const response = await fetch(`${origin}/api/access/prepare`, { method: "POST", headers: { Origin: origin, "x-forwarded-for": `192.0.2.${users.length + 80}` } });
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    const session = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: cookie } }).then((value) => value.json());
    users.push(session.user.id);
    const { rows: [member] } = await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id", [familyId, `Sports ${users.length}`, role]);
    await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [member.id, session.user.id]);
    return { cookie, id: member.id, userId: session.user.id };
  }
  async function request(person, path, method = "GET", body) {
    const response = await fetch(`${origin}${path}`, { method, headers: { Cookie: person?.cookie ?? "", Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  async function ok(person, path, method = "GET", body) {
    const value = await request(person, path, method, body); assert.ok([200, 201].includes(value.status), JSON.stringify(value)); return value.body;
  }
  try {
    const familyId = await family(), owner = await identity(familyId), peer = await identity(familyId), admin = await identity(familyId, "administrator"), outsider = await identity(await family());
    await t.test("manual football agenda is private and members cannot edit it", async () => {
      assert.equal((await request(null, "/api/sports")).status, 403);
      const match = await ok(admin, "/api/sports", "POST", { kind: "football_match", title: "River Plate vs Boca", competition: "Liga", firstParticipant: "River Plate", secondParticipant: "Boca Juniors", eventDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), startTime: null });
      assert.equal((await request(peer, `/api/sports/events/${match.id}`, "PATCH", { title: "No" })).status, 403);
      assert.equal((await request(peer, "/api/sports", "POST", { kind: "football_match" })).status, 403);
      assert.equal((await ok(peer, "/api/sports")).football.length, 1);
      assert.equal((await ok(outsider, "/api/sports")).football.length, 0);
      assert.equal((await request(outsider, `/api/sports/events/${match.id}`, "PATCH", {})).status, 404);
      assert.equal((await request(outsider, `/api/sports/comments?contextKind=river_match&contextDate=2026-10-14&eventId=${match.id}`)).body.comments.length, 0);
    });

    const { rows: [match] } = await pool.query("SELECT id FROM sports_events WHERE family_id=$1 AND kind='football_match' ORDER BY created_at DESC LIMIT 1", [familyId]);
    const contextDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await t.test("comment authoring, version conflicts and administrator removal", async () => {
      const comment = await ok(owner, "/api/sports/comments", "POST", { contextKind: "river_match", contextDate, contextEventId: match.id, body: "Vamos River" });
      assert.equal((await request(peer, `/api/sports/comments/${comment.id}`, "PATCH", { action: "edit", body: "Cambio", expectedVersion: 1 })).status, 403);
      assert.equal((await request(owner, `/api/sports/comments/${comment.id}`, "PATCH", { action: "edit", body: "Editado", expectedVersion: 9 })).status, 409);
      const edited = await ok(owner, `/api/sports/comments/${comment.id}`, "PATCH", { action: "edit", body: "Editado", expectedVersion: 1 });
      assert.equal(edited.version, 2);
      assert.equal((await request(peer, `/api/sports/comments/${comment.id}`, "PATCH", { action: "retire", expectedVersion: 2 })).status, 403);
      await ok(admin, `/api/sports/comments/${comment.id}`, "PATCH", { action: "retire", expectedVersion: 2 });
      assert.equal((await ok(owner, `/api/sports/comments?contextKind=river_match&contextDate=${contextDate}&eventId=${match.id}`)).comments.length, 0);
      assert.equal((await request(outsider, "/api/sports/comments", "POST", { contextKind: "river_match", contextDate, contextEventId: match.id, body: "acceso cruzado" })).status, 404);
    });
  } finally {
    server.kill();
    if (families.length) {
      await pool.query("DELETE FROM audit_events WHERE family_id=ANY($1::uuid[]) AND entity_type IN ('sports_event','sports_comment')", [families]);
      await pool.query("DELETE FROM families WHERE id=ANY($1::uuid[])", [families]);
    }
    if (users.length) await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [users]);
    await pool.end();
  }
});
