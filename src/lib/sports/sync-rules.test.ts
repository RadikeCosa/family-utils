import test from "node:test";
import assert from "node:assert/strict";
import { failureBackoffMinutes, riverSyncDecision, ufcHorizon, ufcSyncDecision } from "./sync-rules.ts";

const fresh=()=>({consecutiveFailures:0,nextAttemptAt:null,leaseUntil:null,lastSuccessAt:null,coveredThrough:null});
const event=(eventDate:string,extra:Record<string,unknown>={})=>({eventDate,startsAt:null,status:"scheduled",sourceProvider:"espn",sourceAbsentAt:null,...extra}) as {eventDate:string;startsAt:string|null;status:string;sourceProvider:string;sourceAbsentAt:null;mainCardStartsAt?:string};

test("completeness checks cause no network work when the stored horizons are complete",()=>{
 const now=new Date("2026-10-15T15:00:00Z");
 const river=riverSyncDecision({riverEvents:[event("2026-10-18",{startsAt:"2026-10-18T23:00:00Z"}),event("2026-10-25",{startsAt:"2026-10-26T00:00:00Z"}),event("2026-11-01",{startsAt:"2026-11-01T18:00:00Z"})],ufcEvents:[],river:{...fresh(),lastSuccessAt:"2026-10-15T12:00:00Z",coveredThrough:"2026-12-31"},ufc:fresh(),ufcListingCoversThrough:null},now);
 assert.equal(river.needed,false);
 const horizon=ufcHorizon(now);
 const ufc=ufcSyncDecision({riverEvents:[],ufcEvents:[],river:fresh(),ufc:{...fresh(),lastSuccessAt:"2026-10-15T12:00:00Z",coveredThrough:horizon.through},ufcListingCoversThrough:horizon.through},now);
 assert.equal(ufc.needed,false);
});

test("a passed River match and a new Argentine UFC week reopen the horizon",()=>{
 const now=new Date("2026-10-19T03:00:01Z");
 const river=riverSyncDecision({riverEvents:[event("2026-10-18",{startsAt:"2026-10-18T23:00:00Z"})],ufcEvents:[],river:{...fresh(),coveredThrough:"2026-12-31",lastSuccessAt:"2026-10-18T20:00:00Z"},ufc:fresh(),ufcListingCoversThrough:null},now);
 assert.equal(river.needed,true);
 const newHorizon=ufcHorizon(now);
 const old=ufcSyncDecision({riverEvents:[],ufcEvents:[],river:fresh(),ufc:{...fresh(),coveredThrough:"2026-10-26",lastSuccessAt:"2026-10-19T02:30:00Z"},ufcListingCoversThrough:"2026-10-26"},now);
 assert.equal(newHorizon.from,"2026-10-19");assert.equal(old.needed,true);
});

test("River confirms no further events without repeating solely for the three-match count",()=>{
 const now=new Date("2026-10-15T15:00:00Z");
 const result=riverSyncDecision({riverEvents:[event("2026-10-18",{startsAt:"2026-10-18T23:00:00Z"})],ufcEvents:[],river:{...fresh(),coveredThrough:"2026-12-31",lastSuccessAt:"2026-10-15T12:00:00Z"},ufc:fresh(),ufcListingCoversThrough:null},now);
 assert.equal(result.needed,false);
});

test("River pending kickoff is reviewed every six hours only inside the fourteen-day window",()=>{
 const now=new Date("2026-10-15T15:00:00Z");
 const make=(date:string,last:string)=>riverSyncDecision({riverEvents:[event(date),event("2026-11-20"),event("2026-11-30")],ufcEvents:[],river:{...fresh(),lastSuccessAt:last,coveredThrough:"2026-12-31"},ufc:fresh(),ufcListingCoversThrough:null},now);
 assert.equal(make("2026-10-20","2026-10-15T08:00:00Z").eligible,true);
 assert.equal(make("2026-10-20","2026-10-15T12:00:00Z").eligible,false);
 assert.equal(make("2026-11-10","2026-10-15T12:00:00Z").needed,false);
});

test("a successful category horizon honors the UFC twelve-hour review window",()=>{
 const now=new Date("2026-10-15T15:00:00Z"),h=ufcHorizon(now);
 const facts={riverEvents:[],ufcEvents:[],river:fresh(),ufc:{...fresh(),coveredThrough:h.through,lastSuccessAt:"2026-10-15T02:00:00Z"},ufcListingCoversThrough:h.through};
 assert.equal(ufcSyncDecision(facts,now).needed,true);
 assert.equal(ufcSyncDecision(facts,new Date("2026-10-15T13:30:00Z")).needed,false);
});

test("UFC checks a card inside seven days from category success, and a due partial card bypasses one-hour spacing",()=>{
 const now=new Date("2026-10-15T15:00:00Z"),h=ufcHorizon(now);const base={riverEvents:[],ufcEvents:[{eventDate:"2026-10-17",mainCardStartsAt:"2026-10-18T00:00:00Z",status:"scheduled",sourceProvider:"ufc_official",sourceAbsentAt:null}],river:fresh(),ufcListingCoversThrough:h.through};
 const older=ufcSyncDecision({...base,ufc:{...fresh(),coveredThrough:h.through,lastSuccessAt:"2026-10-15T02:00:00Z"}},now);
 assert.equal(older.needed,true);
 const partial=ufcSyncDecision({...base,ufc:{...fresh(),lastSuccessAt:"2026-10-15T14:30:00Z"},ufcPartial:true,ufcPendingRetryDue:true},now);
 assert.equal(partial.eligible,true);
});

test("failure backoff grows and a complete success resets it",()=>{
 assert.deepEqual([failureBackoffMinutes(1),failureBackoffMinutes(2),failureBackoffMinutes(3)],[10,60,360]);
 const state={...fresh(),consecutiveFailures:3,lastSuccessAt:"2026-10-15T12:00:00Z",nextAttemptAt:null};
 assert.equal(state.consecutiveFailures,3); // successful persistence writes this back to zero.
});

test("UFC official horizon is three Monday-to-Sunday Argentine weeks",()=>{
 assert.deepEqual(ufcHorizon(new Date("2026-10-19T02:59:00Z")),{from:"2026-10-12",through:"2026-11-02",weeks:3});
 assert.deepEqual(ufcHorizon(new Date("2026-10-19T03:00:00Z")),{from:"2026-10-19",through:"2026-11-09",weeks:3});
});
