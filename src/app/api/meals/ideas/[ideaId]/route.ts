import { writeRecipe } from "@/lib/recipes/server";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ ideaId: string }> }) {
  return writeRecipe(request, (await params).ideaId, true);
}
