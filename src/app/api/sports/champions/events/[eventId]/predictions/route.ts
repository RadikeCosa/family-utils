import { footballPredictions } from "@/lib/sports/football-predictions-server";
type Context = { params: Promise<{ eventId: string }> };
export const runtime = "nodejs";
export async function GET(request: Request, context: Context) {
  return footballPredictions(request, (await context.params).eventId);
}
export async function PUT(request: Request, context: Context) {
  return footballPredictions(request, (await context.params).eventId);
}
export async function DELETE(request: Request, context: Context) {
  return footballPredictions(request, (await context.params).eventId);
}
