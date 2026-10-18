import assert from "node:assert/strict";
import test from "node:test";
import { parseChampionsResults } from "./champions-results-rules.ts";
const now=new Date('2026-10-17T12:00:00Z');
const valid=()=>({schemaVersion:1,sport:'champions',type:'results',period:'90_minutes',checkedAt:now.toISOString(),roundId:'00000000-0000-4000-8000-000000000001',results:[{eventId:'00000000-0000-4000-8000-000000000002',homeGoals:0,awayGoals:0,source:'https://www.uefa.com/uefachampionsleague/'}]});
test('Champions results accept a definitive 90-minute draw and reject extra time, penalties and partial scores',()=>{
 assert.equal(parseChampionsResults(valid(),now).issues.length,0);
 for(const key of ['extraTime','penalties','partial','aggregate']){const b=valid();Object.assign(b.results[0],{[key]:true});assert.ok(parseChampionsResults(b,now).issues.some(i=>i.path.endsWith(key)));}
 const wrong=valid();wrong.period='120_minutes';assert.ok(parseChampionsResults(wrong,now).issues.some(i=>i.path==='period'));
});
test('Champions results collect all score, reference and source errors',()=>{
 const b=valid();b.results[0].homeGoals=-1;b.results[0].awayGoals=1.5;b.results[0].source='https://example.com';b.results.push({...b.results[0]});
 const parsed=parseChampionsResults(b,now);assert.equal(parsed.bundle,null);assert.equal(parsed.issues.length,7);
});
