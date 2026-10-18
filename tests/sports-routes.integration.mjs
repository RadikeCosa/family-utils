import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { championsFixture, championsCleanupTables, championsIdentityTables } from "./helpers/champions.ts";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function start(port, enabled) {
  const origin = `http://localhost:${port}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...process.env, NODE_ENV: "production", DATABASE_URL: connectionString, SPORTS_ENABLED: enabled ? "true" : "false", SPORTS_AGENDA_ENABLED: enabled ? "true" : "false", SPORTS_RIVER_RESULTS_ENABLED: enabled ? "true" : "false", SPORTS_UFC_PREDICTIONS_ENABLED: enabled ? "true" : "false", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "sports-test-only-secret-not-production", CODE_PEPPER: "sports-test-only-pepper-not-production", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, stdio: "ignore" });
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
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  async function ok(person, path, method = "GET", body) {
    const value = await request(person, path, method, body); assert.ok([200, 201].includes(value.status), JSON.stringify(value)); return value.body;
  }
  try {
    const familyId = await family(), owner = await identity(familyId), peer = await identity(familyId), admin = await identity(familyId, "administrator"), outsider = await identity(await family());
    const champions = await championsFixture(pool, familyId, admin.id);
    await t.test("UFC dashboard can validate access inside a read-only transaction", async () => {
      const dashboard = await ok(owner, "/api/sports/dashboard");
      assert.deepEqual(dashboard.events, []);
    });
    await t.test("Champions stays outside legacy reads and mutations", async () => {
      const page = await ok(owner, `/api/sports?event=${champions.event}`);
      assert.ok(!JSON.stringify(page).includes(champions.event));
      assert.equal((await request(admin, `/api/sports/events/${champions.event}`, "PATCH", { action: "hide" })).status, 404);
      assert.equal((await request(owner, `/api/sports/events/${champions.event}/formation`, "PUT", { body: "4-3-3" })).status, 404);
      assert.equal((await request(owner, "/api/sports/comments", "POST", { contextKind: "river_match", contextEventId: champions.event, body: "Must not write" })).status, 404);
      assert.equal((await ok(owner, `/api/sports/comments?contextKind=river_match&eventId=${champions.event}`)).comments.length, 0);
    });
    await t.test("curated JSON import is admin-only, idempotent and preserves event-linked family data", async () => {
      const importFamily = await family(), importer = await identity(importFamily, "administrator"), participant = await identity(importFamily);
      const champions = await championsFixture(pool, importFamily, importer.id);
      const championBefore = (await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE id=$1", [champions.event])).rows[0].record;
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const throughDate = new Date(`${today}T12:00:00Z`); throughDate.setUTCDate(throughDate.getUTCDate() + 20);
      const through = throughDate.toISOString().slice(0, 10), checkedAt = new Date().toISOString();
      const eventDate = new Date(`${today}T12:00:00Z`); eventDate.setUTCDate(eventDate.getUTCDate() + 1);
      const scheduled = eventDate.toISOString().slice(0, 10);
      const movedDate = new Date(`${today}T12:00:00Z`); movedDate.setUTCDate(movedDate.getUTCDate() + 2);
      const bundle = {
        schemaVersion: 1, status: "curated", checkedAt, timezone: "America/Argentina/Buenos_Aires",
        curation: { completeHorizon: { river: { from: today, through, complete: true }, ufc: { from: today, through, complete: true } } },
        events: [
          { kind: "football_match", sourceProvider: "espn", externalReference: "123456", title: "River Plate vs Boca Juniors", competition: "Liga", firstParticipant: "River Plate", secondParticipant: "Boca Juniors", eventDate: scheduled, startTime: "20:00", venue: "Monumental", status: "scheduled", source: { primary: "https://www.ligaprofesional.ar/", checkedAt } },
          { kind: "ufc_card", sourceProvider: "ufc_official", externalReference: "ufc-test-card", title: "UFC Test: Alpha vs Beta", eventDate: scheduled, preliminaryDate: scheduled, preliminaryTime: "18:00", mainCardDate: scheduled, mainCardTime: "21:00", fights: [{ firstFighter: "Alpha", secondFighter: "Beta", boutBlock: "main", isMainEvent: true }], source: { primary: "https://www.ufc.com/events", checkedAt, validation: { officialCardComplete: true, officialFightCount: 1, independentCrossCheck: "passed" } } },
        ],
      };
      assert.equal((await request(participant, "/api/sports/import", "POST", { mode: "preview", bundle })).status, 403);
      const preview = await ok(importer, "/api/sports/import", "POST", { mode: "preview", bundle });
      assert.equal(preview.summary.riverMatches, 1);
      assert.equal(preview.summary.ufcCards, 1);
      const result = await ok(importer, "/api/sports/import", "POST", { mode: "import", bundle });
      assert.equal(result.river[0], "inserted");
      assert.equal(result.ufc[0], "inserted");
      let river = (await pool.query("SELECT id FROM sports_events WHERE family_id=$1 AND kind='football_match' AND external_reference='123456'", [importFamily])).rows[0];
      let ufc = (await pool.query("SELECT id FROM sports_events WHERE family_id=$1 AND kind='ufc_card' AND external_reference='ufc-test-card'", [importFamily])).rows[0];
      await ok(participant, `/api/sports/events/${river.id}/formation`, "PUT", { body: "4-3-3" });
      await ok(participant, "/api/sports/comments", "POST", { contextKind: "river_match", contextEventId: river.id, body: "Conservar esta charla" });
      await ok(importer, `/api/sports/events/${ufc.id}`, "PATCH", { action: "hide" });

      bundle.checkedAt = new Date(Date.now() + 1_000).toISOString();
      for (const event of bundle.events) {
        event.source.checkedAt = bundle.checkedAt;
        event.eventDate = movedDate.toISOString().slice(0, 10);
        if (event.kind === "football_match") { event.externalReference = "123457"; event.title = "River Plate vs Boca Juniors reprogramado"; }
        else { event.externalReference = "ufc-test-card-moved"; event.title = "UFC Test reprogramado: Alpha vs Beta"; event.preliminaryDate = event.eventDate; event.mainCardDate = event.eventDate; }
      }
      const updated = await ok(importer, "/api/sports/import", "POST", { mode: "import", bundle });
      assert.equal(updated.river[0], "updated");
      assert.equal(updated.ufc[0], "updated");
      const riverAfter = (await pool.query("SELECT id FROM sports_events WHERE family_id=$1 AND kind='football_match' AND external_reference='123457'", [importFamily])).rows[0];
      const ufcAfter = (await pool.query("SELECT id,hidden FROM sports_events WHERE family_id=$1 AND kind='ufc_card' AND external_reference='ufc-test-card-moved'", [importFamily])).rows[0];
      assert.equal(riverAfter.id, river.id);
      assert.equal(ufcAfter.id, ufc.id);
      assert.equal(ufcAfter.hidden, true);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM sports_formations WHERE event_id=$1", [river.id])).rows[0].count, 1);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM sports_comments WHERE context_event_id=$1", [river.id])).rows[0].count, 1);
      assert.deepEqual((await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE id=$1", [champions.event])).rows[0].record, championBefore);
      bundle.events[0].externalReference = "771234991";
      const conflict = await request(importer, "/api/sports/import", "POST", { mode: "import", bundle });
      assert.equal(conflict.status, 409);
      assert.deepEqual((await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE id=$1", [champions.event])).rows[0].record, championBefore);
    });

    await t.test("UFC import respects single closure from 0037", async (t) => {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const date = (offset) => {
        const value = new Date(`${today}T12:00:00Z`);
        value.setUTCDate(value.getUTCDate() + offset);
        return value.toISOString().slice(0, 10);
      };
      const makeBundle = (externalReference, eventDate) => {
        const checkedAt = new Date().toISOString();
        return {
          schemaVersion: 1, status: "curated", checkedAt, timezone: "America/Argentina/Buenos_Aires",
          curation: { completeHorizon: { river: { from: today, through: date(20), complete: true }, ufc: { from: today, through: date(20), complete: true } } },
          events: [
            { kind: "football_match", sourceProvider: "espn", externalReference: "990000000001", title: "River Plate vs Boca Juniors", competition: "Liga", firstParticipant: "River Plate", secondParticipant: "Boca Juniors", eventDate, startTime: "20:00", venue: "Monumental", status: "scheduled", source: { primary: "https://www.ligaprofesional.ar/", checkedAt } },
            { kind: "ufc_card", sourceProvider: "ufc_official", externalReference, title: `UFC single closure ${externalReference}`, eventDate, preliminaryDate: eventDate, preliminaryTime: "18:00", mainCardDate: eventDate, mainCardTime: "21:00", fights: [{ firstFighter: "Closure Alpha", secondFighter: "Closure Beta", boutBlock: "main", isMainEvent: true }], source: { primary: "https://www.ufc.com/events", checkedAt, validation: { officialCardComplete: true, officialFightCount: 1, independentCrossCheck: "passed" } } },
          ],
        };
      };
      const createClosedCard = async (externalReference) => {
        const familyId = await family(), importer = await identity(familyId, "administrator");
        const bundle = makeBundle(externalReference, date(1));
        const imported = await ok(importer, "/api/sports/import", "POST", { mode: "import", bundle });
        assert.equal(imported.ufc[0], "inserted");
        const { rows: [event] } = await pool.query("SELECT id FROM sports_events WHERE family_id=$1 AND kind='ufc_card' AND external_reference=$2", [familyId, externalReference]);
        await pool.query("UPDATE sports_events SET main_card_starts_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [event.id]);
        const { rows: [closed] } = await pool.query("SELECT ufc_prediction_closed_at FROM sports_events WHERE id=$1", [event.id]);
        assert.ok(closed.ufc_prediction_closed_at, "0037 must persist the single UFC close on sports_events");
        assert.equal((await pool.query("SELECT count(*)::int AS count FROM sports_block_closures WHERE family_id=$1 AND event_id=$2", [familyId, event.id])).rows[0].count, 0, "the single-close path must not require a block-closure row");
        return { familyId, importer, event, bundle };
      };

      await t.test("closed card is excluded from equivalents", async () => {
        const { familyId, importer, event } = await createClosedCard("ufc-single-close-equivalent");
        const incoming = makeBundle("ufc-single-close-equivalent-new", date(1));
        const result = await ok(importer, "/api/sports/import", "POST", { mode: "import", bundle: incoming });
        assert.equal(result.ufc[0], "inserted");
        assert.equal((await pool.query("SELECT external_reference FROM sports_events WHERE id=$1", [event.id])).rows[0].external_reference, "ufc-single-close-equivalent");
        assert.equal((await pool.query("SELECT count(*)::int AS count FROM sports_events WHERE family_id=$1 AND kind='ufc_card'", [familyId])).rows[0].count, 2);
      });

      await t.test("date change of a closed card is rejected", async () => {
        const { importer, bundle } = await createClosedCard("ufc-single-close-reschedule");
        const rescheduled = makeBundle("ufc-single-close-reschedule", date(2));
        rescheduled.checkedAt = new Date(Date.now() + 1_000).toISOString();
        rescheduled.events[0].source.checkedAt = rescheduled.checkedAt;
        const response = await request(importer, "/api/sports/import", "POST", { mode: "import", bundle: rescheduled });
        assert.equal(response.status, 409);
        assert.match(response.body.error, /cartelera ya cerró/i);
        assert.equal((await pool.query("SELECT event_date::text AS event_date FROM sports_events WHERE external_reference='ufc-single-close-reschedule'", [])).rows[0].event_date, bundle.events[0].eventDate);
      });
    });

    await t.test("manual football agenda is private and members cannot edit it", async () => {
      assert.equal((await request(null, "/api/sports")).status, 403);
      const match = await ok(admin, "/api/sports", "POST", { kind: "football_match", title: "River Plate vs Boca", competition: "Liga", firstParticipant: "River Plate", secondParticipant: "Boca Juniors", eventDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), startTime: null });
      assert.equal((await request(peer, `/api/sports/events/${match.id}`, "PATCH", { title: "No" })).status, 403);
      assert.equal((await request(peer, "/api/sports", "POST", { kind: "football_match" })).status, 403);
      assert.equal((await ok(peer, "/api/sports")).football.length, 1);
      assert.equal((await ok(outsider, "/api/sports")).football.length, 0);
      assert.ok([403, 404].includes((await request(outsider, `/api/sports/events/${match.id}`, "PATCH", {})).status), "a different family cannot access or mutate the event");
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
    await t.test("formations replace only the caller's entry; dates and hiding preserve family data", async () => {
      const path = `/api/sports/events/${match.id}/formation`;
      assert.equal((await request(null, path, "PUT", { body: "4-3-3" })).status, 403);
      await ok(owner, path, "PUT", { body: "4-3-3: primer once" });
      await ok(owner, path, "PUT", { body: "4-4-2: mi nuevo once" });
      await ok(peer, path, "PUT", { body: "3-5-2: otro once", memberId: owner.id });
      const formations = (await ok(owner, "/api/sports")).formations;
      assert.equal(formations.length, 2);
      assert.equal(formations.find(item => item.memberId === owner.id).body, "4-4-2: mi nuevo once");
      assert.equal((await request(owner, path, "PUT", { body: "a".repeat(501) })).status, 400);
      assert.equal((await request(outsider, path, "PUT", { body: "once ajeno" })).status, 404);
      assert.equal((await request(outsider, path, "DELETE")).status, 404);
      await ok(peer, path, "DELETE");
      assert.equal((await ok(owner, "/api/sports")).formations.length, 1);
      await ok(owner, "/api/sports/comments", "POST", { contextKind: "river_match", contextEventId: match.id, body: "Conservar al reprogramar" });
      await ok(admin, `/api/sports/events/${match.id}`, "PATCH", { title: "River Plate vs Boca", competition: "Liga", firstParticipant: "River Plate", secondParticipant: "Boca", eventDate: null, status: "postponed", venue: "Monumental" });
      const page = await ok(owner, "/api/sports");
      assert.equal(page.football[0].id, match.id);
      assert.equal(page.football[0].eventDate, null);
      assert.equal(page.football[0].venue, "Monumental");
      assert.equal(page.formations.length, 1);
      assert.equal((await ok(owner, `/api/sports/comments?contextKind=river_match&eventId=${match.id}`)).comments.length, 1);
      await assert.rejects(pool.query("DELETE FROM sports_events WHERE id=$1", [match.id]), error => ["23503", "23001"].includes(error.code) && ["sports_formations_event_id_sports_events_id_fk", "sports_comments_context_event_id_sports_events_id_fk", "sports_fights_event_id_sports_events_id_fk"].includes(error.constraint));
      await assert.rejects(pool.query("INSERT INTO sports_formations(family_id,event_id,member_id,body) VALUES($1,$2,$3,'duplicate')", [familyId,match.id,owner.id]), error => error.code === "23505");
      assert.equal((await request(peer, `/api/sports/events/${match.id}`, "PATCH", { action: "hide" })).status, 403);
      await ok(admin, `/api/sports/events/${match.id}`, "PATCH", { action: "hide" });
      assert.equal((await ok(owner, "/api/sports")).football.length, 0);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM sports_formations WHERE event_id=$1", [match.id])).rows[0].count, 1);
      assert.equal((await ok(owner, `/api/sports/comments?contextKind=river_match&eventId=${match.id}`)).comments.length, 1);
      assert.equal((await request(admin, `/api/sports/events/${match.id}`, "DELETE")).status, 405);
    });

    await t.test("weekly UFC marker is manual, private, and cleared by card creation", async () => {
      assert.equal((await request(peer, "/api/sports/week", "PUT", { noUfcEvent: true })).status, 403);
      await ok(admin, "/api/sports/week", "PUT", { noUfcEvent: true });
      assert.equal((await ok(owner, "/api/sports")).noUfcEvent, true);
      assert.equal((await ok(outsider, "/api/sports")).noUfcEvent, false);
      const data = { kind: "ufc_card", title: "UFC semanal", eventDate: contextDate, preliminaryDate: contextDate, preliminaryTime: "20:00", mainCardDate: contextDate, mainCardTime: "23:00", fights: [{ firstFighter: "Uno", secondFighter: "Dos", boutBlock: "main", isMainEvent: true }] };
      const card = await ok(admin, "/api/sports", "POST", data);
      let page = await ok(owner, "/api/sports");
      assert.equal(page.noUfcEvent, false);
      assert.equal(page.card.id, card.id);
      assert.equal(page.fights.length, 1);
      await ok(owner, "/api/sports/comments", "POST", { contextKind: "ufc_card", contextEventId: card.id, body: "La estelar" });
      await assert.rejects(pool.query("DELETE FROM sports_events WHERE id=$1", [card.id]), error => ["23503", "23001"].includes(error.code) && ["sports_formations_event_id_sports_events_id_fk", "sports_comments_context_event_id_sports_events_id_fk", "sports_fights_event_id_sports_events_id_fk"].includes(error.constraint));
      // Multiple cards coexist; creating a future card does not remove this week's card/comments.
      const future = new Date(`${contextDate}T12:00:00Z`); future.setUTCDate(future.getUTCDate() + 14);
      await ok(admin, "/api/sports", "POST", { ...data, eventDate: future.toISOString().slice(0,10), title: "Otra semana" });
      page = await ok(owner, "/api/sports");
      assert.equal(page.card.id, card.id);
      await ok(owner, "/api/sports/comments", "POST", { contextKind: "ufc_card", contextEventId: card.id, body: "Sigue la conversación" });
      await ok(admin, "/api/sports/week", "PUT", { noUfcEvent: true });
      assert.equal((await ok(owner, "/api/sports")).card, null);
      await ok(admin, "/api/sports/week", "PUT", { noUfcEvent: false });
      assert.equal((await ok(owner, "/api/sports")).card.id, card.id);
      assert.equal((await ok(owner, `/api/sports/comments?contextKind=ufc_card&eventId=${card.id}`)).comments.length, 2);
    });

  } finally {
    server.kill();
    if (families.length) {
      await pool.query("DELETE FROM audit_events WHERE family_id=ANY($1::uuid[]) AND entity_type IN ('sports_event','sports_comment','sports_formation','sports_week')", [families]);
      for (const table of [...championsCleanupTables, "sports_formations", "sports_comments", "sports_fights", "sports_weeks", "sports_events"]) {
        await pool.query(`DELETE FROM ${table} WHERE family_id=ANY($1::uuid[])`, [families]);
      }
      for (const table of championsIdentityTables) await pool.query(`DELETE FROM ${table} WHERE family_id=ANY($1::uuid[])`, [families]);
      await pool.query("DELETE FROM families WHERE id=ANY($1::uuid[])", [families]);
    }
    if (users.length) await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [users]);
    await pool.end();
  }
});
