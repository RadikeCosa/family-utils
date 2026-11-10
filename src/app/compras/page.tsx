import Experience from "@/components/platform/Experience";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import ShoppingApp from "./ShoppingApp";

export const runtime = "nodejs";
async function ShoppingPage() {
  if (!await getMemberContext(await headers())) redirect("/acceso");
  return <ShoppingApp />;
}

export default async function Page() {
  return <Experience>{await ShoppingPage()}</Experience>;
}
