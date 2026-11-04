import { readRecipe, writeRecipe } from "@/lib/recipes/server";
export const runtime = "nodejs";
type Context = { params: Promise<{ recipeId: string }> };
export async function GET(request: Request, context: Context) { return readRecipe(request, (await context.params).recipeId); }
export async function PATCH(request: Request, context: Context) { return writeRecipe(request, (await context.params).recipeId); }
