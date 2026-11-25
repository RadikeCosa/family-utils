export const GALLERY_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const GALLERY_MAX_PIXELS = 40_000_000;
export const GALLERY_STORAGE_BUDGET_BYTES = 700 * 1024 * 1024;
export const GALLERY_MAX_COLLECTION_ITEMS = 200;
export const GALLERY_MAX_SHARE_ITEMS = 200;
export const GALLERY_MAX_ACTIVE_SHARES_PER_FAMILY = 20;
export const GALLERY_SHARE_PAGE_SIZE = 24;
// A 200 drawing visit can request each thumbnail plus page and revalidation data.
// This leaves headroom above the expected burst while global limits bound abuse.
export const GALLERY_PUBLIC_SESSION_REQUESTS_PER_MINUTE = 360;
export const GALLERY_PUBLIC_IP_REQUESTS_PER_MINUTE = 360;
export const GALLERY_SHARE_SESSION_REVALIDATE_MS = 30_000;
export const GALLERY_SHARE_PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export const GALLERY_SHARE_AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const GALLERY_SHARE_DURATIONS = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
} as const;
export const GALLERY_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
export const GALLERY_GUEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GalleryRole = "administrator" | "member";
export type GalleryInvitationState = {
  expiresAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
};
export type GallerySessionState = {
  expiresAt: Date;
  revokedAt: Date | null;
};

export type GalleryShareDuration = keyof typeof GALLERY_SHARE_DURATIONS;

export function galleryShareExpiry(duration: unknown, now = new Date()) {
  if (typeof duration !== "string" || !Object.hasOwn(GALLERY_SHARE_DURATIONS, duration)) return null;
  return new Date(now.getTime() + GALLERY_SHARE_DURATIONS[duration as GalleryShareDuration]);
}

export function publicAccessIsValid(input: {
  share: { expiresAt: Date; revokedAt: Date | null; creatorArchivedAt: Date | null };
  session?: { expiresAt: Date; revokedAt: Date | null };
  collectionArchivedAt?: Date | null;
}, now = new Date()) {
  return input.share.expiresAt.getTime() > now.getTime()
    && input.share.revokedAt === null
    && input.share.creatorArchivedAt === null
    && (input.collectionArchivedAt ?? null) === null
    && (!input.session || (input.session.expiresAt.getTime() > now.getTime() && input.session.revokedAt === null));
}

export function canManageGallery(role: GalleryRole, actorMemberId: string, ownerMemberId: string) {
  return role === "administrator" || actorMemberId === ownerMemberId;
}

export function canEditDrawing(role: GalleryRole, actorMemberId: string, authorMemberId: string) {
  return canManageGallery(role, actorMemberId, authorMemberId);
}

export function invitationIsRedeemable(invitation: GalleryInvitationState, now = new Date()) {
  return invitation.expiresAt.getTime() > now.getTime()
    && invitation.redeemedAt === null
    && invitation.revokedAt === null;
}

export function guestSessionIsValid(input: {
  session: GallerySessionState;
  invitation: GalleryInvitationState;
  collectionArchivedAt: Date | null;
}, now = new Date()) {
  return input.session.expiresAt.getTime() > now.getTime()
    && input.session.revokedAt === null
    && input.invitation.redeemedAt !== null
    && input.invitation.revokedAt === null
    && input.collectionArchivedAt === null;
}

export function createInvitationExpiry(now = new Date()) {
  return new Date(now.getTime() + GALLERY_INVITATION_TTL_MS);
}

export function createGuestSessionExpiry(now = new Date()) {
  return new Date(now.getTime() + GALLERY_GUEST_SESSION_TTL_MS);
}

export function galleryUploadInput(input: Record<string, unknown>) {
  const name = typeof input.name === "string" ? input.name.trim().split(/[\\/]/u).at(-1) ?? "" : "";
  const bytes = input.bytes;
  const type = input.type;
  if (!name || Array.from(name).length > 255 || /[\u0000-\u001f\u007f]/u.test(name)) return null;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > GALLERY_MAX_INPUT_BYTES) return null;
  if (type !== "image/png" && type !== "image/jpeg") return null;
  return { name, bytes, type };
}

export function galleryQuotaAllows(usedBytes: number, reservedBytes: number, nextBytes: number) {
  return Number.isSafeInteger(usedBytes) && Number.isSafeInteger(reservedBytes) && Number.isSafeInteger(nextBytes)
    && usedBytes >= 0 && reservedBytes >= 0 && nextBytes > 0
    && usedBytes + reservedBytes + nextBytes <= GALLERY_STORAGE_BUDGET_BYTES;
}
