import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { sportsEnabled } from "@/lib/sports/config";
import { loadSportsData } from "@/lib/sports/server";
import AgendaApp from "./AgendaApp";
import { sportsFeatures } from "@/lib/sports/config";
import SportsApp from "./SportsApp";
import { championsEnabled } from "@/lib/sports/config";
import { loadChampionsData } from "@/lib/sports/champions-server";
import { createAuth } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SportsPage({ searchParams }: { searchParams: Promise<{ event?: string; sport?: string; round?: string }> }) {
  if (!sportsEnabled()) notFound();
  const actor = await getMemberContext(await headers());
  if (!actor) redirect("/acceso");
  const params = await searchParams;
  const [initial,session] = await Promise.all([
    loadSportsData(actor,params.event??null),
    params.sport === "champions" ? createAuth().api.getSession({headers:await headers()}) : Promise.resolve(null),
  ]);
  const loadedChampions = session ? await loadChampionsData(actor,session.session.token,params.round??null) : undefined;
  const champions = loadedChampions ?? undefined;
  return sportsFeatures().agenda ? <AgendaApp key={`${initial.familyId}:${initial.currentMemberId}`} initial={{...initial,championsEnabled:championsEnabled(),champions}} /> : <SportsApp initial={initial} />;
}
