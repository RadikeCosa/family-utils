import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, families, memberDevices, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { normalizeGoogleEmail } from "@/lib/access/policy";

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
  const role = input && typeof input === "object" && "role" in input && input.role === "administrator" ? "administrator" : "member";
  const googleEmail = input && typeof input === "object" && "googleEmail" in input && typeof input.googleEmail === "string"
    ? normalizeGoogleEmail(input.googleEmail)
    : "";
  if (role === "administrator" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(googleEmail) || googleEmail.length > 254)) {
    return NextResponse.json({ error: "Para crear una cuenta adulta, ingresá un correo Google válido." }, { status: 400 });
  }

  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${families} WHERE id = ${actor.familyId} FOR UPDATE`);
    const [currentActor] = await tx.select({ role: members.role }).from(memberDevices)
      .innerJoin(members, sql`${memberDevices.memberId} = ${members.id}`)
      .where(sql`${memberDevices.authUserId} = ${actor.authUser.id} AND ${members.familyId} = ${actor.familyId} AND ${memberDevices.revokedAt} IS NULL AND ${members.archivedAt} IS NULL`)
      .limit(1);
    if (currentActor?.role !== "administrator") return null;
    const [created] = await tx.insert(members).values({
      familyId: actor.familyId,
      name,
      role,
      accessMethod: role === "administrator" ? "google" : "code",
      googleEmail: role === "administrator" ? googleEmail : null,
    }).returning();
    await tx.insert(auditEvents).values({
      familyId: actor.familyId,
      actorMemberId: actor.memberId,
      entityType: "member",
      entityId: created.id,
      action: "created",
      after: { id: created.id, name: created.name, role: created.role, accessMethod: created.accessMethod },
    });
    await tx.execute(sql`UPDATE families SET revision = revision + 1, menus_revision = menus_revision + 1, updated_at = now() WHERE id = ${actor.familyId}`);
    return created;
  });
  if (!result) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  return NextResponse.json({ id: result.id, name: result.name, role: result.role, accessMethod: result.accessMethod, version: result.version }, { status: 201 });
}
