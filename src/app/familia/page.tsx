import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import FamilyManager from "./FamilyManager";

export const runtime = "nodejs";

export default async function FamilyPage() {
  const member = await getMemberContext(await headers());
  if (!member) redirect("/acceso");
  return <FamilyManager currentMemberId={member.memberId} currentRole={member.role} googleAutoLinkEnabled={process.env.GOOGLE_AUTO_LINK_ENABLED === "true"} />;
}
