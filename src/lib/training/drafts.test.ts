import assert from "node:assert/strict";
import test from "node:test";
import { HANDOFF_TTL, clearTrainingHandoffs, readTrainingHandoff, saveTrainingHandoff } from "./drafts.ts";
test("handoff is scoped, expires absolutely, and is cleared after use without local storage", t => {
  const data: Record<string, string> = {};
  const storage = new Proxy({ getItem: (key: string) => data[key] ?? null, setItem: (key: string, value: string) => { data[key] = value; }, removeItem: (key: string) => { delete data[key]; } }, { ownKeys: () => Object.keys(data), getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }) });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} }); Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  t.after(() => { Reflect.deleteProperty(globalThis, "window"); Reflect.deleteProperty(globalThis, "sessionStorage"); });
  let now = 1000; t.mock.method(Date, "now", () => now);
  const input = { date: "2026-11-10", kind: "rest" as const, plan: null, result: {}, disposition: "open" as const, sourceRoutineId: null };
  assert.equal(saveTrainingHandoff("family:a", input), true);
  assert.equal(readTrainingHandoff("family:a")?.expiresAt, 1000 + HANDOFF_TTL);
  now += HANDOFF_TTL - 1; assert.ok(readTrainingHandoff("family:a"));
  now++; assert.equal(readTrainingHandoff("family:a"), null); assert.equal(Object.keys(data).length, 0);
  saveTrainingHandoff("family:a", input); assert.equal(readTrainingHandoff("family:b"), null); assert.equal(Object.keys(data).length, 0);
  saveTrainingHandoff("family:b", input); clearTrainingHandoffs(); assert.equal(Object.keys(data).length, 0);
});
