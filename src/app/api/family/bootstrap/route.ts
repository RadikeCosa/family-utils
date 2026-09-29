import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, families, memberDevices, members } from "@/db/schema";
import { getMemberContext, isBootstrapEmail } from "@/lib/auth/context";
import { createAuth } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await createAuth().api.getSession({ headers: request.headers });
  return NextResponse.json({ canBootstrap: !!session && !session.user.isAnonymous && session.user.emailVerified && isBootstrapEmail(session.user.email) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const existing = await getMemberContext(request.headers);
  if (existing) return NextResponse.json({ familyId: existing.familyId, memberId: existing.memberId });

  const session = await createAuth().api.getSession({ headers: request.headers });
  if (!session || session.user.isAnonymous || !session.user.emailVerified || !isBootstrapEmail(session.user.email)) {
    return NextResponse.json({ error: "No family access" }, { status: 403 });
  }

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('family-utils-bootstrap'))`);
    const [linked] = await tx.select({ memberId: memberDevices.memberId })
      .from(memberDevices)
      .where(and(eq(memberDevices.authUserId, session.user.id), isNull(memberDevices.revokedAt)))
      .limit(1);
    if (linked) return { familyId: null, memberId: linked.memberId };

    let [family] = await tx.select().from(families).limit(1);
    if (!family) {
      [family] = await tx.insert(families).values({ name: process.env.FAMILY_NAME?.trim() || "Mi familia" }).returning();
    }

    const displayName = session.user.name.trim().slice(0, 100) || session.user.email.split("@")[0];
    const [member] = await tx.insert(members).values({
      familyId: family.id,
      name: displayName,
      role: "administrator",
      accessMethod: "google",
      googleEmail: session.user.email.trim().toLowerCase(),
    }).returning();

    await tx.insert(memberDevices).values({
      memberId: member.id,
      authUserId: session.user.id,
      label: "Dispositivo adulto",
    });
    await tx.insert(auditEvents).values({
      familyId: family.id,
      actorMemberId: member.id,
      entityType: "family",
      entityId: family.id,
      action: "administrator_joined",
      after: { memberId: member.id, role: "administrator" },
    });
    const [updatedFamily] = await tx.update(families)
      .set({ revision: sql`${families.revision} + 1`, updatedAt: new Date() })
      .where(eq(families.id, family.id))
      .returning();
    return { familyId: updatedFamily.id, memberId: member.id };
  });

  return NextResponse.json(result, { status: 201 });
}
