import { mutateLibrary } from "@/lib/library/server";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ workId: string }> }) { return mutateLibrary(request, "contribute", (await context.params).workId); }
