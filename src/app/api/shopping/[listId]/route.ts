import { mutateShopping } from "@/lib/shopping/server";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ listId: string }> }) {
  const { listId } = await context.params;
  return mutateShopping(request, "manage", listId);
}
