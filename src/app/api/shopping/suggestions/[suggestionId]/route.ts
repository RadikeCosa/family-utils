import { mutateShopping } from "@/lib/shopping/server";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ suggestionId: string }> }) {
  const { suggestionId } = await context.params;
  return mutateShopping(request, "suggestion", undefined, suggestionId);
}
