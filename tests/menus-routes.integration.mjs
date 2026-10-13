import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { addDays, getDayInTimeZone, startOfWeek } from "../src/lib/meals/rules.ts";

const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (process.env.CI && !connectionString) throw new Error("Isolated test database required");
test("daily menus: real authenticated routes, preservation and atomic changes", { skip: !connectionString && "requires isolated PostgreSQL", timeout: 120_000 }, async t => {
  const pool = new pg.Pool({ connectionString }), origin = "http://localhost:3343";
  const server = spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3343"],{ env:{...process.env,DATABASE_URL:connectionString,DATABASE_URL_UNPOOLED:connectionString,BETTER_AUTH_URL:origin,BETTER_AUTH_SECRET:"menus-isolated-test-only-secret-at-least-32",CODE_PEPPER:"menus-test-only-pepper-at-least-32-characters",GOOGLE_CLIENT_ID:"",GOOGLE_CLIENT_SECRET:""},stdio:"ignore" });
  const families = [], users = [];
  async function family() { const {rows:[r]}=await pool.query("INSERT INTO families(name) VALUES('Menus test') RETURNING id");families.push(r.id);return r.id; }
  async function identity(familyId,role) {
    const response=await fetch(`${origin}/api/access/prepare`,{method:"POST",headers:{Origin:origin,"x-forwarded-for":`2001:db8:${randomUUID().slice(0,4)}::1`}});
    assert.equal(response.status,200,await response.clone().text());
    const cookie=response.headers.getSetCookie().map(v=>v.split(";",1)[0]).join("; ");
    const session=await fetch(`${origin}/api/auth/get-session`,{headers:{Cookie:cookie}}).then(r=>r.json());users.push(session.user.id);
    const {rows:[member]}=await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id",[familyId,`Person ${users.length}`,role]);
    await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)",[member.id,session.user.id]);return {id:member.id,cookie};
  }
  async function request(person,path,method="GET",body) {
    const response=await fetch(origin+path,{method,headers:{Cookie:person?.cookie??"",Origin:origin,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json().catch(()=>null)};
  }
  let admin, child, peer, outsider, familyId;
  const today=getDayInTimeZone(), date=addDays(today,1);
  async function meal(person=admin,day=date,type="lunch") {
    const result=await request(person,`/api/meals/planner?weekStart=${startOfWeek(day)}`);assert.equal(result.status,200,JSON.stringify(result));
    return result.body.meals.find(m=>m.date===day&&m.mealType===type);
  }
  async function send(action,person=admin,day=date,type="lunch",version) {
    return request(person,"/api/meals/planner","PUT",{date:day,mealType:type,expectedVersion:version??(await meal(person,day,type)).version,...action});
  }
  async function ok(action,person=admin,day=date,type="lunch") {const result=await send(action,person,day,type);assert.equal(result.status,200,JSON.stringify(result));return result.body;}
  try {
    for(let i=0;;i++){try{if((await fetch(origin)).ok)break;}catch{}if(i>150)throw new Error("Server timeout");await new Promise(r=>setTimeout(r,100));}
    familyId=await family();admin=await identity(familyId,"administrator");child=await identity(familyId,"member");peer=await identity(familyId,"member");outsider=await identity(await family(),"administrator");
    await t.test("new days do not inherit routines and GET has no side effects",async()=>{
      await pool.query("INSERT INTO meal_routines(family_id,member_id,meal_type,starts_on,weekdays,updated_by_member_id) VALUES($1,$2,'lunch',$3,$4,$2)",[familyId,admin.id,today,JSON.stringify(Array(7).fill("home"))]);
      const initial=await meal();assert.equal(initial.plan.people.every(p=>p.status==="unknown"&&p.menu===null),true);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM meal_slots WHERE family_id=$1",[familyId])).rows[0].n,0);
      assert.equal((await request(null,"/api/meals/planner")).status,403);
    });
    await t.test("server enforces self-only children, adult confirmation, family boundaries and past closure",async()=>{
      assert.equal((await send({action:"person",memberId:peer.id,status:"home"},child)).status,403);
      assert.equal((await send({action:"confirm",menu:1,title:"Forbidden"},child)).status,403);
      assert.equal((await send({action:"add-second"},child)).status,403);
      assert.equal((await send({action:"person",memberId:child.id,status:"home"},outsider)).status,400);
      await ok({action:"person",memberId:child.id,status:"packed"},child);
      assert.equal((await meal()).plan.people.find(p=>p.memberId===child.id).menu,1);
      assert.equal((await send({action:"propose",title:"Past"},admin,addDays(today,-1))).status,403);
      assert.equal((await send({action:"person",memberId:child.id,status:"home"},child,date,"breakfast")).status,400);
      await ok({action:"propose",title:"Yogurt"},child,date,"breakfast");
    });
    await t.test("second menu, same dish prevention, home/packed preservation and atomic removal",async()=>{
      await ok({action:"confirm",menu:1,title:"Milanesas"});
      await ok({action:"add-second"});
      assert.equal((await meal()).plan.people.find(p=>p.memberId===child.id).menu,1);
      await ok({action:"person",memberId:child.id,status:"packed",menu:2},child);
      await ok({action:"confirm",menu:2,title:"Ensalada"});
      await ok({action:"person",memberId:child.id,status:"home"},child);
      assert.equal((await meal()).plan.people.find(p=>p.memberId===child.id).menu,2);
      assert.equal((await send({action:"confirm",menu:2,title:"  MILANESAS ",replace:true})).body.code,"DUPLICATE_MENU");
      assert.equal((await send({action:"remove-second"})).status,400);
      assert.equal((await meal()).plan.menus.length,2);
      await ok({action:"remove-second",confirm:true});
      assert.equal((await meal()).plan.people.find(p=>p.memberId===child.id).menu,1);
      assert.equal((await meal()).plan.menus.length,1);
      assert.ok((await meal()).suggestions.some(i=>i.title==="Ensalada"));
      await ok({action:"person",memberId:child.id,status:"unknown"},child);
      assert.equal((await meal()).plan.people.find(p=>p.memberId===child.id).menu,null);
      const saved=(await pool.query("SELECT plan FROM meal_daily_plans WHERE slot_id=$1",[(await meal()).slotId])).rows[0].plan;assert.equal(saved.people.some(p=>p.memberId===child.id),false);
    });
    await t.test("ideas survive replacement, proposals do not confirm, selected edits are rejected",async()=>{
      await ok({action:"propose",title:"Pasta"},peer);
      const before=await meal();assert.equal(before.plan.menus[0].selection.title,"Milanesas");
      const pasta=before.suggestions.find(i=>i.title==="Pasta");
      assert.equal((await send({action:"confirm",menu:1,suggestionId:pasta.id})).body.code,"REPLACE_REQUIRED");
      await ok({action:"confirm",menu:1,suggestionId:pasta.id,replace:true});
      assert.ok((await meal()).suggestions.some(i=>i.title==="Milanesas"));
      const edit=await request(peer,`/api/meals/suggestions/${pasta.id}`,"PATCH",{title:"Edit forbidden",expectedVersion:1});assert.equal(edit.status,409);
    });
    await t.test("two adult confirmations have a single winner and stale undo does not overwrite",async()=>{
      const version=(await meal()).version;
      const results=await Promise.all(["Tarta","Sopa"].map(title=>send({action:"confirm",menu:1,title,replace:true},admin,date,"lunch",version)));
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const current=await meal();assert.ok(["Tarta","Sopa"].includes(current.plan.menus[0].selection.title));
      assert.equal((await send({action:"person",memberId:child.id,status:"away"},admin,date,"lunch",version)).status,409);
    });
    await t.test("saved ideas copy independently and archived/cross-family catalog entries cannot be used",async()=>{
      const created=await request(child,"/api/meals/ideas","POST",{title:"Puré",note:"Sin sal"});assert.equal(created.status,201);const idea=created.body.idea;
      await ok({action:"confirm",menu:1,catalogIdeaId:idea.id,replace:true});
      assert.equal((await request(child,`/api/meals/ideas/${idea.id}`,"PATCH",{title:"Calabaza",expectedVersion:1})).status,200);
      assert.equal((await meal()).plan.menus[0].selection.title,"Puré");
      assert.equal((await request(child,`/api/meals/ideas/${idea.id}`,"PATCH",{action:"archive",expectedVersion:2})).status,200);
      assert.equal((await send({action:"propose",catalogIdeaId:idea.id})).status,400);
      assert.equal((await send({action:"propose",catalogIdeaId:idea.id},outsider)).status,400);
      assert.equal((await request(child,`/api/meals/ideas/${idea.id}`,"PATCH",{action:"restore",expectedVersion:3})).status,200);
    });
    await t.test("compatible legacy snapshots translate and original records are unchanged",async()=>{
      const legacyDate=addDays(today,2);
      const {rows:[slot]}=await pool.query("INSERT INTO meal_slots(family_id,meal_date,meal_type) VALUES($1,$2,'lunch') RETURNING id",[familyId,legacyDate]);
      const {rows:[idea]}=await pool.query("INSERT INTO meal_suggestions(slot_id,author_member_id,title) VALUES($1,$2,'Legacy pasta') RETURNING id",[slot.id,admin.id]);
      const {rows:[group]}=await pool.query("INSERT INTO meal_groups(slot_id,kind,name,is_default,suggestion_id,confirmed_by_member_id,confirmed_at) VALUES($1,'home','Casa',true,$2,$3,now()) RETURNING id",[slot.id,idea.id,admin.id]);
      const participants=[{memberId:admin.id,status:"home",groupId:group.id},{memberId:child.id,status:"packed",groupId:group.id},{memberId:peer.id,status:"away",groupId:null}];
      await pool.query("INSERT INTO meal_distributions(slot_id,participants,updated_by_member_id) VALUES($1,$2,$3)",[slot.id,JSON.stringify(participants),admin.id]);
      const translated=await meal(admin,legacyDate);assert.equal(translated.readOnly,false);assert.equal(translated.plan.menus[0].selection.title,"Legacy pasta");
      assert.equal(translated.plan.people.find(p=>p.memberId===child.id).status,"packed");
      assert.equal((await request(admin,`/api/meals/suggestions/${idea.id}`,"PATCH",{title:"Cannot overwrite original",expectedVersion:1})).status,409);
      await ok({action:"person",memberId:child.id,status:"home"},admin,legacyDate);
      assert.equal((await request(admin,`/api/meals/suggestions/${idea.id}`,"DELETE",{expectedVersion:1})).status,409);
      assert.deepEqual((await pool.query("SELECT participants FROM meal_distributions WHERE slot_id=$1",[slot.id])).rows[0].participants,participants);
      assert.deepEqual((await pool.query("SELECT original FROM meal_daily_plans WHERE slot_id=$1",[slot.id])).rows[0].original.participants,participants);
    });
    await t.test("more than two legacy dishes are read-only and are never truncated in previous information",async()=>{
      const day=addDays(today,3);const {rows:[slot]}=await pool.query("INSERT INTO meal_slots(family_id,meal_date,meal_type) VALUES($1,$2,'lunch') RETURNING id",[familyId,day]);
      for(let i=0;i<3;i++) {const {rows:[idea]}=await pool.query("INSERT INTO meal_suggestions(slot_id,author_member_id,title) VALUES($1,$2,$3) RETURNING id",[slot.id,admin.id,`Old ${i}`]);await pool.query("INSERT INTO meal_groups(slot_id,kind,name,suggestion_id) VALUES($1,$2,$3,$4)",[slot.id,i===0?"home":"packed",`Group ${i}`,idea.id]);}
      const legacy=await meal(admin,day);assert.equal(legacy.readOnly,true);assert.equal(legacy.previous.groups.length,3);
      assert.equal((await send({action:"person",memberId:child.id,status:"home"},admin,day)).body.code,"LEGACY_READ_ONLY");
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM meal_daily_plans WHERE slot_id=$1",[slot.id])).rows[0].n,0);
    });
    await t.test("a database failure rolls back new dish, assignment and audit together",async()=>{
      const day=addDays(today,4);
      await pool.query(`CREATE FUNCTION fail_menus_daily_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM meal_slots WHERE id=NEW.slot_id AND family_id='${familyId}'::uuid AND meal_date='${day}'::date) THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`);
      await pool.query("CREATE TRIGGER fail_menus_daily_test BEFORE INSERT ON meal_daily_plans FOR EACH ROW EXECUTE FUNCTION fail_menus_daily_test()");
      try {assert.equal((await send({action:"confirm",menu:1,title:"Must roll back"},admin,day)).status,500);assert.equal((await pool.query("SELECT count(*)::int AS n FROM meal_slots WHERE family_id=$1 AND meal_date=$2",[familyId,day])).rows[0].n,0);}finally {await pool.query("DROP TRIGGER fail_menus_daily_test ON meal_daily_plans");await pool.query("DROP FUNCTION fail_menus_daily_test()");}
    });
    await t.test("old clients cannot mutate source records or bypass new permissions",async()=>{
      for(const [path,method] of [["attendance","PUT"],["selection","PUT"],["distribution","DELETE"],["groups","POST"],["groups","PATCH"],["groups","DELETE"],["routines","PUT"],["suggestions","POST"]]) assert.equal((await request(child,`/api/meals/${path}`,method,{date,mealType:"lunch"})).status,410,path);
    });
  } finally {
    server.kill();
    for(const id of families){await pool.query("DELETE FROM meal_daily_plans WHERE slot_id IN(SELECT id FROM meal_slots WHERE family_id=$1)",[id]);await pool.query("DELETE FROM meal_distributions WHERE slot_id IN(SELECT id FROM meal_slots WHERE family_id=$1)",[id]);await pool.query("DELETE FROM meal_routines WHERE family_id=$1",[id]);await pool.query("DELETE FROM meal_exceptions WHERE slot_id IN(SELECT id FROM meal_slots WHERE family_id=$1)",[id]);await pool.query("DELETE FROM meal_groups WHERE slot_id IN(SELECT id FROM meal_slots WHERE family_id=$1)",[id]);await pool.query("DELETE FROM meal_selections WHERE slot_id IN(SELECT id FROM meal_slots WHERE family_id=$1)",[id]);await pool.query("DELETE FROM meal_suggestions WHERE slot_id IN(SELECT id FROM meal_slots WHERE family_id=$1)",[id]);await pool.query("DELETE FROM meal_ideas WHERE family_id=$1",[id]);await pool.query("DELETE FROM families WHERE id=$1",[id]);}
    if(users.length)await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[users]);await pool.end();
  }
});
