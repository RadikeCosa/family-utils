import assert from "node:assert/strict";
import test from "node:test";
import { parseChampionsBundle, selectChampionsRound, utcKickoff, zonedKickoff } from "./champions-rules.ts";
import { championsBundle } from "../../../tests/helpers/champions-bundle.ts";
const now = new Date("2026-10-17T12:00:00Z");
test("European kickoff is converted on each side of the October DST change",()=>{
  assert.equal(zonedKickoff({date:"2026-10-20",time:"21:00",timeZone:"Europe/Paris"}),"2026-10-20T19:00:00.000Z");
  assert.equal(zonedKickoff({date:"2026-11-04",time:"21:00",timeZone:"Europe/Paris"}),"2026-11-04T20:00:00.000Z");
  assert.equal(zonedKickoff({date:"2026-10-25",time:"02:30",timeZone:"Europe/Paris"}),null);
  assert.equal(zonedKickoff({date:"2026-10-20",time:"21:00"}),null);
  assert.equal(utcKickoff("2026-10-20T21:00:00"),null);
});
test("agenda validation collects errors together and rejects participant and provider ambiguity",()=>{
  const bundle=championsBundle(now);bundle.rounds[0].matches[0].homeTeam="unknown";bundle.rounds[0].matches[1].awayTeam="unknown";bundle.rounds[0].originalThrough="2026-10-01";
  const result=parseChampionsBundle(bundle,now);assert.ok(result.issues.length>=3);assert.ok(result.issues.some(e=>e.path.endsWith("homeTeam")));assert.ok(result.issues.some(e=>e.path.endsWith("awayTeam")));
});
test("UEFA confirmation is required for a kickoff and local time is normalized during import",()=>{
  const bundle=championsBundle(now);assert.equal(parseChampionsBundle(bundle,now).issues.length,0);
  bundle.rounds[0].matches[0].source.kickoffConfirmed=false;assert.ok(parseChampionsBundle(bundle,now).issues.length>0);
  const local=championsBundle(now) as unknown as Record<string,unknown>;
  const match=(local.rounds as Array<{matches:Array<Record<string,unknown>>}>)[0].matches[0];delete match.startsAt;match.localStart={date:match.eventDate,time:"21:00",timeZone:"Europe/Paris"};
  const parsed=parseChampionsBundle(local,now);assert.equal(parsed.issues.length,0);assert.match(parsed.bundle!.rounds[0].matches[0].startsAt!,/T19:00:00.000Z$/);
});
test("jornada navigation uses original windows and keeps old partial jornadas accessible",()=>{
  const rounds=[{id:"old",originalFrom:"2026-10-01",originalThrough:"2026-10-02"},{id:"next",originalFrom:"2026-10-20",originalThrough:"2026-10-21"}];
  assert.equal(selectChampionsRound(rounds,"2026-10-17")?.id,"next");assert.equal(selectChampionsRound(rounds,"2026-10-01")?.id,"old");assert.equal(selectChampionsRound(rounds,"2026-10-22")?.id,"next");assert.equal(selectChampionsRound(rounds,"2026-10-17","old")?.id,"old");
});
