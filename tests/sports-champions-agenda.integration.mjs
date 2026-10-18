import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { championsBundle } from "./helpers/champions-bundle.ts";
import { championsCleanupTables, championsIdentityTables } from "./helpers/champions.ts";
const connectionString=process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if(process.env.CI&&!connectionString)throw new Error("Isolated PostgreSQL required");
const secret="champions-agenda-test-secret-at-least-32-characters",origin="http://localhost:3349";
test("Champions agenda: signed preview, atomic import, metadata privacy and navigation",{skip:!connectionString&&"requires isolated PostgreSQL",timeout:120000},async t=>{
 const pool=new pg.Pool({connectionString}),families=[],users=[];
 const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3349"],{env:{...process.env,NODE_ENV:"production",DATABASE_URL:connectionString,SPORTS_ENABLED:"true",SPORTS_AGENDA_ENABLED:"true",SPORTS_CHAMPIONS_ENABLED:"true",BETTER_AUTH_URL:origin,BETTER_AUTH_SECRET:secret,CODE_PEPPER:secret,GOOGLE_CLIENT_ID:"",GOOGLE_CLIENT_SECRET:""},stdio:"ignore"});
 async function family(){const id=(await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id",[`champions-import-${randomUUID()}`])).rows[0].id;families.push(id);await pool.query("INSERT INTO sports_champions_switches(family_id,enabled) VALUES($1,true) ON CONFLICT(family_id) DO UPDATE SET enabled=true",[id]);return id;}
 async function identity(f,role="member"){const r=await fetch(`${origin}/api/access/prepare`,{method:"POST",headers:{Origin:origin,"x-forwarded-for":`192.0.2.${users.length+160}`}});assert.equal(r.status,200);const cookie=r.headers.getSetCookie().map(v=>v.split(";",1)[0]).join("; ");const session=await fetch(`${origin}/api/auth/get-session`,{headers:{Cookie:cookie}}).then(r=>r.json());users.push(session.user.id);const id=(await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id",[f,`Importer ${users.length}`,role])).rows[0].id;await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)",[id,session.user.id]);return{id,cookie};}
 async function request(who,path,method="GET",body){const r=await fetch(`${origin}${path}`,{method,headers:{Origin:origin,Cookie:who?.cookie??"",...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};}
 const send=(who,bundle,mode="preview",token)=>request(who,"/api/sports/champions/import","POST",{mode,bundle,...(token?{token}:{})});
 async function importRound(who,bundle){const p=await send(who,bundle);assert.equal(p.status,200,JSON.stringify(p));const r=await send(who,bundle,"import",p.body.token);assert.equal(r.status,200,JSON.stringify(r));return r.body;}
 let f,admin,otherAdmin,member,outsider,bundle,roundId;
 try{
  for(let i=0;;i++){if(server.exitCode!==null)throw new Error("Agenda server failed");try{if((await fetch(origin)).ok)break;}catch{}if(i>100)throw new Error("Startup timeout");await new Promise(r=>setTimeout(r,100));}
  f=await family();admin=await identity(f,"administrator");otherAdmin=await identity(f,"administrator");member=await identity(f);outsider=await identity(await family(),"administrator");bundle=championsBundle();
  await t.test("preview is read-only; permissions, complete errors and examples",async()=>{
   assert.equal((await send(member,bundle)).status,403);assert.equal((await send(null,bundle)).status,403);
   const invalid=structuredClone(bundle);invalid.rounds[0].matches[0].homeTeam="missing";invalid.rounds[0].matches[1].awayTeam="missing";invalid.rounds[0].originalThrough="2000-01-01";
   const errors=await send(admin,invalid);assert.equal(errors.status,400);assert.ok(errors.body.errors.length>=3);
   const example=(await request(admin,"/api/sports/champions/templates?example=true")).body;
   const p=await send(admin,example);assert.equal(p.status,200);assert.equal((await send(admin,example,"import",p.body.token)).status,400);
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM sports_events WHERE family_id=$1",[f])).rows[0].n,0);
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM sports_football_teams WHERE family_id=$1",[f])).rows[0].n,0);
  });
  await t.test("unsigned preview repeated twice is identical and never creates teams, matches or confirmation tokens",async()=>{
   const call=()=>request(admin,"/api/sports/champions/import","POST",{mode:"preview",bundle,issueToken:false});
   const a=await call(),b=await call();assert.equal(a.status,200);assert.deepEqual(b,a);assert.equal(Object.hasOwn(a.body,'token'),false);assert.equal(a.body.summary.teams,4);assert.deepEqual(a.body.errors,[]);
   for(const table of ['sports_events','sports_football_teams','sports_football_rounds','sports_football_seasons'])assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE family_id=$1`,[f])).rows[0].n,0);
  });
  await t.test("signed token binds file, administrator, family, expiry and base state",async()=>{
   const p=await send(admin,bundle);assert.equal(p.status,200);assert.equal((await send(admin,bundle,"import")).status,409);
   const changed=structuredClone(bundle);changed.rounds[0].matches[0].venue="Changed";
   assert.equal((await send(admin,changed,"import",p.body.token)).status,409);assert.equal((await send(otherAdmin,bundle,"import",p.body.token)).status,409);assert.equal((await send(outsider,bundle,"import",p.body.token)).status,409);
   const content=JSON.parse(Buffer.from(p.body.token.split('.')[0],'base64url').toString());content.expires=Date.now()-1;const encoded=Buffer.from(JSON.stringify(content)).toString('base64url');const expired=`${encoded}.${createHmac('sha256',secret).update(JSON.stringify(encoded)).digest('hex')}`;
   const expiredResponse=await send(admin,bundle,"import",expired);assert.equal(expiredResponse.status,409);assert.match(expiredResponse.body.error,/venció/);
   const second=await send(otherAdmin,bundle);
   const raced=await Promise.all([send(admin,bundle,"import",p.body.token),send(otherAdmin,bundle,"import",second.body.token)]);
   assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);roundId=raced.find(r=>r.status===200).body.roundId;
  });
  await t.test("reimport is idempotent; template retains provider identities and no picks",async()=>{
   const before=(await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE family_id=$1 ORDER BY id",[f])).rows;
   const identities = async () => Object.fromEntries(await Promise.all(['sports_football_teams','sports_football_team_sources','sports_football_event_sources','sports_football_seasons','sports_football_rounds'].map(async table => [table,(await pool.query(`SELECT to_jsonb(t) AS record FROM ${table} t WHERE family_id=$1 ORDER BY to_jsonb(t)::text`,[f])).rows])));
   const identityBefore=await identities();
   const audits=(await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE family_id=$1",[f])).rows[0].n;
   assert.equal((await importRound(admin,bundle)).changed,false);assert.deepEqual(await identities(),identityBefore);
   assert.deepEqual((await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE family_id=$1 ORDER BY id",[f])).rows,before);
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE family_id=$1",[f])).rows[0].n,audits);
   const template=await request(admin,`/api/sports/champions/templates?round=${roundId}`);assert.equal(template.status,200);assert.equal(template.body.teams.length,4);assert.ok(template.body.teams.every(t=>t.externalIds.uefa&&t.externalIds.espn));assert.equal(template.body.rounds[0].matches.length,2);
   assert.equal((await request(member,"/api/sports/champions/templates")).status,403);
   assert.equal((await request(outsider,`/api/sports/champions/templates?round=${roundId}`)).status,404);
  });
  await t.test("obsolete preview rejects metadata changes; foreign jornada errors are complete with no writes",async()=>{
   const before=(await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE family_id=$1 ORDER BY id",[f])).rows;
   const foreign=structuredClone(bundle);foreign.rounds[0].reference='another-round';
   const bad=await send(admin,foreign);assert.equal(bad.status,400);assert.equal(bad.body.errors.filter(e=>e.message.includes('otra jornada')).length,2);
   assert.deepEqual((await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE family_id=$1 ORDER BY id",[f])).rows,before);
   const p=await send(admin,bundle);assert.equal(p.status,200);
   await pool.query("UPDATE sports_events SET updated_at=updated_at+interval '1 second' WHERE family_id=$1",[f]);
   const stale=await send(admin,bundle,'import',p.body.token);assert.equal(stale.status,409);assert.match(stale.body.error,/datos cambiaron/);
  });
  await t.test("legacy River import cannot claim a Champions ESPN identity stored in the provider map",async()=>{
   const date=bundle.rounds[0].matches[0].eventDate,checkedAt=new Date().toISOString();
   const legacy={schemaVersion:1,status:"curated",checkedAt,timezone:"America/Argentina/Buenos_Aires",curation:{completeHorizon:{river:{from:"2020-01-01",through:"2099-12-31",complete:true},ufc:{from:"2020-01-01",through:"2099-12-31",complete:true}}},events:[{kind:"football_match",sourceProvider:"espn",externalReference:bundle.rounds[0].matches[0].externalIds.espn,title:"River Plate vs Boca",competition:"Liga",firstParticipant:"River Plate",secondParticipant:"Boca",eventDate:date,status:"scheduled",source:{primary:"https://www.espn.com",checkedAt}},{kind:"ufc_card",sourceProvider:"ufc_official",externalReference:"ufc-regression",title:"UFC Alpha vs Beta",eventDate:date,fights:[{firstFighter:"Alpha",secondFighter:"Beta",boutBlock:"main",isMainEvent:true}],source:{primary:"https://www.ufc.com/events",checkedAt,validation:{officialCardComplete:true,officialFightCount:1,independentCrossCheck:"passed"}}}]};
   const before=(await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE family_id=$1 ORDER BY id",[f])).rows;
   assert.equal((await request(admin,"/api/sports/import","POST",{mode:"import",bundle:legacy})).status,409);
   assert.deepEqual((await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE family_id=$1 ORDER BY id",[f])).rows,before);
  });
  await t.test("private picks neither leak through round/template/preview nor invalidate agenda token",async()=>{
   const data=(await request(admin,`/api/sports/champions?round=${roundId}`)).body;
   const match=data.matches.find(m=>m.startsAt),p=await send(admin,bundle);
   const chosen=await request(member,`/api/sports/champions/events/${match.id}/predictions`,'PUT',{choice:'home'});assert.equal(chosen.status,200);
   assert.equal((await send(admin,bundle,"import",p.body.token)).status,200);
   const adminData=(await request(admin,`/api/sports/champions?round=${roundId}`)).body;
   assert.deepEqual(adminData,data);assert.ok(!JSON.stringify(adminData).includes(member.id));assert.ok(adminData.matches.every(m=>m.prediction.choices.length===0));
   const own=(await request(member,`/api/sports/champions?round=${roundId}`)).body;assert.equal(own.matches.find(m=>m.id===match.id).prediction.ownChoice,'home');
   const preview=await send(admin,bundle);assert.ok(!JSON.stringify(preview.body).includes(member.id));
   assert.ok(!JSON.stringify((await request(admin,`/api/sports/champions/templates?round=${roundId}`)).body).includes(member.id));
   const outside=(await request(outsider,`/api/sports/champions?round=${roundId}`)).body;assert.equal(outside.matches.length,0);
  });
  await t.test("schedule correction preserves identity/choice; omissions and swaps reject all changes",async()=>{
   const data=(await request(member,`/api/sports/champions?round=${roundId}`)).body,match=data.matches.find(m=>m.startsAt);
   bundle.rounds[0].matches[0].startsAt=bundle.rounds[0].matches[0].startsAt.replace('18:00','19:00');
   await importRound(admin,bundle);
   const after=(await request(member,`/api/sports/champions?round=${roundId}`)).body.matches.find(m=>m.id===match.id);assert.equal(after.prediction.ownChoice,'home');assert.match(after.startsAt,/T19:00/);
   const before=(await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE family_id=$1 ORDER BY id",[f])).rows;
   const invalid=structuredClone(bundle);invalid.rounds[0].matches[0].venue="Must not persist";[invalid.rounds[0].matches[1].homeTeam,invalid.rounds[0].matches[1].awayTeam]=[invalid.rounds[0].matches[1].awayTeam,invalid.rounds[0].matches[1].homeTeam];
   assert.equal((await send(admin,invalid)).status,400);
   const omitted=structuredClone(bundle);omitted.rounds[0].matches.pop();assert.equal((await send(admin,omitted)).status,400);
   assert.deepEqual((await pool.query("SELECT to_jsonb(e) AS record FROM sports_events e WHERE family_id=$1 ORDER BY id",[f])).rows,before);
  });
  await t.test("database failure rolls the whole jornada back, including new round and earlier match",async()=>{
   const next=championsBundle(new Date(Date.now()+10*86400000),'league-4');next.checkedAt=new Date().toISOString();
   const p=await send(admin,next);assert.equal(p.status,200);
   await pool.query(`CREATE FUNCTION champions_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.family_id='${f}'::uuid AND NEW.title='Club Gamma vs Club Delta' THEN RAISE EXCEPTION 'Fixture rejection'; END IF; RETURN NEW; END; $$`);
   await pool.query("CREATE TRIGGER champions_test_reject BEFORE INSERT ON sports_events FOR EACH ROW EXECUTE FUNCTION champions_test_reject()");
   try{assert.equal((await send(admin,next,'import',p.body.token)).status,500);}finally{await pool.query("DROP TRIGGER champions_test_reject ON sports_events");await pool.query("DROP FUNCTION champions_test_reject()");}
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM sports_football_rounds WHERE family_id=$1 AND reference='league-4'",[f])).rows[0].n,0);
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM sports_events WHERE family_id=$1",[f])).rows[0].n,2);
  });
  await t.test("late provider reservation conflict cannot silently omit a Champions identity",async()=>{
   const river=(await pool.query("INSERT INTO sports_events(family_id,kind,title,competition,first_participant,second_participant,created_by_member_id,updated_by_member_id) VALUES($1,'football_match','Legacy reservation','Liga','River Plate','Boca',$2,$2) RETURNING id",[f,admin.id])).rows[0].id;
   const next=championsBundle(new Date(Date.now()+10*86400000),'league-4');next.checkedAt=new Date().toISOString();const p=await send(admin,next);assert.equal(p.status,200);
   await pool.query(`CREATE FUNCTION champions_test_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.family_id='${f}'::uuid AND NEW.title='Club Alfa vs Club Beta' THEN INSERT INTO sports_football_event_sources(family_id,event_id,provider,external_id) VALUES('${f}','${river}','espn','88000401'); END IF; RETURN NEW; END; $$`);
   await pool.query("CREATE TRIGGER champions_test_claim BEFORE INSERT ON sports_events FOR EACH ROW EXECUTE FUNCTION champions_test_claim()");
   try{assert.equal((await send(admin,next,'import',p.body.token)).status,409);}finally{await pool.query("DROP TRIGGER champions_test_claim ON sports_events");await pool.query("DROP FUNCTION champions_test_claim()");}
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM sports_football_rounds WHERE family_id=$1 AND reference='league-4'",[f])).rows[0].n,0);
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM sports_football_event_sources WHERE event_id=$1",[river])).rows[0].n,0);
  });
 }finally{server.kill();if(families.length){await pool.query("DELETE FROM audit_events WHERE family_id=ANY($1::uuid[])",[families]);for(const table of [...championsCleanupTables,'sports_events',...championsIdentityTables])await pool.query(`DELETE FROM ${table} WHERE family_id=ANY($1::uuid[])`,[families]);await pool.query("DELETE FROM families WHERE id=ANY($1::uuid[])",[families]);}if(users.length)await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[users]);await pool.end();}
});
