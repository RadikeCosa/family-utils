import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { accessCodes, auditEvents, authAccount, families, memberDevices, members } from "@/db/schema";
import { createAuth } from "@/lib/auth/server";
import { isGoogleAutoLinkEnabled, normalizeGoogleEmail } from "@/lib/access/policy";

export const runtime = "nodejs";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (request.headers.get("origin") !== new URL(request.url).origin) return response({ error: "No se pudo vincular esta cuenta." }, 403);
  if (!isGoogleAutoLinkEnabled()) return response({ enabled: false });

  const session = await createAuth().api.getSession({ headers: request.headers });
  if (!session || session.user.isAnonymous || !session.user.emailVerified) return response({ error: "Iniciá sesión con una cuenta Google verificada." }, 401);

  try {
    const email = normalizeGoogleEmail(session.user.email);
    const db = getDb();
    const [googleAccount] = await db.select({ id: authAccount.id }).from(authAccount)
      .where(and(eq(authAccount.userId, session.user.id), eq(authAccount.providerId, "google")))
      .limit(1);
    if (!googleAccount) return response({ error: "La sesión actual no tiene una identidad Google verificada." }, 403);

    const [candidate] = await db.select({ id: members.id, familyId: members.familyId })
      .from(members)
      .where(and(
        eq(sql`lower(${members.googleEmail})`, email),
        eq(members.role, "administrator"),
        eq(members.accessMethod, "google"),
        isNull(members.archivedAt),
      ))
      .limit(1);
    if (!candidate) return response({ enabled: true, linked: false });

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${families} WHERE id = ${candidate.familyId} FOR UPDATE`);
      const [target] = await tx.select().from(members)
        .where(and(eq(members.id, candidate.id), eq(members.familyId, candidate.familyId)))
        .for("update")
        .limit(1);
      if (!target || target.archivedAt || target.role !== "administrator" || target.accessMethod !== "google" || normalizeGoogleEmail(target.googleEmail ?? "") !== email) {
        return { kind: "unavailable" as const };
      }

      const [existingIdentity] = await tx.select().from(memberDevices)
        .where(eq(memberDevices.authUserId, session.user.id))
        .for("update")
        .limit(1);
      if (existingIdentity) {
        if (existingIdentity.memberId === target.id && !existingIdentity.revokedAt) return { kind: "already-linked" as const, memberId: target.id };
        return { kind: "unavailable" as const };
      }

      const [activeIdentity] = await tx.select({ id: memberDevices.id }).from(memberDevices)
        .where(and(eq(memberDevices.memberId, target.id), isNull(memberDevices.revokedAt)))
        .limit(1);
      if (activeIdentity) return { kind: "unavailable" as const };

      await tx.insert(memberDevices).values({
        memberId: target.id,
        authUserId: session.user.id,
        identityKind: "google",
        label: "Cuenta Google",
      });
      const now = new Date();
      await tx.update(accessCodes).set({ revokedAt: now })
        .where(and(eq(accessCodes.memberId, target.id), eq(accessCodes.purpose, "invitation"), isNull(accessCodes.consumedAt), isNull(accessCodes.revokedAt)));
      await tx.insert(auditEvents).values({
        familyId: target.familyId,
        actorMemberId: target.id,
        entityType: "member",
        entityId: target.id,
        action: "google_identity_linked",
        after: { accessMethod: "google" },
      });
      await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${target.familyId}`);
      return { kind: "linked" as const, memberId: target.id };
    });

    if (result.kind === "unavailable") return response({ enabled: true, linked: false });
    return response({ enabled: true, linked: true, alreadyLinked: result.kind === "already-linked" });
  } catch {
    console.error("GOOGLE_PROFILE_LINK_FAILED", { requestId });
    return response({ error: "No se pudo vincular la cuenta. Compartí este identificador con un administrador.", requestId }, 500);
  }
}
