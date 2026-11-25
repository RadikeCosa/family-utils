import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");

let savepointIndex = 0;
async function expectSqlFailure(client, query, params, code) {
  const savepoint = `gallery_invalid_${savepointIndex++}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  await assert.rejects(client.query(query, params), error => error.code === code);
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
}

async function ensureTimedShareSchema(client, migration) {
  const { rows: [row] } = await client.query(`
    SELECT count(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name = ANY(ARRAY['gallery_shares','gallery_share_drawings','gallery_share_sessions'])
  `);
  if (row.count === 0) await client.query(migration);
  else assert.equal(row.count, 3, "timed-share tables must be created together");
}

test("gallery schema isolates authorship, family rows, hashes, and private invitation credentials", { skip: !connectionString, timeout: 30_000 }, async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    const familyId = (await client.query("INSERT INTO families(name) VALUES('Gallery integration fixture') RETURNING id")).rows[0].id;
    const otherFamilyId = (await client.query("INSERT INTO families(name) VALUES('Other gallery fixture') RETURNING id")).rows[0].id;
    const ownerId = (await client.query("INSERT INTO members(family_id,name) VALUES($1,'Author one') RETURNING id", [familyId])).rows[0].id;
    const otherAuthorId = (await client.query("INSERT INTO members(family_id,name) VALUES($1,'Author two') RETURNING id", [familyId])).rows[0].id;
    const outsiderId = (await client.query("INSERT INTO members(family_id,name) VALUES($1,'Outside author') RETURNING id", [otherFamilyId])).rows[0].id;
    const insertDrawing = (authorId, hash) => client.query(
      "INSERT INTO gallery_drawings(family_id,author_member_id,original_name,original_sha256,original_bytes,source_mime_type) VALUES($1,$2,'private.png',$3,100,'image/png') RETURNING id",
      [familyId, authorId, hash],
    );
    const drawingId = (await insertDrawing(ownerId, "a".repeat(64))).rows[0].id;
    const otherDrawingId = (await insertDrawing(otherAuthorId, "b".repeat(64))).rows[0].id;
    const collectionId = (await client.query(
      "INSERT INTO gallery_collections(family_id,owner_member_id,title) VALUES($1,$2,'Private collection') RETURNING id",
      [familyId, ownerId],
    )).rows[0].id;
    await client.query("INSERT INTO gallery_collection_drawings(family_id,owner_member_id,collection_id,drawing_id) VALUES($1,$2,$3,$4)", [familyId, ownerId, collectionId, drawingId]);
    await expectSqlFailure(client, "INSERT INTO gallery_collection_drawings(family_id,owner_member_id,collection_id,drawing_id) VALUES($1,$2,$3,$4)", [familyId, ownerId, collectionId, otherDrawingId], "23503");
    await expectSqlFailure(client, "INSERT INTO gallery_drawings(family_id,author_member_id,original_name,original_sha256,original_bytes,source_mime_type) VALUES($1,$2,'private.png',$3,100,'image/png')", [familyId, ownerId, "a".repeat(64)], "23505");
    await expectSqlFailure(client, "INSERT INTO gallery_drawings(family_id,author_member_id,original_name,original_bytes,source_mime_type) VALUES($1,$2,'outside.png',100,'image/png')", [familyId, outsiderId], "23503");

    const invitationId = (await client.query(
      "INSERT INTO gallery_invitations(family_id,owner_member_id,collection_id,created_by_member_id,token_hash,expires_at) VALUES($1,$2,$3,$2,$4,now()+interval '1 day') RETURNING id",
      [familyId, ownerId, collectionId, "c".repeat(64)],
    )).rows[0].id;
    await client.query(
      "INSERT INTO gallery_guest_sessions(family_id,collection_id,invitation_id,session_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')",
      [familyId, collectionId, invitationId, "d".repeat(64)],
    );
    await expectSqlFailure(client, "INSERT INTO gallery_guest_sessions(family_id,collection_id,invitation_id,session_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')", [otherFamilyId, collectionId, invitationId, "e".repeat(64)], "23503");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("all gallery tables are readable by the encrypted-backup role", { skip: !connectionString, timeout: 30_000 }, async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    const exists = (await client.query("SELECT 1 FROM pg_roles WHERE rolname='family_utils_backup_reader'")).rowCount > 0;
    if (!exists) await client.query("CREATE ROLE family_utils_backup_reader");
    const migration = await readFile(new URL("../drizzle/0070_gallery_backup_reader.sql", import.meta.url), "utf8");
    const timedSharesMigration = await readFile(new URL("../drizzle/0071_gallery_timed_shares.sql", import.meta.url), "utf8");
    await client.query(migration);
    await ensureTimedShareSchema(client, timedSharesMigration);
    await client.query(timedSharesMigration.slice(timedSharesMigration.lastIndexOf("DO $$")));
    const privileges = await client.query(`
      SELECT table_name, has_table_privilege('family_utils_backup_reader', format('public.%I', table_name), 'SELECT') AS can_read
      FROM unnest(ARRAY['gallery_drawings','gallery_collections','gallery_collection_drawings','gallery_invitations','gallery_guest_sessions','gallery_shares','gallery_share_drawings','gallery_share_sessions','audit_events']) AS table_name
    `);
    assert.equal(privileges.rowCount, 9);
    assert.ok(privileges.rows.every(row => row.can_read), "backup role must read every Gallery table");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("timed shares enforce family scoped snapshots and sessions", { skip: !connectionString, timeout: 30_000 }, async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    const migration = await readFile(new URL("../drizzle/0071_gallery_timed_shares.sql", import.meta.url), "utf8");
    await ensureTimedShareSchema(client, migration);
    const familyId = (await client.query("INSERT INTO families(name) VALUES('Timed share fixture') RETURNING id")).rows[0].id;
    const otherFamilyId = (await client.query("INSERT INTO families(name) VALUES('Other timed share fixture') RETURNING id")).rows[0].id;
    const memberId = (await client.query("INSERT INTO members(family_id,name) VALUES($1,'Share author') RETURNING id", [familyId])).rows[0].id;
    const otherMemberId = (await client.query("INSERT INTO members(family_id,name) VALUES($1,'Outside member') RETURNING id", [otherFamilyId])).rows[0].id;
    const drawingId = (await client.query(
      "INSERT INTO gallery_drawings(family_id,author_member_id,original_name,original_sha256,original_bytes,source_mime_type) VALUES($1,$2,'fake.png',$3,100,'image/png') RETURNING id",
      [familyId, memberId, "f".repeat(64)],
    )).rows[0].id;
    const otherDrawingId = (await client.query(
      "INSERT INTO gallery_drawings(family_id,author_member_id,original_name,original_sha256,original_bytes,source_mime_type) VALUES($1,$2,'other-fake.png',$3,100,'image/png') RETURNING id",
      [otherFamilyId, otherMemberId, "9".repeat(64)],
    )).rows[0].id;
    const shareId = (await client.query(
      "INSERT INTO gallery_shares(family_id,created_by_member_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour') RETURNING id",
      [familyId, memberId, "1".repeat(64)],
    )).rows[0].id;
    await client.query(
      "INSERT INTO gallery_share_drawings(share_id,family_id,author_member_id,drawing_id,position) VALUES($1,$2,$3,$4,0)",
      [shareId, familyId, memberId, drawingId],
    );
    await client.query(
      "INSERT INTO gallery_share_sessions(family_id,share_id,session_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [familyId, shareId, "2".repeat(64)],
    );
    await expectSqlFailure(client,
      "INSERT INTO gallery_share_drawings(share_id,family_id,author_member_id,drawing_id,position) VALUES($1,$2,$3,$4,1)",
      [shareId, otherFamilyId, otherMemberId, otherDrawingId], "23503");
    await expectSqlFailure(client,
      "INSERT INTO gallery_share_sessions(family_id,share_id,session_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [otherFamilyId, shareId, "3".repeat(64)], "23503");
    await client.query("DELETE FROM gallery_shares WHERE id=$1", [shareId]);
    assert.equal((await client.query("SELECT 1 FROM gallery_share_drawings WHERE share_id=$1", [shareId])).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM gallery_share_sessions WHERE share_id=$1", [shareId])).rowCount, 0);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
