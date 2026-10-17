import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {championsFixture,championsCleanupTables,championsIdentityTables} from './helpers/champions.ts';
const connectionString=process.env.FAMILY_UTILS_TEST_DATABASE_URL,origin='http://localhost:3352';
if(process.env.CI&&!connectionString)throw Error('Isolated PostgreSQL required');
test('Champions jornada conversation: stable identity, family isolation, authorship and concurrent edits',{skip:!connectionString&&'requires isolated PostgreSQL',timeout:120000},async t=>{
 const pool=new pg.Pool({connectionString}),families=[],users=[];let admin,member,peer,outsider,familyId,base,nextRound,comment;
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3352'],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:connectionString,SPORTS_ENABLED:'true',SPORTS_AGENDA_ENABLED:'true',SPORTS_CHAMPIONS_ENABLED:'true',BETTER_AUTH_URL:origin,BETTER_AUTH_SECRET:'champions-comments-test-secret-at-least-32-characters',CODE_PEPPER:'champions-comments-test-pepper-at-least-32-characters',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''},stdio:'ignore'});
 async function family(){const id=(await pool.query('INSERT INTO families(name) VALUES($1) RETURNING id',[`champions-comments-${randomUUID()}`])).rows[0].id;families.push(id);await pool.query('INSERT INTO sports_champions_switches(family_id,enabled) VALUES($1,true) ON CONFLICT(family_id) DO UPDATE SET enabled=true',[id]);return id;}
 async function identity(f,role='member'){const r=await fetch(`${origin}/api/access/prepare`,{method:'POST',headers:{Origin:origin,'x-forwarded-for':`198.18.${Math.floor(Math.random()*200)+1}.${Math.floor(Math.random()*200)+1}`}});assert.equal(r.status,200);const cookie=r.headers.getSetCookie().map(v=>v.split(';',1)[0]).join('; '),session=await fetch(`${origin}/api/auth/get-session`,{headers:{Cookie:cookie}}).then(r=>r.json());users.push(session.user.id);const id=(await pool.query('INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id',[f,`Comment player ${users.length}`,role])).rows[0].id;await pool.query('INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)',[id,session.user.id]);return{id,cookie,userId:session.user.id};}
 async function request(person,path,method='GET',body){const r=await fetch(`${origin}${path}`,{method,headers:{Origin:origin,Cookie:person?.cookie??'',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};}
 const path=(round=base.round,id)=>`/api/sports/champions/rounds/${round}/comments${id?`/${id}`:''}`;
 try{
  for(let i=0;;i++){if(server.exitCode!==null)throw Error('Comments server failed');try{if((await fetch(origin)).ok)break;}catch{}if(i>100)throw Error('Startup timeout');await new Promise(r=>setTimeout(r,100));}
  familyId=await family();admin=await identity(familyId,'administrator');member=await identity(familyId);peer=await identity(familyId);outsider=await identity(await family(),'administrator');base=await championsFixture(pool,familyId,admin.id);
  nextRound=(await pool.query("INSERT INTO sports_football_rounds(family_id,season_id,reference,name,original_from,original_through) SELECT family_id,season_id,'league-4','Jornada 4',original_from,original_through FROM sports_football_rounds WHERE id=$1 RETURNING id",[base.round])).rows[0].id;
  await t.test('member creates one jornada thread shared across days; another jornada with same dates stays separate',async()=>{
   const created=await request(member,path(),'POST',{body:'Conversación de ambos días',contextKind:'champions_round'});assert.equal(created.status,201);assert.equal(created.cache,'no-store');comment=created.body;
   const read=await request(admin,path());assert.equal(read.status,200);assert.equal(read.cache,'no-store');assert.equal(read.body.comments.length,1);assert.equal(read.body.comments[0].authorMemberId,member.id);
   assert.deepEqual((await request(member,path(nextRound))).body.comments,[]);
   await pool.query("UPDATE sports_events SET event_date='2026-11-04',starts_at=now()+interval '20 days',status='postponed' WHERE id=$1",[base.event]);
   assert.deepEqual((await request(admin,path())).body,read.body);assert.deepEqual((await request(admin,`${path()}?contextDate=2026-10-20`)).body,read.body);assert.deepEqual((await request(admin,`${path()}?contextDate=2026-10-21`)).body,read.body);
   assert.equal((await pool.query('SELECT round_id FROM sports_football_round_comments WHERE id=$1',[comment.id])).rows[0].round_id,base.round);
  });
  await t.test('family and session isolation; path identity cannot be replaced by date, event or member payload',async()=>{
   for(const method of ['GET','POST']){const r=await request(outsider,path(),method,method==='POST'?{body:'foreign'}:undefined);assert.equal(r.status,404);assert.equal(r.cache,'no-store');}
   assert.equal((await request(null,path())).status,403);assert.equal((await request(member,path(randomUUID()))).status,404);assert.equal((await request(member,path('invalid'))).status,400);
   for(const spoof of [{familyId:familyId},{memberId:admin.id},{roundId:nextRound},{contextDate:'2026-10-20'},{contextEventId:base.event}])assert.equal((await request(member,path(),'POST',{body:'Spoof',...spoof})).status,400);
   await assert.rejects(pool.query('INSERT INTO sports_football_round_comments(family_id,round_id,author_member_id,body) VALUES($1,$2,$3,$4)',[familyId,base.round,outsider.id,'invalid author']),{code:'23503'});
   await assert.rejects(pool.query('INSERT INTO sports_football_round_comments(family_id,round_id,author_member_id,body) VALUES($1,$2,$3,$4)',[families[1],base.round,outsider.id,'invalid round']),{code:'23503'});
   assert.equal((await request(member,path(),'POST',{body:' '.repeat(10)})).status,400);assert.equal((await request(member,path(),'POST',{body:'a'.repeat(2001)})).status,400);
  });
  await t.test('legacy generic endpoints cannot read, create or edit Champions jornada comments',async()=>{
   assert.equal((await request(member,'/api/sports/comments?contextKind=champions_round')).status,400);
   assert.equal((await request(member,'/api/sports/comments','POST',{contextKind:'champions_round',contextEventId:base.round,body:'Legacy bypass'})).status,400);
   assert.equal((await request(member,`/api/sports/comments/${comment.id}`,'PATCH',{action:'edit',expectedVersion:1,body:'Legacy bypass'})).status,404);
   assert.equal((await request(member,path(nextRound,comment.id),'PATCH',{action:'edit',expectedVersion:1,body:'Wrong jornada'})).status,404);
  });
  await t.test('author alone edits; administrators can retire but cannot rewrite someone else',async()=>{
   for(const person of [peer,admin])assert.equal((await request(person,path(base.round,comment.id),'PATCH',{action:'edit',expectedVersion:1,body:'Not mine'})).status,403);
   assert.equal((await request(peer,path(base.round,comment.id),'PATCH',{action:'retire',expectedVersion:1})).status,403);
   const changed=await request(member,path(base.round,comment.id),'PATCH',{action:'edit',expectedVersion:1,body:'Editado por autor'});assert.equal(changed.status,200);assert.equal(changed.body.version,2);
   assert.equal((await request(member,path(base.round,comment.id),'PATCH',{action:'edit',expectedVersion:1,body:'Stale'})).status,409);
   assert.equal((await request(admin,path(base.round,comment.id),'PATCH',{action:'retire',expectedVersion:1})).status,409);
  });
  await t.test('simultaneous edits serialize; exactly one expected version wins without overwriting',async()=>{
   const responses=await Promise.all(['Concurrent A','Concurrent B'].map(body=>request(member,path(base.round,comment.id),'PATCH',{action:'edit',expectedVersion:2,body})));assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
   const row=(await request(member,path())).body.comments.find(c=>c.id===comment.id);assert.equal(row.version,3);assert.ok(['Concurrent A','Concurrent B'].includes(row.body));
  });
  await t.test('current role, revocation and archival are enforced; withdrawal preserves auditable identity',async()=>{
   await pool.query("UPDATE members SET role='member' WHERE id=$1",[admin.id]);assert.equal((await request(admin,path(base.round,comment.id),'PATCH',{action:'retire',expectedVersion:3})).status,403);await pool.query("UPDATE members SET role='administrator' WHERE id=$1",[admin.id]);
   await pool.query('UPDATE member_devices SET revoked_at=now() WHERE member_id=$1',[peer.id]);assert.equal((await request(peer,path(),'POST',{body:'Revoked'})).status,403);
   const retired=await request(admin,path(base.round,comment.id),'PATCH',{action:'retire',expectedVersion:3});assert.equal(retired.status,200);assert.equal(retired.body.retired,true);assert.deepEqual((await request(member,path())).body.comments,[]);
   const stored=(await pool.query('SELECT round_id,body,version,retired_by_member_id,retired_at FROM sports_football_round_comments WHERE id=$1',[comment.id])).rows[0];assert.equal(stored.round_id,base.round);assert.equal(stored.version,4);assert.equal(stored.retired_by_member_id,admin.id);assert.ok(stored.retired_at);
   const audits=(await pool.query("SELECT action,\"after\" FROM audit_events WHERE family_id=$1 AND entity_type='sports_champions_comment' ORDER BY created_at,id",[familyId])).rows;assert.deepEqual(audits.map(a=>a.action),['created','edited','edited','retired']);assert.ok(audits.every(a=>JSON.stringify(a.after)===JSON.stringify({roundId:base.round})));
   await pool.query('UPDATE members SET archived_at=now() WHERE id=$1',[member.id]);assert.equal((await request(member,path())).status,403);
  });
 }finally{server.kill();for(const f of families){await pool.query('DELETE FROM audit_events WHERE family_id=$1',[f]);for(const table of [...championsCleanupTables,'sports_events',...championsIdentityTables])await pool.query(`DELETE FROM ${table} WHERE family_id=$1`,[f]);await pool.query('DELETE FROM families WHERE id=$1',[f]);}for(const u of users)await pool.query('DELETE FROM "user" WHERE id=$1',[u]);await pool.end();}
});
