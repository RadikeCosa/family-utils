import { recipesEnabled } from "@/lib/recipes/config";
import { GET as catalog } from "@/app/api/meals/catalog/route";
import { RecipeError, recipeError, writeRecipe } from "@/lib/recipes/server";
export const runtime = "nodejs";
export async function GET(request: Request) { try { if (!recipesEnabled()) throw new RecipeError("Recetas todavía no está disponible.", 404, "NOT_FOUND"); return catalog(request); } catch (error) { return recipeError(error); } }
export async function POST(request: Request) { return writeRecipe(request); }
