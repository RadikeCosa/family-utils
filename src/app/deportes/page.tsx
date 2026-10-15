import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { sportsEnabled } from "@/lib/sports/config";
import { loadSportsData } from "@/lib/sports/server";
import SportsApp from "./SportsApp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SportsPage() {
  if (!sportsEnabled()) notFound();
  const actor = await getMemberContext(await headers());
  if (!actor) redirect("/acceso");
  return <SportsApp initial={await loadSportsData(actor)} />;
}
