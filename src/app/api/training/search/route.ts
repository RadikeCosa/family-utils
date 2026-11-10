import { diaryRead } from "@/lib/training/diary-server";
export const runtime = "nodejs";
export async function POST(request: Request) { return diaryRead(request, "search"); }
