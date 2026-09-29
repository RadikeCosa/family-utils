import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { accessCodes, auditEvents, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { createAccessCode, digestAccessCode, formatAccessCode } from "@/lib/tasks/rules";
import { accessPepper } from "@/lib/access/rate-limit";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ memberId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  if (actor.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const { memberId } = await context.params;
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid code request" }, { status: 400 }); }
  const purpose = input.purpose;
  if (purpose !== "invitation" && purpose !== "recovery") return NextResponse.json({ error: "Invalid code request" }, { status: 400 });

  let pepper: string;
  try { pepper = accessPepper(); }
  catch { return NextResponse.json({ error: "Access codes are not configured" }, { status: 503 }); }

  const code = createAccessCode();
  const expiresAt = new Date(Date.now() + (purpose === "invitation" ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000));
  const digest = digestAccessCode(code, pepper, purpose);
  const result = await getDb().transaction(async (tx) => {
    const [target] = await tx.select().from(members)
      .where(and(eq(members.id, memberId), eq(members.familyId, actor.familyId), isNull(members.archivedAt)))
      .limit(1);
    if (!target) return null;
    const now = new Date();
    await tx.update(accessCodes).set({ revokedAt: now })
      .where(and(eq(accessCodes.memberId, memberId), eq(accessCodes.purpose, purpose), isNull(accessCodes.consumedAt), isNull(accessCodes.revokedAt)));
    const [record] = await tx.insert(accessCodes).values({
      familyId: actor.familyId,
      memberId,
      purpose,
      digest,
      expiresAt,
      createdByMemberId: actor.memberId,
    }).returning();
    await tx.insert(auditEvents).values({
      familyId: actor.familyId,
      actorMemberId: actor.memberId,
      entityType: "member",
      entityId: memberId,
      action: `${purpose}_code_created`,
      after: { codeId: record.id, expiresAt },
    });
    await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${actor.familyId}`);
    return record;
  });

  if (!result) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  return NextResponse.json({ code: formatAccessCode(code), purpose, expiresAt: result.expiresAt }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
