import { sportsPredictions } from "@/lib/sports/predictions-server";
type Context = { params: Promise<{ eventId: string }> };
export const runtime = "nodejs";
export async function GET(request: Request, context: Context) {
  return sportsPredictions(request, (await context.params).eventId);
}
export async function PUT(request: Request, context: Context) {
  return sportsPredictions(request, (await context.params).eventId);
}
export async function DELETE(request: Request, context: Context) {
  return sportsPredictions(request, (await context.params).eventId);
}
