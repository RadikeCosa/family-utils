import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import MenuApp from "./MenuApp";

export const runtime = "nodejs";

export default async function MenusPage() {
  const member = await getMemberContext(await headers());
  if (!member) redirect("/acceso");
  return <MenuApp />;
}
