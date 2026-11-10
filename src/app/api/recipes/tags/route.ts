import { recipeCatalog } from "@/lib/recipes/catalog";
export const runtime = "nodejs";
export async function GET(request: Request) { return recipeCatalog(request, true); }
