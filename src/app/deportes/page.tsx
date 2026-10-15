import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { sportsEnabled } from "@/lib/sports/config";
import { loadSportsData } from "@/lib/sports/server";
import AgendaApp from "./AgendaApp";
import { sportsFeatures } from "@/lib/sports/config";
import SportsApp from "./SportsApp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SportsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  if (!sportsEnabled()) notFound();
  const actor = await getMemberContext(await headers());
  if (!actor) redirect("/acceso");
  const initial = await loadSportsData(actor, (await searchParams).event ?? null);
  return sportsFeatures().agenda ? <AgendaApp initial={initial} /> : <SportsApp initial={initial} />;
}
