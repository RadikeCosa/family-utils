import assert from "node:assert/strict";
import test from "node:test";
import { codePointLength, contributionInput, experienceInput, familyDay, normalizeLibraryText, personalInput, workInput } from "./rules.ts";
import { libraryEnabled } from "./config.ts";

test("library normalizes accents, case and whitespace consistently", () => {
  assert.equal(normalizeLibraryText("  CANCIÓN  del\n verano  "), "cancion del verano");
  assert.equal(normalizeLibraryText("cancio\u0301n"), "cancion");
});
test("Unicode limits count code points instead of UTF-16 units", () => {
  assert.equal(codePointLength("😀"), 1);
  assert.equal(codePointLength("👩‍👩‍👦"), 5);
  assert.ok(workInput({ title: "😀".repeat(200), kind: "movie" }));
  assert.equal(workInput({ title: "😀".repeat(201), kind: "movie" }), null);
  assert.equal(workInput({ title: "A", kind: "movie", referenceUrl: "javascript:alert(1)" }), null);
  assert.equal(workInput({ title: "A", kind: "unknown" }), null);
  assert.equal(workInput({ title: "A", kind: "movie", year: 1.5 }), null);
});
test("partial experience dates preserve precision and reject invalid or wholly future periods", () => {
  const today = "2026-10-12";
  assert.deepEqual(experienceInput({ year: 2015 }, today), { year: 2015, month: null, day: null });
  assert.ok(experienceInput({ year: 2026 }, today));
  assert.ok(experienceInput({ year: 2026, month: 10 }, today));
  assert.equal(experienceInput({ year: 2026, month: 11 }, today), null);
  assert.equal(experienceInput({ year: 2027 }, today), null);
  assert.equal(experienceInput({ year: 2026, month: 10, day: 13 }, today), null);
  assert.equal(experienceInput({ month: 2 }, today), null);
  assert.equal(experienceInput({ year: 2015, day: 1 }, today), null);
  assert.equal(experienceInput({ year: 2025, month: 2, day: 29 }, today), null);
  assert.ok(experienceInput({ year: 2024, month: 2, day: 29 }, today));
  assert.ok(experienceInput({ year: 1, month: 2, day: 28 }, today));
  assert.equal(familyDay(new Date("2026-10-13T01:00:00Z")), "2026-10-12");
});
test("personal values are optional and contribution companions deduplicate", () => {
  assert.deepEqual(personalInput({ status: null, rating: null }), { status: null, rating: null });
  assert.equal(personalInput({ status: "pending", rating: 6 }), null);
  const id = "12345678-1234-1234-1234-123456789012";
  assert.equal(contributionInput({ body: "x", spoiler: false, companionIds: [id, id] })?.companionIds.length, 1);
  assert.equal(contributionInput({ body: " ", spoiler: false, companionIds: [] }), null);
  assert.ok(contributionInput({ body: "😀".repeat(5000), spoiler: false, companionIds: [] }));
  assert.equal(contributionInput({ body: "😀".repeat(5001), spoiler: false, companionIds: [] }), null);
});
test("server flag is enabled only by exact true", () => {
  const old = process.env.LIBRARY_ENABLED;
  try {
    for (const value of [undefined, "", "false", "TRUE", "1"]) {
      if (value === undefined) delete process.env.LIBRARY_ENABLED; else process.env.LIBRARY_ENABLED = value;
      assert.equal(libraryEnabled(), false);
    }
    process.env.LIBRARY_ENABLED = "true"; assert.equal(libraryEnabled(), true);
  } finally { if (old === undefined) delete process.env.LIBRARY_ENABLED; else process.env.LIBRARY_ENABLED = old; }
});
