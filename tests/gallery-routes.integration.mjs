import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import test from "node:test";
import pg from "pg";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function start(port, enabled) {
  const origin = `http://localhost:${port}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: connectionString, DATABASE_URL_UNPOOLED: connectionString,
      GALLERY_ENABLED: enabled ? "true" : "false", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "gallery-test-only-secret-not-production",
      CODE_PEPPER: "gallery-test-only-pepper-not-production", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("Gallery test server failed to start");
    try { if ((await fetch(origin)).ok) return { origin, server }; } catch { /* Wait for Next to listen. */ }
    await delay(100);
  }
  server.kill();
  throw new Error("Gallery test server startup timeout");
}

test("gallery routes gate access, preserve family/authorship rules, and revoke guest sessions", { skip: !connectionString && "requires isolated PostgreSQL 18", timeout: 120_000 }, async () => {
  const disabled = await start(3358, false);
  try {
    for (const [path, method] of [["/galeria", "GET"], ["/galeria/invitado", "GET"], ["/api/gallery", "GET"], ["/api/gallery/collections", "GET"], ["/api/gallery/guest/collection", "GET"], ["/api/gallery/uploads", "POST"], ["/api/gallery/upload-token", "POST"], ["/api/gallery/drawings/test", "GET"], ["/api/gallery/uploads/test/finalize", "POST"]]) {
      assert.equal((await fetch(disabled.origin + path, { method })).status, 404, path);
    }
  } finally { disabled.server.kill(); }

  const { origin, server } = await start(3359, true);
  const pool = new pg.Pool({ connectionString });
  const families = [], users = [];
  async function family() {
    const { rows: [row] } = await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [`gallery-${randomUUID()}`]);
    families.push(row.id); return row.id;
  }
  async function identity(familyId, name, role = "member") {
    const response = await fetch(`${origin}/api/access/prepare`, { method: "POST", headers: { Origin: origin, "x-forwarded-for": `192.0.2.${users.length + 61}` } });
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
    const session = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: cookie } }).then(value => value.json());
    users.push(session.user.id);
    const { rows: [member] } = await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id", [familyId, name, role]);
    await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [member.id, session.user.id]);
    return { cookie, id: member.id };
  }
  const request = async (person, path, method = "GET", body) => {
    const response = await fetch(`${origin}${path}`, { method, headers: {
      Cookie: person?.cookie ?? "", Origin: origin, "x-real-ip": "192.0.2.240",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json().catch(() => null);
    return { response, status: response.status, body: json };
  };

  try {
    const familyId = await family(), owner = await identity(familyId, "Author"), other = await identity(familyId, "Other"), outsider = await identity(await family(), "Outsider");
    const collectionResult = await request(owner, "/api/gallery/collections", "POST", { title: "Private gallery", description: "A fictional test collection" });
    assert.equal(collectionResult.status, 201);
    const collectionId = collectionResult.body.collection.id;
    assert.equal((await request(outsider, `/api/gallery/collections/${collectionId}`)).status, 404);

    const drawing = async (authorId, hash) => (await pool.query(
      "INSERT INTO gallery_drawings(family_id,author_member_id,status,original_name,original_sha256,original_bytes,source_mime_type,width,height,display_path,thumbnail_path,display_bytes,thumbnail_bytes) VALUES($1,$2,'ready','private-original.png',$3,100,'image/png',20,20,$4,$5,10,10) RETURNING id",
      [familyId, authorId, hash, `gallery/${randomUUID()}/display.webp`, `gallery/${randomUUID()}/thumbnail.webp`],
    )).rows[0].id;
    const ownedDrawing = await drawing(owner.id, "1".repeat(64));
    const secondOwnedDrawing = await drawing(owner.id, "3".repeat(64));
    const otherDrawing = await drawing(other.id, "2".repeat(64));
    assert.equal((await request(owner, `/api/gallery/collections/${collectionId}/drawings`, "POST", { action: "add", drawingIds: [ownedDrawing] })).status, 200);
    assert.equal((await request(owner, `/api/gallery/collections/${collectionId}/drawings`, "POST", { action: "add", drawingIds: [otherDrawing] })).status, 400);
    const detail = await request(owner, `/api/gallery/collections/${collectionId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.drawings.length, 1);
    assert.equal("originalName" in detail.body.drawings[0], false);

    const created = await request(owner, `/api/gallery/collections/${collectionId}/invitations`, "POST", {});
    assert.equal(created.status, 201);
    assert.equal((await request(owner, `/api/gallery/collections/${collectionId}`, "PATCH", { title: "Updated preview" })).status, 409);
    assert.equal((await request(owner, `/api/gallery/collections/${collectionId}`, "PATCH", { title: "Updated preview", confirmExposure: true })).status, 200);
    assert.equal((await request(owner, `/api/gallery/collections/${collectionId}/drawings`, "POST", { action: "add", drawingIds: [secondOwnedDrawing] })).status, 409);
    assert.equal((await request(owner, `/api/gallery/collections/${collectionId}/drawings`, "POST", { action: "add", drawingIds: [secondOwnedDrawing], confirmExposure: true })).status, 200);
    assert.equal((await request(owner, `/api/gallery/collections/${collectionId}/drawings`, "POST", { action: "remove", drawingIds: [secondOwnedDrawing] })).status, 200);
    const activeInvitations = await request(owner, `/api/gallery/collections/${collectionId}/invitations`);
    assert.equal(activeInvitations.status, 200);
    assert.equal(activeInvitations.body.invitations.length, 1);
    assert.equal((await request(owner, "/api/gallery/collections")).body.collections[0].activeInvitationCount, 1);
    const inviteUrl = new URL(created.body.url);
    assert.equal(inviteUrl.pathname, "/galeria/invitado");
    assert.ok(inviteUrl.hash.startsWith("#token="));
    assert.equal(inviteUrl.search, "");
    const token = new URLSearchParams(inviteUrl.hash.slice(1)).get("token");
    const redeemed = await request(null, "/api/gallery/guest/redeem", "POST", { token });
    assert.equal(redeemed.status, 200);
    const guestCookie = redeemed.response.headers.getSetCookie().find(value => value.startsWith("fu_gallery_guest="))?.split(";", 1)[0];
    assert.ok(guestCookie);
    const guest = { cookie: guestCookie };
    const guestPage = await request(guest, "/api/gallery/guest/collection");
    assert.equal(guestPage.status, 200);
    assert.equal(guestPage.body.collection.title, "Updated preview");
    assert.equal(guestPage.body.drawings.length, 1);
    assert.equal("authorMemberId" in guestPage.body.drawings[0], false);
    assert.equal("originalName" in guestPage.body.drawings[0], false);
    assert.equal((await request(guest, "/api/gallery/guest/collection")).status, 429, "the global interval throttles immediate repeats");
    await delay(250);
    assert.equal((await request(guest, "/api/gallery/guest/collection")).status, 200);

    assert.equal((await request(owner, `/api/gallery/collections/${collectionId}/invitations`, "POST", {})).status, 409);
    const reissued = await request(owner, `/api/gallery/collections/${collectionId}/invitations`, "POST", { confirmReissue: true });
    assert.equal(reissued.status, 201);
    assert.equal((await request(guest, "/api/gallery/guest/collection")).status, 401);
    const replacementToken = new URLSearchParams(new URL(reissued.body.url).hash.slice(1)).get("token");
    const replacement = await request(null, "/api/gallery/guest/redeem", "POST", { token: replacementToken });
    assert.equal(replacement.status, 200);
    const replacementCookie = replacement.response.headers.getSetCookie().find(value => value.startsWith("fu_gallery_guest="))?.split(";", 1)[0];
    await pool.query("UPDATE gallery_invitations SET expires_at=now()-interval '1 minute' WHERE collection_id=$1", [collectionId]);
    await delay(250);
    assert.equal((await request({ cookie: replacementCookie }, "/api/gallery/guest/collection")).status, 200, "redeemed session remains valid for its seven-day period");
    await pool.query("UPDATE gallery_invitations SET revoked_at=now() WHERE collection_id=$1", [collectionId]);
    assert.equal((await request({ cookie: replacementCookie }, "/api/gallery/guest/collection")).status, 401);
  } finally {
    server.kill();
    if (families.length) await pool.query("DELETE FROM families WHERE id=ANY($1::uuid[])", [families]);
    if (users.length) await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [users]);
    await pool.query('DELETE FROM "rateLimit" WHERE key LIKE \'gallery:%\'');
    await pool.end();
  }
});
