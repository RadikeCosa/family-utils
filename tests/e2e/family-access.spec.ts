import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";

test("an administrator shares an alternative code and the adult enters without Google", async ({ page, browser }) => {
  const databaseUrl = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
  test.skip(!databaseUrl, "requires an isolated PostgreSQL test database");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const recipient = await browser.newContext();
  const suffix = randomUUID();
  let familyId: string | undefined;
  const authIds: string[] = [];
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${suffix.slice(0, 4)}:1::1` });
    await page.goto("/acceso");
    const prepared = await page.evaluate(async () => {
      const response = await fetch("/api/access/prepare", { method: "POST" });
      return response.status;
    });
    expect(prepared).toBe(200);
    const actorSession = await page.request.get("/api/auth/get-session").then((r) => r.json());
    authIds.push(actorSession.user.id);
    familyId = (await pool.query("INSERT INTO families (name) VALUES ('Familia de prueba de códigos') RETURNING id")).rows[0].id;
    const actorId = (await pool.query("INSERT INTO members (family_id, name, role, access_method, google_email) VALUES ($1, 'Administrador de prueba', 'administrator', 'google', $2) RETURNING id", [familyId, `actor-${suffix}@family-utils.invalid`])).rows[0].id;
    await pool.query("INSERT INTO member_devices (member_id, auth_user_id, identity_kind) VALUES ($1, $2, 'anonymous')", [actorId, actorSession.user.id]);
    const targetEmail = `adult-${suffix}@family-utils.invalid`;
    const targetId = (await pool.query("INSERT INTO members (family_id, name, role, access_method, google_email) VALUES ($1, 'Alex de prueba', 'administrator', 'google', $2) RETURNING id", [familyId, targetEmail])).rows[0].id;
    const googleAuthId = (await pool.query('INSERT INTO "user" (name, email, email_verified, is_anonymous) VALUES ($1, $2, true, false) RETURNING id', ["Adulto de prueba", targetEmail])).rows[0].id;
    authIds.push(googleAuthId);
    await pool.query("INSERT INTO member_devices (member_id, auth_user_id, identity_kind) VALUES ($1, $2, 'google')", [targetId, googleAuthId]);
    await page.goto("/familia");
    await expect(page.getByText("Entra con Google", { exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Generar código alternativo", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Código para Alex de prueba", exact: true })).toBeVisible();
    await expect(page.getByText("Entrá con este código sin iniciar con Google.", { exact: false })).toBeVisible();
    const code = await page.locator("strong").filter({ hasText: /^[A-Z0-9]{5}-[A-Z0-9]{5}$/ }).innerText();
    await page.screenshot({ path: test.info().outputPath("adult-alternative-code.png"), fullPage: true });

    const recipientPage = await recipient.newPage();
    await recipientPage.setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${suffix.slice(0, 4)}:2::1` });
    const baseOrigin = new URL(page.url()).origin;
    await recipientPage.goto(`${baseOrigin}/acceso`);
    await recipientPage.getByLabel("Código de invitación o recuperación", { exact: true }).fill(code);
    await recipientPage.getByRole("button", { name: "Ingresar a la familia", exact: true }).click();
    await expect(recipientPage).toHaveURL(`${baseOrigin}/`);
    const recipientSession = await recipient.request.get(`${baseOrigin}/api/auth/get-session`).then((r) => r.json());
    authIds.push(recipientSession.user.id);
    expect(recipientSession.user.isAnonymous).toBe(true);
    const family = await recipient.request.get(`${baseOrigin}/api/family`).then((r) => r.json());
    expect(family.currentMemberId).toBe(targetId);
    expect(family.members.find((m: { id: string }) => m.id === targetId)).toMatchObject({
      role: "administrator", accessMethod: "google", googleEmail: targetEmail, hasGoogleAccess: true,
    });
  } finally {
    if (familyId) {
      const linked = await pool.query("SELECT auth_user_id FROM member_devices WHERE member_id IN (SELECT id FROM members WHERE family_id=$1)", [familyId]);
      authIds.push(...linked.rows.map((r) => r.auth_user_id));
      await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
    }
    if (authIds.length) await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[...new Set(authIds)]]);
    await recipient.close();
    await pool.end();
  }
});
