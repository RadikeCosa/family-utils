import { championsComments } from "@/lib/sports/champions-comments-server";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ roundId: string; commentId: string }> }) {
  const { roundId, commentId } = await params;
  return championsComments(request, roundId, commentId);
}
