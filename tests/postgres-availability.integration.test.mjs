import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  AvailabilityStore,
  availabilitySummary,
  offerFilterSql,
} from "../src/lib/library/availability-store.ts";
import { familyDay } from "../src/lib/library/rules.ts";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString)
  throw Error("FAMILY_UTILS_TEST_DATABASE_URL required");
test(
  "availability transactions, normalization, constraints, previews and resumable per-movie commits",
  {
    skip: !connectionString && "isolated PostgreSQL required",
    timeout: 120000,
  },
  async () => {
    const admin = new pg.Pool({ connectionString });
    const db = `availability_${randomUUID().replaceAll("-", "")}`;
    let pool;
    try {
      await admin.query(`CREATE DATABASE "${db}"`);
      const url = new URL(connectionString);
      url.pathname = `/${db}`;
      pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
      await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
      async function actor(role = "administrator") {
        const family = (
          await pool.query(
            "INSERT INTO families(name) VALUES('availability-test') RETURNING id",
          )
        ).rows[0].id;
        const member = (
          await pool.query(
            "INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id",
            [family, "Test", role],
          )
        ).rows[0].id;
        const user = randomUUID();
        await pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
          user,
          "Availability",
          `${user}@example.test`,
        ]);
        await pool.query(
          "INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)",
          [member, user],
        );
        return { familyId: family, memberId: member, authUser: { id: user } };
      }
      const a = await actor(),
        b = await actor();
      const store = new AvailabilityStore(pool, a),
        other = new AvailabilityStore(pool, b);
      const create = async (title, year = 2000) =>
        (
          await pool.query(
            "INSERT INTO library_works(family_id,title,titulo_normalizado,kind,year,created_by_member_id,updated_by_member_id) VALUES($1,$2,lower($2),'movie',$3,$4,$4) RETURNING id",
            [a.familyId, title, year, a.memberId],
          )
        ).rows[0].id;
      const one = await create("Original", 1989),
        two = await create("Original", 2019),
        three = await create("Sin revisar");
      await store.initialize();
      assert.equal((await store.platforms()).platforms.length, 12);
      await store.initialize();
      assert.equal((await store.platforms()).platforms.length, 12);
      assert.equal((await other.platforms()).platforms.length, 0);
      let netflix = (await store.platforms()).platforms.find(
          (p) => p.name === "Netflix",
        ),
        plex = (await store.platforms()).platforms.find(
          (p) => p.name === "Plex",
        ),
        youtube = (await store.platforms()).platforms.find(
          (p) => p.requiresChannel,
        );
      const check = (p, offers = []) => ({
        platformId: p.id,
        outcome: "completed",
        checkedOn: familyDay(),
        sourceUrls: ["https://example.org/ar/source"],
        offers,
      });
      const offer = (mode = "subscription") => ({
        mode,
        sourceUrls: ["https://example.org/ar/source"],
        linkKind: "aggregator",
        url: "https://example.org/ar/movie",
        directVerifiedOn: null,
        channel: null,
      });
      const payload = (movies) => ({ schemaVersion: 1, country: "AR", movies });
      const movie = (workId, p = netflix, offers = [offer()]) => ({
        workId,
        checks: [check(p, offers)],
      });
      const commit = (p) =>
        store.commit({
          previewId: p.previewId,
          proposalHash: p.proposalHash,
          idempotencyKey: randomUUID(),
        });
      let p = await store.preview(payload([movie(one)]));
      assert.equal((await commit(p)).results[0].status, "rejected");
      assert.equal((await store.availability(one)).checks.length, 0);
      const editable = ({ version, ...p }) => ({
        ...p,
        expectedVersion: version,
      });
      netflix = await store.platform(
        {
          ...editable(netflix),
          coverage: "verified",
          coverageSources: ["https://example.org/ar/netflix"],
        },
        true,
      );
      plex = await store.platform(
        {
          ...editable(plex),
          coverage: "verified",
          coverageSources: ["https://example.org/ar/plex"],
        },
        true,
      );
      const nowNetflix = netflix;
      netflix = await store.platform(
        { ...editable(netflix), name: "Netflix Argentina" },
        true,
      );
      assert.ok(netflix.aliases.includes("Netflix"));
      assert.equal(netflix.id, nowNetflix.id);
      await assert.rejects(
        store.platform(
          {
            name: "netflix",
            aliases: [],
            modes: ["subscription"],
            coverage: "pending",
            coverageSources: [],
            requiresChannel: false,
          },
          false,
        ),
        (e) => e.code === "DUPLICATE",
      );
      const baseline = await pool.query(
        "SELECT to_jsonb(w) AS value FROM library_works w WHERE family_id=$1 ORDER BY id",
        [a.familyId],
      );
      const p1 = await store.preview(payload([movie(one)])),
        p2 = await store.preview(payload([movie(one)]));
      const concurrent = await Promise.all([commit(p1), commit(p2)]);
      assert.deepEqual(concurrent.map((r) => r.results[0].status).sort(), [
        "applied",
        "conflict",
      ]);
      assert.equal(
        (await store.availability(two)).checks.length,
        0,
        "remake is independent",
      );
      const key = randomUUID();
      p = await store.preview(payload([movie(two)]));
      const args = {
        previewId: p.previewId,
        proposalHash: p.proposalHash,
        idempotencyKey: key,
      };
      const first = await store.commit(args);
      assert.deepEqual(await store.commit(args), first);
      const different = await store.preview(payload([movie(three)]));
      await assert.rejects(
        store.commit({
          ...args,
          previewId: different.previewId,
          proposalHash: different.proposalHash,
        }),
        (e) => e.code === "IDEMPOTENCY_CONFLICT",
      );
      await assert.rejects(
        store.commit({ ...args, proposalHash: "0".repeat(64) }),
        (e) => e.code === "HASH_MISMATCH",
      );
      await assert.rejects(
        pool.query(
          "UPDATE library_availability_proposals SET payload='[]' WHERE id=$1",
          [p.previewId],
        ),
        { code: "23514" },
      );
      const expired = (
        await pool.query(
          "INSERT INTO library_availability_proposals(family_id,member_id,proposal_hash,payload,created_at,expires_at) SELECT family_id,member_id,proposal_hash,payload,now()-interval '2 days',now()-interval '1 day' FROM library_availability_proposals WHERE id=$1 RETURNING id",
          [p.previewId],
        )
      ).rows[0].id;
      await assert.rejects(
        store.commit({
          ...args,
          previewId: expired,
          idempotencyKey: randomUUID(),
        }),
        (e) => e.code === "EXPIRED",
      );
      // One conflict must not roll back the other movie in the same proposal.
      p = await store.preview(
        payload([
          movie(one, plex, [offer("free_with_ads")]),
          movie(three, plex, [offer("free_with_ads")]),
        ]),
      );
      await commit(
        await store.preview(
          payload([movie(one, plex, [offer("free_with_ads")])]),
        ),
      );
      const batch = await commit(p);
      assert.deepEqual(
        batch.results.map((r) => r.status),
        ["conflict", "applied"],
      );
      const client = await pool.connect();
      try {
        const condition = offerFilterSql("$2", true);
        assert.equal(
          (
            await client.query(
              `SELECT w.id FROM library_works w WHERE w.family_id=$1 AND ${condition}`,
              [a.familyId, [netflix.id]],
            )
          ).rows.length,
          0,
          "free must match selected platform",
        );
        assert.equal(
          (
            await client.query(
              `SELECT w.id FROM library_works w WHERE w.family_id=$1 AND ${condition}`,
              [a.familyId, [netflix.id, plex.id]],
            )
          ).rows.length,
          2,
          "OR providers and AND free",
        );
        const summary = await availabilitySummary(client, a.familyId, false);
        assert.equal(summary.reviewed, 3);
        assert.equal(summary.total, 3);
      } finally {
        client.release();
      }
      // Failed/partial checks preserve previous offers and dates.
      const previous = await store.availability(one);
      p = await store.preview(
        payload([
          {
            workId: one,
            checks: [
              {
                platformId: netflix.id,
                outcome: "failed",
                reason: "Dynamic page unavailable",
                findings: "Unconfirmed result",
              },
            ],
          },
        ]),
      );
      assert.equal((await commit(p)).results[0].status, "unchanged");
      assert.deepEqual(await store.availability(one), previous);
      await assert.rejects(
        store.platform({ ...editable(netflix), coverage: "pending" }, true),
        (e) => e.code === "OFFERS_EXIST",
      );
      youtube = await store.platform(
        {
          ...editable(youtube),
          coverage: "verified",
          coverageSources: ["https://youtube.com/about"],
        },
        true,
      );
      p = await store.preview(payload([movie(two, youtube, [offer("free")])]));
      assert.ok(p.movies[0].errors.length);
      assert.equal((await commit(p)).results[0].status, "rejected");
      // Composite keys and modality uniqueness also hold outside application code.
      const checkId = (
        await pool.query(
          "SELECT id FROM library_platform_checks WHERE work_id=$1 AND platform_id=$2",
          [one, netflix.id],
        )
      ).rows[0].id;
      await assert.rejects(
        pool.query(
          "INSERT INTO library_streaming_offers(family_id,check_id,mode,source_urls,link_kind) VALUES($1,$2,'subscription',ARRAY['https://example.org'],'none')",
          [a.familyId, checkId],
        ),
        { code: "23505" },
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO library_platform_checks(family_id,work_id,platform_id,checked_on,source_urls,updated_by_member_id) VALUES($1,$2,$3,CURRENT_DATE,ARRAY['https://example.org'],$4)",
          [b.familyId, one, netflix.id, b.memberId],
        ),
        { code: "23503" },
      );
      assert.deepEqual(
        (
          await pool.query(
            "SELECT to_jsonb(w) AS value FROM library_works w WHERE family_id=$1 ORDER BY id",
            [a.familyId],
          )
        ).rows,
        baseline.rows,
        "metadata and activity unchanged",
      );
      const four = await create("Resume first"),
        five = await create("Resume second");
      p = await store.preview(payload([movie(four), movie(five)]));
      const resumeArgs = {
        previewId: p.previewId,
        proposalHash: p.proposalHash,
        idempotencyKey: randomUUID(),
      };
      await pool.query(
        `CREATE FUNCTION fail_availability_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated transient failure' USING ERRCODE='40001'; END; $$; CREATE TRIGGER fail_availability_test BEFORE INSERT ON library_platform_checks FOR EACH ROW WHEN (NEW.work_id='${five}'::uuid) EXECUTE FUNCTION fail_availability_test()`,
      );
      await assert.rejects(store.commit(resumeArgs), { code: "40001" });
      assert.equal((await store.availability(four)).checks.length, 1);
      assert.equal((await store.availability(five)).checks.length, 0);
      await pool.query(
        "DROP TRIGGER fail_availability_test ON library_platform_checks",
      );
      const resumed = await store.commit(resumeArgs);
      assert.deepEqual(
        resumed.results.map((r) => r.status),
        ["applied", "applied"],
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM audit_events WHERE entity_type='library_availability' AND entity_id=$1",
            [four],
          )
        ).rows[0].n,
        1,
      );
      const member = await actor("member");
      await assert.rejects(
        new AvailabilityStore(pool, member).initialize(),
        (e) => e.code === "NOT_ADMIN",
      );
      await pool.query(
        "UPDATE member_devices SET revoked_at=now() WHERE member_id=$1",
        [a.memberId],
      );
      await assert.rejects(store.commit(args), (e) => e.code === "NO_ACCESS");
    } finally {
      await pool?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      await admin.end();
    }
  },
);
