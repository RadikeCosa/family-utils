import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { galleryCollections, galleryGuestSessions, galleryInvitations } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { galleryEnabled } from "@/lib/gallery/config";
import { canManageGallery, createInvitationExpiry } from "@/lib/gallery/rules";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ collectionId: string }> }) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { collectionId } = await context.params;
  const [collection] = await getDb().select({ ownerMemberId: galleryCollections.ownerMemberId }).from(galleryCollections).where(and(
    eq(galleryCollections.id, collectionId), eq(galleryCollections.familyId, actor.familyId), isNull(galleryCollections.archivedAt),
  )).limit(1);
  if (!collection || !canManageGallery(actor.role, actor.memberId, collection.ownerMemberId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const now = new Date();
  const invitations = await getDb().select({
    id: galleryInvitations.id,
    createdAt: galleryInvitations.createdAt,
    expiresAt: galleryInvitations.expiresAt,
    redeemedAt: galleryInvitations.redeemedAt,
    revokedAt: galleryInvitations.revokedAt,
  }).from(galleryInvitations).leftJoin(galleryGuestSessions, eq(galleryGuestSessions.invitationId, galleryInvitations.id)).where(and(
    eq(galleryInvitations.collectionId, collectionId), isNull(galleryInvitations.revokedAt),
    or(
      and(isNull(galleryInvitations.redeemedAt), gt(galleryInvitations.expiresAt, now)),
      and(gt(galleryGuestSessions.expiresAt, now), isNull(galleryGuestSessions.revokedAt)),
    ),
  )).groupBy(galleryInvitations.id);
  return NextResponse.json({ invitations }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ collectionId: string }> }) {
  if (!galleryEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { collectionId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID" }, { status: 400 }); }
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await getDb().transaction(async tx => {
    const [collection] = await tx.select({ ownerMemberId: galleryCollections.ownerMemberId }).from(galleryCollections).where(and(
      eq(galleryCollections.id, collectionId), eq(galleryCollections.familyId, actor.familyId), isNull(galleryCollections.archivedAt),
    )).for("update").limit(1);
    if (!collection || !canManageGallery(actor.role, actor.memberId, collection.ownerMemberId)) return { error: "NOT_FOUND" as const };
    const now = new Date();
    const [active] = await tx.select({ id: galleryInvitations.id }).from(galleryInvitations).leftJoin(galleryGuestSessions, eq(galleryGuestSessions.invitationId, galleryInvitations.id)).where(and(
      eq(galleryInvitations.collectionId, collectionId), isNull(galleryInvitations.revokedAt),
      or(
        and(isNull(galleryInvitations.redeemedAt), gt(galleryInvitations.expiresAt, now)),
        and(gt(galleryGuestSessions.expiresAt, now), isNull(galleryGuestSessions.revokedAt)),
      ),
    )).limit(1);
    if (active && input.confirmReissue !== true) return { error: "CONFIRM_REISSUE" as const };
    await tx.update(galleryInvitations).set({ revokedAt: now }).where(and(eq(galleryInvitations.collectionId, collectionId), isNull(galleryInvitations.revokedAt)));
    await tx.update(galleryGuestSessions).set({ revokedAt: now }).where(and(eq(galleryGuestSessions.collectionId, collectionId), isNull(galleryGuestSessions.revokedAt)));
    const [invitation] = await tx.insert(galleryInvitations).values({
      familyId: actor.familyId, ownerMemberId: collection.ownerMemberId, collectionId,
      createdByMemberId: actor.memberId, tokenHash, expiresAt: createInvitationExpiry(now),
    }).returning({ id: galleryInvitations.id, expiresAt: galleryInvitations.expiresAt });
    return { invitation };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.error === "NOT_FOUND" ? 404 : 409 });
  const url = new URL("/galeria/invitado", process.env.BETTER_AUTH_URL ?? request.url);
  url.hash = new URLSearchParams({ token }).toString();
  return NextResponse.json({ invitation: result.invitation, url: url.toString() }, { status: 201, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
