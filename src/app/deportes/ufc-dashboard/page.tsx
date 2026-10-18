import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { sportsFeatures, sportsEnabled } from "@/lib/sports/config";
import { getMemberContext } from "@/lib/auth/context";
import UfcDashboard from "./UfcDashboard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function UfcDashboardPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  if (!sportsEnabled() || !sportsFeatures().ufc) notFound();
  const actor = await getMemberContext(await headers());
  if (!actor) redirect("/acceso");
  const params = await searchParams;
  return <UfcDashboard initialEvent={params.event ?? null} isAdmin={actor.role === "administrator"} />;
}
