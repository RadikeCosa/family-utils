import { diaryRead } from "@/lib/training/diary-server";
export const runtime = "nodejs";
export async function GET(request: Request) { return diaryRead(request, "summary"); }
