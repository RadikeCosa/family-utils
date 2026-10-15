import { importSportsResults } from "@/lib/sports/results-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return importSportsResults(request);
}
