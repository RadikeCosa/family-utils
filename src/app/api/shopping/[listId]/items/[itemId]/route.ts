import { mutateShopping } from "@/lib/shopping/server";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ listId: string; itemId: string }> }) {
  const { listId, itemId } = await context.params;
  return mutateShopping(request, "edit", listId, itemId);
}

export async function DELETE(request: Request, context: { params: Promise<{ listId: string; itemId: string }> }) {
  const { listId, itemId } = await context.params;
  return mutateShopping(request, "remove", listId, itemId);
}
