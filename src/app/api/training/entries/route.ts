import { diaryRead, diaryWrite } from "@/lib/training/diary-server";
export const runtime = "nodejs";
export async function GET(request: Request) { return diaryRead(request, "entries"); }
export async function POST(request: Request) { return diaryWrite(request); }
