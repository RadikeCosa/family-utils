import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw Error('Isolated PostgreSQL required');
test('UFC closure migration, guards, boundaries and concurrency', { skip: !connectionString && 'requires isolated PostgreSQL', timeout: 60000 }, async t => {
 const admin = new pg.Pool({ connectionString }), name=`ufc_${randomUUID().replaceAll('-','')}`, folder=await mkdtemp(join(tmpdir(),'ufc-migration-'));
 let pool;
 const clientEnds=[];
 try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const url=new URL(connectionString);url.pathname=`/${name}`;pool=new pg.Pool({connectionString:url.toString()});
  // Pool.end resolves before every socket has emitted end; wait before dropping the database.
  pool.on('connect',client=>clientEnds.push(new Promise(resolve=>client.once('end',resolve))));
  const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')),entries=journal.entries.slice(0,journal.entries.findIndex(e=>e.tag==='0037_ufc_card_closure'));
  await mkdir(join(folder,'meta'));await writeFile(join(folder,'meta/_journal.json'),JSON.stringify({...journal,entries}));
  for(const e of entries)await writeFile(join(folder,`${e.tag}.sql`),await readFile(`drizzle/${e.tag}.sql`));
  await migrate(drizzle(pool),{migrationsFolder:folder});
  const family=(await pool.query("INSERT INTO families(name) VALUES('UFC fixture') RETURNING id")).rows[0].id;
  const member=(await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,'Player','administrator') RETURNING id",[family])).rows[0].id;
  const other=(await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,'Other','member') RETURNING id",[family])).rows[0].id;
  const card=async(early=null,pre='2 hours',main='3 hours')=>(await pool.query(`INSERT INTO sports_events(family_id,kind,title,event_date,early_preliminaries_starts_at,preliminary_starts_at,main_card_starts_at,created_by_member_id,updated_by_member_id) VALUES($1,'ufc_card','UFC fixture',CURRENT_DATE,clock_timestamp()+$3::interval,clock_timestamp()+$4::interval,clock_timestamp()+$5::interval,$2,$2) RETURNING *`,[family,member,early,pre,main])).rows[0];
  const fight=async(event,block='main',order=1,first='A',second='B')=>(await pool.query("INSERT INTO sports_fights(family_id,event_id,bout_order,first_fighter,second_fighter,bout_block,is_main_event) VALUES($1,$2,$3,$4,$5,$6,false) RETURNING *",[family,event,order,first,second,block])).rows[0];
  const vote=(event,f,person=member)=>pool.query('INSERT INTO sports_predictions(family_id,event_id,fight_id,member_id,winner_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(family_id,member_id,fight_id) DO UPDATE SET winner_id=excluded.winner_id RETURNING *',[family,event,f.id,person,f.second_fighter_id]);
  const state=async event=>(await pool.query('SELECT * FROM sports_events WHERE id=$1',[event])).rows[0];
  const legacy=await card('-1 hour'),first=await fight(legacy.id,'early_preliminaries',1,'Cody Chovancek','SuYoung You'),main=await fight(legacy.id,'main',2);
  await vote(legacy.id,first);await vote(legacy.id,main,other);
  await pool.query("INSERT INTO sports_fight_results(family_id,event_id,fight_id,outcome,winner_id,source,checked_at,updated_by_member_id) VALUES($1,$2,$3,'winner',$4,'fixture',clock_timestamp(),$5)",[family,legacy.id,first.id,first.second_fighter_id,member]);
  await pool.query("INSERT INTO sports_block_closures(family_id,event_id,block,closed_at) VALUES($1,$2,'early_preliminaries',$3)",[family,legacy.id,legacy.early_preliminaries_starts_at]);
  const predictions=(await pool.query('SELECT * FROM sports_predictions ORDER BY id')).rows,results=(await pool.query('SELECT * FROM sports_fight_results')).rows;
  await migrate(drizzle(pool),{migrationsFolder:'drizzle'});
  await t.test('preserve legacy late main vote, SuYoung You result and existing eligibility; rerun is identical',async()=>{
   assert.equal((await state(legacy.id)).ufc_prediction_closed_at.toISOString(),legacy.early_preliminaries_starts_at.toISOString());
   assert.deepEqual((await pool.query('SELECT * FROM sports_predictions ORDER BY id')).rows,predictions);assert.deepEqual((await pool.query('SELECT * FROM sports_fight_results')).rows,results);
   assert.equal((await pool.query("SELECT count(*)::int points FROM sports_predictions p JOIN sports_fight_results r ON r.fight_id=p.fight_id AND r.winner_id=p.winner_id JOIN sports_fights f ON f.id=p.fight_id WHERE p.member_id=$1 AND f.prode_eligible AND r.outcome='winner'",[member])).rows[0].points,1);
   assert.ok((await pool.query('SELECT prode_eligible FROM sports_fights')).rows.every(f=>f.prode_eligible));
   const before=await state(legacy.id);await pool.query(await readFile('drizzle/0037_ufc_card_closure.sql','utf8'));assert.deepEqual(await state(legacy.id),before);
   assert.deepEqual((await pool.query('SELECT * FROM sports_predictions ORDER BY id')).rows,predictions);
  });
  await t.test('direct late create/update/delete suppressed, managed closure and eligibility immutable',async()=>{
   assert.equal((await vote(legacy.id,main)).rowCount,0);
   assert.equal((await pool.query('UPDATE sports_predictions SET winner_id=$2 WHERE fight_id=$1',[main.id,main.first_fighter_id])).rowCount,0);
   assert.equal((await pool.query('DELETE FROM sports_predictions WHERE event_id=$1',[legacy.id])).rowCount,0);
   for(const column of ['ufc_prediction_closed_at','ufc_prediction_closes_at'])await assert.rejects(pool.query(`UPDATE sports_events SET ${column}=clock_timestamp()+interval '1 day' WHERE id=$1`,[legacy.id]),{code:'23514'});
   await pool.query("UPDATE sports_events SET early_preliminaries_starts_at=clock_timestamp()+interval '1 day' WHERE id=$1",[legacy.id]);
   assert.equal((await state(legacy.id)).ufc_prediction_closed_at.toISOString(),legacy.early_preliminaries_starts_at.toISOString());
   const added=await fight(legacy.id,'preliminaries',3);assert.equal(added.prode_eligible,false);
   await assert.rejects(pool.query('UPDATE sports_fights SET prode_eligible=true WHERE id=$1',[added.id]),{code:'23514'});
   await pool.query("UPDATE sports_fights SET bout_block='main' WHERE id=$1",[first.id]);
   assert.equal((await state(legacy.id)).ufc_prediction_closed_at.toISOString(),legacy.early_preliminaries_starts_at.toISOString());
  });
  await t.test('missing earliest block time blocks main; filling it with past time closes immediately',async()=>{
   const c=await card(),m=await fight(c.id);assert.equal((await vote(c.id,m)).rowCount,1);
   await fight(c.id,'preliminaries',2);assert.equal((await state(c.id)).ufc_prediction_closes_at.toISOString(),c.preliminary_starts_at.toISOString());
   await pool.query('UPDATE sports_events SET preliminary_starts_at=NULL WHERE id=$1',[c.id]);assert.equal((await state(c.id)).ufc_prediction_closes_at,null);assert.equal((await vote(c.id,m,other)).rowCount,0);
   await pool.query("UPDATE sports_events SET preliminary_starts_at=clock_timestamp()-interval '1 second' WHERE id=$1",[c.id]);assert.ok((await state(c.id)).ufc_prediction_closed_at);assert.equal((await vote(c.id,m,other)).rowCount,0);
  });
  await t.test('open close follows advances/postponements; expired old deadline freezes before update',async()=>{
   const c=await card();await fight(c.id);
   await pool.query("UPDATE sports_events SET main_card_starts_at=clock_timestamp()+interval '2 hours' WHERE id=$1",[c.id]);const advanced=await state(c.id);assert.ok(advanced.ufc_prediction_closes_at<c.main_card_starts_at);
   await pool.query("UPDATE sports_events SET main_card_starts_at=clock_timestamp()+interval '4 hours' WHERE id=$1",[c.id]);assert.ok((await state(c.id)).ufc_prediction_closes_at>advanced.ufc_prediction_closes_at);
   await pool.query("UPDATE sports_events SET main_card_starts_at=clock_timestamp()+interval '120 milliseconds' WHERE id=$1",[c.id]);const before=(await state(c.id)).ufc_prediction_closes_at;
   await pool.query('SELECT pg_sleep(0.16)');await pool.query("UPDATE sports_events SET main_card_starts_at=clock_timestamp()+interval '1 day' WHERE id=$1",[c.id]);assert.equal((await state(c.id)).ufc_prediction_closed_at.toISOString(),before.toISOString());
  });
  await t.test('transaction started before close cannot write afterward and rejection persists closure',async()=>{
   const c=await card(),f=await fight(c.id);await pool.query("UPDATE sports_events SET main_card_starts_at=clock_timestamp()+interval '150 milliseconds' WHERE id=$1",[c.id]);
   const tx=await pool.connect();try{await tx.query('BEGIN');await tx.query('SELECT pg_sleep(0.2)');assert.equal((await tx.query('INSERT INTO sports_predictions(family_id,event_id,fight_id,member_id,winner_id) VALUES($1,$2,$3,$4,$5)',[family,c.id,f.id,member,f.first_fighter_id])).rowCount,0);await tx.query('COMMIT');assert.ok((await state(c.id)).ufc_prediction_closed_at);}finally{await tx.query('ROLLBACK');tx.release();}
  });
  await t.test('revealing reader waits for pending vote; waiting writer rechecks real clock',async()=>{
   const c=await card(),f=await fight(c.id),writer=await pool.connect(),reader=await pool.connect(),late=await pool.connect();
   try{
    await pool.query("UPDATE sports_events SET main_card_starts_at=clock_timestamp()+interval '250 milliseconds' WHERE id=$1",[c.id]);await writer.query('BEGIN');
    assert.equal((await writer.query('INSERT INTO sports_predictions(family_id,event_id,fight_id,member_id,winner_id) VALUES($1,$2,$3,$4,$5)',[family,c.id,f.id,member,f.first_fighter_id])).rowCount,1);
    let settled=false;const reading=reader.query('SELECT public.sports_ufc_refresh_close($1,$2)',[family,c.id]).then(()=>{settled=true;});
    const writing=late.query('INSERT INTO sports_predictions(family_id,event_id,fight_id,member_id,winner_id) VALUES($1,$2,$3,$4,$5)',[family,c.id,f.id,other,f.first_fighter_id]);
    await writer.query('SELECT pg_sleep(0.3)');assert.equal(settled,false);await writer.query('COMMIT');await reading;assert.equal((await writing).rowCount,0);assert.ok((await state(c.id)).ufc_prediction_closed_at);
   }finally{await writer.query('ROLLBACK');writer.release();reader.release();late.release();}
  });
  await t.test('foreign family refresh is inert and Argentina presentation uses explicit timezone',async()=>{
   const c=await card();await fight(c.id);const before=await state(c.id);await pool.query('SELECT public.sports_ufc_refresh_close($1,$2)',[randomUUID(),c.id]);assert.deepEqual(await state(c.id),before);
   assert.equal((await pool.query("SELECT to_char('2026-10-17 21:00:00+00'::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires','YYYY-MM-DD HH24:MI') value")).rows[0].value,'2026-10-17 18:00');
  });
 }finally{await pool?.end();await Promise.all(clientEnds);await admin.query(`DROP DATABASE IF EXISTS "${name}"`);await admin.end();await rm(folder,{recursive:true,force:true});}
});
