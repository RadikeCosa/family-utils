import { readShopping, mutateShopping } from "@/lib/shopping/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return readShopping(request);
}

export async function POST(request: Request) {
  return mutateShopping(request, "create");
}
