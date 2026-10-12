import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { familyDayInterval, getFamilyDay } from "../src/lib/tasks/family-day.ts";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("Isolated PostgreSQL required");
test("daily query indexes with ten years of representative records", { skip: !connectionString && "requires isolated PostgreSQL" }, async (t) => {
  const pool = new pg.Pool({ connectionString });
  const familyId = randomUUID(), memberId = randomUUID();
  try {
    await pool.query("INSERT INTO families(id,name) VALUES($1,'Query plan fixture')", [familyId]);
    await pool.query("INSERT INTO members(id,family_id,name,role) VALUES($1,$2,'Fixture','member')", [memberId, familyId]);
    await pool.query("INSERT INTO tasks(family_id,title,created_by_member_id,edited_by_member_id) SELECT $1,'Historical task',$2,$2 FROM generate_series(1,8)", [familyId, memberId]);
    const today = getFamilyDay();
    await pool.query(`INSERT INTO task_occurrences(task_id,family_id,due_date,generation_date,title_snapshot,assignment_mode_snapshot,status,completed_at)
      SELECT t.id,$1,$2::date - g,$2::date - g,'Snapshot','shared','completed',($2::date - g)::timestamp + interval '15 hours'
      FROM tasks t CROSS JOIN generate_series(0,3650) AS g WHERE t.family_id=$1`, [familyId, today]);
    const started = performance.now();
    await pool.query("INSERT INTO audit_events(family_id,entity_type,entity_id,action) SELECT $1,'occurrence',id,'edited' FROM task_occurrences WHERE family_id=$1", [familyId]);
    const insertMs = performance.now() - started;
    await pool.query("ANALYZE task_occurrences"); await pool.query("ANALYZE audit_events");
    const day = "2026-01-12";
    const interval = familyDayInterval(day);
    const explains = [];
    for (const [query, args, expectedIndex] of [
      ["SELECT id FROM task_occurrences WHERE family_id=$1 AND due_date=$2", [familyId, day], "occurrences_family_due_id_idx"],
      ["SELECT id FROM task_occurrences WHERE family_id=$1 AND status='completed' AND completed_at >= $2 AND completed_at < $3", [familyId, interval.startsAt, interval.endsAt], "occurrences_family_completed_id_idx"],
    ]) {
      const result = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, args);
      const plan = result.rows[0]["QUERY PLAN"][0];
      assert.match(JSON.stringify(plan), new RegExp(expectedIndex));
      explains.push({ index: expectedIndex, executionMs: plan["Execution Time"] });
    }
    const { rows: [occasion] } = await pool.query("SELECT id FROM task_occurrences WHERE family_id=$1 LIMIT 1", [familyId]);
    const auditPlan = await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT action FROM audit_events WHERE family_id=$1 AND entity_type='occurrence' AND entity_id=$2 AND action='edited'", [familyId, occasion.id]);
    assert.match(JSON.stringify(auditPlan.rows[0]), /audit_occurrence_cause_idx/);
    const sizes = (await pool.query("SELECT relname,pg_relation_size(oid) AS bytes FROM pg_class WHERE relname IN ('occurrences_family_due_id_idx','occurrences_family_completed_id_idx','audit_occurrence_cause_idx')")).rows;
    t.diagnostic(JSON.stringify({ records: 29208, insertAuditMs: Math.round(insertMs), explains, indexSizes: sizes }));
  } finally { await pool.query("DELETE FROM families WHERE id=$1", [familyId]); await pool.end(); }
});
