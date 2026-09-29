import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { accessCodes, auditEvents, authAccount, families, memberDevices, members } from "@/db/schema";
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
    const [googleAccount] = await tx.select({ id: authAccount.id }).from(authAccount)
      .where(and(eq(authAccount.userId, session.user.id), eq(authAccount.providerId, "google")))
      .limit(1);
    if (!googleAccount) return { kind: "not-google" as const };

    const [linked] = await tx.select({ memberId: memberDevices.memberId })
      .from(memberDevices)
      .where(and(eq(memberDevices.authUserId, session.user.id), isNull(memberDevices.revokedAt)))
      .limit(1);
    if (linked) return { kind: "already-linked" as const, familyId: null, memberId: linked.memberId };

    const email = session.user.email.trim().toLowerCase();
    const [existingProfile] = await tx.select().from(members)
      .where(and(eq(sql`lower(${members.googleEmail})`, email), eq(members.role, "administrator"), isNull(members.archivedAt)))
      .limit(1);
    if (existingProfile) {
      await tx.execute(sql`SELECT id FROM ${families} WHERE id = ${existingProfile.familyId} FOR UPDATE`);
      const [activeDevice] = await tx.select({ id: memberDevices.id }).from(memberDevices)
        .where(and(eq(memberDevices.memberId, existingProfile.id), isNull(memberDevices.revokedAt)))
        .limit(1);
      if (activeDevice) return { kind: "profile-already-linked" as const };
      await tx.insert(memberDevices).values({ memberId: existingProfile.id, authUserId: session.user.id, identityKind: "google", label: "Dispositivo adulto" });
      const now = new Date();
      await tx.update(accessCodes).set({ revokedAt: now })
        .where(and(eq(accessCodes.memberId, existingProfile.id), eq(accessCodes.purpose, "invitation"), isNull(accessCodes.consumedAt), isNull(accessCodes.revokedAt)));
      await tx.insert(auditEvents).values({
        familyId: existingProfile.familyId,
        actorMemberId: existingProfile.id,
        entityType: "member",
        entityId: existingProfile.id,
        action: "google_identity_linked",
        after: { accessMethod: "google" },
      });
      const [updatedFamily] = await tx.update(families)
        .set({ revision: sql`${families.revision} + 1`, updatedAt: now })
        .where(eq(families.id, existingProfile.familyId))
        .returning();
      return { kind: "linked-existing" as const, familyId: updatedFamily.id, memberId: existingProfile.id };
    }

    const existingFamilies = await tx.select().from(families).orderBy(families.createdAt).limit(2);
    if (existingFamilies.length > 1) return { kind: "ambiguous-family" as const };
    let family = existingFamilies[0];
    if (!family) {
      [family] = await tx.insert(families).values({ name: process.env.FAMILY_NAME?.trim() || "Mi familia" }).returning();
    }

    const displayName = session.user.name.trim().slice(0, 100) || session.user.email.split("@")[0];
    const [member] = await tx.insert(members).values({
      familyId: family.id,
      name: displayName,
      role: "administrator",
      accessMethod: "google",
      googleEmail: email,
    }).returning();

    await tx.insert(memberDevices).values({
      memberId: member.id,
      authUserId: session.user.id,
      identityKind: "google",
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
    return { kind: "created" as const, familyId: updatedFamily.id, memberId: member.id };
  });

  if (result.kind === "not-google") return NextResponse.json({ error: "Google account required" }, { status: 403 });
  if (result.kind === "profile-already-linked") return NextResponse.json({ error: "This family profile already has an active Google identity" }, { status: 409 });
  if (result.kind === "ambiguous-family") return NextResponse.json({ error: "More than one family is configured" }, { status: 409 });
  return NextResponse.json(result, { status: result.kind === "created" ? 201 : 200 });
}
