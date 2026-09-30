import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;

if (process.env.CI && !connectionString) {
  throw new Error("FAMILY_UTILS_TEST_DATABASE_URL is required in CI");
}

test("PostgreSQL access and family transaction invariants", { skip: !connectionString && "requires an isolated PostgreSQL test service" }, async (t) => {
  const pool = new pg.Pool({ connectionString });
  const suffix = randomUUID();
  const emailA = `it-${suffix}-a@family-utils.invalid`;
  const emailB = `it-${suffix}-b@family-utils.invalid`;
  let familyId;
  let adminA;
  let adminB;
  let childId;
  let authA;
  let authB;

  async function addCode(memberId, purpose, expiresAt) {
    const digest = randomBytes(32).toString("hex");
    const { rows: [row] } = await pool.query(
      `INSERT INTO access_codes (family_id, member_id, purpose, digest, expires_at, created_by_member_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [familyId, memberId, purpose, digest, expiresAt, adminA],
    );
    return { id: row.id, digest };
  }

  async function redeem(code, authUserId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM members WHERE id = $1 FOR UPDATE", [childId]);
      const { rows: [stored] } = await client.query("SELECT * FROM access_codes WHERE id = $1 FOR UPDATE", [code.id]);
      if (stored.consumed_at) {
        const sameIdentity = stored.consumed_by_auth_user_id === authUserId;
        await client.query("ROLLBACK");
        return sameIdentity ? "retry" : "used";
      }
      if (stored.revoked_at || new Date(stored.expires_at).getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      const { rowCount } = await client.query(
        `UPDATE access_codes SET consumed_at = now(), consumed_by_auth_user_id = $2
         WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [code.id, authUserId],
      );
      await client.query("COMMIT");
      return rowCount === 1 ? "consumed" : "used";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  try {
    const migration = await readFile(new URL("../drizzle/0006_swift_millenium_guard.sql", import.meta.url), "utf8");
    await pool.query(migration);
    await pool.query(migration);

    const { rows: [family] } = await pool.query("INSERT INTO families (name) VALUES ($1) RETURNING id", [`integration-${suffix}`]);
    familyId = family.id;
    const { rows: admins } = await pool.query(
      `INSERT INTO members (family_id, name, role, access_method, google_email)
       VALUES ($1, 'Admin A', 'administrator', 'google', $2), ($1, 'Admin B', 'administrator', 'google', $3) RETURNING id`,
      [familyId, emailA, emailB],
    );
    [adminA, adminB] = admins.map(({ id }) => id);
    const { rows: [child] } = await pool.query(
      "INSERT INTO members (family_id, name, role, access_method) VALUES ($1, 'Child', 'member', 'code') RETURNING id", [familyId],
    );
    childId = child.id;
    const { rows: users } = await pool.query(
      `INSERT INTO "user" (name, email, email_verified, is_anonymous)
       VALUES ('Device A', $1, false, true), ('Device B', $2, false, true) RETURNING id`,
      [emailA, emailB],
    );
    [authA, authB] = users.map(({ id }) => id);

    await t.test("one code has one winner under concurrent transactions; same identity may retry", async () => {
      const code = await addCode(childId, "invitation", new Date(Date.now() + 60_000));
      const results = await Promise.all([redeem(code, authA), redeem(code, authB)]);
      assert.equal(results.filter((result) => result === "consumed").length, 1);
      assert.equal(results.filter((result) => result === "used").length, 1);
      const winner = (await pool.query("SELECT consumed_by_auth_user_id FROM access_codes WHERE id = $1", [code.id])).rows[0].consumed_by_auth_user_id;
      assert.equal(await redeem(code, winner), "retry");
      assert.equal(await redeem(code, winner === authA ? authB : authA), "used");
    });

    await t.test("prepare does not consume a code and expiration is exclusive at the boundary", async () => {
      const code = await addCode(childId, "invitation", new Date(Date.now() + 60_000));
      let row = (await pool.query("SELECT consumed_at FROM access_codes WHERE id = $1", [code.id])).rows[0];
      assert.equal(row.consumed_at, null);
      const boundary = new Date();
      await pool.query("UPDATE access_codes SET expires_at = $2 WHERE id = $1", [code.id, boundary]);
      row = (await pool.query("SELECT expires_at <= $2 AS expired FROM access_codes WHERE id = $1", [code.id, boundary])).rows[0];
      assert.equal(row.expired, true);
    });

    await t.test("recovery invalidates every other pending code for the child", async () => {
      const recovery = await addCode(childId, "recovery", new Date(Date.now() + 60_000));
      const invitation = await addCode(childId, "invitation", new Date(Date.now() + 60_000));
      await pool.query("INSERT INTO member_devices (member_id, auth_user_id, label) VALUES ($1, $2, 'old device')", [childId, authA]);
      const token = randomUUID();
      await pool.query("INSERT INTO session (token, expires_at, user_id) VALUES ($1, now() + interval '1 day', $2)", [token, authA]);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM members WHERE id = $1 FOR UPDATE", [childId]);
        await client.query("UPDATE member_devices SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL", [childId]);
        await client.query("DELETE FROM session WHERE user_id = $1 AND user_id <> $2", [authA, authB]);
        await client.query("UPDATE access_codes SET revoked_at = now() WHERE member_id = $1 AND id <> $2 AND consumed_at IS NULL AND revoked_at IS NULL", [childId, recovery.id]);
        await client.query("UPDATE access_codes SET consumed_at = now(), consumed_by_auth_user_id = $2 WHERE id = $1", [recovery.id, authB]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      const state = (await pool.query("SELECT id, consumed_at, revoked_at FROM access_codes WHERE id = ANY($1::uuid[])", [[recovery.id, invitation.id]])).rows;
      assert.equal(state.find((row) => row.id === recovery.id).consumed_at === null, false);
      assert.notEqual(state.find((row) => row.id === invitation.id).revoked_at, null);
      assert.equal((await pool.query("SELECT revoked_at IS NOT NULL AS revoked FROM member_devices WHERE member_id = $1 AND auth_user_id = $2", [childId, authA])).rows[0].revoked, true);
      assert.equal((await pool.query("SELECT count(*) FROM session WHERE token = $1", [token])).rows[0].count, "0");
    });

    await t.test("daily cleanup removes only stale unlinked anonymous identities", async () => {
      const staleEmail = `stale-${suffix}@family-utils.invalid`;
      const { rows: [stale] } = await pool.query(
        `INSERT INTO "user" (name, email, is_anonymous, created_at, updated_at)
         VALUES ('Stale prepared session', $1, true, now() - interval '2 hours', now() - interval '2 hours') RETURNING id`, [staleEmail],
      );
      const token = randomUUID();
      await pool.query("INSERT INTO session (token, expires_at, user_id) VALUES ($1, now() + interval '1 day', $2)", [token, stale.id]);
      await pool.query(`
        WITH stale AS (
          SELECT u.id FROM "user" u
          WHERE u.is_anonymous = true AND u.created_at < now() - interval '1 hour'
            AND NOT EXISTS (SELECT 1 FROM member_devices d WHERE d.auth_user_id = u.id)
            AND u.id = $1
          LIMIT 100
        )
        DELETE FROM "user" u USING stale WHERE u.id = stale.id
      `, [stale.id]);
      assert.equal((await pool.query("SELECT count(*) FROM \"user\" WHERE id = $1", [stale.id])).rows[0].count, "0");
      assert.equal((await pool.query("SELECT count(*) FROM session WHERE token = $1", [token])).rows[0].count, "0");
    });

    await t.test("concurrent administrator archives leave one active administrator", async () => {
      async function archiveAdmin(memberId) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT id FROM families WHERE id = $1 FOR UPDATE", [familyId]);
          const count = Number((await client.query("SELECT count(*) FROM members WHERE family_id = $1 AND role = 'administrator' AND archived_at IS NULL", [familyId])).rows[0].count);
          if (count <= 1) { await client.query("ROLLBACK"); return false; }
          await client.query("UPDATE members SET archived_at = now(), version = version + 1 WHERE id = $1", [memberId]);
          await client.query("COMMIT");
          return true;
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      }
      const results = await Promise.all([archiveAdmin(adminA), archiveAdmin(adminB)]);
      assert.equal(results.filter(Boolean).length, 1);
      const count = Number((await pool.query("SELECT count(*) FROM members WHERE family_id = $1 AND role = 'administrator' AND archived_at IS NULL", [familyId])).rows[0].count);
      assert.equal(count, 1);
    });
  } finally {
    if (familyId) await pool.query("DELETE FROM families WHERE id = $1", [familyId]);
    if (authA || authB) await pool.query("DELETE FROM \"user\" WHERE id = ANY($1::text[])", [[authA, authB].filter(Boolean)]);
    await pool.end();
  }
});
