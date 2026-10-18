import assert from "node:assert/strict";
import test from "node:test";
import { buildUfcDashboard, parseUfcOddsBundle, type DashboardEvent, type DashboardFight } from "./ufc-dashboard-rules.ts";

const people = [
  { id: "ana", name: "Ana", archived: false },
  { id: "beto", name: "Beto", archived: true },
  { id: "cami", name: "Cami", archived: false },
];
function bout(id: string, winnerId: string | null, firstOdds: number | null, secondOdds: number | null, choices: DashboardFight["choices"]): DashboardFight {
  return {
    id,eventId:"event",eventTitle:"UFC Test",eventDate:"2026-10-17",
    firstFighter:"Favorito",secondFighter:"Underdog",firstFighterId:"f1",secondFighterId:"f2",
    mainEvent:false,eligible:true,removed:false,result:winnerId ? "winner" : "draw",winnerId,
    firstOdds,secondOdds,bookmaker:"Casa",source:"https://example.com/odds",referenceAt:"2026-10-17T15:00:00Z",choices,
  };
}
function card(fights: DashboardFight[]): DashboardEvent {
  return {id:"event",title:"UFC Test",eventDate:"2026-10-17",fights};
}

test("UFC dashboard ranks hits, handles tie places, absent picks and archived members", () => {
  const fights = [
    bout("1","f1",1.4,3.2,[{memberId:"ana",name:"Ana",winnerId:"f1"},{memberId:"beto",name:"Beto",winnerId:"f2"}]),
    bout("2","f2",2.1,1.8,[{memberId:"ana",name:"Ana",winnerId:"f1"},{memberId:"beto",name:"Beto",winnerId:"f2"}]),
  ];
  const result = buildUfcDashboard([card(fights)],people);
  assert.equal(result.ranking.find((row) => row.memberId === "ana")?.hits,1);
  assert.equal(result.ranking.find((row) => row.memberId === "beto")?.hits,1);
  assert.equal(result.ranking.find((row) => row.memberId === "ana")?.rank,1);
  assert.equal(result.ranking.find((row) => row.memberId === "beto")?.rank,1);
  assert.equal(result.ranking.find((row) => row.memberId === "cami")?.accuracy,null);
  assert.equal(result.ranking.find((row) => row.memberId === "cami")?.participation,0);
  assert.equal(result.ranking.find((row) => row.memberId === "beto")?.archived,true);
});

test("simulation uses decimal returns, refunds void outcomes, and marks incomplete coverage", () => {
  const fights = [
    bout("1","f2",1.4,3.2,[{memberId:"ana",name:"Ana",winnerId:"f2"}]),
    {...bout("2",null,null,null,[{memberId:"ana",name:"Ana",winnerId:"f1"}]),result:"draw" as const},
  ];
  const row = buildUfcDashboard([card(fights)],people).ranking.find((person) => person.memberId === "ana")!;
  assert.equal(row.stake,10);
  assert.equal(row.returned,32);
  assert.equal(row.net,22);
  assert.equal(row.roi,2.2);
  assert.equal(row.financialComplete,false);
});

test("upset recognition ignores unpicked dogs and equal prices and names all correct pickers", () => {
  const fights = [
    bout("1","f2",1.1,5,[{memberId:"cami",name:"Cami",winnerId:"f1"}]),
    {...bout("2","f1",3.4,2,[{memberId:"ana",name:"Ana",winnerId:"f1"},{memberId:"beto",name:"Beto",winnerId:"f1"}]),id:"2"},
    {...bout("3","f2",2.4,2.4,[{memberId:"cami",name:"Cami",winnerId:"f2"}]),id:"3"},
  ];
  const result = buildUfcDashboard([card(fights)],people);
  assert.equal(result.upsetOfNight.winners.length,1);
  assert.equal(result.upsetOfNight.winners[0].odds,3.4);
  assert.deepEqual(result.upsetOfNight.winners[0].correct.map((person) => person.name),["Ana","Beto"]);
});

test("odds bundle validates odds bounds, duplicate fights and source metadata", () => {
  const bundle = {version:1,source:"https://example.com/archive",events:[{eventId:"event",bookmaker:"Book",referenceAt:"2026-10-17T15:00:00Z",fights:[{fightId:"fight",firstOdds:1.2,secondOdds:4.5}]}]};
  assert.ok(parseUfcOddsBundle(bundle,new Date("2026-10-18T00:00:00Z")));
  assert.equal(parseUfcOddsBundle({...bundle,events:[{...bundle.events[0],fights:[{fightId:"fight",firstOdds:1,secondOdds:4.5}]}]},new Date("2026-10-18T00:00:00Z")),null);
  assert.equal(parseUfcOddsBundle({...bundle,events:[{...bundle.events[0],fights:[...bundle.events[0].fights,...bundle.events[0].fights]}]},new Date("2026-10-18T00:00:00Z")),null);
  assert.equal(parseUfcOddsBundle({...bundle,events:[{...bundle.events[0],referenceAt:"2026-10-19T00:00:00Z"}]},new Date("2026-10-18T00:00:00Z")),null);
});
