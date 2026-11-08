import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString)
  throw Error("FAMILY_UTILS_TEST_DATABASE_URL required");
async function start(port, flag) {
  const origin = `http://localhost:${port}`;
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: connectionString,
        LIBRARY_ENABLED: "true",
        LIBRARY_AVAILABILITY_ENABLED: String(flag),
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: "availability-test-only-secret-not-production",
        CODE_PEPPER: "availability-test-only-pepper-not-production",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stderr.on("data", (data) => process.stderr.write(data));
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw Error("server failed");
    try {
      if ((await fetch(origin)).ok) return { server, origin };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  server.kill();
  throw Error("server timeout");
}
test(
  "availability HTTP gates, per-family authorization, preview and immutable commit",
  {
    skip: !connectionString && "isolated PostgreSQL required",
    timeout: 120000,
  },
  async () => {
    const disabled = await start(3350, false);
    try {
      for (const [path, method] of [
        ["platforms", "GET"],
        ["platforms", "POST"],
        ["platforms", "PATCH"],
        ["availability/preview", "POST"],
        ["availability/commit", "POST"],
        [`${randomUUID()}/availability`, "GET"],
      ])
        assert.equal(
          (await fetch(`${disabled.origin}/api/library/${path}`, { method }))
            .status,
          404,
        );
    } finally {
      disabled.server.kill();
    }
    const { server, origin } = await start(3351, true),
      pool = new pg.Pool({ connectionString });
    let family, user;
    const req = async (path, method = "GET", body, cookie = "") => {
      const r = await fetch(`${origin}/api/library${path}`, {
        method,
        headers: {
          Cookie: cookie,
          Origin: origin,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: r.status,
        body: r.status === 304 ? null : await r.json(),
        etag: r.headers.get("etag"),
      };
    };
    try {
      assert.equal((await req("/platforms")).status, 403);
      const access = await fetch(`${origin}/api/access/prepare`, {
        method: "POST",
        headers: { Origin: origin, "x-forwarded-for": "198.51.100.221" },
      });
      assert.equal(access.status, 200, await access.clone().text());
      const cookie = access.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      user = (
        await fetch(`${origin}/api/auth/get-session`, {
          headers: { Cookie: cookie },
        }).then((r) => r.json())
      ).user.id;
      family = (
        await pool.query(
          "INSERT INTO families(name) VALUES('availability-http-test') RETURNING id",
        )
      ).rows[0].id;
      const member = (
        await pool.query(
          "INSERT INTO members(family_id,name,role) VALUES($1,'Test','administrator') RETURNING id",
          [family],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)",
        [member, user],
      );
      assert.equal(
        (await req("/platforms", "POST", { action: "initialize" }, cookie))
          .status,
        200,
      );
      let platform = (
        await req("/platforms", "GET", undefined, cookie)
      ).body.platforms.find((p) => p.name === "Netflix");
      const work = (
        await req(
          "",
          "POST",
          { title: "HTTP availability", creator: "Test", year: 2000 },
          cookie,
        )
      ).body.id;
      const movie = {
        workId: work,
        checks: [
          {
            platformId: platform.id,
            outcome: "completed",
            checkedOn: "2026-01-01",
            sourceUrls: ["https://example.org/ar"],
            offers: [],
          },
        ],
      };
      const payload = { schemaVersion: 1, country: "AR", movies: [movie] };
      assert.equal(
        (
          await req(
            "/availability/preview",
            "POST",
            { ...payload, bogus: true },
            cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await req(
            "/availability/preview",
            "POST",
            { ...payload, movies: [movie, movie] },
            cookie,
          )
        ).status,
        400,
      );
      const preview = (
        await req("/availability/preview", "POST", payload, cookie)
      ).body;
      assert.equal(
        (await req(`/${work}/availability`, "GET", undefined, cookie)).body
          .checks.length,
        0,
      );
      const args = {
        previewId: preview.previewId,
        proposalHash: preview.proposalHash,
        idempotencyKey: randomUUID(),
      };
      assert.equal(
        (
          await req(
            "/availability/commit",
            "POST",
            { ...args, proposalHash: "0".repeat(64) },
            cookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await req(
            "/availability/commit",
            "POST",
            { ...args, payload },
            cookie,
          )
        ).status,
        400,
      );
      const saved = await req("/availability/commit", "POST", args, cookie);
      assert.equal(saved.status, 200);
      assert.equal(saved.body.results[0].status, "applied");
      assert.deepEqual(
        (await req("/availability/commit", "POST", args, cookie)).body,
        saved.body,
      );
      const detail = (await req(`/${work}`, "GET", undefined, cookie)).body;
      assert.equal(detail.work.availability.checks.length, 1);
      assert.equal(detail.work.availability.checks[0].stale, true);
      const collection = await req("", "GET", undefined, cookie);
      assert.equal(collection.body.availabilitySummary.reviewed, 1);
      assert.equal(collection.body.availabilityDay.length, 10);
      assert.equal(
        (await req(`?platform=${randomUUID()}`, "GET", undefined, cookie))
          .status,
        400,
      );
      assert.equal(
        (await req("?free=wrong", "GET", undefined, cookie)).status,
        400,
      );
      const cached = await fetch(`${origin}/api/library`, {
        headers: { Cookie: cookie, "If-None-Match": collection.etag },
      });
      assert.equal(cached.status, 304);
      await pool.query("UPDATE members SET role='member' WHERE id=$1", [
        member,
      ]);
      assert.equal(
        (await req("/platforms", "POST", { action: "initialize" }, cookie))
          .status,
        403,
      );
      platform = (
        await req("/platforms", "GET", undefined, cookie)
      ).body.platforms.find((p) => p.name === "Netflix");
      assert.ok(platform);
    } finally {
      server.kill();
      if (family) {
        for (const table of [
          "library_availability_operations",
          "library_availability_proposals",
          "library_streaming_offers",
          "library_platform_checks",
          "streaming_platform_aliases",
          "streaming_platforms",
          "library_companions",
          "library_contributions",
          "library_personal",
          "library_works",
          "audit_events",
        ])
          await pool.query(`DELETE FROM ${table} WHERE family_id=$1`, [family]);
        await pool.query("DELETE FROM families WHERE id=$1", [family]);
      }
      if (user) await pool.query('DELETE FROM "user" WHERE id=$1', [user]);
      await pool.end();
    }
  },
);
