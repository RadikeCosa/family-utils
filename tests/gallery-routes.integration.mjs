import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import test from "node:test";
import pg from "pg";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function start(port, enabled, timedSharesEnabled = enabled) {
  const origin = `http://localhost:${port}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: connectionString, DATABASE_URL_UNPOOLED: connectionString,
      GALLERY_ENABLED: enabled ? "true" : "false", GALLERY_SHARES_ENABLED: timedSharesEnabled ? "true" : "false", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "gallery-test-only-secret-not-production",
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
    for (const [path, method] of [["/galeria", "GET"], ["/galeria/invitado", "GET"], ["/galeria/compartida", "GET"], ["/api/gallery", "GET"], ["/api/gallery/collections", "GET"], ["/api/gallery/guest/collection", "GET"], ["/api/gallery/public/session", "GET"], ["/api/gallery/public/enter", "POST"], ["/api/gallery/shares", "GET"], ["/api/gallery/uploads", "POST"], ["/api/gallery/upload-token", "POST"], ["/api/gallery/drawings/test", "GET"], ["/api/gallery/uploads/test/finalize", "POST"]]) {
      assert.equal((await fetch(disabled.origin + path, { method })).status, 404, path);
      assert.equal((await fetch(disabled.origin + path, { method })).headers.get("cache-control"), "private, no-store", `${path} no-store`);
    }
  } finally { disabled.server.kill(); }

  const sharesDisabled = await start(3357, true, false);
  try {
    assert.equal((await fetch(sharesDisabled.origin + "/api/gallery/public/session")).status, 404);
    assert.equal((await fetch(sharesDisabled.origin + "/api/gallery")).status, 401, "the existing family gallery remains available behind its original flag");
  } finally { sharesDisabled.server.kill(); }

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

    const deniedCollectionShare = await request(other, "/api/gallery/shares", "POST", { collectionId, duration: "1h" });
    assert.equal(deniedCollectionShare.status, 404, "only collection owners and administrators can share a collection");
    const beforeHourlyShare = Date.now();
    const collectionShare = await request(owner, "/api/gallery/shares", "POST", { collectionId, duration: "1h" });
    assert.equal(collectionShare.status, 201);
    assert.ok(Math.abs(Date.parse(collectionShare.body.expiresAt) - beforeHourlyShare - 60 * 60_000) < 10_000);
    const collectionUrl = new URL(collectionShare.body.url);
    assert.equal(collectionUrl.pathname, "/galeria/compartida");
    const collectionToken = new URLSearchParams(collectionUrl.hash.slice(1)).get("token");
    assert.match(collectionToken, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal((await request(owner, `/api/gallery/collections/${collectionId}/drawings`, "POST", { action: "add", drawingIds: [secondOwnedDrawing] })).status, 200);
    assert.equal((await pool.query("SELECT token_hash FROM gallery_shares WHERE id=$1", [collectionShare.body.id])).rows[0].token_hash.length, 64);
    assert.equal((await pool.query("SELECT token_hash FROM gallery_shares WHERE id=$1", [collectionShare.body.id])).rows[0].token_hash.includes(collectionToken), false);
    const entered = await request(null, "/api/gallery/public/enter", "POST", { token: collectionToken });
    assert.equal(entered.status, 200);
    assert.equal(entered.body.shareId, collectionShare.body.id);
    const sessionCookie = entered.response.headers.getSetCookie().find(value => value.startsWith("fu_gallery_session_dev="));
    assert.ok(sessionCookie);
    assert.match(sessionCookie, /HttpOnly/iu);
    assert.match(sessionCookie, /SameSite=Lax/iu);
    assert.match(sessionCookie, /Path=\//iu);
    const publicGuest = { cookie: sessionCookie.split(";", 1)[0] };
    await delay(250);
    const publicPage = await request(publicGuest, `/api/gallery/public/shares/${collectionShare.body.id}`);
    assert.equal(publicPage.status, 200);
    assert.equal(publicPage.body.drawings.length, 1);
    assert.equal(publicPage.body.total, 1, "drawings added after link creation do not enter its fixed selection");
    assert.equal("authorMemberId" in publicPage.body.drawings[0], false);
    assert.equal("originalName" in publicPage.body.drawings[0], false);
    assert.equal(publicPage.response.headers.get("cache-control"), "private, no-store");
    assert.equal(publicPage.response.headers.get("referrer-policy"), "no-referrer");
    await delay(250);
    assert.equal((await request(publicGuest, `/api/gallery/public/shares/${randomUUID()}`)).status, 410, "a session cannot enumerate another share ID");

    const beforeDefaultShare = Date.now();
    const familyShare = await request(other, "/api/gallery/shares", "POST", {});
    assert.equal(familyShare.status, 201, "any active family member can share the whole gallery");
    assert.ok(Math.abs(Date.parse(familyShare.body.expiresAt) - beforeDefaultShare - 24 * 60 * 60_000) < 10_000, "24 hours is the default duration");
    assert.equal((await request(owner, `/api/gallery/shares/${familyShare.body.id}`, "DELETE")).status, 200, "family members can revoke another member's whole-gallery link");
    const familyToken = new URLSearchParams(new URL(familyShare.body.url).hash.slice(1)).get("token");
    const revokedEntry = await request(null, "/api/gallery/public/enter", "POST", { token: familyToken });
    assert.equal(revokedEntry.status, 410, "revoked links share the unavailable response");
    assert.equal((await request(null, "/api/gallery/public/enter", "POST", { token: "b".repeat(43) })).status, 410, "unknown credentials share the unavailable response");
    await delay(250);
    const deniedCollectionRevoke = await request(other, `/api/gallery/shares/${collectionShare.body.id}`, "DELETE");
    assert.equal(deniedCollectionRevoke.status, 404, "a different collection owner cannot revoke a collection link");
    assert.equal((await request(owner, `/api/gallery/shares/${collectionShare.body.id}`, "DELETE")).status, 200);
    await delay(250);
    const revokedPage = await request(publicGuest, `/api/gallery/public/shares/${collectionShare.body.id}`);
    assert.equal(revokedPage.status, 410);
    assert.equal(revokedPage.body.error, "LINK_UNAVAILABLE");
    await delay(250);
    const revokedImage = await request(publicGuest, `/api/gallery/public/shares/${collectionShare.body.id}/images/${ownedDrawing}?variant=display`);
    assert.equal(revokedImage.status, 410);
    assert.equal(revokedImage.body, null);

    const expiringShare = await request(owner, "/api/gallery/shares", "POST", { collectionId, duration: "1h" });
    assert.equal(expiringShare.status, 201);
    const expiringToken = new URLSearchParams(new URL(expiringShare.body.url).hash.slice(1)).get("token");
    const expiringSession = await request(null, "/api/gallery/public/enter", "POST", { token: expiringToken });
    const expiringCookie = expiringSession.response.headers.getSetCookie().find(value => value.startsWith("fu_gallery_session_dev="))?.split(";", 1)[0];
    await pool.query("UPDATE gallery_shares SET expires_at=now()-interval '1 second' WHERE id=$1", [expiringShare.body.id]);
    await delay(250);
    const expiredPage = await request({ cookie: expiringCookie }, `/api/gallery/public/shares/${expiringShare.body.id}`);
    assert.equal(expiredPage.status, 410);
    assert.equal(expiredPage.body.error, revokedPage.body.error, "expired and revoked links are indistinguishable");

    const paginationDrawings = await Promise.all(Array.from({ length: 197 }, (_, index) => drawing(owner.id, String(index + 4).padStart(64, "0"))));
    const paginatedShare = await request(owner, "/api/gallery/shares", "POST", {});
    assert.equal(paginatedShare.status, 201);
    const paginatedToken = new URLSearchParams(new URL(paginatedShare.body.url).hash.slice(1)).get("token");
    const paginatedEntry = await request(null, "/api/gallery/public/enter", "POST", { token: paginatedToken });
    assert.equal(paginatedEntry.status, 200);
    const paginatedCookie = paginatedEntry.response.headers.getSetCookie().find(value => value.startsWith("fu_gallery_session_dev="))?.split(";", 1)[0];
    assert.ok(paginatedCookie);
    const paginatedGuest = { cookie: paginatedCookie };
    await delay(250);
    const firstPage = await request(paginatedGuest, `/api/gallery/public/shares/${paginatedShare.body.id}`);
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.body.drawings.length, 24);
    assert.ok(firstPage.body.nextCursor);

    let page = firstPage.body, pageCursor = page.nextCursor, visitedDrawings = [...page.drawings], lastReadStartedAt = Date.now(), lastRevalidatedAt = Date.now();
    while (pageCursor) {
      await delay(Math.max(0, lastReadStartedAt + 220 - Date.now()));
      lastReadStartedAt = Date.now();
      const nextPage = await request(paginatedGuest, `/api/gallery/public/shares/${paginatedShare.body.id}?cursor=${pageCursor}`);
      assert.equal(nextPage.status, 200, "normal pagination over 200 drawings stays below public rate limits");
      page = nextPage.body;
      pageCursor = page.nextCursor;
      visitedDrawings.push(...page.drawings);
    }
    assert.equal(visitedDrawings.length, 200);
    for (const [index, item] of visitedDrawings.entries()) {
      await delay(Math.max(0, lastReadStartedAt + 220 - Date.now()));
      lastReadStartedAt = Date.now();
      const thumbnail = await request(paginatedGuest, item.thumbnailUrl);
      assert.notEqual(thumbnail.status, 429, `normal lazy thumbnail ${index + 1}/200 must not be rate limited`);
      if (Date.now() - lastRevalidatedAt >= 30_000) {
        const sessionCheck = await request(paginatedGuest, "/api/gallery/public/session");
        assert.equal(sessionCheck.status, 200, "30-second session revalidation stays below public rate limits");
        lastRevalidatedAt = Date.now();
      }
    }

    await delay(250);
    const revokeTransaction = await pool.connect();
    try {
      await revokeTransaction.query("BEGIN");
      await revokeTransaction.query("UPDATE gallery_shares SET revoked_at=now() WHERE id=$1", [paginatedShare.body.id]);
      const pendingPage = request(paginatedGuest, `/api/gallery/public/shares/${paginatedShare.body.id}?cursor=${firstPage.body.nextCursor}`);
      await delay(300);
      await revokeTransaction.query("COMMIT");
      assert.equal((await pendingPage).status, 410, "a page racing with revocation cannot return drawings after revocation commits");
    } catch (error) {
      await revokeTransaction.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { revokeTransaction.release(); }
    await pool.query("DELETE FROM gallery_drawings WHERE id=ANY($1::uuid[])", [paginationDrawings]);
  } finally {
    server.kill();
    if (families.length) await pool.query("DELETE FROM families WHERE id=ANY($1::uuid[])", [families]);
    if (users.length) await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [users]);
    await pool.query('DELETE FROM "rateLimit" WHERE key LIKE \'gallery:%\'');
    await pool.end();
  }
});
