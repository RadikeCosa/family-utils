import { NextResponse } from "next/server";
import { getMemberContext } from "@/lib/auth/context";
import { getDb } from "@/db";
import { members } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const member = await getMemberContext(request.headers);
  if (!member) return NextResponse.json({ error: "No family access" }, { status: 403 });
  const familyMembers = await getDb()
    .select({ id: members.id, name: members.name, role: members.role })
    .from(members)
    .where(and(eq(members.familyId, member.familyId), isNull(members.archivedAt)));
  const etag = `"family-${member.familyId}-r${member.familyRevision}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  }
  return NextResponse.json({
    family: {
      id: member.familyId,
      name: member.familyName,
      timeZone: member.familyTimeZone,
      revision: member.familyRevision,
    },
    members: familyMembers,
    currentMemberId: member.memberId,
  }, {
    headers: { ETag: etag, "Cache-Control": "private, no-cache" },
  });
}
