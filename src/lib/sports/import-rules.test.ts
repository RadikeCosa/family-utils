import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSportsCuratedBundle, parseSingleUfcCardImport, sportsBundleSummary } from "./import-rules.ts";

const snapshot = JSON.parse(readFileSync(new URL("../../../sources/deportes-carga-2026-10-15.json", import.meta.url), "utf8")) as Record<string, unknown>;
const checkedAt = new Date(String(snapshot.checkedAt));

test("accepts the curated snapshot and counts all events and fights", () => {
  const result = parseSportsCuratedBundle(snapshot, new Date(checkedAt.getTime() + 60_000));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(sportsBundleSummary(result.bundle), {
    riverMatches: 3,
    ufcCards: 3,
    ufcFights: 35,
    through: { river: "2026-11-01", ufc: "2026-11-01" },
  });
});

test("rejects a stale snapshot", () => {
  const result = parseSportsCuratedBundle(snapshot, new Date(checkedAt.getTime() + 31 * 86400_000));
  assert.equal(result.ok, false);
});

test("rejects a card whose fight list is not complete per its evidence", () => {
  const changed = structuredClone(snapshot) as { events: Array<Record<string, unknown>> };
  const card = changed.events.find(event => event.kind === "ufc_card");
  assert.ok(card && Array.isArray(card.fights));
  (card.fights as unknown[]).pop();
  const result = parseSportsCuratedBundle(changed, new Date(checkedAt.getTime() + 60_000));
  assert.equal(result.ok, false);
});

test("rejects duplicate provider references in a bundle", () => {
  const changed = structuredClone(snapshot) as { events: Array<Record<string, unknown>> };
  changed.events[1].externalReference = changed.events[0].externalReference;
  const result = parseSportsCuratedBundle(changed, new Date(checkedAt.getTime() + 60_000));
  assert.equal(result.ok, false);
});

import { agendaExample, singleUfcCardExample } from "./templates.ts";
test("agenda example validates and location fields distinguish absent from null", () => {
  const now = new Date();
  const example = agendaExample(now);
  const parsed = parseSportsCuratedBundle(example, now);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const card = parsed.bundle.events.find(event => event.kind === "ufc_card");
  assert.equal(card?.kind === "ufc_card" && card.location.eventType, "fight_night");
  const changed = structuredClone(example) as unknown as {events:Array<Record<string,unknown>>};
  const raw = changed.events[1]; delete raw.city; raw.venue = null;
  const next = parseSportsCuratedBundle(changed, now);
  assert.equal(next.ok, true);
  if(next.ok){const c=next.bundle.events[1];if(c.kind==="ufc_card"){assert.equal(Object.hasOwn(c.location,"city"),false);assert.equal(c.location.venue,null);}}
  raw.eventType = "unknown";
  assert.equal(parseSportsCuratedBundle(changed,now).ok,false);
});


test("single UFC import requires only a complete card and rejects ambiguous or invalid input", () => {
  const now = new Date();
  const single = singleUfcCardExample(now);
  const parsed = parseSingleUfcCardImport(single, now);
  assert.equal(parsed.ok, true);
  assert.equal(parseSportsCuratedBundle(single, now).ok, false);
  type MutableCard = ReturnType<typeof singleUfcCardExample> & { events?: unknown[] };
  const mutations = [
    (v) => { v.event.source.validation!.officialFightCount++; },
    (v) => { v.event.fights!.push({ ...v.event.fights![0] }); v.event.source.validation!.officialFightCount++; },
    (v) => { v.event.mainCardTime = "25:99"; },
    (v) => { v.event.source.primary = "https://untrusted.example/card"; },
    (v) => { v.checkedAt = new Date(now.getTime() - 31 * 86400000).toISOString(); },
    (v) => { v.event.source.checkedAt = new Date(now.getTime() - 31 * 86400000).toISOString(); },
    (v) => { v.event.fights![0].isMainEvent = false; },
    (v) => { Object.assign(v.event, { kind: "football_match" }); },
    (v) => { v.events = [v.event]; },
    (v) => { Object.assign(v, { status: undefined }); },
  ] as Array<(v: MutableCard) => void>;
  for (const mutate of mutations) {
    const changed = structuredClone(single);
    mutate(changed);
    assert.equal(parseSingleUfcCardImport(changed, now).ok, false);
  }
});
