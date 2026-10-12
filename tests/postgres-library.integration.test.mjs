import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL required");
test("library database constraints: tenant boundaries, Unicode and partial dates", { skip: !connectionString && "requires isolated PostgreSQL" }, async () => {
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: families } = await client.query("INSERT INTO families(name) VALUES('library-test-a'),('library-test-b') RETURNING id");
    const { rows: [member] } = await client.query("INSERT INTO members(family_id,name) VALUES($1,'Test') RETURNING id", [families[0].id]);
    const { rows: [outsider] } = await client.query("INSERT INTO members(family_id,name) VALUES($1,'Other') RETURNING id", [families[1].id]);
    const { rows: [work] } = await client.query("INSERT INTO library_works(family_id,title,titulo_normalizado,kind,created_by_member_id,updated_by_member_id) VALUES($1,$2,'test','movie',$3,$3) RETURNING id", [families[0].id, "😀".repeat(200), member.id]);
    async function rejected(sql, params, code) {
      await client.query("SAVEPOINT invalid_input");
      await assert.rejects(client.query(sql, params), (error) => error.code === code);
      await client.query("ROLLBACK TO SAVEPOINT invalid_input");
    }
    await rejected("UPDATE library_works SET title=$1 WHERE id=$2", ["😀".repeat(201), work.id], "23514");
    await rejected("INSERT INTO library_personal(family_id,work_id,member_id) VALUES($1,$2,$3)", [families[0].id, work.id, outsider.id], "23503");
    await client.query("INSERT INTO library_personal(family_id,work_id,member_id,rating) VALUES($1,$2,$3,5)", [families[0].id, work.id, member.id]);
    await rejected("INSERT INTO library_personal(family_id,work_id,member_id) VALUES($1,$2,$3)", [families[0].id, work.id, member.id], "23505");
    const insert = "INSERT INTO library_contributions(family_id,work_id,author_member_id,body,experience_year,experience_month,experience_day) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id";
    const args = [families[0].id, work.id, member.id, "😀".repeat(5000)];
    await client.query(insert, [...args, 2015, null, null]);
    await client.query(insert, [...args, 2024, 2, 29]);
    await rejected(insert, [...args, 2025, 2, 29], "23514");
    await rejected(insert, [...args, null, 2, null], "23514");
    const { rows: [contribution] } = await client.query(insert, [...args, null, null, null]);
    await rejected("INSERT INTO library_companions(family_id,contribution_id,member_id) VALUES($1,$2,$3)", [families[0].id, contribution.id, outsider.id], "23503");
    await client.query("INSERT INTO library_companions(family_id,contribution_id,member_id) VALUES($1,$2,$3)", [families[0].id, contribution.id, member.id]);
    await client.query("UPDATE library_contributions SET retired_at=now() WHERE id=$1", [contribution.id]);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM library_companions WHERE contribution_id=$1", [contribution.id])).rows[0].n, 1);
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
});
