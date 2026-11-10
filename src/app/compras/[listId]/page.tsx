import Experience from "@/components/platform/Experience";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import ShoppingApp from "../ShoppingApp";

export const runtime = "nodejs";
async function ShoppingListPage({ params }: { params: Promise<{ listId: string }> }) {
  if (!await getMemberContext(await headers())) redirect("/acceso");
  const { listId } = await params;
  return <ShoppingApp listId={listId} />;
}

export default async function Page(props: Parameters<typeof ShoppingListPage>[0]) {
  return <Experience>{await ShoppingListPage(props)}</Experience>;
}
