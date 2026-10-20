import { readTraining, mutateTraining } from "@/lib/training/server";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return readTraining(request, "routines", (await context.params).id); }
export async function PATCH(request: Request, context: Context) { return mutateTraining(request, "routines", (await context.params).id); }
