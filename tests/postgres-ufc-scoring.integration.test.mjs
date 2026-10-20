import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { ufcFightPoints } from '../src/lib/sports/prediction-rules.ts';
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
const migrationsFolder = process.env.UFC_SCORING_MIGRATIONS_FOLDER ?? 'drizzle';
if (process.env.CI && !connectionString) throw Error('Isolated PostgreSQL required');
test('UFC scoring: cutoff, migration preservation, frozen roles and direct writes', { skip: !connectionString && 'requires isolated PostgreSQL', timeout: 60000 }, async t => {
 const admin = new pg.Pool({connectionString}), name=`scores_${randomUUID().replaceAll('-','')}`;
 const folder=await mkdtemp(join(tmpdir(),'ufc-scoring-')); let pool;
 try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const url=new URL(connectionString); url.pathname=`/${name}`; pool=new pg.Pool({connectionString:url.toString()});
  const journal=JSON.parse(await readFile(join(migrationsFolder,'meta/_journal.json'),'utf8'));
  const entries=journal.entries.slice(0,journal.entries.findIndex(e=>e.tag==='0052_ufc_scoring'));
  await mkdir(join(folder,'meta')); await writeFile(join(folder,'meta/_journal.json'),JSON.stringify({...journal,entries}));
  for(const entry of entries) await writeFile(join(folder,`${entry.tag}.sql`),await readFile(join(migrationsFolder,`${entry.tag}.sql`)));
  await migrate(drizzle(pool),{migrationsFolder:folder});
  const family=(await pool.query("INSERT INTO families(name) VALUES('Scoring isolated') RETURNING id")).rows[0].id;
  const member=(await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,'Player','administrator') RETURNING id",[family])).rows[0].id;
  const card=async date=>(await pool.query(`INSERT INTO sports_events(family_id,kind,title,event_date,main_card_starts_at,created_by_member_id,updated_by_member_id)
   VALUES($1,'ufc_card','Scoring fixture',$3,clock_timestamp()+interval '1 day',$2,$2) RETURNING *`,[family,member,date])).rows[0];
  const fight=async(event,order,main=false,first='A',second='B')=>(await pool.query(`INSERT INTO sports_fights(family_id,event_id,bout_order,bout_block,is_main_event,first_fighter,second_fighter)
   VALUES($1,$2,$3,'main',$4,$5,$6) RETURNING *`,[family,event,order,main,first,second])).rows[0];
  const state=async id=>(await pool.query('SELECT * FROM sports_events WHERE id=$1',[id])).rows[0];
  const points=async id=>ufcFightPoints((await pool.query('SELECT * FROM sports_fights WHERE event_id=$1 ORDER BY bout_order,id',[id])).rows,await state(id));
  const historical=await card('2026-10-16'), current=await card('2026-10-17');
  const rows=[];
  for (const c of [historical,current]) {
   const main=await fight(c.id,1,true),co=await fight(c.id,2),ordinary=await fight(c.id,3,false,'Cody Chovancek','SuYoung You'); rows.push([main,co,ordinary]);
   for(const f of [main,co,ordinary]) await pool.query('INSERT INTO sports_predictions(family_id,event_id,fight_id,member_id,winner_id) VALUES($1,$2,$3,$4,$5)',[family,c.id,f.id,member,f.second_fighter_id]);
   await pool.query("UPDATE sports_events SET main_card_starts_at=clock_timestamp()-interval '1 second' WHERE id=$1",[c.id]);
   for(const f of [main,co,ordinary]) await pool.query("INSERT INTO sports_fight_results(family_id,event_id,fight_id,outcome,winner_id,source,checked_at,updated_by_member_id) VALUES($1,$2,$3,'winner',$4,'fixture',clock_timestamp(),$5)",[family,c.id,f.id,f.second_fighter_id,member]);
  }
  const votes=(await pool.query('SELECT * FROM sports_predictions ORDER BY id')).rows;
  const results=(await pool.query('SELECT * FROM sports_fight_results ORDER BY fight_id')).rows;
  await migrate(drizzle(pool),{migrationsFolder});
  await t.test('backfill keeps every vote, result, historical point and SuYoung You winner',async()=>{
   assert.deepEqual((await pool.query('SELECT * FROM sports_predictions ORDER BY id')).rows,votes);
   assert.deepEqual((await pool.query('SELECT * FROM sports_fight_results ORDER BY fight_id')).rows,results);
   assert.equal((await state(historical.id)).ufc_scoring_version,1); assert.equal((await state(current.id)).ufc_scoring_version,2);
   assert.deepEqual([...await points(historical.id)].map(([,p])=>p),[1,1,1]);
   assert.deepEqual([...await points(current.id)].map(([,p])=>p),[5,3,1]);
   assert.equal(results.find(r=>r.fight_id===rows[1][2].id).winner_id,rows[1][2].second_fighter_id);
  });
  await t.test('closed card keeps identities across reordering, blocks, flags, dates and removals; late addition has zero',async()=>{
   const [main,co,ordinary]=rows[1],before=await state(current.id);
   await pool.query("UPDATE sports_fights SET bout_order=20,bout_block='preliminaries',is_main_event=false WHERE id=$1",[main.id]);
   await pool.query("UPDATE sports_fights SET bout_order=1,bout_block='preliminaries',is_main_event=true WHERE id=$1",[ordinary.id]);
   await pool.query('UPDATE sports_fights SET removed_at=clock_timestamp() WHERE id=$1',[co.id]);
   await pool.query("UPDATE sports_events SET event_date='2026-10-01' WHERE id=$1",[current.id]);
   const after=await state(current.id); assert.equal(after.ufc_main_fight_id,before.ufc_main_fight_id); assert.equal(after.ufc_co_main_fight_id,before.ufc_co_main_fight_id); assert.equal(after.ufc_scoring_version,2);
   const late=await fight(current.id,2); const values=await points(current.id);
   assert.equal(values.get(main.id),5); assert.equal(values.get(co.id),0); assert.equal(values.get(ordinary.id),1); assert.equal(values.get(late.id),0);
  });
  await t.test('open cards follow order; first edit after deadline freezes previous composition',async()=>{
   const c=await card('2026-10-24'),main=await fight(c.id,1,true),a=await fight(c.id,2),b=await fight(c.id,3);
   await pool.query('UPDATE sports_fights SET bout_order=1 WHERE id=$1',[b.id]); assert.equal((await state(c.id)).ufc_co_main_fight_id,b.id);
   await pool.query('UPDATE sports_fights SET bout_order=4 WHERE id=$1',[b.id]); assert.equal((await state(c.id)).ufc_co_main_fight_id,a.id);
   await pool.query("UPDATE sports_events SET main_card_starts_at=clock_timestamp()+interval '80 milliseconds' WHERE id=$1",[c.id]);
   const tx=await pool.connect(); try {
    await tx.query('BEGIN'); await tx.query('SELECT pg_sleep(0.12)');
    await tx.query('UPDATE sports_fights SET bout_order=1 WHERE id=$1',[b.id]); await tx.query('COMMIT');
   } finally { await tx.query('ROLLBACK'); tx.release(); }
   const frozen=await state(c.id); assert.ok(frozen.ufc_prediction_closed_at); assert.equal(frozen.ufc_co_main_fight_id,a.id); assert.equal(frozen.ufc_main_fight_id,main.id);
  });
  await t.test('database managed rule cannot be bypassed, including new cards and family scope',async()=>{
   for(const [column,value] of [['ufc_scoring_version',1],['ufc_main_fight_id',randomUUID()],['ufc_co_main_fight_id',randomUUID()]]) {
    await assert.rejects(pool.query(`UPDATE sports_events SET ${column}=$2 WHERE id=$1`,[current.id,value]),{code:'23514'});
   }
   const c=await card('2026-11-01'); assert.equal(c.ufc_scoring_version,2);
   await assert.rejects(card(null), {code:'23514'});
   assert.deepEqual((await pool.query('SELECT * FROM sports_ufc_scoring_roles($1,$2)',[randomUUID(),current.id])).rows,[{main_fight_id:null,co_main_fight_id:null}]);
  });
  await t.test('second migration execution preserves all rows and scores',async()=>{
   const before=(await pool.query('SELECT * FROM sports_events ORDER BY id')).rows;
   await pool.query(await readFile(join(migrationsFolder,'0052_ufc_scoring.sql'),'utf8'));
   assert.deepEqual((await pool.query('SELECT * FROM sports_events ORDER BY id')).rows,before);
   assert.deepEqual((await pool.query('SELECT * FROM sports_predictions ORDER BY id')).rows,votes);
   assert.deepEqual((await pool.query('SELECT * FROM sports_fight_results ORDER BY fight_id')).rows,results);
  });
 } finally { await pool?.end(); await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end(); await rm(folder,{recursive:true,force:true}); }
});
