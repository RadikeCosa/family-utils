export function normalizeProductName(value: string): string {
  return value.trim().replace(/\s+/g, " ").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function productInput(body: Record<string, unknown>) {
  const { name, brand = "", quantity = "" } = body;
  if (typeof name !== "string" || typeof brand !== "string" || typeof quantity !== "string") return null;
  const cleaned = { name: name.trim(), brand: brand.trim(), quantity: quantity.trim() };
  if (!cleaned.name || cleaned.name.length > 160 || cleaned.brand.length > 160 || cleaned.quantity.length > 100) return null;
  return { name: cleaned.name, brand: cleaned.brand || null, quantity: cleaned.quantity || null };
}

export function shoppingPermissions(ownerId: string, memberId: string, editorIds: string[], archived: boolean) {
  const canManage = ownerId === memberId;
  return { canManage, canEdit: !archived && (canManage || editorIds.includes(memberId)) };
}

export function shoppingItemOrder<T extends { id: string; purchased: boolean; createdAt: string | Date }>(a: T, b: T) {
  return Number(a.purchased) - Number(b.purchased)
    || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    || a.id.localeCompare(b.id);
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
