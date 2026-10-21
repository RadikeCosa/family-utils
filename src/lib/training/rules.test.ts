import assert from "node:assert/strict";
import test from "node:test";
import { calendarDate, effortLabel, LIMITS, todayInZone, validateRoutine, validateSession } from "./rules.ts";
import { cursorScope, decodeCursor, encodeCursor } from "./cursor.ts";
const id = "11111111-1111-4111-8111-111111111111";
const routine = () => ({ name: " Circuito ", blocks: [{ name: "", rounds: 3, exercises: [{ name: "Sentadillas", mode: "repetitions", repetitions: 12 }, { name: "Plancha", mode: "time", seconds: 30 }] }] });
const session = () => ({ ...routine(), sourceRoutineId: id, performedOn: "2026-10-20", durationSeconds: 1500, effort: 7, note: " Dos vueltas " });
test("normalizes a mixed routine and independent session without changing input", () => {
  const input = routine(); const result = validateRoutine(input); assert.equal(result.name, "Circuito"); assert.equal(input.name, " Circuito ");
  result.blocks[0].rounds = 2; assert.equal(input.blocks[0].rounds, 3);
  assert.equal(validateSession(session(), "2026-10-20").note, "Dos vueltas");
  for (const name of ["Bad\0name", "Bad\uD800name"]) assert.throws(() => validateRoutine({ ...input, name }));
});
test("all nested size and numeric boundaries", () => {
  const valid = routine(); valid.name = "😀".repeat(120); valid.blocks[0].name = "😀".repeat(80); valid.blocks[0].rounds = 100;
  valid.blocks[0].exercises[0].repetitions = 1000; valid.blocks[0].exercises[1].seconds = 14400;
  assert.doesNotThrow(() => validateRoutine(valid));
  for (const [field, value] of [["name", "😀".repeat(121)], ["name", "  "], ["blocks", []], ["blocks", Array(21).fill(valid.blocks[0])]] as const) assert.throws(() => validateRoutine({ ...valid, [field]: value }));
  for (const value of [0, -1, 1.5, 101, 1e9, "3", Infinity, NaN]) assert.throws(() => validateRoutine({ ...valid, blocks: [{ ...valid.blocks[0], rounds: value }] }));
  for (const patch of [{ name: "a".repeat(81) }, { exercises: [] }, { exercises: Array(31).fill(valid.blocks[0].exercises[0]) }]) assert.throws(() => validateRoutine({ ...valid, blocks: [{ ...valid.blocks[0], ...patch }] }));
  for (const exercise of [{ name: "", mode: "time", seconds: 1 }, { name: "x", mode: "time", seconds: 14401 }, { name: "x", mode: "repetitions", repetitions: 1001 }, { name: "x", mode: "time", seconds: 2, repetitions: 1 }, { name: "x", mode: "repetitions", repetitions: 2, seconds: null }, { name: "x", mode: "other", seconds: 2 }]) assert.throws(() => validateRoutine({ ...valid, blocks: [{ ...valid.blocks[0], exercises: [exercise] }] }));
  assert.doesNotThrow(() => validateRoutine({ ...valid, blocks: Array(LIMITS.blocks).fill({ ...valid.blocks[0], exercises: Array(LIMITS.exercises).fill(valid.blocks[0].exercises[0]) }) }));
});
test("session date, effort, duration, note and source constraints", () => {
  for (const performedOn of ["2026-10-21", "2025-02-29", "2026-02-30", "0000-01-01", "2026-1-01", "not-a-date"]) assert.throws(() => validateSession({ ...session(), performedOn }, "2026-10-20"));
  assert.equal(calendarDate("2024-02-29"), "2024-02-29");
  for (const patch of [{ durationSeconds: 0 }, { durationSeconds: 86401 }, { durationSeconds: 1.5 }, { effort: 0 }, { effort: 11 }, { effort: 2.5 }, { sourceRoutineId: "bad" }, { note: "😀".repeat(2001) }]) assert.throws(() => validateSession({ ...session(), ...patch }, "2026-10-20"));
  assert.doesNotThrow(() => validateSession({ ...session(), durationSeconds: 86400, note: "😀".repeat(2000) }, "2026-10-20"));
});
test("optional session metrics are explicit nulls, while required mode and zero duration fail", () => {
  const absent = { ...session(), durationSeconds: undefined, effort: undefined };
  assert.throws(() => validateSession(absent, "2026-10-20"));
  const optional = validateSession(absent, "2026-10-20", true);
  assert.equal(optional.durationSeconds, null); assert.equal(optional.effort, null);
  assert.deepEqual(validateSession({ ...session(), durationSeconds: null, effort: null }, "2026-10-20", true), optional);
  for (const durationSeconds of [0, 86401, 1.5]) assert.throws(() => validateSession({ ...session(), durationSeconds }, "2026-10-20", true));
  assert.doesNotThrow(() => validateSession({ ...session(), durationSeconds: 60, effort: null }, "2026-10-20", true));
  assert.doesNotThrow(() => validateSession({ ...session(), durationSeconds: null, effort: 1 }, "2026-10-20", true));
  assert.equal(effortLabel(null), "Sin registrar");
});
test("family day and effort wording have one definition", () => {
  assert.equal(todayInZone("America/Argentina/Buenos_Aires", new Date("2026-10-21T01:30:00Z")), "2026-10-20");
  assert.deepEqual(Array.from({ length: 10 }, (_, i) => effortLabel(i + 1)), ["Suave", "Suave", "Suave", "Moderado", "Moderado", "Moderado", "Intenso", "Intenso", "Máximo", "Máximo"]);
});
test("cursor preserves microseconds and rejects cross-owner/filter reuse", () => {
  const scope = cursorScope(["owner", "family", "sessions"]); const value = { scope, at: "2026-10-20T10:20:30.123456Z", id, date: "2026-10-19" };
  const encoded = encodeCursor(value); assert.deepEqual(decodeCursor(encoded, scope, true), value);
  assert.throws(() => decodeCursor(encoded, cursorScope(["peer"]), true));
  for (const change of [{ at: "invalid" }, { date: "2026-02-30" }, { id: "bad" }]) assert.throws(() => decodeCursor(encodeCursor({ ...value, ...change }), scope, true));
});
