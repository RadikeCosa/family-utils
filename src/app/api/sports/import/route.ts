import { importSportsBundle } from "@/lib/sports/import-server";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(request: Request) {
  return importSportsBundle(request);
}
