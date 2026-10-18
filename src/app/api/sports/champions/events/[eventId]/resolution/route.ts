import { resolveChampionsSuspension } from "@/lib/sports/champions-resolution-server";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return resolveChampionsSuspension(request, eventId);
}
