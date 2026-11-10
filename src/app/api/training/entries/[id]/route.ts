import { diaryRead, diaryWrite } from "@/lib/training/diary-server";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return diaryRead(request, "entries", (await context.params).id); }
export async function PATCH(request: Request, context: Context) { return diaryWrite(request, (await context.params).id); }
