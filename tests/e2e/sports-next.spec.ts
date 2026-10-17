import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import pg from "pg";
import { championsFixture, championsCleanupTables, championsIdentityTables } from "../helpers/champions";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
test.skip(!connectionString, "requires isolated PostgreSQL");
const baseURL = "http://localhost:3318";
let pool: pg.Pool,
  familyId: string,
  memberId: string,
  userId: string,
  championsId: string,
  api: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

function familyDay(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
function curatedBundle() {
  const day = familyDay();
  const throughDate = new Date(`${day}T12:00:00Z`);
  throughDate.setUTCDate(throughDate.getUTCDate() + 14);
  const through = familyDay(throughDate),
    checkedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    status: "curated",
    checkedAt,
    timezone: "America/Argentina/Buenos_Aires",
    curation: {
      completeHorizon: {
        river: { from: day, through, complete: true },
        ufc: { from: day, through, complete: true },
      },
    },
    events: [
      {
        kind: "football_match",
        sourceProvider: "espn",
        externalReference: "991234",
        title: "River Plate vs Boca Juniors",
        competition: "Liga Profesional",
        firstParticipant: "River Plate",
        secondParticipant: "Boca Juniors",
        eventDate: day,
        startTime: "20:15",
        venue: "Monumental",
        channel: "ESPN Premium",
        status: "scheduled",
        source: { primary: "https://www.ligaprofesional.ar/", checkedAt },
      },
      {
        kind: "ufc_card",
        sourceProvider: "ufc_official",
        externalReference: "ufc-test-night",
        title: "UFC Fight Night: Alpha vs Beta",
        eventDate: day,
        preliminaryDate: day,
        preliminaryTime: "18:00",
        mainCardDate: day,
        mainCardTime: "21:00",
        fights: [
          {
            firstFighter: "Alpha",
            secondFighter: "Beta",
            boutBlock: "main",
            isMainEvent: true,
          },
        ],
        source: {
          primary: "https://www.ufc.com/events",
          checkedAt,
          validation: {
            officialCardComplete: true,
            officialFightCount: 1,
            independentCrossCheck: "passed",
          },
        },
      },
    ],
  };
}

test.beforeEach(async ({ page }) => {
  pool = new pg.Pool({ connectionString });
  familyId = (
    await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [
      `sports-ui-${randomUUID()}`,
    ])
  ).rows[0].id;
  api = await playwrightRequest.newContext({ baseURL });
  const response = await api.post("/api/access/prepare", {
    headers: {
      Origin: baseURL,
      "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  userId = (await (await api.get("/api/auth/get-session")).json()).user.id;
  memberId = (
    await pool.query(
      "INSERT INTO members(family_id,name,role) VALUES($1,'Alex','administrator') RETURNING id",
      [familyId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)",
    [memberId, userId],
  );
  championsId = (await championsFixture(pool, familyId, memberId)).event;
  await page.context().addCookies((await api.storageState()).cookies);
});

test.afterEach(async () => {
  await api?.dispose();
  if (familyId) {
    await pool.query(
      "DELETE FROM audit_events WHERE family_id=$1 AND entity_type IN ('sports_event','sports_comment','sports_formation','sports_week','sports_import','sports_result')",
      [familyId],
    );
    // Test-only cleanup: production triggers intentionally prevent late vote deletion.
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query("SET LOCAL session_replication_role=replica");
      await cleanup.query("DELETE FROM sports_predictions WHERE family_id=$1", [familyId]);
      await cleanup.query("COMMIT");
    } finally { await cleanup.query("ROLLBACK"); cleanup.release(); }
    for (const table of [
      ...championsCleanupTables,
      "sports_predictions",
      "sports_fight_results",
      "sports_block_closures",
      "sports_football_results",
      "sports_formations",
      "sports_comments",
      "sports_fights",
      "sports_weeks",
      "sports_events",
    ])
      await pool.query(`DELETE FROM ${table} WHERE family_id=$1`, [familyId]);
    for (const table of championsIdentityTables) await pool.query(`DELETE FROM ${table} WHERE family_id=$1`, [familyId]);
    await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
  }
  if (userId) await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await pool?.end();
});

test("agenda: all events, independent drafts, templates and mobile accessibility", async ({
  page,
}) => {
  const before = await (await api.get(`/api/sports?event=${championsId}`)).json();
  expect(JSON.stringify(before)).not.toContain(championsId);
  expect((await api.patch(`/api/sports/events/${championsId}`, { data: { action: "hide" } })).status()).toBe(404);
  const hiddenResults = await (await api.get("/api/sports/templates?kind=results")).json();
  expect(JSON.stringify(hiddenResults)).not.toContain(championsId);
  const deniedResult = await api.post("/api/sports/results/import", { data: { mode: "preview", bundle: { version: 1, checkedAt: new Date().toISOString(), source: "Regression fixture", events: [{ eventId: championsId, result: { homeGoals: 1, awayGoals: 0 } }] } } });
  expect(deniedResult.status()).toBe(200);
  const deniedBody = await deniedResult.json();
  expect(deniedBody.events).toEqual([]);
  expect(deniedBody.errors).toHaveLength(1);
  const bundle = curatedBundle();
  const future = structuredClone(bundle.events[0]);
  future.externalReference = "991235";
  future.title = "River Plate vs Otro rival";
  future.secondParticipant = "Otro rival";
  const day = new Date(`${future.eventDate}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 7);
  future.eventDate = familyDay(day);
  bundle.events.push(future);
  expect(
    (
      await api.post("/api/sports/import", { data: { mode: "import", bundle } })
    ).status(),
  ).toBe(200);
  await page.goto("/deportes?sport=river");
  await expect(page.getByText("Champions sentinel", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Próximos \(2\)/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Contenido JSON").first()).toBeHidden();
  await page
    .getByLabel("Escribí un comentario")
    .fill("Mi borrador del primer partido");
  await page.getByRole("button", { name: /River Plate vs Otro rival/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "River Plate vs Otro rival",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Escribí un comentario").fill("Otro borrador");
  await page
    .getByRole("button", { name: /River Plate vs Boca Juniors/ })
    .click();
  await expect(page.getByLabel("Escribí un comentario")).toHaveValue(
    "Mi borrador del primer partido",
  );
  await page.getByText("Administrar", { exact: true }).click();
  await page
    .getByRole("button", { name: "Ver ejemplo", exact: true })
    .first()
    .click();
  await expect(page.getByText("Formato de referencia")).toBeVisible();
  const template = await api.get("/api/sports/templates");
  expect(template.status()).toBe(200);
  await pool.query(
    "INSERT INTO sports_auto_sync_settings(family_id,enabled) VALUES($1,true) ON CONFLICT(family_id) DO UPDATE SET enabled=true",
    [familyId],
  );
  const sync = await api.post("/api/sports/sync");
  expect(sync.status()).toBe(200);
  expect((await sync.json()).status).toBe("Automatización desactivada");
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "UFC", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "UFC Fight Night: Alpha vs Beta",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cartelera principal", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/sports-next-mobile.png",
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 1365, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/sports-next-desktop.png",
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "‹ Inicio", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "River", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(
    page.getByText("Cargando comentarios…", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/sports-next-preview.png" });
});

test("River results: preview, concurrency, corrections and idempotence", async ({
  page,
}) => {
  const bundle = curatedBundle();
  expect(
    (
      await api.post("/api/sports/import", { data: { mode: "import", bundle } })
    ).status(),
  ).toBe(200);
  const {
    rows: [match],
  } = await pool.query(
    "SELECT id FROM sports_events WHERE family_id=$1 AND kind='football_match' AND football_category='river'",
    [familyId],
  );
  const template = await (
    await api.get("/api/sports/templates?kind=results")
  ).json();
  expect(
    template.events.find((e: { eventId: string }) => e.eventId === match.id)
      .result,
  ).toBeNull();
  const result = {
    version: 1,
    checkedAt: new Date().toISOString(),
    source: "Fuente verificada",
    events: [{ eventId: match.id, result: { homeGoals: 2, awayGoals: 1 } }],
  };
  await pool.query("UPDATE members SET role='member' WHERE id=$1", [memberId]);
  expect(
    (
      await api.post("/api/sports/results/import", {
        data: { mode: "preview", bundle: result },
      })
    ).status(),
  ).toBe(403);
  await pool.query("UPDATE members SET role='administrator' WHERE id=$1", [
    memberId,
  ]);
  expect(
    (
      await api.post("/api/sports/results/import", {
        data: {
          mode: "preview",
          bundle: { ...result, events: [...result.events, ...result.events] },
        },
      })
    ).status(),
  ).toBe(400);
  const unknown = await (
    await api.post("/api/sports/results/import", {
      data: {
        mode: "preview",
        bundle: {
          ...result,
          events: [{ ...result.events[0], eventId: randomUUID() }],
        },
      },
    })
  ).json();
  expect(unknown.errors).toHaveLength(1);
  const preview = await (
    await api.post("/api/sports/results/import", {
      data: { mode: "preview", bundle: result },
    })
  ).json();
  expect(preview.events[0].after).toEqual({ homeGoals: 2, awayGoals: 1 });
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM sports_football_results WHERE family_id=$1",
        [familyId],
      )
    ).rows[0].n,
  ).toBe(0);
  await pool.query("UPDATE sports_events SET updated_at=now() WHERE id=$1", [
    match.id,
  ]);
  const stale = await (
    await api.post("/api/sports/results/import", {
      data: { mode: "import", bundle: result, token: preview.token },
    })
  ).json();
  expect(stale.errors).toHaveLength(1);
  expect(stale.imported).toBe(false);
  expect(stale.events).toHaveLength(0);
  async function apply() {
    const p = await (
      await api.post("/api/sports/results/import", {
        data: { mode: "preview", bundle: result },
      })
    ).json();
    const r = await (
      await api.post("/api/sports/results/import", {
        data: { mode: "import", bundle: result, token: p.token },
      })
    ).json();
    expect(r.errors).toHaveLength(0);
  }
  await apply();
  await apply();
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM audit_events WHERE family_id=$1 AND entity_type='sports_result'",
        [familyId],
      )
    ).rows[0].n,
  ).toBe(1);
  result.events[0].result.homeGoals = 3;
  await apply();
  expect(
    (
      await pool.query(
        "SELECT home_goals FROM sports_football_results WHERE event_id=$1",
        [match.id],
      )
    ).rows[0].home_goals,
  ).toBe(3);
  await api.post("/api/sports/import", { data: { mode: "import", bundle } });
  expect(
    (
      await pool.query("SELECT status,result FROM sports_events WHERE id=$1", [
        match.id,
      ])
    ).rows[0],
  ).toEqual({ status: "completed", result: "3–1" });
  await page.goto(`/deportes?sport=river&event=${match.id}`);
  await expect(
    page.getByText("Finalizado · 3–1", { exact: true }),
  ).toBeVisible();
});

test("UFC: private picks, stable fighters, cancellations, results and corrections", async ({
  page,
}) => {
  const bundle = curatedBundle();
  // Keep this scenario open regardless of the actual local time of the test run.
  const tomorrow = familyDay(new Date(Date.now() + 86400000));
  Object.assign(bundle.events[1], { eventDate: tomorrow, preliminaryDate: tomorrow, mainCardDate: tomorrow });
  const card = bundle.events[1] as {
    fights: Array<{
      firstFighter: string;
      secondFighter: string;
      boutBlock: string;
      isMainEvent: boolean;
    }>;
    source: { validation: { officialFightCount: number } };
  };
  card.fights.push(
    {
      firstFighter: "Gamma",
      secondFighter: "Delta",
      boutBlock: "preliminaries",
      isMainEvent: false,
    },
    {
      firstFighter: "Epsilon",
      secondFighter: "Zeta",
      boutBlock: "main",
      isMainEvent: false,
    },
  );
  card.source.validation.officialFightCount = 3;
  const importAgenda = async () => {
    const response = await api.post("/api/sports/import", {
      data: { mode: "import", bundle },
    });
    return response;
  };
  expect((await importAgenda()).status()).toBe(200);
  const {
    rows: [event],
  } = await pool.query(
    "SELECT id FROM sports_events WHERE family_id=$1 AND kind='ufc_card'",
    [familyId],
  );
  await pool.query(
    "UPDATE sports_events SET main_card_starts_at=clock_timestamp()+interval '1 hour',preliminary_starts_at=clock_timestamp()+interval '30 minutes' WHERE id=$1",
    [event.id],
  );
  const endpoint = `/api/sports/events/${event.id}/predictions`;
  let view = await (await api.get(endpoint)).json();
  const main = view.fights.find(
    (f: { firstFighter: string }) => f.firstFighter === "Alpha",
  );
  const prelim = view.fights.find(
    (f: { firstFighter: string }) => f.firstFighter === "Gamma",
  );
  const other = view.fights.find(
    (f: { firstFighter: string }) => f.firstFighter === "Epsilon",
  );
  const {
    rows: [bea],
  } = await pool.query(
    "INSERT INTO members(family_id,name,role) VALUES($1,'Bea','member') RETURNING id",
    [familyId],
  );
  await pool.query(
    "INSERT INTO sports_predictions(family_id,event_id,fight_id,member_id,winner_id) VALUES($1,$2,$3,$4,$5)",
    [familyId, event.id, main.id, bea.id, main.secondFighterId],
  );
  expect(
    (
      await api.put(endpoint, {
        data: {
          fightId: main.id,
          winnerId: main.firstFighterId,
          memberId: bea.id,
        },
      })
    ).status(),
  ).toBe(200);
  view = await (await api.get(endpoint)).json();
  expect(
    view.fights.every((f: { choices: unknown[] }) => f.choices.length === 0),
  ).toBe(true);
  expect(
    (
      await api.put(endpoint, {
        data: { fightId: prelim.id, winnerId: prelim.firstFighterId },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await api.put(endpoint, {
        data: { fightId: randomUUID(), winnerId: main.firstFighterId },
      })
    ).status(),
  ).toBe(409);
  async function results(entries: unknown[], confirm = true) {
    const result = {
      version: 1,
      source: "Fuente oficial revisada",
      checkedAt: new Date().toISOString(),
      events: [{ eventId: event.id, fights: entries }],
    };
    const preview = await (
      await api.post("/api/sports/results/import", {
        data: { mode: "preview", bundle: result },
      })
    ).json();
    if (!confirm) return { preview, result };
    const response = await (
      await api.post("/api/sports/results/import", {
        data: { mode: "import", bundle: result, token: preview.token },
      })
    ).json();
    expect(response.errors).toHaveLength(0);
    return { preview, result };
  }
  const early = await results(
    [
      {
        fightId: main.id,
        result: { outcome: "winner", winnerId: main.firstFighterId },
      },
    ],
    false,
  );
  expect(early.preview.errors).toHaveLength(1);
  await results([
    { fightId: prelim.id, result: { outcome: "cancelled", winnerId: null } },
  ]);
  card.fights[0] = {
    ...card.fights[0],
    firstFighter: "Beta",
    secondFighter: "Alpha",
  };
  expect((await importAgenda()).status()).toBe(200);
  view = await (await api.get(endpoint)).json();
  const reversed = view.fights.find((f: { id: string }) => f.id === main.id);
  expect(reversed.secondFighterId).toBe(main.firstFighterId);
  expect(reversed.ownWinnerId).toBe(main.firstFighterId);
  expect(
    (
      await api.put(endpoint, {
        data: { fightId: other.id, winnerId: other.firstFighterId },
      })
    ).status(),
  ).toBe(200);
  card.fights[2].secondFighter = "Eta";
  expect((await importAgenda()).status()).toBe(200);
  view = await (await api.get(endpoint)).json();
  expect(
    view.fights.find((f: { id: string }) => f.id === other.id).removed,
  ).toBe(true);
  await pool.query(
    "UPDATE sports_events SET main_card_starts_at=now()-interval '1 minute' WHERE id=$1",
    [event.id],
  );
  view = await (await api.get(endpoint)).json();
  expect(
    view.fights.find((f: { id: string }) => f.id === main.id).choices,
  ).toHaveLength(2);
  expect(
    (
      await api.put(endpoint, {
        data: { fightId: main.id, winnerId: main.secondFighterId },
      })
    ).status(),
  ).toBe(409);
  expect((await importAgenda()).status()).toBe(200);
  view = await (await api.get(endpoint)).json();
  expect(view.fights.find((f: { id: string }) => f.id === main.id).closed).toBe(
    true,
  );
  card.fights[2].boutBlock = "preliminaries";
  expect((await importAgenda()).status()).toBe(200);
  const movedView = await (await api.get(endpoint)).json();
  expect(
    movedView.fights.find(
      (f: { firstFighter: string; removed: boolean }) =>
        f.firstFighter === "Epsilon" && !f.removed,
    ).closed,
  ).toBe(true);
  await results([
    {
      fightId: main.id,
      result: { outcome: "winner", winnerId: main.firstFighterId },
    },
  ]);
  view = await (await api.get(endpoint)).json();
  expect(
    view.ranking.find((r: { memberId: string }) => r.memberId === memberId)
      .points,
  ).toBe(1);
  expect(view.final).toBe(false);
  const corrected = await results([
    {
      fightId: main.id,
      result: { outcome: "winner", winnerId: main.secondFighterId },
    },
  ]);
  expect(corrected.preview.events[0].points).toHaveLength(2);
  view = await (await api.get(endpoint)).json();
  expect(
    view.ranking.find((r: { memberId: string }) => r.memberId === memberId)
      .points,
  ).toBe(0);
  expect(
    view.ranking.find((r: { memberId: string }) => r.memberId === bea.id)
      .points,
  ).toBe(1);
  const next = await results(
    [
      {
        fightId: main.id,
        result: { outcome: "winner", winnerId: main.firstFighterId },
      },
    ],
    false,
  );
  const concurrent = await Promise.all(
    [1, 2].map(() =>
      api
        .post("/api/sports/results/import", {
          data: {
            mode: "import",
            bundle: next.result,
            token: next.preview.token,
          },
        })
        .then((r) => r.json()),
    ),
  );
  expect(concurrent.map((r) => r.errors.length).sort()).toEqual([0, 1]);
  const remaining = view.fights.find(
    (f: { firstFighter: string; removed: boolean }) =>
      f.firstFighter === "Epsilon" && !f.removed,
  );
  await results([
    {
      fightId: remaining.id,
      result: { outcome: "no_contest", winnerId: null },
    },
  ]);
  view = await (await api.get(endpoint)).json();
  expect(view.final).toBe(true);
  card.fights[0].secondFighter = "Replacement";
  expect((await importAgenda()).status()).toBe(409);
  await page.goto(`/deportes?sport=ufc&event=${event.id}`);
  await expect(
    page.getByRole("heading", {
      name: "Tabla de la cartelera · Final",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});


test("UFC: one closure reveals all picks, rejects a stale screen and excludes later additions", async ({ page }) => {
  const event = (await pool.query(`INSERT INTO sports_events(family_id,kind,title,event_date,preliminary_starts_at,main_card_starts_at,is_current,created_by_member_id,updated_by_member_id)
    VALUES($1,'ufc_card','UFC: Cierre único',CURRENT_DATE,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '3 hours',true,$2,$2) RETURNING id`, [familyId, memberId])).rows[0];
  const fights = [];
  for (const [order, first, second, block] of [[1, 'Cody Chovancek', 'SuYoung You', 'preliminaries'], [2, 'Alpha', 'Beta', 'main']] as const) {
    fights.push((await pool.query(`INSERT INTO sports_fights(family_id,event_id,bout_order,first_fighter,second_fighter,bout_block,is_main_event)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [familyId, event.id, order, first, second, block, block === 'main'])).rows[0]);
  }
  const peer = (await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,'Peer with private choice','member') RETURNING id", [familyId])).rows[0];
  const endpoint = `/api/sports/events/${event.id}/predictions`;
  const beforePeerVote = await (await api.get(endpoint)).json();
  const agendaBeforePeerVote = await (await api.get(`/api/sports?event=${event.id}`)).json();
  await pool.query('INSERT INTO sports_predictions(family_id,event_id,fight_id,member_id,winner_id) VALUES($1,$2,$3,$4,$5)', [familyId, event.id, fights[1].id, peer.id, fights[1].second_fighter_id]);
  const open = await (await api.get(endpoint)).json();
  expect(open).toEqual(beforePeerVote);
  expect(await (await api.get(`/api/sports?event=${event.id}`)).json()).toEqual(agendaBeforePeerVote);
  expect(open.closed).toBe(false);
  expect(open.fights.every((f: { choices: unknown[]; closesAt: string }) => f.choices.length === 0 && f.closesAt === open.closesAt)).toBe(true);
  expect(open.chosen).toBe(0);
  expect(open.ranking.every((r: { points: number }) => r.points === 0)).toBe(true);
  // A missing first-block time disables all fights, including the main card.
  await pool.query('UPDATE sports_events SET preliminary_starts_at=NULL WHERE id=$1', [event.id]);
  expect((await api.put(endpoint, { data: { fightId: fights[1].id, winnerId: fights[1].first_fighter_id } })).status()).toBe(409);
  expect((await (await api.get(endpoint)).json()).fights.every((f: { choices: unknown[] }) => f.choices.length === 0)).toBe(true);
  await pool.query("UPDATE sports_events SET preliminary_starts_at=clock_timestamp()+interval '1 hour' WHERE id=$1", [event.id]);
  await page.goto(`/deportes?sport=ufc&event=${event.id}`);
  await expect(page.getByText(/Los pronósticos de toda la cartelera cierran/)).toBeVisible();
  const choose = page.getByRole('button', { name: 'Elegir a Alpha', exact: true });
  await expect(choose).toBeEnabled();
  await pool.query("UPDATE sports_events SET preliminary_starts_at=clock_timestamp()-interval '1 second' WHERE id=$1", [event.id]);
  await choose.click();
  await expect(page.getByRole('alert').filter({ hasText: 'La cartelera ya cerró. Tu cambio no se guardó.' })).toBeVisible();
  await expect(choose).toBeDisabled();
  const closed = await (await api.get(endpoint)).json();
  expect(closed.closed).toBe(true);
  expect(closed.fights.find((f: { id: string }) => f.id === fights[1].id).choices).toHaveLength(1);
  expect(closed.chosen).toBe(0);
  expect((await api.delete(endpoint, { data: { fightId: fights[1].id } })).status()).toBe(409);
  await pool.query("UPDATE sports_events SET preliminary_starts_at=clock_timestamp()+interval '1 day' WHERE id=$1", [event.id]);
  const added = (await pool.query(`INSERT INTO sports_fights(family_id,event_id,bout_order,first_fighter,second_fighter,bout_block,is_main_event)
    VALUES($1,$2,3,'New fighter','New opponent','main',false) RETURNING id,prode_eligible`, [familyId, event.id])).rows[0];
  expect(added.prode_eligible).toBe(false);
  const preserved = await (await api.get(endpoint)).json();
  expect(preserved.closesAt).toBe(closed.closesAt);
  expect(preserved.total).toBe(2);
  await page.reload();
  await expect(page.getByText('Agregada después del cierre · no puntúa')).toBeVisible();
});


test("UFC: partial result preview persists first closure and its confirmation stays valid", async () => {
  const event = (await pool.query(`INSERT INTO sports_events(family_id,kind,title,event_date,main_card_starts_at,is_current,created_by_member_id,updated_by_member_id)
    VALUES($1,'ufc_card','UFC: Resultados parciales',CURRENT_DATE,clock_timestamp()+interval '1 hour',true,$2,$2) RETURNING id`, [familyId, memberId])).rows[0];
  const fights = [];
  for (const order of [1, 2]) {
    fights.push((await pool.query(`INSERT INTO sports_fights(family_id,event_id,bout_order,first_fighter,second_fighter,bout_block,is_main_event)
      VALUES($1,$2,$3,$4,$5,'main',$6) RETURNING *`, [familyId, event.id, order, `First ${order}`, `Second ${order}`, order === 1])).rows[0]);
  }
  const endpoint = `/api/sports/events/${event.id}/predictions`;
  expect((await api.put(endpoint, { data: { fightId: fights[0].id, winnerId: fights[0].second_fighter_id } })).status()).toBe(200);
  // Make the closure part of the preview's base state. If the deadline crossed
  // between preview and confirmation, the signed state must correctly expire.
  await pool.query("UPDATE sports_events SET main_card_starts_at=clock_timestamp()-interval '1 second' WHERE id=$1", [event.id]);
  const bundle = { version: 1, checkedAt: new Date().toISOString(), source: 'Synthetic verified result', events: [{ eventId: event.id, fights: [{ fightId: fights[0].id, result: { outcome: 'winner', winnerId: fights[0].second_fighter_id } }] }] };
  const preview = await (await api.post('/api/sports/results/import', { data: { mode: 'preview', bundle } })).json();
  expect(preview.errors).toEqual([]);
  const saved = await (await api.post('/api/sports/results/import', { data: { mode: 'import', bundle, token: preview.token } })).json();
  expect(saved.errors).toEqual([]);
  const view = await (await api.get(endpoint)).json();
  expect(view.closed).toBe(true);
  expect(view.final).toBe(false);
  expect(view.ranking.find((r: { memberId: string }) => r.memberId === memberId).points).toBe(1);
  expect(view.fights.find((f: { id: string }) => f.id === fights[1].id).result).toBeNull();
});
