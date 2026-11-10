import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { cleanText, parseIngredients, draftText } from "./rules.ts";
import { canonical, fingerprint, issueOperation, OPERATION_TTL, verifyOperation } from "./operation.ts";
import { parseTransfer } from "./transfer-rules.ts";
test("recipe input permits partial recipes and culinary quantities with bounded text", () => {
  assert.equal(cleanText(" \r\nPrimero\rDespués  ", 100), "Primero\nDespués");
  assert.equal(cleanText(" ", 100), null);
  assert.equal(cleanText("½ taza", 100), "½ taza");
  const id = randomUUID();
  assert.deepEqual(parseIngredients([{ id, name: " Sal ", quantity: "a gusto" }]), [{ id, name: "Sal", quantity: "a gusto" }]);
  assert.throws(() => parseIngredients([{ id, name: "A" }, { id: id.toUpperCase(), name: "B" }]));
  assert.throws(() => cleanText("x".repeat(161), 160));
  assert.throws(() => cleanText("\0", 100));
  assert.throws(() => cleanText("\ud800", 100));
  assert.throws(() => parseIngredients(Array.from({ length: 101 }, () => ({ id: randomUUID(), name: "A" }))));
});
test("operation tokens use server time, reject tampering and are bound to family/member", () => {
  const token = issueOperation("test-secret", "f", "m", 1000);
  assert.equal(verifyOperation("test-secret", token, "f", "m", 1001).expiresAt, 1000 + OPERATION_TTL);
  assert.throws(() => verifyOperation("test-secret", token, "other", "m", 1001), /INVALID_OPERATION/);
  assert.throws(() => verifyOperation("other-secret", token, "f", "m", 1001), /INVALID_OPERATION/);
  assert.throws(() => verifyOperation("test-secret", token, "f", "m", 1000 + OPERATION_TTL), /OPERATION_EXPIRED/);
});
test("validated transfer fingerprints ignore key and observed-set order while retaining decisions", () => {
  const a = randomUUID(), b = randomUUID();
  const item = (id: string) => ({ id, name: "Harina", brand: null, quantity: "1 paquete", version: 1, purchased: true });
  const row = { ingredientId: randomUUID(), name: "Harina", quantity: "½ taza", action: "add", observed: [item(a), item(b)] };
  const body = { recipeId: randomUUID(), destination: { newListName: " Semana " }, rows: [row] };
  const first = parseTransfer(body), second = parseTransfer({ rows: [{ ...row, observed: [...row.observed].reverse() }], destination: { newListName: "Semana" }, recipeId: body.recipeId });
  assert.equal(fingerprint(first), fingerprint(second));
  assert.notEqual(fingerprint(first), fingerprint({ ...second, destination: { newListName: "Otra" } }));
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  assert.throws(() => parseTransfer({ ...body, rows: [row, row] }));
});

import { normalizeTagNameV1, parseTags } from "./tags.ts";
import { encodeRecipeCursor, decodeRecipeCursor, type RecipeCursor } from "./cursor.ts";
import { readRecipeFilters } from "./filters.ts";
test("tag identity v1 preserves ñ, deduplicates after cleaning and counts Unicode points", () => {
  assert.equal(normalizeTagNameV1("AÑO"), "año");
  assert.notEqual(normalizeTagNameV1("año"), normalizeTagNameV1("ano"));
  assert.equal(normalizeTagNameV1("  VERA\u0301NO  familiar "), "verano familiar");
  assert.deepEqual(parseTags([" #deVerano ", "DeVerano", "#año", "ano"]), [
    { name: "ano", slug: "ano" }, { name: "año", slug: "año" }, { name: "deVerano", slug: "deverano" },
  ]);
  assert.equal(parseTags(Array(30).fill("verano")).length, 1);
  assert.equal(parseTags(["𐐀".repeat(40)])[0].name.length, 80);
  assert.throws(() => parseTags(["𐐀".repeat(41)]));
  assert.throws(() => parseTags(Array.from({ length: 11 }, (_, n) => `tag${n}`)));
  for (const invalid of ["#", "a/b", "a\0b", "##verano", "🍲", "---"]) assert.throws(() => parseTags([invalid]));
  assert.throws(() => parseTags(null));
});
test("signed recipe cursors preserve microseconds and reject tampering and invalid shapes", () => {
  const value: RecipeCursor = { v: 1, family: "12345678-1234-1234-1234-123456789012", query: '["",false,[]]', revision: "17",
    last: { used: null, updated: "2026-11-10 12:00:00.123456+00", created: "2026-11-10 10:00:00+00", id: "12345678-1234-1234-1234-123456789012" } };
  const encoded = encodeRecipeCursor(value, "test-secret");
  assert.deepEqual(decodeRecipeCursor(encoded, "test-secret"), value);
  assert.throws(() => decodeRecipeCursor(encoded, "other-secret"));
  assert.throws(() => decodeRecipeCursor(encoded + ".extra", "test-secret"));
  assert.throws(() => decodeRecipeCursor(encodeRecipeCursor({ ...value, v: 2 } as unknown as RecipeCursor, "test-secret"), "test-secret"));
});
test("recipe URLs preserve repeated tag slugs and canonicalize archive state", () => {
  const f = readRecipeFilters(new URLSearchParams("tag=deVerano&tag=DeVerano&tag=año&archived=1&q=Sopa"));
  assert.deepEqual(f.slugs, ["año", "deverano"]);
  assert.equal(new URLSearchParams(f.queryKey).get("archived"), "true");
});

test("copyable recipe draft includes tags in canonical order", () => {
  const draft = { title: "Sopa", note: null, yieldText: null, preparation: null, ingredients: [], tags: ["deVerano", "almuerzo"] };
  assert.equal(draftText(draft), "Sopa\n#almuerzo #deVerano\nIngredientes\nPreparación");
  assert.equal(parseTags(["a", "a" + "\u0301".repeat(42)]).length, 1);
});
