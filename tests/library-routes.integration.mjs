import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function start(port, enabled, root = process.cwd()) {
  const origin = `http://localhost:${port}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...process.env, NODE_ENV: "production", DATABASE_URL: connectionString, LIBRARY_ENABLED: enabled ? "true" : "false", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "library-test-only-secret-not-production", CODE_PEPPER: "library-test-only-pepper-not-production", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, stdio: "ignore", cwd: root });
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error("Library test server failed");
    try { if ((await fetch(origin)).ok) break; } catch { /* Wait for listening. */ }
    if (i > 100) { server.kill(); throw new Error("Server startup timeout"); }
    await delay(100);
  }
  return { origin, server };
}
test("library gates and real authenticated family endpoints", { skip: !connectionString && "requires isolated PostgreSQL", timeout: 120_000 }, async (t) => {
  const disabled = await start(3340, false);
  try {
    for (const [path, method] of [["/cinemateca", "GET"], ["/cinemateca/123", "GET"], ["/biblioteca", "GET"], ["/biblioteca/123", "GET"], ["/api/library", "GET"], ["/api/library", "POST"], ["/api/library/123", "GET"], ["/api/library/123", "PATCH"], ["/api/library/123/personal", "PUT"], ["/api/library/123/contributions", "POST"], ["/api/library/123/contributions/123", "PATCH"]]) assert.equal((await fetch(disabled.origin + path, { method })).status, 404, path);
    assert.ok(!(await fetch(disabled.origin).then((value) => value.text())).includes('href="/cinemateca"'));
  } finally { disabled.server.kill(); }
  const { server, origin } = await start(3341, true);
  const pool = new pg.Pool({ connectionString });
  const users = [], families = [];
  async function family() { const { rows: [row] } = await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [`library-${randomUUID()}`]); families.push(row.id); return row.id; }
  async function identity(familyId, role = "member") {
    const response = await fetch(`${origin}/api/access/prepare`, { method: "POST", headers: { Origin: origin, "x-forwarded-for": `192.0.2.${users.length + 51}` } });
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    const session = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: cookie } }).then((value) => value.json()); users.push(session.user.id);
    const { rows: [member] } = await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id", [familyId, `Test ${users.length}`, role]);
    await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [member.id, session.user.id]);
    return { cookie, id: member.id, userId: session.user.id };
  }
  async function request(person, path = "", method = "GET", body, extra = {}) {
    const response = await fetch(`${origin}/api/library${path}`, { method, headers: { Cookie: person?.cookie ?? "", Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, etag: response.headers.get("etag"), body: response.status === 304 ? null : await response.json() };
  }
  async function ok(person, path, method, body) { const result = await request(person, path, method, body); assert.ok([200, 201].includes(result.status), JSON.stringify(result)); return result.body; }
  try {
    const familyId = await family(), owner = await identity(familyId), peer = await identity(familyId), admin = await identity(familyId, "administrator"), outsider = await identity(await family());
    let workId;
    const detail = async () => (await ok(owner, `/${workId}`)).work;
    await t.test("anonymous profiles participate and family boundaries hold", async () => {
      assert.equal((await request(null)).status, 403);
      assert.ok((await fetch(origin).then((value) => value.text())).includes('href="/cinemateca"'));
      workId = (await ok(owner, "", "POST", { title: "Canción del verano", creator: "María", kind: "movie" })).id;
      assert.equal((await detail()).title, "Canción del verano");
      assert.equal((await ok(peer)).works.length, 1);
      assert.equal((await ok(outsider)).works.length, 0);
      assert.equal((await request(outsider, `/${workId}`)).status, 404);
      assert.equal((await request(owner, "", "POST", { title: "x", kind: "invalid" })).status, 400);
      assert.equal((await request(owner, "", "POST", { title: "x", kind: "movie", referenceUrl: "javascript:alert(1)" })).status, 400);
      assert.equal((await ok(owner, "?q=cancion")).works.length, 1);
      assert.equal((await ok(owner, "?q=MARIA")).works.length, 1);
      const state = await request(owner);
      assert.equal((await request(owner, "", "GET", undefined, { "If-None-Match": state.etag })).status, 304);
    });
    await t.test("pre-genre representation ETags revalidate without changing cursor scope", async () => {
      const current = await request(owner);
      const { cursorScope } = await import("../src/lib/library/cursor.ts");
      const scope = cursorScope([familyId, "collection", "", "", "", false, "", null]);
      const oldEtag = `"library-${cursorScope([scope, owner.id, current.body.revision, current.body.accessRevision, null])}"`;
      const refreshed = await request(owner, "", "GET", undefined, { "If-None-Match": oldEtag });
      assert.equal(refreshed.status, 200, "an old cached body without genres must not receive 304");
      assert.notEqual(refreshed.etag, oldEtag);
      assert.ok(refreshed.body.works.every(work => Array.isArray(work.genres)));
      assert.equal((await request(owner, "", "GET", undefined, { "If-None-Match": refreshed.etag })).status, 304);
    });
    await t.test("legacy pages redirect permanently and canonical pages gate access", async () => {
      for (const status of ["pending", "in_progress", "finished", "none"]) {
        for (const suffix of ["", `/${workId}`]) {
          const response = await fetch(`${origin}/biblioteca${suffix}?status=${status}&kind=book&type=music&cursor=old&extra=yes`, { headers: { Cookie: owner.cookie }, redirect: "manual" });
          assert.equal(response.status, 308);
          assert.equal(response.headers.get("location"), `/cinemateca${suffix}?status=${status}&extra=yes`);
        }
      }
      assert.equal((await fetch(`${origin}/cinemateca`, { headers: { Cookie: owner.cookie } })).status, 200);
      for (const kind of ["book", "series", "music", "art", "video_game", "tabletop_game", null]) {
        const result = await request(owner, "", "POST", { title: "Rejected", kind });
        assert.equal(result.status, 400); assert.equal(result.body.code, "INVALID");
      }
    });
    await t.test("pair pending counts, parameter contracts, pagination and peer-only revisions", async () => {
      const fid = await family(), me = await identity(fid, "administrator"), other = await identity(fid), third = await identity(fid);
      const pair = `?view=pair_pending&withMember=${other.id}`;
      const seeded = (await pool.query(`INSERT INTO library_works(family_id,title,titulo_normalizado,kind,genres,archived_at,created_by_member_id,updated_by_member_id)
        SELECT $1,'Pair '||n,'pair '||n,'movie',CASE WHEN n<=3 THEN ARRAY['terror'] ELSE '{}'::text[] END,
        CASE WHEN n=52 THEN now() END,$2,$2 FROM generate_series(1,54) n RETURNING id,title`, [fid, me.id])).rows;
      await pool.query(`INSERT INTO library_personal(family_id,work_id,member_id,status)
        SELECT $1,id,$2,'pending' FROM library_works WHERE family_id=$1 AND title NOT IN ('Pair 53','Pair 54')`, [fid, me.id]);
      await pool.query("INSERT INTO library_personal(family_id,work_id,member_id,status) SELECT $1,id,$2,'pending' FROM library_works WHERE family_id=$1 AND title<>'Pair 54'", [fid, other.id]);
      const firstId = seeded.find(w => w.title === "Pair 1").id;
      await ok(third, `/${firstId}/personal`, "PUT", { status: "pending", rating: null, expectedVersion: 0 });
      const initial = await request(me, pair);
      assert.equal(initial.status, 200);
      const previousRepresentation = await request(me, pair, "GET", undefined, { "If-None-Match": initial.etag.replace("library-v5-", "library-v3-") });
      assert.equal(previousRepresentation.status, 200);
      assert.ok(Array.isArray(previousRepresentation.body.commonPendingCounts));
      assert.deepEqual(initial.body.commonPendingCounts, [{ memberId: other.id, count: 51 }, { memberId: third.id, count: 1 }]);
      assert.equal(initial.body.works.length, 50); assert.ok(initial.body.nextCursor);
      const next = await ok(me, `${pair}&cursor=${encodeURIComponent(initial.body.nextCursor)}`);
      assert.equal(next.works.length, 1); assert.deepEqual(next.commonPendingCounts, initial.body.commonPendingCounts);
      assert.equal(new Set([...initial.body.works, ...next.works].map(w => w.id)).size, 51);
      assert.equal((await ok(me, `${pair}&archived=true`)).commonPendingCounts[0].count, 1);
      assert.equal((await ok(me, `${pair}&genre=terror`)).commonPendingCounts[0].count, 3);
      assert.equal((await ok(me, `${pair}&q=pair%201`)).commonPendingCounts[0].count, 11);
      assert.deepEqual((await ok(me, "?status=finished")).commonPendingCounts, initial.body.commonPendingCounts);
      assert.deepEqual((await ok(me, `?view=pair_pending&withMember=${third.id}`)).commonPendingCounts, initial.body.commonPendingCounts);
      assert.equal((await ok(me, "?view=common_pending")).works.length, 1, "all-family is a subset of pair");
      assert.ok(![...initial.body.works, ...next.works].some(w => ["Pair 53", "Pair 54"].includes(w.title)), "other pending alone does not match");
      for (const query of ["?view=pair_pending", `${pair}&status=pending`, `?withMember=${other.id}`, `?view=common_pending&withMember=${other.id}`, "?view=pair_pending&withMember=bad", `?view=pair_pending&withMember=${me.id}`, `?view=pair_pending&withMember=${me.id.toUpperCase()}`, `?view=pair_pending&withMember=${outsider.id}`, `?view=pair_pending&withMember=${randomUUID()}`, `${pair}&withMember=${other.id}`, `?view=pair_pending&withMember=${third.id}&cursor=${encodeURIComponent(initial.body.nextCursor)}`]) {
        const result = await request(me, query); assert.equal(result.status, 400, query); assert.equal(result.body.code, "INVALID");
      }
      await ok(other, `/${firstId}/personal`, "PUT", { status: "finished", rating: null, expectedVersion: 1 });
      const probe = await request(me, `${pair}&revisionOnly=true`, "GET", undefined, { "If-None-Match": initial.etag });
      assert.equal(probe.status, 200); assert.notEqual(probe.etag, initial.etag);
      assert.ok(probe.body.revision > initial.body.revision); assert.equal(probe.body.commonPendingCounts, undefined);
      const changed = await request(me, pair, "GET", undefined, { "If-None-Match": initial.etag });
      assert.equal(changed.status, 200); assert.equal(changed.body.commonPendingCounts[0].count, 50);
      assert.equal((await request(me, pair, "GET", undefined, { "If-None-Match": changed.etag })).status, 304);
      const archived = await fetch(`${origin}/api/members/${other.id}`, { method: "PATCH", headers: { Cookie: me.cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive", expectedVersion: 1 }) });
      assert.equal(archived.status, 200);
      assert.equal((await request(me, pair)).body.code, "MEMBER_UNAVAILABLE");
      const archivedProbe = await request(me, `${pair}&revisionOnly=true`, "GET", undefined, { "If-None-Match": changed.etag });
      assert.equal(archivedProbe.status, 200); assert.ok(archivedProbe.body.accessRevision > changed.body.accessRevision);
      assert.deepEqual((await ok(me)).commonPendingCounts, [{ memberId: third.id, count: 1 }]);
      const solo = await identity(await family());
      assert.deepEqual((await ok(solo)).commonPendingCounts, []);
    });
    await t.test("common pending, complete ratings and revisions have independent archive and membership semantics", async () => {
      const id = (await ok(owner, "", "POST", { title: "Common fixture" })).id;
      const common = async (archived = false) => (await ok(owner, `?view=common_pending${archived ? "&archived=true" : ""}`)).works.some((work) => work.id === id);
      assert.equal(await common(), false);
      for (const [person, rating] of [[owner, 5], [peer, 3]]) await ok(person, `/${id}/personal`, "PUT", { status: "pending", rating, expectedVersion: 0 });
      assert.equal(await common(), false, "admin has no state");
      await ok(admin, `/${id}/personal`, "PUT", { status: "pending", rating: null, expectedVersion: 0 });
      assert.equal(await common(), true);
      const first = await request(owner, "?view=common_pending");
      assert.equal(first.body.works.find((work) => work.id === id).personal.length, 3);
      for (const filters of ["?status=pending", "?q=Common", "?view=common_pending"]) assert.equal((await ok(owner, filters)).works.find((work) => work.id === id).personal.length, 3);
      await ok(owner, `/${id}`, "PATCH", { action: "archive", expectedVersion: 1 });
      assert.equal(await common(), false); assert.equal(await common(true), true);
      await ok(owner, `/${id}`, "PATCH", { action: "restore", expectedVersion: 2 });
      for (const status of ["pending", "none", "finished", "in_progress"]) {
        const result = await request(owner, `?view=common_pending&status=${status}`);
        assert.equal(result.status, 400); assert.equal(result.body.code, "INVALID");
      }
      assert.equal((await request(owner, "?view=unknown")).status, 400);
      // Exercise actual member endpoints, which already increment families.revision.
      const memberRequest = (path, method, body) => fetch(`${origin}/api/members${path}`, { method, headers: { Cookie: admin.cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const created = await memberRequest("", "POST", { name: "New common viewer", role: "member" });
      assert.equal(created.status, 201);
      const newcomer = await created.json();
      const changed = await request(owner, "?view=common_pending&revisionOnly=true", "GET", undefined, { "If-None-Match": first.etag });
      assert.equal(changed.status, 200);
      assert.equal(changed.body.accessRevision, first.body.accessRevision + 1);
      assert.equal(await common(), false);
      const archived = await memberRequest(`/${newcomer.id}`, "PATCH", { action: "archive", expectedVersion: newcomer.version });
      assert.equal(archived.status, 200);
      assert.equal(await common(), true);
      assert.equal((await ok(owner, `/${id}`)).accessRevision, first.body.accessRevision + 2);
      const restored = await memberRequest(`/${newcomer.id}`, "PATCH", { action: "restore", expectedVersion: newcomer.version + 1 });
      assert.equal(restored.status, 200);
      assert.equal(await common(), false);
      await memberRequest(`/${newcomer.id}`, "PATCH", { action: "archive", expectedVersion: newcomer.version + 2 });
      await pool.query("UPDATE members SET archived_at=now() WHERE id=$1", [peer.id]);
      const rated = (await ok(owner, "?status=pending")).works.find((work) => work.id === id);
      assert.equal(rated.personal.find((entry) => entry.memberId === peer.id).rating, 3, "archived member ratings are retained in filtered collection");
      assert.equal((await ok(owner, `/${id}`)).work.personal.length, rated.personal.length);
      await pool.query("UPDATE members SET archived_at=NULL WHERE id=$1", [peer.id]);
    });
    await t.test("collection keyset pages remain usable when revision changes", async () => {
      await pool.query("INSERT INTO library_works(family_id,title,titulo_normalizado,kind,created_by_member_id,updated_by_member_id) SELECT $1,'Paged '||n,'paged '||n,'movie',$2,$2 FROM generate_series(1,110) n", [familyId, owner.id]);
      const first = await ok(owner, "?kind=movie&q=Paged"); assert.equal(first.works.length, 50); assert.ok(first.nextCursor);
      await ok(peer, "", "POST", { title: "New activity", kind: "movie" });
      const second = await ok(owner, `?kind=movie&q=Paged&cursor=${encodeURIComponent(first.nextCursor)}`); assert.equal(second.works.length, 50);
      assert.equal(new Set([...first.works, ...second.works].map((work) => work.id)).size, 100);
      assert.equal((await request(owner, `?kind=movie&q=Paged&view=common_pending&cursor=${encodeURIComponent(first.nextCursor)}`)).status, 400);
      assert.equal((await request(outsider, `?kind=movie&q=Paged&cursor=${encodeURIComponent(first.nextCursor)}`)).status, 400);
      const third = await ok(owner, `?kind=movie&q=Paged&cursor=${encodeURIComponent(second.nextCursor)}`); assert.equal(third.works.length, 10); assert.equal(third.nextCursor, null);
    });
    await t.test("common pagination preserves full personal entries and rejects cross-view cursors", async () => {
      await pool.query("INSERT INTO library_personal(family_id,work_id,member_id,status,rating) SELECT w.family_id,w.id,m.id,'pending',4 FROM library_works w JOIN members m ON m.family_id=w.family_id WHERE w.family_id=$1 AND w.title LIKE 'Paged %' AND m.archived_at IS NULL", [familyId]);
      const first = await ok(owner, "?view=common_pending&q=Paged");
      assert.equal(first.works.length, 50); assert.ok(first.nextCursor);
      assert.ok(first.works.every((work) => work.personal.length === 3));
      const second = await ok(owner, `?view=common_pending&q=Paged&cursor=${encodeURIComponent(first.nextCursor)}`);
      assert.equal(second.works.length, 50);
      assert.ok(second.works.every((work) => work.personal.length === 3));
      assert.equal(new Set([...first.works, ...second.works].map((work) => work.id)).size, 100);
      const crossed = await request(owner, `?q=Paged&cursor=${encodeURIComponent(first.nextCursor)}`);
      assert.equal(crossed.status, 400); assert.equal(crossed.body.code, "INVALID");
      await pool.query("DELETE FROM library_personal WHERE work_id IN (SELECT id FROM library_works WHERE family_id=$1 AND title LIKE 'Paged %')", [familyId]);
    });
    await t.test("genre contracts filter before pagination, preserve omission and scope cursors and ETags", async () => {
      const id = (await ok(owner, "", "POST", { title: "Genre contracts", genres: ["terror", "drama", "terror"], referenceUrl: "https://example.com" })).id;
      const read = async () => (await ok(owner, `/${id}`)).work;
      assert.deepEqual((await read()).genres, ["drama", "terror"]);
      const initial = await read();
      await ok(owner, `/${id}`, "PATCH", { action: "edit", title: initial.title, referenceUrl: initial.referenceUrl, expectedVersion: initial.version });
      assert.deepEqual((await read()).genres, ["drama", "terror"]);
      await pool.query("UPDATE library_works SET genres=ARRAY['terror','drama'] WHERE id=$1", [id]);
      assert.deepEqual((await read()).genres, ["drama", "terror"]);
      for (const genre of ["", "unknown", "drama&genre=terror", "drama&genre=drama"]) {
        const result = await request(owner, `?genre=${genre}`); assert.equal(result.status, 400); assert.equal(result.body.code, "INVALID");
      }
      for (const genres of [null, "drama", ["unknown"], [null]]) assert.equal((await request(owner, "", "POST", { title: "Invalid", genres })).status, 400);
      assert.ok((await ok(owner, "?genre=drama")).works.some(w => w.id === id));
      assert.ok(!(await ok(outsider, "?genre=drama")).works.some(w => w.id === id));
      const state = await request(owner, "?genre=drama");
      assert.equal((await request(owner, "?genre=drama", "GET", undefined, { "If-None-Match": state.etag })).status, 304);
      assert.equal((await request(owner, "?genre=terror", "GET", undefined, { "If-None-Match": state.etag })).status, 200);
      await pool.query("UPDATE library_works SET genres=ARRAY['drama'] WHERE family_id=$1 AND title LIKE 'Paged %'", [familyId]);
      const first = await ok(owner, "?q=Paged&genre=drama"); assert.equal(first.works.length, 50);
      const second = await ok(owner, `?q=Paged&genre=drama&cursor=${encodeURIComponent(first.nextCursor)}`); assert.equal(second.works.length, 50);
      for (const genre of ["terror", "none", ""]) assert.equal((await request(owner, `?q=Paged${genre ? `&genre=${genre}` : ""}&cursor=${encodeURIComponent(first.nextCursor)}`)).status, 400);
      const plain = await ok(owner, "?q=Paged");
      const { cursorScope, decodeCursor } = await import("../src/lib/library/cursor.ts");
      assert.ok(decodeCursor(plain.nextCursor, cursorScope([familyId, "collection", "paged", "", "", false, "", null])));
      await ok(owner, `/${id}`, "PATCH", { action: "edit", title: initial.title, referenceUrl: initial.referenceUrl, genres: [], expectedVersion: (await read()).version });
      assert.deepEqual((await read()).genres, []);
      assert.ok((await ok(owner, "?genre=none")).works.some(w => w.id === id));
    });
    await t.test("metadata omission, clearing, validation, ETags and old clients preserve new columns", async () => {
      const id = (await ok(owner, "", "POST", { title: "Metadata contracts", runtimeMinutes: 148, cast: ["  Jose\u0301   Pérez ", "JOSÉ PÉREZ", "Ana"], synopsis: " \r\nUno\r\nDos\rTres " })).id;
      const read = async () => (await ok(owner, `/${id}`)).work;
      let current = await read();
      assert.equal(current.runtimeMinutes, 148); assert.deepEqual(current.cast, ["José Pérez", "Ana"]); assert.equal(current.synopsis, "Uno\nDos\nTres");
      const state = await request(owner, `/${id}`);
      assert.match(state.etag, /library-v5-/);
      const oldEtag = state.etag.replace("library-v5-", "library-v2-");
      const refreshed = await request(owner, `/${id}`, "GET", undefined, { "If-None-Match": oldEtag });
      assert.equal(refreshed.status, 200); assert.equal(refreshed.body.work.runtimeMinutes, 148);
      assert.equal((await request(owner, `/${id}`, "GET", undefined, { "If-None-Match": state.etag })).status, 304);
      const legacyPayload = { action: "edit", title: "Old client changes title", creator: null, year: null, referenceUrl: null, expectedVersion: current.version };
      await ok(owner, `/${id}`, "PATCH", legacyPayload);
      current = await read(); assert.equal(current.runtimeMinutes,148); assert.deepEqual(current.cast,["José Pérez","Ana"]); assert.equal(current.synopsis,"Uno\nDos\nTres");
      assert.equal((await request(owner, `/${id}`, "PATCH", legacyPayload)).status,409);
      for (const data of [{runtimeMinutes:""},{runtimeMinutes:0},{runtimeMinutes:1441},{runtimeMinutes:1.5},{cast:null},{cast:[""]},{cast:Array.from({length:31},(_,i)=>`Actor ${i}`)},{synopsis:"a".repeat(5001)}]) assert.equal((await request(owner,"","POST",{title:"Invalid metadata",...data})).status,400);
      if (process.env.LIBRARY_LEGACY_ROOT) {
        const legacy = await start(3342,true,process.env.LIBRARY_LEGACY_ROOT);
        try {
          const response = await fetch(`${legacy.origin}/api/library/${id}`, {headers:{Cookie:owner.cookie}});
          assert.equal(response.status,200); const oldBody = await response.json();
          assert.equal(oldBody.work.title,current.title);
          const edited = await fetch(`${legacy.origin}/api/library/${id}`,{method:"PATCH",headers:{Cookie:owner.cookie,Origin:legacy.origin,"Content-Type":"application/json"},body:JSON.stringify({...legacyPayload,title:"Actual old code",expectedVersion:current.version})});
          assert.equal(edited.status,200); current=await read(); assert.equal(current.runtimeMinutes,148); assert.deepEqual(current.cast,["José Pérez","Ana"]); assert.equal(current.synopsis,"Uno\nDos\nTres");
        } finally { legacy.server.kill(); }
      }
      await ok(owner,`/${id}`,"PATCH",{action:"edit",title:current.title,runtimeMinutes:null,cast:[],synopsis:" \r\n ",expectedVersion:current.version});
      current=await read(); assert.equal(current.runtimeMinutes,null); assert.deepEqual(current.cast,[]); assert.equal(current.synopsis,null);
      const minimal=(await ok(owner,"","POST",{title:"Empty metadata defaults"})).id;
      const empty=(await ok(owner,`/${minimal}`)).work; assert.equal(empty.runtimeMinutes,null); assert.deepEqual(empty.cast,[]); assert.equal(empty.synopsis,null);
    });
    await t.test("duplicate warnings, shared edits, conflicts and archive rules", async () => {
      const duplicate = await request(peer, "", "POST", { title: " CANCION del verano ", kind: "movie" });
      assert.equal(duplicate.status, 409); assert.equal(duplicate.body.code, "DUPLICATE"); assert.equal(duplicate.body.duplicates[0].id, workId);
      const another = (await ok(peer, "", "POST", { title: "Canción del verano", kind: "movie", confirmDuplicate: true })).id;
      const before = await detail();
      const outcomes = await Promise.all([peer, admin].map((person, index) => request(person, `/${workId}`, "PATCH", { action: "edit", title: `New ${index}`, kind: "movie", expectedVersion: before.version })));
      assert.deepEqual(outcomes.map((value) => value.status).sort(), [200, 409]);
      const current = await detail();
      const warning = await request(peer, `/${workId}`, "PATCH", { action: "edit", title: "Cancion del verano", kind: "movie", expectedVersion: current.version });
      assert.equal(warning.body.code, "DUPLICATE");
      await ok(peer, `/${workId}`, "PATCH", { action: "archive", expectedVersion: current.version });
      assert.equal((await request(owner, `/${workId}`, "PATCH", { action: "edit", title: "Forbidden", kind: "movie", expectedVersion: current.version + 1 })).status, 403);
      assert.ok(!(await ok(owner)).works.some((value) => value.id === workId));
      assert.ok((await ok(owner, "?archived=true")).works.some((value) => value.id === workId));
      await ok(owner, `/${workId}`, "PATCH", { action: "restore", expectedVersion: current.version + 1 });
      assert.equal((await detail()).activityAt, before.activityAt, "edits and archive do not change activity");
      assert.equal((await request(outsider, `/${another}`, "PATCH", { action: "archive", expectedVersion: 1 })).status, 404);
    });
    await t.test("personal values are independent, nullable and conflict-protected", async () => {
      const activity = (await detail()).activityAt;
      await ok(owner, `/${workId}/personal`, "PUT", { status: "finished", rating: 5, expectedVersion: 0 });
      await ok(peer, `/${workId}/personal`, "PUT", { status: "pending", rating: null, expectedVersion: 0 });
      const values = (await detail()).personal;
      assert.equal(values.find((entry) => entry.memberId === owner.id).rating, 5);
      assert.equal(values.find((entry) => entry.memberId === peer.id).status, "pending");
      assert.equal((await request(admin, `/${workId}/personal`, "PUT", { status: "pending", rating: 9, expectedVersion: 0 })).status, 400);
      const outcomes = await Promise.all([2,3].map((rating) => request(owner, `/${workId}/personal`, "PUT", { status: "finished", rating, expectedVersion: 1 })));
      assert.deepEqual(outcomes.map((value) => value.status).sort(), [200,409]);
      await ok(owner, `/${workId}/personal`, "PUT", { status: null, rating: null, expectedVersion: 2 });
      assert.equal((await detail()).personal.find((entry) => entry.memberId === owner.id).rating, null);
      assert.equal((await detail()).activityAt, activity);
      assert.ok((await ok(peer, "?status=pending")).works.some((work) => work.id === workId));
      assert.ok(!(await ok(owner, "?status=pending")).works.some((work) => work.id === workId));
      const version = (await detail()).version;
      await ok(peer, `/${workId}`, "PATCH", { action: "archive", expectedVersion: version });
      assert.equal((await request(owner, `/${workId}/personal`, "PUT", { status: "pending", rating: 1, expectedVersion: 3 })).status, 403);
      await ok(peer, `/${workId}`, "PATCH", { action: "restore", expectedVersion: version + 1 });
    });
    await t.test("contributions enforce authorship, dates, logical retirement and stable activity", async () => {
      const path = `/${workId}/contributions`;
      const input = { body: "Un recuerdo familiar 👨‍👩‍👧‍👦", spoiler: true, experience: { year: 2015, month: null, day: null }, companionIds: [owner.id,peer.id,peer.id] };
      const id = (await ok(owner,path,"POST",input)).id;
      const published = await ok(owner,`/${workId}`), entry = published.contributions[0];
      assert.equal(entry.id,id); assert.equal(entry.experience.year,2015); assert.equal(entry.experience.month,null); assert.equal(entry.companionIds.length,2);
      assert.equal((await request(admin,`${path}/${id}`,"PATCH",{ action:"retire",expectedVersion:1 })).status,403);
      assert.equal((await request(peer,`${path}/${id}`,"PATCH",{ ...input,action:"edit",expectedVersion:1 })).status,403);
      assert.equal((await request(outsider,path,"POST",input)).status,404);
      assert.equal((await request(owner,path,"POST",{ ...input,companionIds:[outsider.id] })).status,400);
      assert.equal((await request(owner,path,"POST",{ ...input,experience:{year:9999} })).status,400);
      assert.equal((await request(owner,path,"POST",{ ...input,experience:{year:2025,month:2,day:29} })).status,400);
      const edits = await Promise.all(["Primera","Segunda"].map((body) => request(owner,`${path}/${id}`,"PATCH",{ ...input,body,action:"edit",expectedVersion:1 })));
      assert.deepEqual(edits.map((entry) => entry.status).sort(),[200,409]);
      assert.equal((await detail()).activityAt,published.work.activityAt);
      const version=(await detail()).version;
      await ok(peer,`/${workId}`,"PATCH",{ action:"archive",expectedVersion:version });
      assert.equal((await request(owner,path,"POST",input)).status,403);
      assert.equal((await request(owner,`${path}/${id}`,"PATCH",{ ...input,action:"edit",expectedVersion:2 })).status,403);
      await ok(owner,`${path}/${id}`,"PATCH",{action:"retire",expectedVersion:2});
      assert.equal((await ok(owner,`/${workId}`)).contributions.length,0);
      assert.equal((await detail()).activityAt,published.work.activityAt);
      const retained = (await pool.query("SELECT body,retired_at,(SELECT count(*) FROM library_companions WHERE contribution_id=$1) AS companions FROM library_contributions WHERE id=$1",[id])).rows[0];
      assert.ok(retained.retired_at); assert.equal(Number(retained.companions),2);
      const audits=(await pool.query('SELECT "after" FROM audit_events WHERE entity_id=$1',[id])).rows;
      assert.ok(audits.every((row)=> !JSON.stringify(row).includes(retained.body)));
      await ok(peer,`/${workId}`,"PATCH",{ action:"restore",expectedVersion:version+1 });
      await pool.query("INSERT INTO library_contributions(family_id,work_id,author_member_id,body) SELECT $1,$2,$3,'Aporte '||n FROM generate_series(1,105) n",[familyId,workId,owner.id]);
      const first=await ok(owner,`/${workId}`); assert.equal(first.contributions.length,50); assert.ok(first.nextCursor);
      await ok(peer,path,"POST",{ ...input,body:"Nuevo aporte" });
      const second=await ok(owner,`/${workId}?cursor=${encodeURIComponent(first.nextCursor)}`); assert.equal(second.contributions.length,50);
      assert.equal(new Set([...first.contributions,...second.contributions].map((entry)=>entry.id)).size,100);
      const third=await ok(owner,`/${workId}?cursor=${encodeURIComponent(second.nextCursor)}`); assert.equal(third.contributions.length,5);
    });
    await t.test("archive lock wins before publication and personal write", async () => {
      const id=(await ok(owner,"","POST",{title:"Concurrent archive",kind:"movie"})).id;
      const blocker=await pool.connect();
      try {
        await blocker.query("BEGIN"); await blocker.query("SELECT id FROM library_works WHERE id=$1 FOR UPDATE",[id]);
        const publish=request(owner,`/${id}/contributions`,"POST",{body:"No debe publicarse",spoiler:false,companionIds:[]});
        const personal=request(peer,`/${id}/personal`,"PUT",{status:"pending",rating:1,expectedVersion:0});
        await delay(100);
        await blocker.query("UPDATE library_works SET archived_at=now(),version=version+1 WHERE id=$1",[id]);
        await blocker.query("COMMIT");
        assert.equal((await publish).status,403); assert.equal((await personal).status,403);
        assert.equal(Number((await pool.query("SELECT count(*) n FROM library_contributions WHERE work_id=$1",[id])).rows[0].n),0);
      } finally { await blocker.query("ROLLBACK");blocker.release(); }
      const second=(await ok(owner,"","POST",{title:"Dependent lock",kind:"movie"})).id;
      const shared=await pool.connect();
      try { await shared.query("BEGIN"); await shared.query("SELECT id FROM library_works WHERE id=$1 FOR SHARE",[second]);
        let resolved=false; const archive=request(peer,`/${second}`,"PATCH",{action:"archive",expectedVersion:1}).then((result)=>{resolved=true;return result;});
        await delay(100); assert.equal(resolved,false,"archive waits for dependent writes");
        await shared.query("COMMIT"); assert.equal((await archive).status,200);
      } finally {await shared.query("ROLLBACK");shared.release();}
    });
    await t.test("revoked device loses library access", async () => {
      await pool.query("UPDATE member_devices SET revoked_at=now() WHERE auth_user_id=$1", [peer.userId]);
      assert.equal((await request(peer)).status, 403);
      assert.equal((await request(peer, "", "POST", { title: "Denied", kind: "movie" })).status, 403);
    });
    await t.test("Cine con Cami: shared writes, legacy preservation, filters, cursors and permissions", async () => {
      const fid = await family(), me = await identity(fid), other = await identity(fid);
      const create = async (title, cineWithCami) => (await ok(me, "", "POST", { title, genres: ["drama"], ...(cineWithCami === undefined ? {} : { cineWithCami }) })).id;
      const id = await create("Cami sentinel", true);
      const read = async () => (await ok(me, `/${id}`)).work;
      const save = async (person, extra) => request(person, `/${id}`, "PATCH", { action: "edit", title: "Cami sentinel", expectedVersion: (await read()).version, ...extra });
      assert.equal((await read()).cineWithCami, true);
      assert.equal((await ok(other, `/${id}`)).work.cineWithCami, true);
      const before = await request(me, "?selection=cine_with_cami");
      assert.equal((await save(other, { cineWithCami: false })).status, 200);
      assert.equal((await read()).cineWithCami, false);
      assert.equal((await request(me, "?selection=cine_with_cami&revisionOnly=true", "GET", undefined, { "If-None-Match": before.etag })).status, 200);
      assert.equal((await save(other, { cineWithCami: true })).status, 200);
      assert.equal((await save(me, {})).status, 200);
      assert.equal((await read()).cineWithCami, true, "legacy edits preserve selection");
      assert.deepEqual((await read()).genres, ["drama"]);
      assert.equal((await request(me, `/${id}`, "PATCH", { action: "edit", title: "stale", expectedVersion: 1, cineWithCami: false })).status, 409);
      for (const value of [null, "true", 1, []]) assert.equal((await save(me, { cineWithCami: value })).status, 400);
      assert.equal((await save(null, { cineWithCami: false })).status, 403);
      assert.equal((await save(outsider, { cineWithCami: false })).status, 404);
      const legacy = await create("Cami legacy");
      assert.equal((await ok(me, `/${legacy}`)).work.cineWithCami, false);
      for (const query of ["selection=", "selection=other", "selection=cine_with_cami&selection=cine_with_cami"]) assert.equal((await request(me, `?${query}`)).status, 400);
      await pool.query("INSERT INTO library_personal(family_id,work_id,member_id,status,rating) VALUES($1,$2,$3,'pending',4),($1,$2,$4,'pending',5)", [fid,id,me.id,other.id]);
      const selected = await ok(me, "?selection=cine_with_cami&genre=drama&q=sentinel");
      assert.deepEqual(selected.works.map(w => w.id), [id]);
      assert.equal(selected.commonPendingCounts.find(c => c.memberId === other.id).count, 1);
      assert.equal((await ok(me, `?selection=cine_with_cami&view=pair_pending&withMember=${other.id}`)).works.length, 1);
      await ok(me, `/${id}/personal`, "PUT", { status: "finished", rating: 4, expectedVersion: 1 });
      assert.equal((await ok(me, "?selection=cine_with_cami&status=finished")).works.length, 1);
      assert.equal((await read()).cineWithCami, true);
      await ok(me, `/${id}`, "PATCH", { action: "archive", expectedVersion: (await read()).version });
      assert.equal((await ok(me, "?selection=cine_with_cami")).works.length, 0);
      assert.equal((await ok(me, "?selection=cine_with_cami&archived=true")).works.length, 1);
      assert.equal((await save(me, { cineWithCami: false })).status, 403);
      await ok(me, `/${id}`, "PATCH", { action: "restore", expectedVersion: (await read()).version });
      assert.equal((await read()).cineWithCami, true);
      assert.equal((await read()).personal.find(p => p.memberId === me.id).rating, 4);
      await pool.query("INSERT INTO library_works(family_id,title,titulo_normalizado,kind,cine_with_cami,created_by_member_id,updated_by_member_id) SELECT $1,'Cami page '||n,'cami page '||n,'movie',true,$2,$2 FROM generate_series(1,55) n", [fid,me.id]);
      const first = await ok(me, "?selection=cine_with_cami");
      assert.equal(first.works.length, 50); assert.ok(first.nextCursor);
      const next = await ok(me, `?selection=cine_with_cami&cursor=${encodeURIComponent(first.nextCursor)}`);
      assert.equal(next.works.length, 6);
      assert.equal(new Set([...first.works, ...next.works].map(w => w.id)).size, 56);
      assert.equal((await request(me, `?cursor=${encodeURIComponent(first.nextCursor)}`)).status, 400);
      const cached = await request(me, "?selection=cine_with_cami");
      assert.equal((await request(me, "?selection=cine_with_cami", "GET", undefined, { "If-None-Match": cached.etag })).status, 304);
      assert.equal((await request(me, "?selection=cine_with_cami", "GET", undefined, { "If-None-Match": cached.etag.replace("library-v5", "library-v4") })).status, 200);
      await pool.query("UPDATE member_devices SET revoked_at=now() WHERE auth_user_id=$1", [other.userId]);
      assert.equal((await save(other, { cineWithCami: false })).status, 403);
    });
    void admin;
  } finally {
    server.kill();
    for (const table of ["library_companions", "library_contributions", "library_personal", "library_works", "audit_events"]) await pool.query(`DELETE FROM ${table} WHERE family_id=ANY($1::uuid[])`, [families]);
    if (families.length) await pool.query("DELETE FROM families WHERE id=ANY($1::uuid[])", [families]);
    if (users.length) await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [users]);
    await pool.end();
  }
});
