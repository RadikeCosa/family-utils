import assert from "node:assert/strict";
import test from "node:test";
import { addCivilDays, civilWeekStart, dayInZone, nextCivilDayAt } from "../calendar/civil.ts";
import { countsLabel, dayIndicator, diaryDate, diaryStatus, diaryWeek, emptyCounts, validateDiary, weekDates, diaryContent, mergeDiaryContent } from "./diary.ts";
import { activityTiming, clockCandidates, timingFromClocks, timingDuration, formatActivityDuration } from "./timing.ts";
const today = "2026-11-10";
const entry = (patch: Record<string, unknown> = {}) => ({ date: today, kind: "training", plan: null, result: { text: " Caminé 40 minutos " }, disposition: "open", sourceRoutineId: null, ...patch });
test("real durations resolve gaps, folds, overnight sessions and inclusive 24h", () => {
  assert.equal(formatActivityDuration(6300), "1 h 45 min");
  const zone = "America/New_York";
  assert.deepEqual(clockCandidates("2026-03-08", "02:30", zone), []);
  assert.equal(clockCandidates("2026-11-01", "01:30", zone).length, 2);
  assert.throws(() => timingFromClocks("2026-11-01", "01:30", "03:00", false, zone), /dos veces/);
  assert.equal(timingDuration(timingFromClocks("2026-03-08", "01:30", "03:30", false, zone)), 3600);
  assert.equal(timingDuration(timingFromClocks("2026-03-07", "12:00", "12:00", true, zone)), 23 * 3600);
  assert.throws(() => timingFromClocks("2026-10-31", "12:00", "12:00", true, zone), /24 horas/);
  assert.equal(timingDuration(timingFromClocks(today, "12:00", "12:00", true, "UTC")), 86400);
  assert.throws(() => timingFromClocks(today, "12:00", "12:00", false, "UTC"));
  assert.throws(() => timingFromClocks(today, "23:00", "01:00", false, "UTC"), /día siguiente/);
  assert.throws(() => timingFromClocks(today, "", "01:00", false, "UTC"));
  assert.throws(() => timingFromClocks("2200-12-31", "23:00", "01:00", true, "UTC"));
  assert.throws(() => activityTiming({ startAt: "2026-02-30T12:00:00Z", endAt: "2026-03-02T12:00:00Z", timeZone: "UTC" }));
});
test("timing omissions preserve snapshots; explicit null clears hours and duration", () => {
  const timing = timingFromClocks(today, "10:00", "11:00", false, "UTC"), previous = { text: "Corrí", timing, durationSeconds: 3600 };
  const merged = diaryContent(mergeDiaryContent({ text: "Editado", durationSeconds: 99 }, previous), "training")!;
  assert.deepEqual(merged.timing, timing); assert.equal(merged.durationSeconds, 3600);
  assert.equal(diaryContent(mergeDiaryContent({ text: "Editado" }, { text: "x", durationSeconds: 80 }), "training")!.durationSeconds, 80);
  assert.equal(diaryContent(mergeDiaryContent({ text: "Editado", timing: null }, previous), "training")!.durationSeconds, null);
  assert.throws(() => diaryContent({ text: "x", timing: { startAt: timing.startAt } }, "training"));
  assert.throws(() => validateDiary(entry({ date: "2026-11-09", result: previous }), today));
  assert.doesNotThrow(() => validateDiary(entry({ plan: { ...previous, timing: timingFromClocks("2026-11-09", "10:00", "11:00", false, "UTC") }, result: previous }), today));
});
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
