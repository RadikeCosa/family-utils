import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { accessCodes, auditEvents, authSession, memberDevices, members } from "@/db/schema";
import { createAuth } from "@/lib/auth/server";
import { accessPepper, opaqueBucketKey, recordCodeAttempt } from "@/lib/access/rate-limit";
import { digestAccessCode, normalizeAccessCode } from "@/lib/tasks/rules";

export const runtime = "nodejs";
const invalidCode = { error: "Código inválido o vencido" };

export async function POST(request: Request) {
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json(invalidCode, { status: 400 }); }
  if (typeof input.code !== "string" || input.code.length > 80) return NextResponse.json(invalidCode, { status: 400 });

  let pepper: string;
  try { pepper = accessPepper(); }
  catch { return NextResponse.json({ error: "Access codes are not configured" }, { status: 503 }); }

  let normalizedForRateLimit = input.code.toUpperCase().replace(/[\s-]/g, "").slice(0, 80);
  try { normalizedForRateLimit = normalizeAccessCode(input.code); } catch { /* Keep malformed input in a bounded bucket. */ }
  // Vercel overwrites this platform header; client supplied forwarding headers are not trusted.
  const trustedOrigin = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? "unknown-origin";
  const originAllowed = await recordCodeAttempt(opaqueBucketKey(pepper, "origin", trustedOrigin), 10);
  const credentialAllowed = await recordCodeAttempt(opaqueBucketKey(pepper, "code-attempt", normalizedForRateLimit), 5);
  if (!originAllowed || !credentialAllowed) return NextResponse.json(invalidCode, { status: 400 },);

  let digest: string;
  try { digest = digestAccessCode(normalizeAccessCode(input.code), pepper, "invitation"); }
  catch {
    try { digest = digestAccessCode(normalizeAccessCode(input.code), pepper, "recovery"); }
    catch { return NextResponse.json(invalidCode, { status: 400 }); }
  }
  const now = new Date();
  const candidate = await getDb().select().from(accessCodes)
    .where(and(eq(accessCodes.digest, digest), isNull(accessCodes.consumedAt), isNull(accessCodes.revokedAt), gt(accessCodes.expiresAt, now)))
    .limit(1);
  // The digest is purpose-scoped. Check both scopes without revealing the result.
  let selected = candidate[0];
  let selectedPurpose: "invitation" | "recovery" | null = selected?.purpose ?? null;
  if (!selected) {
    const recoveryDigest = digestAccessCode(input.code, pepper, "recovery");
    const recoveryCandidate = await getDb().select().from(accessCodes)
      .where(and(eq(accessCodes.digest, recoveryDigest), isNull(accessCodes.consumedAt), isNull(accessCodes.revokedAt), gt(accessCodes.expiresAt, now)))
      .limit(1);
    selected = recoveryCandidate[0];
    selectedPurpose = selected?.purpose ?? null;
    if (selectedPurpose) digest = recoveryDigest;
  }
  if (!selected || !selectedPurpose) return NextResponse.json(invalidCode, { status: 400 });

  const auth = createAuth();
  const authHeaders = new Headers(request.headers);
  authHeaders.delete("cookie");
  authHeaders.delete("content-length");
  authHeaders.set("content-type", "application/json");
  const signInRequest = new Request(new URL("/api/auth/sign-in/anonymous", request.url), {
    method: "POST",
    headers: authHeaders,
    body: "{}",
  });
  const authResponse = await auth.handler(signInRequest);
  if (!authResponse.ok) return NextResponse.json(invalidCode, { status: 400 });
  let authUserId: string;
  try {
    const payload = await authResponse.clone().json() as { user?: { id?: string } };
    authUserId = payload.user?.id ?? "";
  } catch { authUserId = ""; }
  if (!authUserId) return NextResponse.json(invalidCode, { status: 400 });

  const bound = await getDb().transaction(async (tx) => {
    const [code] = await tx.select().from(accessCodes)
      .where(and(eq(accessCodes.id, selected.id), eq(accessCodes.digest, digest)))
      .for("update")
      .limit(1);
    if (!code || code.consumedAt || code.revokedAt || code.expiresAt <= new Date()) return null;
    const [target] = await tx.select().from(members)
      .where(and(eq(members.id, code.memberId), eq(members.familyId, code.familyId), isNull(members.archivedAt)))
      .limit(1);
    if (!target) return null;

    const currentDevices = await tx.select({ authUserId: memberDevices.authUserId }).from(memberDevices)
      .where(and(eq(memberDevices.memberId, code.memberId), isNull(memberDevices.revokedAt)));
    if (code.purpose === "recovery") {
      for (const device of currentDevices) {
        await tx.update(memberDevices).set({ revokedAt: new Date() }).where(eq(memberDevices.authUserId, device.authUserId));
        await tx.delete(authSession).where(eq(authSession.userId, device.authUserId));
      }
    }

    const [consumed] = await tx.update(accessCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(accessCodes.id, code.id), isNull(accessCodes.consumedAt), isNull(accessCodes.revokedAt), gt(accessCodes.expiresAt, new Date())))
      .returning({ id: accessCodes.id });
    if (!consumed) return null;
    await tx.insert(memberDevices).values({ memberId: target.id, authUserId, label: "Dispositivo familiar" });
    await tx.insert(auditEvents).values({
      familyId: code.familyId,
      actorMemberId: target.id,
      entityType: "member",
      entityId: target.id,
      action: `${code.purpose}_code_redeemed`,
      after: { deviceAdded: true },
    });
    await tx.execute(sql`UPDATE families SET revision = revision + 1, updated_at = now() WHERE id = ${code.familyId}`);
    return { memberId: target.id };
  });

  if (!bound) return NextResponse.json(invalidCode, { status: 400 });
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  for (const cookie of authResponse.headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
  return response;
}
