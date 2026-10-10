export interface ShoppingItem {
  id: string;
  listId: string;
  name: string;
  brand: string | null;
  quantity: string | null;
  version: number;
  purchased: boolean;
  purchasedByName: string | null;
  updatedByName: string;
  updatedAt: string;
  createdAt: string;
}
export interface ShoppingList {
  id: string;
  name: string;
  version: number;
  ownerMemberId: string;
  ownerName: string;
  creatorName: string;
  archivedAt: string | null;
  editorIds: string[];
  canEdit: boolean;
  canManage: boolean;
  items: ShoppingItem[];
}
export interface ShoppingData {
  revision: number;
  accessRevision: number;
  currentMemberId: string;
  currentRole: "administrator" | "member";
  members: { id: string; name: string; archivedAt: string | null }[];
  lists: ShoppingList[];
  suggestions: { id: string; name: string; hidden: boolean; version: number }[];
}
