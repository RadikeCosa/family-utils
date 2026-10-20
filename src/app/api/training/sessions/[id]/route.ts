import { readTraining, mutateTraining } from "@/lib/training/server";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return readTraining(request, "sessions", (await context.params).id); }
export async function PATCH(request: Request, context: Context) { return mutateTraining(request, "sessions", (await context.params).id); }
