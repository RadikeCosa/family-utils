import assert from "node:assert/strict";
import test from "node:test";
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
