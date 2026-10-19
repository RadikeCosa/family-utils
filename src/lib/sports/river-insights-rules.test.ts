import assert from "node:assert/strict";
import test from "node:test";
import {parseRiverInsights} from "./river-insights-rules.ts";
const now=new Date("2026-10-18T20:00:00Z"),meta={source:"https://www.cariverplate.com.ar/",checkedAt:now.toISOString()};
const base={version:1,eventId:"11111111-1111-4111-8111-111111111111"};
test("insights allow independent sections, explicit zero and unknown values",()=>{
 const value=parseRiverInsights({...base,statistics:{...meta,items:[{label:"Remates",homeValue:0,awayValue:null}]}},now);
 assert.equal(value?.statistics?.items[0].homeValue,0);assert.equal(value?.statistics?.items[0].awayValue,null);assert.ok(!Object.hasOwn(value!,"curiosities"));
 assert.ok(parseRiverInsights({...base,curiosities:{...meta,items:[]}},now));
 for(const patch of [{},{statistics:null},{statistics:{...meta,items:[{label:"Remates",homeValue:null,awayValue:null}]}},{statistics:{...meta,items:[{label:"Remates",homeValue:-1,awayValue:1}]}},{curiosities:{...meta,items:[" "]}},{curiosities:{...meta,source:"javascript:alert(1)",items:["Texto"]}},{curiosities:{...meta,checkedAt:"invalid",items:["Texto"]}},{curiosities:{...meta,items:["x".repeat(501)]}}])assert.equal(parseRiverInsights({...base,...patch},now),null);
});
