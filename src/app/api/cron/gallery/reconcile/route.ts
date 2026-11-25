import { del } from "@vercel/blob";
import { and, eq, gt, lt, or, isNull, notExists, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, authRateLimit, galleryDrawings, galleryGuestSessions, galleryInvitations, galleryShareSessions, galleryShares } from "@/db/schema";
import { GALLERY_SHARE_AUDIT_RETENTION_MS, GALLERY_SHARE_PURGE_AFTER_MS } from "@/lib/gallery/rules";

export const runtime = "nodejs";

async function remove(path: string | null) {
  if (!path) return true;
  try { await del(path); return true; } catch { return false; }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const db = getDb();
  const now = new Date();
  const stale = await db.select().from(galleryDrawings).where(and(
    lt(galleryDrawings.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    or(eq(galleryDrawings.status, "pending"), eq(galleryDrawings.status, "processing"), eq(galleryDrawings.status, "failed")),
  ));
  let abandoned = 0;
  for (const drawing of stale) {
    const paths = [drawing.pendingPath, drawing.displayPath, drawing.thumbnailPath,
      `gallery/${drawing.id}/display.webp`, `gallery/${drawing.id}/thumbnail.webp`];
    const removed = await Promise.all([...new Set(paths)].map(remove));
    if (removed.every(Boolean)) {
      await db.delete(galleryDrawings).where(eq(galleryDrawings.id, drawing.id));
      abandoned++;
    }
  }

  const readyWithOriginal = await db.select({ id: galleryDrawings.id, pendingPath: galleryDrawings.pendingPath }).from(galleryDrawings)
    .where(and(eq(galleryDrawings.status, "ready"), sql`${galleryDrawings.pendingPath} IS NOT NULL`));
  let originalsRemoved = 0;
  for (const drawing of readyWithOriginal) {
    if (await remove(drawing.pendingPath)) {
      await db.update(galleryDrawings).set({ pendingPath: null, updatedAt: now }).where(eq(galleryDrawings.id, drawing.id));
      originalsRemoved++;
    }
  }

  await db.delete(galleryGuestSessions).where(lt(galleryGuestSessions.expiresAt, now));
  await db.delete(galleryInvitations).where(and(
    lt(galleryInvitations.expiresAt, now),
    or(isNull(galleryInvitations.redeemedAt), notExists(db.select({ id: galleryGuestSessions.id }).from(galleryGuestSessions).where(and(
      eq(galleryGuestSessions.invitationId, galleryInvitations.id), isNull(galleryGuestSessions.revokedAt), gt(galleryGuestSessions.expiresAt, now),
    )))),
  ));
  const terminalCutoff = new Date(now.getTime() - GALLERY_SHARE_PURGE_AFTER_MS);
  await db.delete(galleryShareSessions).where(and(
    or(lt(galleryShareSessions.expiresAt, terminalCutoff), lt(galleryShareSessions.revokedAt, terminalCutoff)),
  ));
  await db.delete(galleryShares).where(or(
    lt(galleryShares.expiresAt, terminalCutoff), lt(galleryShares.revokedAt, terminalCutoff),
  ));
  await db.delete(auditEvents).where(and(
    eq(auditEvents.entityType, "gallery_share"),
    lt(auditEvents.createdAt, new Date(now.getTime() - GALLERY_SHARE_AUDIT_RETENTION_MS)),
  ));
  const rateCutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  await db.delete(authRateLimit).where(and(sql`${authRateLimit.key} LIKE 'gallery:%'`, lt(authRateLimit.lastRequest, rateCutoff)));
  return NextResponse.json({ ok: true, abandoned, originalsRemoved }, { headers: { "Cache-Control": "no-store" } });
}
