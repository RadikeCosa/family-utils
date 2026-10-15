import { syncSports } from "@/lib/sports/sync";

export const runtime = "nodejs";
export const maxDuration = 25;

export async function POST(request: Request) {
  return syncSports(request);
}
