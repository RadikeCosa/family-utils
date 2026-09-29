import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { families } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { getFamilyDay, taskListEtag } from "@/lib/tasks/family-day";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const member = await getMemberContext(request.headers);
  if (!member) return NextResponse.json({ error: "No family access" }, { status: 403 });
  const [family] = await getDb().select({ revision: families.revision }).from(families)
    .where(eq(families.id, member.familyId)).limit(1);
  const revision = family?.revision ?? member.familyRevision;
  const familyDay = getFamilyDay();
  const etag = taskListEtag(member.familyId, revision, familyDay);
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return NextResponse.json({ revision, familyDay }, { headers });
}
