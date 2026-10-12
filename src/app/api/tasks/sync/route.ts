import { NextResponse } from "next/server";
import { getMemberContext } from "@/lib/auth/context";
import { materializeOccurrences } from "@/lib/tasks/materialize";
import { getFamilyDay } from "@/lib/tasks/family-day";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const member = await getMemberContext(request.headers);
  if (!member) return NextResponse.json({ error: "No family access" }, { status: 403 });
  // No client date is accepted: materialization always uses the actual family day.
  if (new URL(request.url).search || (await request.text()).trim()) return NextResponse.json({ error: "La actualización no acepta fechas ni parámetros." }, { status: 400 });
  const now = new Date();
  const changed = await materializeOccurrences(member.familyId, now);
  return NextResponse.json({ changed, familyDay: getFamilyDay(now) }, { headers: { "Cache-Control": "private, no-store" } });
}
