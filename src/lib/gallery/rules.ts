export const GALLERY_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const GALLERY_MAX_PIXELS = 40_000_000;
export const GALLERY_STORAGE_BUDGET_BYTES = 700 * 1024 * 1024;
export const GALLERY_MAX_COLLECTION_ITEMS = 200;
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
