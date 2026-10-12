import { mutateLibrary } from "@/lib/library/server";
export const runtime = "nodejs";
export async function PUT(request: Request, context: { params: Promise<{ workId: string }> }) { return mutateLibrary(request, "personal", (await context.params).workId); }
