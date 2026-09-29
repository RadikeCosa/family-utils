import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { accessCodes, auditEvents, authAccount, authSession, families, memberDevices, members } from "@/db/schema";
import { accessPepper, enforceAccessAttemptLimit } from "@/lib/access/rate-limit";
import { accessDeviceSetCookie } from "@/lib/access/device-limit";
import { digestAccessCode, normalizeAccessCode, secureDigestEqual } from "@/lib/tasks/rules";
import { isAccessCodeCurrent, matchesVerifiedGoogleIdentity } from "@/lib/access/policy";

export const runtime = "nodejs";
const invalidCode = { error: "Código inválido, vencido o ya utilizado" };
const dummyDigest = "0000000000000000000000000000000000000000000000000000000000000000";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json(invalidCode, { status: 403, headers: { "Cache-Control": "no-store" } });
  let pepper: string;
  try { pepper = accessPepper(); }
  catch { return NextResponse.json({ error: "El acceso no está configurado." }, { status: 503 }); }

  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { input = {}; }
  if (!input || typeof input !== "object") input = {};
  const rawCode = typeof input.code === "string" ? input.code.trim() : "";
  let rateCodeValue = rawCode;
  if (typeof input.code === "string") {
    try { rateCodeValue = normalizeAccessCode(input.code); }
    catch { /* Invalid values are still counted under a keyed digest. */ }
  }
  const limit = await enforceAccessAttemptLimit({ headers: request.headers, endpoint: "redeem", secret: pepper, codeValue: rateCodeValue });
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    if (limit.shouldSetCookie) response.headers.append("Set-Cookie", accessDeviceSetCookie(limit.deviceCookie));
    return response;
  };
  if (!limit.allowed || typeof input.code !== "string" || input.code.length > 80) return respond(invalidCode, 400);

  const auth = await import("@/lib/auth/server").then(({ createAuth }) => createAuth());
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return respond(invalidCode, 400);

  let code: string;
  try { code = normalizeAccessCode(input.code); }
  catch {
    secureDigestEqual(dummyDigest, dummyDigest);
    return respond(invalidCode, 400);
  }

  const invitationDigest = digestAccessCode(code, pepper, "invitation");
  const recoveryDigest = digestAccessCode(code, pepper, "recovery");
  const candidates = await getDb().select().from(accessCodes)
    .where(inArray(accessCodes.digest, [invitationDigest, recoveryDigest]))
    .limit(2);
  let candidate: typeof candidates[number] | undefined;
  for (const value of candidates) {
    const matchesInvitation = secureDigestEqual(value.digest, invitationDigest);
    const matchesRecovery = secureDigestEqual(value.digest, recoveryDigest);
    if ((matchesInvitation || matchesRecovery) && !candidate) candidate = value;
  }
  // Run a fixed-time comparison when no database row matched the presented code.
  if (!candidate) {
    secureDigestEqual(dummyDigest, invitationDigest);
    secureDigestEqual(dummyDigest, recoveryDigest);
  }
  if (!candidate) return respond(invalidCode, 400);

  const now = new Date();
  const result = await getDb().transaction(async (tx) => {
    // Keep lock ordering consistent with code creation and profile archival.
    await tx.execute(sql`SELECT id FROM ${families} WHERE id = ${candidate.familyId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM ${members} WHERE id = ${candidate.memberId} FOR UPDATE`);
    const [stored] = await tx.select().from(accessCodes)
      .where(and(eq(accessCodes.id, candidate.id), eq(accessCodes.digest, candidate.digest)))
      .for("update")
      .limit(1);
    if (!stored) return { kind: "invalid" as const };
    const [target] = await tx.select().from(members)
      .where(and(eq(members.id, stored.memberId), eq(members.familyId, stored.familyId)))
      .for("update")
      .limit(1);
    if (!target || target.archivedAt || target.familyId !== stored.familyId) return { kind: "invalid" as const };

    if (stored.consumedAt) {
      if (stored.consumedByAuthUserId !== session.user.id) return { kind: "invalid" as const };
      const [alreadyBound] = await tx.select({ id: memberDevices.id }).from(memberDevices)
        .where(and(eq(memberDevices.memberId, target.id), eq(memberDevices.authUserId, session.user.id), isNull(memberDevices.revokedAt)))
        .limit(1);
      return alreadyBound ? { kind: "already" as const, memberId: target.id } : { kind: "invalid" as const };
    }
    if (stored.revokedAt || !isAccessCodeCurrent(stored.expiresAt, now)) return { kind: "invalid" as const };

    if (target.accessMethod === "google") {
      if (stored.purpose !== "invitation" || session.user.isAnonymous || !matchesVerifiedGoogleIdentity({
        actualEmail: session.user.email,
        configuredEmail: target.googleEmail,
        emailVerified: session.user.emailVerified,
        providerIsGoogle: true,
      })) {
        return { kind: "invalid" as const };
      }
      const [googleAccount] = await tx.select({ id: authAccount.id }).from(authAccount)
        .where(and(eq(authAccount.userId, session.user.id), eq(authAccount.providerId, "google")))
        .limit(1);
      if (!googleAccount) return { kind: "invalid" as const };
    } else if (!session.user.isAnonymous) {
      return { kind: "invalid" as const };
    }

    const [priorIdentity] = await tx.select().from(memberDevices)
      .where(eq(memberDevices.authUserId, session.user.id))
      .limit(1);
    if (priorIdentity && priorIdentity.memberId !== target.id) return { kind: "invalid" as const };
    if (priorIdentity && priorIdentity.revokedAt) return { kind: "invalid" as const };
    if (stored.purpose === "recovery" && priorIdentity) return { kind: "invalid" as const };

    if (stored.purpose === "recovery") {
      if (target.accessMethod !== "code" || session.user.isAnonymous !== true) return { kind: "invalid" as const };
      const priorDevices = await tx.select({ authUserId: memberDevices.authUserId }).from(memberDevices)
        .where(and(eq(memberDevices.memberId, target.id), isNull(memberDevices.revokedAt)));
      for (const device of priorDevices) {
        await tx.update(memberDevices).set({ revokedAt: now })
          .where(and(eq(memberDevices.authUserId, device.authUserId), isNull(memberDevices.revokedAt)));
        await tx.delete(authSession).where(and(eq(authSession.userId, device.authUserId), sql`${authSession.userId} <> ${session.user.id}`));
      }
      await tx.update(accessCodes).set({ revokedAt: now })
        .where(and(eq(accessCodes.memberId, target.id), ne(accessCodes.id, stored.id), isNull(accessCodes.consumedAt), isNull(accessCodes.revokedAt)));
    }

    if (!priorIdentity) {
      await tx.insert(memberDevices).values({
        memberId: target.id,
        authUserId: session.user.id,
        identityKind: target.accessMethod === "google" ? "google" : "anonymous",
        label: target.accessMethod === "google" ? "Cuenta Google" : "Dispositivo familiar",
      });
    }
    const [consumed] = await tx.update(accessCodes)
      .set({ consumedAt: now, consumedByAuthUserId: session.user.id })
      .where(and(eq(accessCodes.id, stored.id), isNull(accessCodes.consumedAt), isNull(accessCodes.revokedAt), gt(accessCodes.expiresAt, now)))
      .returning({ id: accessCodes.id });
    if (!consumed) return { kind: "invalid" as const };

    await tx.insert(auditEvents).values({
      familyId: stored.familyId,
      actorMemberId: target.id,
      entityType: "member",
      entityId: target.id,
      action: `${stored.purpose}_code_redeemed`,
      after: { deviceAdded: true },
    });
    await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${stored.familyId}`);
    return { kind: "ok" as const, memberId: target.id };
  });

  if (result.kind === "invalid") return respond(invalidCode, 400);
  return respond({ ok: true });
}
