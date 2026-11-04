export type Ingredient = { id: string; name: string; quantity: string | null };
export type RecipeDraft = { title: string; note: string | null; yieldText: string | null; preparation: string | null; ingredients: Ingredient[] };
export type Recipe = RecipeDraft & { id: string; version: number; archivedAt: string | null; authorMemberId: string; updatedAt: string; updatedByName: string | null; canManage: boolean };
export type ObservedItem = { id: string; version: number; name: string; brand: string | null; quantity: string | null; purchased: boolean };
export type TransferRow = { ingredientId: string; name: string; brand: string | null; quantity: string | null; action: "add" | "keep" | "edit"; itemId: string | null; observed: ObservedItem[] };
export type TransferDestination = { listId: string } | { newListName: string };
export type TransferCommand = { recipeId: string; destination: TransferDestination; rows: TransferRow[] };
