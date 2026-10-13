import assert from "node:assert/strict";
import test from "node:test";
import { addSecondMenu, canChangePerson, changePerson, duplicateMenu, emptyPlan, menuSummary, participationSummary, removeSecondMenu, translateLegacy, type LegacyInput } from "./daily.ts";
const ids = ["a", "b", "c", "d"];
const legacy = (overrides: Partial<LegacyInput> = {}): LegacyInput => ({ memberIds: ids, groups: [], suggestions: [], participants: [], attendance: [], selection: null, ...overrides });

test("unknown is no choice and never implies no preparation", () => {
  let plan = emptyPlan(ids);
  assert.equal(participationSummary(plan.people), "Falta definir");
  plan = changePerson(changePerson(changePerson(plan,"a","home"),"b","home"),"c","packed");
  assert.equal(participationSummary(plan.people), "2 en casa · 1 para llevar · 1 por definir");
  const away = ids.slice(0,3).reduce((p,id) => changePerson(p,id,"away"),emptyPlan(ids));
  assert.equal(participationSummary(away.people), "0 para preparar · 1 por definir");
  assert.equal(participationSummary(changePerson(away,"d","away").people), "No hay que preparar");
});
test("second menu retains assignments, removal returns them to first, packed/home preserves dish", () => {
  let plan = addSecondMenu(changePerson(emptyPlan(ids),"a","home"));
  assert.equal(plan.people[0].menu,1);
  assert.equal(menuSummary(plan,2), "Sin personas asignadas");
  plan = changePerson(plan,"a","packed",2);
  plan = changePerson(plan,"a","home");
  assert.equal(plan.people[0].menu,2);
  assert.equal(removeSecondMenu(plan).people[0].menu,1);
  assert.equal(removeSecondMenu(plan).menus.length,1);
  assert.equal(changePerson(plan,"a","away").people[0].menu,null);
  assert.equal(changePerson(changePerson(plan,"a","unknown"),"a","packed").people[0].menu,1);
});
test("permissions and duplicate dishes", () => {
  assert.equal(canChangePerson("administrator","a","b"),true);
  assert.equal(canChangePerson("member","a","b"),false);
  assert.equal(canChangePerson("member","a","a"),true);
  const plan = addSecondMenu(emptyPlan(ids));
  const selection = {suggestionId:"idea",title:"Puré",note:null,confirmedByMemberId:"adult",confirmedAt:null};
  plan.menus[0].selection = selection;
  assert.equal(duplicateMenu(plan,2,{...selection,suggestionId:"another",title:"  PURÉ "}),true);
});
test("legacy snapshots and explicit states translate without inventing choices", () => {
  const input = legacy({groups:[{id:"home",kind:"home",followsHome:false,suggestionId:"dish",confirmedAt:null,confirmedByMemberId:"a"},{id:"packed",kind:"packed",followsHome:true,suggestionId:null,confirmedAt:null,confirmedByMemberId:null}],suggestions:[{id:"dish",title:"Pasta",note:null}],participants:[{memberId:"a",status:"home",groupId:"home"},{memberId:"b",status:"packed",groupId:"packed"},{memberId:"c",status:"away",groupId:null}]});
  const original = structuredClone(input), result = translateLegacy(input);
  assert.equal(result.readOnly,false);
  assert.equal(result.plan.menus.length,1);
  assert.deepEqual(result.plan.people.map(p=>[p.status,p.menu]),[["home",1],["packed",1],["away",null],["unknown",null]]);
  assert.deepEqual(input,original);
  assert.equal(translateLegacy(legacy({attendance:[{memberId:"a",status:"present"},{memberId:"b",status:"absent"}]})).plan.people[1].status,"away");
});
test("incompatible legacy plans remain read-only, including broken group references", () => {
  const groups = [1,2,3].map(n=>({id:`g${n}`,kind:n===1?"home":"packed",followsHome:false,suggestionId:`s${n}`,confirmedAt:null,confirmedByMemberId:null}));
  assert.equal(translateLegacy(legacy({groups,suggestions:[1,2,3].map(n=>({id:`s${n}`,title:`Dish ${n}`,note:null}))})).readOnly,true);
  assert.equal(translateLegacy(legacy({participants:[{memberId:"a",status:"packed",groupId:"broken"}]})).readOnly,true);
  assert.equal(translateLegacy(legacy({groups:[groups[0]]})).readOnly,true);
  assert.equal(translateLegacy(legacy()).plan.people.every(p=>p.status==="unknown"),true);
});
