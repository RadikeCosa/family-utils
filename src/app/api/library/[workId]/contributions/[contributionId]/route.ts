import { mutateLibrary } from "@/lib/library/server";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ workId: string; contributionId: string }> }) { const params = await context.params; return mutateLibrary(request, "contribute", params.workId, params.contributionId); }
