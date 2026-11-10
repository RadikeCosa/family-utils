import Experience from "@/components/platform/Experience";
import { recipesEnabled } from "@/lib/recipes/config";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import MenuApp from "./MenuApp";

export const runtime = "nodejs";

async function MenusPage() {
  const member = await getMemberContext(await headers());
  if (!member) redirect("/acceso");
  return <MenuApp recipes={recipesEnabled()} />;
}

export default async function Page() {
  return <Experience>{await MenusPage()}</Experience>;
}
