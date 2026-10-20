import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChampionsBundle } from '../src/lib/sports/champions-rules.ts';
for (const [round, from, through] of [[4,'2026-11-03','2026-11-04'],[5,'2026-11-24','2026-11-25']]) {
  test(`verified Champions jornada ${round}: 18 matches, 36 teams and November timezone`, () => {
    const raw=JSON.parse(readFileSync(new URL(`../sources/champions/2026-27-jornada-${round}-agenda.json`,import.meta.url)));
    const parsed=parseChampionsBundle(raw,new Date(raw.checkedAt));
    assert.deepEqual(parsed.issues,[]);
    const r=parsed.bundle.rounds[0];
    assert.equal(r.reference,`league-${round}`);
    assert.equal(r.originalFrom,from);assert.equal(r.originalThrough,through);
    assert.equal(r.matches.length,18);
    assert.equal(new Set(r.matches.flatMap(m=>[m.homeTeam,m.awayTeam])).size,36);
    assert.equal(new Set(r.matches.map(m=>m.externalIds.uefa)).size,18);
    assert.equal(r.matches.filter(m=>m.startsAt.endsWith('T17:45:00.000Z')).length,4);
    assert.equal(r.matches.filter(m=>m.startsAt.endsWith('T20:00:00.000Z')).length,14);
    assert.ok(r.matches.every(m=>m.source.uefaUrl.includes(`/match/${m.externalIds.uefa}--`)));
  });
}
