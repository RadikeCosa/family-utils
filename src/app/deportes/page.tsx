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
import { storedChampionsEnabled } from "@/lib/sports/champions-switch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SportsPage({ searchParams }: { searchParams: Promise<{ event?: string; sport?: string; round?: string }> }) {
  if (!sportsEnabled()) notFound();
  const actor = await getMemberContext(await headers());
  if (!actor) redirect("/acceso");
  const params = await searchParams;
  const environmentEnabled = championsEnabled();
  const [initial,session,storedEnabled] = await Promise.all([
    loadSportsData(actor,params.event??null),
    environmentEnabled && params.sport === "champions" ? createAuth().api.getSession({headers:await headers()}) : Promise.resolve(null),
    environmentEnabled ? storedChampionsEnabled(actor.familyId) : Promise.resolve(false),
  ]);
  const enabled = environmentEnabled && storedEnabled;
  const loadedChampions = enabled && session ? await loadChampionsData(actor,session.session.token,params.round??null) : undefined;
  const champions = loadedChampions ?? undefined;
  return sportsFeatures().agenda ? <AgendaApp key={`${initial.familyId}:${initial.currentMemberId}`} initial={{...initial,championsEnabled:enabled,champions}} /> : <SportsApp initial={initial} />;
}
