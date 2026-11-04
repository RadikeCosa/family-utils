import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { cleanText, parseIngredients } from "./rules.ts";
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
