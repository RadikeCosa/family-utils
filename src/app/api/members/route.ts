import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  if (actor.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });

  let input: unknown;
  try { input = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid member" }, { status: 400 }); }
  const name = input && typeof input === "object" && "name" in input && typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 100) return NextResponse.json({ error: "Name is required (100 characters max)" }, { status: 400 });

  const result = await getDb().transaction(async (tx) => {
    const [created] = await tx.insert(members).values({ familyId: actor.familyId, name, role: "member" }).returning();
    await tx.insert(auditEvents).values({
      familyId: actor.familyId,
      actorMemberId: actor.memberId,
      entityType: "member",
      entityId: created.id,
      action: "created",
      after: { id: created.id, name: created.name, role: created.role },
    });
    await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${actor.familyId}`);
    return created;
  });
  return NextResponse.json({ id: result.id, name: result.name, role: result.role }, { status: 201 });
}
