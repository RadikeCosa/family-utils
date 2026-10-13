import env from "@next/env";
import pg from "pg";
import { translateLegacy } from "../src/lib/meals/daily.ts";
env.loadEnvConfig(process.cwd());
const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED required");
const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 7000 });
const client = await pool.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const slots = (await client.query('SELECT id,family_id AS "familyId" FROM meal_slots')).rows;
  const profiles = (await client.query('SELECT id,family_id AS "familyId" FROM members WHERE archived_at IS NULL')).rows;
  const groups = (await client.query('SELECT id,slot_id AS "slotId",kind,follows_home AS "followsHome",suggestion_id AS "suggestionId",confirmed_by_member_id AS "confirmedByMemberId",confirmed_at AS "confirmedAt" FROM meal_groups')).rows;
  const suggestions = (await client.query('SELECT id,slot_id AS "slotId",title,note FROM meal_suggestions')).rows;
  const distributions = (await client.query('SELECT slot_id AS "slotId",participants FROM meal_distributions')).rows;
  const exceptions = (await client.query('SELECT slot_id AS "slotId",member_id AS "memberId",status,group_id AS "groupId" FROM meal_exceptions')).rows;
  const attendance = (await client.query('SELECT slot_id AS "slotId",member_id AS "memberId",status FROM meal_attendance')).rows;
  const selections = (await client.query('SELECT slot_id AS "slotId",suggestion_id AS "suggestionId",confirmed_by_member_id AS "confirmedByMemberId",confirmed_at AS "confirmedAt" FROM meal_selections')).rows;
  const summary = { slots: slots.length, compatible: 0, readOnly: 0, states: { home: 0, packed: 0, away: 0, unknown: 0 } };
  for (const slot of slots) {
    const selection = selections.find(s => s.slotId === slot.id), idea = suggestions.find(s => s.id === selection?.suggestionId);
    const result = translateLegacy({ memberIds: profiles.filter(p => p.familyId === slot.familyId).map(p => p.id), groups: groups.filter(g => g.slotId === slot.id), suggestions: suggestions.filter(s => s.slotId === slot.id), participants: distributions.find(d => d.slotId === slot.id)?.participants ?? exceptions.filter(e => e.slotId === slot.id), attendance: attendance.filter(a => a.slotId === slot.id), selection: selection && idea ? { ...selection, title: idea.title, note: idea.note } : null });
    summary[result.readOnly ? "readOnly" : "compatible"]++;
    for (const person of result.plan.people) summary.states[person.status]++;
  }
  console.log(JSON.stringify(summary));
  await client.query("ROLLBACK");
} finally { client.release(); await pool.end(); }
