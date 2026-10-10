import { mutateShopping } from "@/lib/shopping/server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ listId: string }> }) {
  const { listId } = await context.params;
  return mutateShopping(request, "add", listId);
}
