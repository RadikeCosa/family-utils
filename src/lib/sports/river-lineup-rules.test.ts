import assert from "node:assert/strict";
import test from "node:test";
import { parseRiverLineup } from "./river-lineup-rules.ts";
const now = new Date("2026-10-18T20:00:00Z");
const bundle = {version:1,eventId:"11111111-1111-4111-8111-111111111111",body:" Titulares\nSuplentes ",source:"https://www.cariverplate.com.ar/formacion",checkedAt:now.toISOString()};
test("lineup requires a real event, bounded text, HTTPS source and non-future review",()=>{
 assert.equal(parseRiverLineup(bundle,now)?.body,"Titulares\nSuplentes");
 for(const patch of [{version:2},{eventId:"bad"},{body:" "},{body:"a".repeat(4001)},{source:"javascript:alert(1)"},{source:"http://example.com"},{source:"https://user:pass@example.com"},{checkedAt:"bad"},{checkedAt:"2026-10-19T00:00:00Z"},{example:true}])assert.equal(parseRiverLineup({...bundle,...patch},now),null);
 assert.ok(parseRiverLineup({...bundle,body:"⚽".repeat(4000)},now));
});
