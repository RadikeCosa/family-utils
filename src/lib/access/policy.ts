export type AccessPurpose = "invitation" | "recovery";
export type AccessMethod = "google" | "code";
export type AccessRole = "administrator" | "member";

export function normalizeGoogleEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isGoogleAutoLinkEnabled(value = process.env.GOOGLE_AUTO_LINK_ENABLED): boolean {
  return value === "true";
}

export function matchesVerifiedGoogleIdentity(input: {
  configuredEmail: string | null | undefined;
  actualEmail: string;
  emailVerified: boolean;
  providerIsGoogle: boolean;
}): boolean {
  return input.providerIsGoogle && input.emailVerified && !!input.configuredEmail
    && normalizeGoogleEmail(input.actualEmail) === normalizeGoogleEmail(input.configuredEmail);
}

export function canGenerateMemberCode(input: {
  actorRole: AccessRole;
  actorMemberId: string;
  targetMemberId: string;
  targetRole: AccessRole;
  accessMethod: AccessMethod;
  googleEmail: string | null;
  hasActiveDevice: boolean;
  purpose: AccessPurpose;
}): boolean {
  if (input.actorRole !== "administrator" || input.actorMemberId === input.targetMemberId) return false;
  if (input.accessMethod === "google") {
    return input.targetRole === "administrator" && !!input.googleEmail && input.purpose === "invitation" && !input.hasActiveDevice;
  }
  return input.targetRole === "member" && (input.purpose === "invitation" || input.hasActiveDevice);
}

export function accessCodeLifetimeMs(purpose: AccessPurpose): number {
  return purpose === "invitation" ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
}

export function isAccessCodeCurrent(expiresAt: Date, now = new Date()): boolean {
  return now.getTime() < expiresAt.getTime();
}
