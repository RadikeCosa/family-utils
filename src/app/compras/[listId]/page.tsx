import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import ShoppingApp from "../ShoppingApp";

export const runtime = "nodejs";
export default async function ShoppingListPage({ params }: { params: Promise<{ listId: string }> }) {
  if (!await getMemberContext(await headers())) redirect("/acceso");
  const { listId } = await params;
  return <ShoppingApp listId={listId} />;
}
