import { updateSportsEvent } from "@/lib/sports/server";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return updateSportsEvent(request, eventId);
}
