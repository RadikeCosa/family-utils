import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductName, productInput, shoppingItemOrder, shoppingPermissions } from "./rules.ts";

test("shopping permissions distinguish ownership from active editing", () => {
  assert.deepEqual(shoppingPermissions("owner", "owner", [], true), { canManage: true, canEdit: false });
  assert.deepEqual(shoppingPermissions("owner", "editor", ["editor"], false), { canManage: false, canEdit: true });
  assert.deepEqual(shoppingPermissions("owner", "viewer", ["editor"], false), { canManage: false, canEdit: false });
});
test("product names normalize without affecting display or requiring brand/quantity", () => {
  assert.equal(normalizeProductName("  CAFÉ   molido  "), "cafe molido");
  assert.deepEqual(productInput({ name: " Café " }), { name: "Café", brand: null, quantity: null });
  assert.deepEqual(productInput({ name: "Leche", quantity: "2 paquetes", brand: " Marca " }), { name: "Leche", quantity: "2 paquetes", brand: "Marca" });
  for (const input of [{ name: " " }, { name: 5 }, { name: "A", quantity: 2 }, { name: "x".repeat(161) }]) assert.equal(productInput(input), null);
});
test("unchecking restores the original position among pending products", () => {
  const original = [
    { id: "a", createdAt: "2026-10-01", purchased: true },
    { id: "b", createdAt: "2026-10-02", purchased: false },
    { id: "c", createdAt: "2026-10-03", purchased: true },
  ];
  assert.deepEqual([...original].sort(shoppingItemOrder).map((item) => item.id), ["b", "a", "c"]);
  original[0].purchased = false;
  assert.deepEqual([...original].sort(shoppingItemOrder).map((item) => item.id), ["a", "b", "c"]);
});
