import assert from "node:assert/strict";
import test from "node:test";
import { appendCast, normalizeCast, normalizeSynopsis, formatRuntime, movieTextLength } from "./movie-metadata.ts";
import { workInput } from "./rules.ts";
import { workFieldErrors } from "./form-errors.ts";
import { restoreLibraryDraft } from "./drafts.ts";

test("metadata API distinguishes omission, null, empty and invalid values", () => {
  const minimal = workInput({ title: "Una película" })!;
  for (const key of ["runtimeMinutes", "cast", "synopsis"]) assert.equal(Object.hasOwn(minimal, key), false);
  for (const runtimeMinutes of ["", "45", 0, -1, 1441, 1.5, true, [], {}]) assert.equal(workInput({ title: "A", runtimeMinutes }), null);
  for (const runtimeMinutes of [1, 45, 60, 61, 148, 1440, null]) assert.equal(workInput({ title: "A", runtimeMinutes })!.runtimeMinutes, runtimeMinutes);
  for (const cast of [null, "Actor", [null], [1], [""], [" \t"], ["x".repeat(201)]]) assert.equal(workInput({ title: "A", cast }), null);
  assert.deepEqual(workInput({ title: "A", cast: [] })!.cast, []);
  for (const synopsis of [null, "", " \r\n "]) assert.equal(workInput({ title: "A", synopsis })!.synopsis, null);
  for (const synopsis of [1, [], {}, true]) assert.equal(workInput({ title: "A", synopsis }), null);
});

test("synopsis normalizes line endings before trimming and counting code points", () => {
  assert.equal(normalizeSynopsis(" \r\nUno\r\nDos\rTres\n "), "Uno\nDos\nTres");
  assert.equal(movieTextLength("👩‍👩‍👦"), 5);
  assert.ok(workInput({ title: "A", synopsis: " \r\n" + "😀".repeat(5000) + "\r\n " }));
  assert.equal(workInput({ title: "A", synopsis: "😀".repeat(5001) }), null);
  assert.ok(workInput({ title: "A", synopsis: "x\r\n".repeat(2500) }));
});

test("cast normalizes before measuring, preserves order and uses simple lowercase keys", () => {
  const cast = normalizeCast(["  Jose\u0301   Pérez ", "JOSÉ PÉREZ", "Ana", "ANA", "ß", "ss", "İ", "i", "ı"]);
  assert.equal(cast.error, null); assert.equal(cast.duplicates, 2);
  assert.deepEqual(cast.names, ["José Pérez", "Ana", "ß", "ss", "İ", "i", "ı"]);
  assert.equal(normalizeCast(["e\u0301".repeat(200)]).error, null);
  assert.ok(normalizeCast(["e\u0301".repeat(201)]).error);
  assert.equal(normalizeCast(["👩‍👩‍👦".repeat(40)]).error, null);
  assert.ok(normalizeCast(["👩‍👩‍👦".repeat(41)]).error);
});

test("pending cast is atomic and capacity counts the combined unique names", () => {
  const existing = Array.from({ length: 29 }, (_, index) => `Actor ${index}`);
  const rejected = appendCast(existing, "Actor 0\nNuevo A\nNuevo B");
  assert.ok(rejected.error); assert.equal(existing.length, 29);
  const accepted = appendCast(existing, "Actor 0\nACTOR 1\nNuevo A\n \n");
  assert.equal(accepted.error, null); assert.equal(accepted.names.length, 30); assert.equal(accepted.duplicates, 2);
  assert.deepEqual(accepted.names.slice(0, 29), existing);
  assert.ok(appendCast(existing, `Válido\n${"x".repeat(201)}`).error);
});

test("duration visible and accessible formats cover boundaries", () => {
  for (const [value, text, label] of [[45,"45 min","45 minutos"],[60,"1 h","1 hora"],[61,"1 h 1 min","1 hora y 1 minuto"],[148,"2 h 28 min","2 horas y 28 minutos"],[1440,"24 h","24 horas"]] as const) assert.deepEqual(formatRuntime(value), { text, label });
});

test("legacy and partial drafts preserve new fields and normalize cast safely", () => {
  const initial = { title: "", kind: "movie", creator: "", year: "", genres: [], expectedVersion: 0, runtimeMinutes: "", cast: [] as string[], synopsis: "", castPending: "" };
  const old = { title: "Mi película", kind: "book", creator: "Una directora", year: "2020", expectedVersion: 0 };
  assert.deepEqual(restoreLibraryDraft(initial, old), { ...initial, ...old, kind: "movie" });
  const partial = { ...initial, synopsis: "Una historia a medio escribir", cast: [" Ana ", "ANA"], castPending: "Actor a medio escribir", runtimeMinutes: "14" };
  assert.deepEqual(restoreLibraryDraft(initial, partial), { ...partial, cast: ["Ana"] });
  assert.equal(workFieldErrors({ ...partial, title: "A", runtimeMinutes: "0" }).runtimeMinutes, "Ingresá una duración entera entre 1 y 1440 minutos.");
  assert.ok(workFieldErrors({ ...partial, title: "A", castPending: "a".repeat(201) }).castPending);
});
