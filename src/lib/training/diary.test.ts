import assert from "node:assert/strict";
import test from "node:test";
import { addCivilDays, civilWeekStart, dayInZone, nextCivilDayAt } from "../calendar/civil.ts";
import { countsLabel, dayIndicator, diaryDate, diaryStatus, diaryWeek, emptyCounts, validateDiary, weekDates } from "./diary.ts";
const today = "2026-11-10";
const entry = (patch: Record<string, unknown> = {}) => ({ date: today, kind: "training", plan: null, result: { text: " Caminé 40 minutos " }, disposition: "open", sourceRoutineId: null, ...patch });
test("a phrase is sufficient; content presence distinguishes rest from invalid training", () => {
  assert.equal(validateDiary(entry(), today).result?.text, "Caminé 40 minutos");
  for (const patch of [{ plan: null, result: null }, { result: {} }, { result: { durationSeconds: 100 } }, { result: { text: "x", extra: true } }, { extra: true }, { result: { text: "x", blocks: {} } }, { result: { text: "x", effort: 11 } }]) assert.throws(() => validateDiary(entry(patch), today));
  assert.deepEqual(validateDiary(entry({ kind: "rest", plan: {}, result: null }), today).plan, {});
  assert.deepEqual(validateDiary(entry({ kind: "rest", result: {} }), today).result, {});
  assert.throws(() => validateDiary(entry({ kind: "rest", result: { blocks: [] } }), today));
  assert.throws(() => validateDiary(entry({ date: "2026-11-11" }), today));
  assert.throws(() => validateDiary(entry({ disposition: "skipped" }), today));
});
test("states derive from the family date, with independent archive precedence", () => {
  const base = { archivedAt: null, result: null, date: today, disposition: "open" as const };
  assert.equal(diaryStatus(base, today), "planned");
  assert.equal(diaryStatus(base, "2026-11-11"), "missed");
  assert.equal(diaryStatus({ ...base, disposition: "skipped" }, today), "missed");
  assert.equal(diaryStatus({ ...base, result: {} }, today), "completed");
  assert.equal(diaryStatus({ ...base, archivedAt: "2026-01-01" }, today), "archived");
  const counts = { ...emptyCounts(), training_completed: 1, training_missed: 1, rest_completed: 1 };
  assert.equal(dayIndicator(counts), "No realizado"); assert.match(countsLabel(counts), /descanso realizado/);
});
test("strict civil dates, Monday weeks, leap years and limited boundary weeks", () => {
  for (const day of ["1899-12-31", "2201-01-01", "2026-02-30", "2026-1-01", "0099-01-01", "bad"]) assert.throws(() => diaryDate(day));
  assert.equal(diaryDate("2000-02-29"), "2000-02-29"); assert.throws(() => diaryDate("1900-02-29"));
  assert.equal(addCivilDays("1999-12-31", 1), "2000-01-01");
  assert.equal(civilWeekStart(today), "2026-11-09"); assert.throws(() => diaryWeek(today));
  assert.equal(weekDates(diaryWeek("2200-12-29")).at(-1), "2200-12-31");
});
test("server family day ignores device zone and rolls over at civil midnight, including DST", () => {
  const before = new Date("2026-11-11T02:59:59.999Z"), zone = "America/Argentina/Buenos_Aires";
  assert.equal(dayInZone(before, zone), today); assert.equal(nextCivilDayAt(before, zone).toISOString(), "2026-11-11T03:00:00.000Z");
  assert.equal(dayInZone(new Date("2026-11-11T03:00:00Z"), zone), "2026-11-11");
  assert.equal(dayInZone(before, "Asia/Tokyo"), "2026-11-11");
  const dst = new Date("2026-03-08T05:00:00Z");
  assert.equal(nextCivilDayAt(dst, "America/New_York").getTime() - dst.getTime(), 23 * 3600_000);
});
