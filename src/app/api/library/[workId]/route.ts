import { mutateLibrary, readLibrary } from "@/lib/library/server";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ workId: string }> }) { return readLibrary(request, (await context.params).workId); }

export async function PATCH(request: Request, context: { params: Promise<{ workId: string }> }) { return mutateLibrary(request, "manage", (await context.params).workId); }
