import { and, eq, isNull } from "drizzle-orm";
import type { User } from "better-auth";
import { getDb } from "@/db";
import { createAuth } from "@/lib/auth/server";
import { families, memberDevices, members } from "@/db/schema";
import { normalizeGoogleEmail } from "@/lib/access/policy";

export interface MemberContext {
  authUser: User;
  memberId: string;
  familyId: string;
  familyName: string;
  familyTimeZone: string;
  familyRevision: number;
  name: string;
  role: "administrator" | "member";
  accessMethod: "google" | "code";
  googleEmail: string | null;
  memberVersion: number;
}

export async function getMemberContext(requestHeaders: Headers): Promise<MemberContext | null> {
  const session = await createAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const [membership] = await getDb()
    .select({
      memberId: members.id,
      familyId: families.id,
      familyName: families.name,
      familyTimeZone: families.timeZone,
      familyRevision: families.revision,
      name: members.name,
      role: members.role,
      accessMethod: members.accessMethod,
      googleEmail: members.googleEmail,
      memberVersion: members.version,
    })
    .from(memberDevices)
    .innerJoin(members, eq(memberDevices.memberId, members.id))
    .innerJoin(families, eq(members.familyId, families.id))
    .where(and(
      eq(memberDevices.authUserId, session.user.id),
      isNull(memberDevices.revokedAt),
      isNull(members.archivedAt),
    ))
    .limit(1);

  if (!membership) return null;
  return { authUser: session.user, ...membership };
}

export function isBootstrapEmail(email: string): boolean {
  const allowed = (process.env.FAMILY_BOOTSTRAP_EMAILS ?? "")
    .split(",")
    .map(normalizeGoogleEmail)
    .filter(Boolean);
  return allowed.includes(normalizeGoogleEmail(email));
}
