import { mutateSportsComment } from "@/lib/sports/server";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  const { commentId } = await params;
  return mutateSportsComment(request, commentId);
}
