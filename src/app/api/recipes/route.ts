import { recipeCatalog } from "@/lib/recipes/catalog";
import { writeRecipe } from "@/lib/recipes/server";
export const runtime = "nodejs";
export async function GET(request: Request) { return recipeCatalog(request); }
export async function POST(request: Request) { return writeRecipe(request); }
