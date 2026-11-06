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

test("movie-only input accepts omission and rejects every other kind", () => {
  assert.equal(workInput({ title: "One" })?.kind, "movie");
  for (const kind of ["book", "series", "music", "art", "video_game", "tabletop_game", null, ""]) assert.equal(workInput({ title: "One", kind }), null);
});

import { familyRating } from "./presentation.ts";
import { cinematecaUrl } from "./urls.ts";
test("family averages exclude null and format one decimal with vote counts", () => {
  assert.equal(familyRating([]), "Familia · Sin valoraciones");
  assert.equal(familyRating([{ rating: null }]), "Familia · Sin valoraciones");
  assert.equal(familyRating([{ rating: 5 }]), "Familia · 5,0/5 · 1 valoración");
  assert.equal(familyRating([{ rating: 5 }, { rating: 4 }, { rating: 4 }, { rating: null }]), "Familia · 4,3/5 · 3 valoraciones");
});
test("legacy URLs preserve status codes and unknown parameters but drop obsolete scope", () => {
  for (const status of ["pending", "in_progress", "finished", "none"]) {
    assert.equal(cinematecaUrl({ status, kind: "book", type: "music", cursor: "old", q: "cine", extra: ["a", "b"] }), `/cinemateca?status=${status}&q=cine&extra=a&extra=b`);
  }
  assert.equal(cinematecaUrl({}, "123"), "/cinemateca/123");
});

import { readLibraryFilters, canonicalLibrarySearch } from "./filters.ts";
test("page filters canonicalize defaults and mutually exclusive modes without losing other parameters", () => {
  for (const status of ["pending", "in_progress", "finished", "none"]) {
    assert.equal(readLibraryFilters(new URLSearchParams({ status })).status, status);
    assert.equal(canonicalLibrarySearch(new URLSearchParams({ status })), `status=${status}`);
  }
  for (const status of ["", "wrong"]) assert.equal(canonicalLibrarySearch(new URLSearchParams({ status, view: "invalid", archived: "false", kind: "book", type: "music", cursor: "old" })), "");
  const query = new URLSearchParams("view=common_pending&status=finished&archived=true&q=cine&extra=a&extra=b");
  assert.deepEqual(readLibraryFilters(query), { view: "common_pending", status: "", archived: "true", q: "cine" });
  assert.equal(canonicalLibrarySearch(query), "extra=a&extra=b&q=cine&view=common_pending&archived=true");
});

import { orderCompanions, selectedCompanionsSummary } from "./presentation.ts";
test("companion summaries have stable Spanish ordering, include archived profiles and never reorder source data", () => {
  const members = [{ id: "z", name: "Álex", archivedAt: null }, { id: "a", name: "Alex", archivedAt: "2026-01-01" }, { id: "b", name: "Vicky", archivedAt: null }];
  const ordered = orderCompanions(members);
  assert.deepEqual(ordered.map(member => member.id), ["a", "z", "b"]);
  assert.equal(members[0].id, "z");
  assert.equal(selectedCompanionsSummary(ordered, []), "Opcional");
  assert.equal(selectedCompanionsSummary(ordered, ["b", "z", "a"]), "Alex, Álex +1");
});

import { workFieldErrors, contributionFieldErrors, revalidateFieldErrors, libraryIssueMessage } from "./form-errors.ts";
test("form validation identifies fields without changing API rules and only revalidates existing errors", () => {
  const empty = { title: "", creator: "", year: "", referenceUrl: "" };
  assert.deepEqual(Object.keys(workFieldErrors(empty)), ["title"]);
  assert.deepEqual(workFieldErrors({ ...empty, title: "Película", year: "2000", referenceUrl: "https://example.com" }), {});
  assert.ok(workFieldErrors({ ...empty, title: "Película", year: "1.5", referenceUrl: "javascript:alert(1)" }).year);
  assert.ok(workFieldErrors({ ...empty, title: "Película", referenceUrl: "javascript:alert(1)" }).referenceUrl);
  assert.ok(workFieldErrors({ ...empty, title: "a".repeat(201) }).title);
  assert.deepEqual(revalidateFieldErrors({ title: "err" }, { year: "other" }), {});
  assert.deepEqual(revalidateFieldErrors({}, { year: "other" }), {});
  const date = { body: "Un recuerdo", year: "2024", month: "2", day: "30" };
  assert.ok(contributionFieldErrors(date, "2026-11-06").day);
  assert.deepEqual(contributionFieldErrors({ ...date, day: "29" }, "2026-11-06"), {});
  assert.ok(contributionFieldErrors({ ...date, year: "9999", month: "", day: "" }, "2026-11-06").year);
  assert.deepEqual(contributionFieldErrors({ ...date, year: "2026", month: "", day: "" }, "2026-11-06"), {});
  for (const code of ["SQL detail: secret", "constructor", "__proto__", null]) assert.equal(libraryIssueMessage(code), libraryIssueMessage("UNAVAILABLE"));
  for (const code of ["CONFLICT", "DUPLICATE", "NO_ACCESS", "NOT_AUTHOR", "ARCHIVED", "NOT_FOUND", "INVALID"]) assert.notEqual(libraryIssueMessage(code), libraryIssueMessage("UNAVAILABLE"));
});

import { GENRES, normalizeGenres, genreInput } from "./genres.ts";
import { restoreLibraryDraft } from "./drafts.ts";
test("genres use the shared catalog, canonical order and strict API input", () => {
  assert.equal(GENRES.length, 18);
  assert.equal(new Set(GENRES.map(g => g.id)).size, 18);
  assert.ok(!GENRES.some(g => String(g.id) === "none"));
  assert.deepEqual(genreInput(["terror", "drama", "terror"]), ["drama", "terror"]);
  for (const invalid of [null, "drama", ["unknown"], [null], [["drama"]]]) assert.equal(genreInput(invalid), null);
  assert.deepEqual(workInput({ title: "One", genres: ["terror", "drama", "terror"] })?.genres, ["drama", "terror"]);
  assert.equal(workInput({ title: "One", genres: null }), null);
  assert.equal(workInput({ title: "One" })?.genres, undefined);
  assert.deepEqual(normalizeGenres(["unknown", "terror", 1, "drama"]), ["drama", "terror"]);
});
test("genre draft recovery distinguishes absence, empty and malformed values without losing known fields", () => {
  const initial = { title: "Saved", kind: "movie", expectedVersion: 2, genres: ["drama"] };
  const saved = { title: "Draft", kind: "book", expectedVersion: 1, unknown: "ignored" };
  const recover = (genres: unknown) => restoreLibraryDraft(initial, { ...saved, genres });
  assert.deepEqual(restoreLibraryDraft(initial, saved), { ...initial, title: "Draft", expectedVersion: 1 });
  assert.deepEqual(recover([]).genres, []);
  assert.deepEqual(recover(["terror", "invalid", 5, "drama", "terror"]).genres, ["drama", "terror"]);
  assert.deepEqual(recover(["invalid"]).genres, []);
  for (const invalid of [null, "drama", {}]) assert.deepEqual(recover(invalid).genres, ["drama"]);
});
