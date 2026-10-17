import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { championsFixture, championsCleanupTables, championsIdentityTables } from "./helpers/champions.ts";

const connectionString=process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if(process.env.CI&&!connectionString)throw new Error("Isolated PostgreSQL required");
const origin="http://localhost:3353",secret="champions-switch-test-secret-at-least-32-characters";
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test("Champions family switch gates routes, isolates families, and waits for authorized writes",{skip:!connectionString&&"requires isolated PostgreSQL",timeout:120000},async()=>{
 const pool=new pg.Pool({connectionString}),families=[],users=[];
 const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3353"],{env:{...process.env,NODE_ENV:"production",DATABASE_URL:connectionString,SPORTS_ENABLED:"true",SPORTS_AGENDA_ENABLED:"true",SPORTS_RIVER_RESULTS_ENABLED:"true",SPORTS_UFC_PREDICTIONS_ENABLED:"true",SPORTS_CHAMPIONS_ENABLED:"true",BETTER_AUTH_URL:origin,BETTER_AUTH_SECRET:secret,CODE_PEPPER:secret,GOOGLE_CLIENT_ID:"",GOOGLE_CLIENT_SECRET:""},stdio:"ignore"});
 async function family(){const id=(await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id",["champions-switch-"+randomUUID()])).rows[0].id;families.push(id);return id}
 async function identity(f,role){const res=await fetch(origin+"/api/access/prepare",{method:"POST",headers:{Origin:origin,"x-forwarded-for":"203.0.113."+(users.length+20)}});assert.equal(res.status,200);const cookie=res.headers.getSetCookie().map(x=>x.split(";",1)[0]).join("; ");const session=await fetch(origin+"/api/auth/get-session",{headers:{Cookie:cookie}}).then(x=>x.json());users.push(session.user.id);const id=(await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id",[f,"Switch member "+users.length,role||"member"])).rows[0].id;await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)",[id,session.user.id]);return{id,cookie}}
 async function req(who,path,method,body){const res=await fetch(origin+path,{method:method||"GET",headers:{Origin:origin,Cookie:who?who.cookie:"",...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await res.text();return{status:res.status,body:text?JSON.parse(text):null}}
 try{
  for(let i=0;;i++){if(server.exitCode!==null)throw Error("Server failed");try{if((await fetch(origin)).ok)break}catch{}if(i>100)throw Error("Startup timeout");await wait(100)}
  const fa=await family(),aa=await identity(fa,"administrator"),ma=await identity(fa),ca=await championsFixture(pool,fa,aa.id);
  const fb=await family(),ab=await identity(fb,"administrator"),cb=await championsFixture(pool,fb,ab.id);
  await pool.query("UPDATE sports_champions_switches SET enabled=true WHERE family_id=$1",[fa]);await pool.query("UPDATE sports_champions_switches SET enabled=false WHERE family_id=$1",[fb]);
  const riverA=(await pool.query("INSERT INTO sports_events(family_id,kind,football_category,title,competition,first_participant,second_participant,event_date,starts_at,created_by_member_id,updated_by_member_id) VALUES($1,'football_match','river','River vs Boca','Liga','River Plate','Boca Juniors',CURRENT_DATE,now()+interval '4 hours',$2,$2) RETURNING id",[fa,aa.id])).rows[0].id;
  const ufcA=(await pool.query("INSERT INTO sports_events(family_id,kind,title,event_date,early_preliminaries_starts_at,preliminary_starts_at,main_card_starts_at,card_status,is_current,created_by_member_id,updated_by_member_id) VALUES($1,'ufc_card','UFC sentinel',CURRENT_DATE,now()+interval '1 hour',now()+interval '2 hours',now()+interval '3 hours','upcoming',true,$2,$2) RETURNING id",[fa,aa.id])).rows[0].id;
  const riverB=(await pool.query("INSERT INTO sports_events(family_id,kind,football_category,title,competition,first_participant,second_participant,event_date,starts_at,created_by_member_id,updated_by_member_id) VALUES($1,'football_match','river','River B vs Boca','Liga','River Plate','Boca Juniors',CURRENT_DATE,now()+interval '4 hours',$2,$2) RETURNING id",[fb,ab.id])).rows[0].id;
  const ufcB=(await pool.query("INSERT INTO sports_events(family_id,kind,title,event_date,early_preliminaries_starts_at,preliminary_starts_at,main_card_starts_at,card_status,is_current,created_by_member_id,updated_by_member_id) VALUES($1,'ufc_card','UFC B sentinel',CURRENT_DATE,now()+interval '1 hour',now()+interval '2 hours',now()+interval '3 hours','upcoming',true,$2,$2) RETURNING id",[fb,ab.id])).rows[0].id;
  assert.equal((await req(aa,"/api/sports/champions/switch")).body.effective,true);
  assert.equal((await req(ab,"/api/sports/champions/switch")).body.enabled,false);
  assert.equal((await req(aa,"/api/sports/champions?round="+ca.round)).status,200);
  assert.equal((await req(ab,"/api/sports/champions?round="+cb.round)).status,404);
  const genericOff=(await req(ab,"/api/sports")).body;assert.ok(genericOff.football.some(e=>e.id===riverB));assert.equal(genericOff.card.id,ufcB);
  assert.equal((await req(ab,"/api/sports/champions/switch","PUT",{enabled:true})).body.effective,true);
  assert.equal((await req(ab,"/api/sports/champions?round="+cb.round)).status,200);
  const genericOn=(await req(aa,"/api/sports")).body;assert.ok(genericOn.football.some(e=>e.id===riverA));assert.ok(genericOn.card.id===ufcA)

  // Hold an actual API prediction after it has acquired the shared switch-row lock.
  await pool.query("CREATE FUNCTION public.champions_switch_test_wait() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(938475610); RETURN NEW; END $$");
  await pool.query("CREATE TRIGGER champions_switch_test_wait BEFORE INSERT ON public.sports_football_predictions FOR EACH ROW EXECUTE FUNCTION public.champions_switch_test_wait()");
  const tx=await pool.connect();let transactionOpen=true;await tx.query("BEGIN");await tx.query("SELECT pg_advisory_xact_lock(938475610)");
  try {
   const saving=req(ma,"/api/sports/champions/events/"+ca.event+"/predictions","PUT",{choice:"home"});
   let waiting=false;
   for(let i=0;i<100;i++){waiting=(await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory' AND query ILIKE '%sports_football_predictions_api%' LIMIT 1")).rowCount>0;if(waiting)break;await wait(20)}
   assert.equal(waiting,true,"the authenticated prediction request reached its blocked database write");
   let finished=false;const disabling=req(aa,"/api/sports/champions/switch","PUT",{enabled:false}).then(x=>{finished=true;return x});
   await wait(250);assert.equal(finished,false,"switch off waits while an authorized write is in flight");
   await tx.query("COMMIT");transactionOpen=false;
   assert.equal((await saving).status,200);assert.equal((await disabling).status,200);
   assert.equal((await pool.query("SELECT choice FROM sports_football_predictions WHERE event_id=$1 AND member_id=$2",[ca.event,ma.id])).rows[0].choice,"home");
  } finally { if(transactionOpen)await tx.query("ROLLBACK");tx.release();await pool.query("DROP TRIGGER champions_switch_test_wait ON public.sports_football_predictions");await pool.query("DROP FUNCTION public.champions_switch_test_wait()"); }
  assert.equal((await req(ab,"/api/sports/champions/switch","PUT",{enabled:false})).status,200);
  assert.equal((await req(ab,"/api/sports/champions?round="+cb.round)).status,404);
  const otherGeneric=(await req(ab,"/api/sports")).body;assert.ok(otherGeneric.football.some(e=>e.id===riverB));assert.equal(otherGeneric.card.id,ufcB);

  const base="/api/sports/champions",checks=[
   [aa,base+"?round="+ca.round,"GET"],[aa,base+"/templates?round="+ca.round,"GET"],
   [aa,base+"/import","POST",{mode:"preview",bundle:{}}],[aa,base+"/results","POST",{mode:"preview",bundle:{}}],
   [aa,base+"/results/templates?round="+ca.round,"GET"],
   [ma,base+"/rounds/"+ca.round+"/comments","GET"],[ma,base+"/rounds/"+ca.round+"/comments","POST",{body:"blocked"}],
   [aa,base+"/rounds/"+ca.round+"/comments/"+ca.event,"PATCH",{action:"retire",expectedVersion:1}],
   [ma,base+"/events/"+ca.event+"/predictions","GET"],[ma,base+"/events/"+ca.event+"/predictions","PUT",{choice:"draw"}],[ma,base+"/events/"+ca.event+"/predictions","DELETE"]
  ];
  for(const [who,path,method,body] of checks)assert.equal((await req(who,path,method,body)).status,404,method+" "+path);
  assert.equal((await req(aa,"/api/sports/events/"+ca.event,"PATCH",{action:"hide"})).status,404);
  assert.equal((await req(ma,"/api/sports/events/"+ca.event+"/predictions")).status,404);
  assert.equal((await req(ma,"/api/sports/events/"+ca.event+"/formation","PUT",{body:"4-3-3"})).status,404);
  assert.equal((await req(ma,"/api/sports/comments","POST",{contextKind:"river_match",contextEventId:ca.event,body:"blocked"})).status,404);
  assert.equal((await req(ma,"/api/sports/comments?contextKind=river_match&eventId="+ca.event)).body.comments.length,0);
  const genericResult={version:1,checkedAt:new Date().toISOString(),source:"https://www.uefa.com/uefachampionsleague/",events:[{eventId:ca.event,result:{homeGoals:1,awayGoals:0}}]};
  const genericResultResponse=await req(aa,"/api/sports/results/import","POST",{mode:"preview",bundle:genericResult});assert.ok(genericResultResponse.body.errors?.length);assert.equal((await pool.query("SELECT count(*)::int n FROM sports_football_results WHERE event_id=$1",[ca.event])).rows[0].n,0);
  assert.ok(!JSON.stringify((await req(aa,"/api/sports/templates?kind=results")).body).includes(ca.event));
  const generic=(await req(ma,"/api/sports")).body;assert.ok(generic.football.some(e=>e.id===riverA));assert.equal(generic.card.id,ufcA);
  assert.equal((await pool.query("SELECT count(*)::int n FROM sports_football_round_comments WHERE round_id=$1",[ca.round])).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM sports_formations WHERE event_id=$1",[ca.event])).rows[0].n,0);
  const before=(await pool.query("SELECT to_jsonb(e) r FROM sports_events e WHERE family_id=ANY($1::uuid[]) ORDER BY id",[[fa,fb]])).rows;
  assert.equal((await req(aa,"/api/sports/champions/switch","PUT",{enabled:true})).body.effective,true);
  assert.deepEqual((await pool.query("SELECT to_jsonb(e) r FROM sports_events e WHERE family_id=ANY($1::uuid[]) ORDER BY id",[[fa,fb]])).rows,before);
  assert.equal((await req(aa,"/api/sports/champions?round="+ca.round)).status,200);
  assert.equal((await req(ab,"/api/sports/champions?round="+cb.round)).status,404);
  const finalB=(await req(ab,"/api/sports")).body;assert.ok(finalB.football.some(e=>e.id===riverB));assert.equal(finalB.card.id,ufcB);
 }finally{
  server.kill();await new Promise(resolve=>server.once("exit",resolve));
  for(const f of families){for(const table of championsCleanupTables)await pool.query("DELETE FROM "+table+" WHERE family_id=$1",[f]);await pool.query("DELETE FROM sports_fights WHERE family_id=$1",[f]);await pool.query("DELETE FROM sports_events WHERE family_id=$1",[f]);for(const table of championsIdentityTables)await pool.query("DELETE FROM "+table+" WHERE family_id=$1",[f]);await pool.query("DELETE FROM sports_champions_switches WHERE family_id=$1",[f]);await pool.query("DELETE FROM audit_events WHERE family_id=$1",[f]);await pool.query("DELETE FROM member_devices WHERE member_id IN (SELECT id FROM members WHERE family_id=$1)",[f]);await pool.query("DELETE FROM members WHERE family_id=$1",[f]);await pool.query("DELETE FROM families WHERE id=$1",[f])}
  for(const user of users)await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end();
 }
});

test("the environment flag is a required dependency while the switch control stays available",{skip:!connectionString&&"requires isolated PostgreSQL",timeout:60000},async()=>{
 const envOrigin="http://localhost:3354",pool=new pg.Pool({connectionString}),family=(await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id",["champions-env-"+randomUUID()])).rows[0].id;
 const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3354"],{env:{...process.env,NODE_ENV:"production",DATABASE_URL:connectionString,SPORTS_ENABLED:"true",SPORTS_AGENDA_ENABLED:"true",SPORTS_RIVER_RESULTS_ENABLED:"true",SPORTS_UFC_PREDICTIONS_ENABLED:"true",SPORTS_CHAMPIONS_ENABLED:"false",BETTER_AUTH_URL:envOrigin,BETTER_AUTH_SECRET:secret,CODE_PEPPER:secret,GOOGLE_CLIENT_ID:"",GOOGLE_CLIENT_SECRET:""},stdio:"ignore"});
 let userId;
 try{
  for(let i=0;;i++){if(server.exitCode!==null)throw Error("Environment-gated server failed");try{if((await fetch(envOrigin)).ok)break}catch{}if(i>100)throw Error("Startup timeout");await wait(100)}
  const prepared=await fetch(envOrigin+"/api/access/prepare",{method:"POST",headers:{Origin:envOrigin,"x-forwarded-for":"203.0.113.250"}});assert.equal(prepared.status,200);
  const cookie=prepared.headers.getSetCookie().map(x=>x.split(";",1)[0]).join("; "),session=await fetch(envOrigin+"/api/auth/get-session",{headers:{Cookie:cookie}}).then(r=>r.json());userId=session.user.id;
  const admin=(await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,'Environment flag administrator','administrator') RETURNING id",[family])).rows[0].id;
  await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)",[admin,userId]);
  const event=await championsFixture(pool,family,admin);
  async function request(path,method,body){const res=await fetch(envOrigin+path,{method:method||"GET",headers:{Origin:envOrigin,Cookie:cookie,...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:res.status,body:await res.json()}}
  assert.deepEqual((await request("/api/sports/champions/switch")).body,{enabled:true,effective:false});
  assert.equal((await request("/api/sports/champions?round="+event.round)).status,404);
  assert.equal((await request("/api/sports/champions/import","POST",{mode:"preview",bundle:{}})).status,404);
  assert.equal((await request("/api/sports/champions/events/"+event.event+"/predictions","PUT",{choice:"home"})).status,404);
  assert.deepEqual((await request("/api/sports/champions/switch","PUT",{enabled:false})).body,{enabled:false,effective:false});
  assert.equal((await request("/api/sports/champions/switch","PUT",{enabled:true})).status,409);
  assert.equal((await pool.query("SELECT count(*)::int n FROM sports_events WHERE id=$1",[event.event])).rows[0].n,1);
 }finally{
  server.kill();await new Promise(resolve=>server.once("exit",resolve));
  for(const table of championsCleanupTables)await pool.query("DELETE FROM "+table+" WHERE family_id=$1",[family]);
  await pool.query("DELETE FROM sports_fights WHERE family_id=$1",[family]);await pool.query("DELETE FROM sports_events WHERE family_id=$1",[family]);
  for(const table of championsIdentityTables)await pool.query("DELETE FROM "+table+" WHERE family_id=$1",[family]);
  await pool.query("DELETE FROM sports_champions_switches WHERE family_id=$1",[family]);await pool.query("DELETE FROM audit_events WHERE family_id=$1",[family]);
  await pool.query("DELETE FROM member_devices WHERE member_id IN (SELECT id FROM members WHERE family_id=$1)",[family]);await pool.query("DELETE FROM members WHERE family_id=$1",[family]);await pool.query("DELETE FROM families WHERE id=$1",[family]);
  if(userId)await pool.query('DELETE FROM "user" WHERE id=$1',[userId]);await pool.end();
 }
});
