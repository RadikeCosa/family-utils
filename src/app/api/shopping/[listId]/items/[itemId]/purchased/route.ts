import { mutateShopping } from "@/lib/shopping/server";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ listId: string; itemId: string }> }) {
  const { listId, itemId } = await context.params;
  return mutateShopping(request, "purchased", listId, itemId);
}
