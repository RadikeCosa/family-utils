import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function start(port, enabled) {
  const origin = `http://localhost:${port}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...process.env, NODE_ENV: "production", DATABASE_URL: connectionString, LIBRARY_ENABLED: enabled ? "true" : "false", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "library-test-only-secret-not-production", CODE_PEPPER: "library-test-only-pepper-not-production", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, stdio: "ignore" });
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
    for (const [path, method] of [["/biblioteca", "GET"], ["/biblioteca/123", "GET"], ["/api/library", "GET"], ["/api/library", "POST"], ["/api/library/123", "GET"], ["/api/library/123", "PATCH"], ["/api/library/123/personal", "PUT"], ["/api/library/123/contributions", "POST"], ["/api/library/123/contributions/123", "PATCH"]]) assert.equal((await fetch(disabled.origin + path, { method })).status, 404, path);
    assert.ok(!(await fetch(disabled.origin).then((value) => value.text())).includes('href="/biblioteca"'));
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
      assert.ok((await fetch(origin).then((value) => value.text())).includes('href="/biblioteca"'));
      workId = (await ok(owner, "", "POST", { title: "Canción del verano", creator: "María", kind: "music" })).id;
      assert.equal((await detail()).title, "Canción del verano");
      assert.equal((await ok(peer)).works.length, 1);
      assert.equal((await ok(outsider)).works.length, 0);
      assert.equal((await request(outsider, `/${workId}`)).status, 404);
      assert.equal((await request(owner, "", "POST", { title: "x", kind: "invalid" })).status, 400);
      assert.equal((await request(owner, "", "POST", { title: "x", kind: "book", referenceUrl: "javascript:alert(1)" })).status, 400);
      assert.equal((await ok(owner, "?q=cancion")).works.length, 1);
      assert.equal((await ok(owner, "?q=MARIA")).works.length, 1);
      const state = await request(owner);
      assert.equal((await request(owner, "", "GET", undefined, { "If-None-Match": state.etag })).status, 304);
    });
    await t.test("collection keyset pages remain usable when revision changes", async () => {
      await pool.query("INSERT INTO library_works(family_id,title,titulo_normalizado,kind,created_by_member_id,updated_by_member_id) SELECT $1,'Paged '||n,'paged '||n,'book',$2,$2 FROM generate_series(1,110) n", [familyId, owner.id]);
      const first = await ok(owner, "?kind=book"); assert.equal(first.works.length, 50); assert.ok(first.nextCursor);
      await ok(peer, "", "POST", { title: "New activity", kind: "movie" });
      const second = await ok(owner, `?kind=book&cursor=${encodeURIComponent(first.nextCursor)}`); assert.equal(second.works.length, 50);
      assert.equal(new Set([...first.works, ...second.works].map((work) => work.id)).size, 100);
      assert.equal((await request(owner, `?kind=music&cursor=${encodeURIComponent(first.nextCursor)}`)).status, 400);
      assert.equal((await request(outsider, `?kind=book&cursor=${encodeURIComponent(first.nextCursor)}`)).status, 400);
      const third = await ok(owner, `?kind=book&cursor=${encodeURIComponent(second.nextCursor)}`); assert.equal(third.works.length, 10); assert.equal(third.nextCursor, null);
    });
    await t.test("duplicate warnings, shared edits, conflicts and archive rules", async () => {
      const duplicate = await request(peer, "", "POST", { title: " CANCION del verano ", kind: "music" });
      assert.equal(duplicate.status, 409); assert.equal(duplicate.body.code, "DUPLICATE"); assert.equal(duplicate.body.duplicates[0].id, workId);
      const another = (await ok(peer, "", "POST", { title: "Canción del verano", kind: "music", confirmDuplicate: true })).id;
      const before = await detail();
      const outcomes = await Promise.all([peer, admin].map((person, index) => request(person, `/${workId}`, "PATCH", { action: "edit", title: `New ${index}`, kind: "music", expectedVersion: before.version })));
      assert.deepEqual(outcomes.map((value) => value.status).sort(), [200, 409]);
      const current = await detail();
      const warning = await request(peer, `/${workId}`, "PATCH", { action: "edit", title: "Cancion del verano", kind: "music", expectedVersion: current.version });
      assert.equal(warning.body.code, "DUPLICATE");
      await ok(peer, `/${workId}`, "PATCH", { action: "archive", expectedVersion: current.version });
      assert.equal((await request(owner, `/${workId}`, "PATCH", { action: "edit", title: "Forbidden", kind: "book", expectedVersion: current.version + 1 })).status, 403);
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
      const id=(await ok(owner,"","POST",{title:"Concurrent archive",kind:"book"})).id;
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
      const second=(await ok(owner,"","POST",{title:"Dependent lock",kind:"music"})).id;
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
      assert.equal((await request(peer, "", "POST", { title: "Denied", kind: "book" })).status, 403);
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
