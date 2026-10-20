import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { trainingEnabled } from "@/lib/training/config";
import { todayInZone } from "@/lib/training/rules";
import TrainingApp from "./TrainingApp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function TrainingPage() {
  if (!trainingEnabled()) notFound();
  const actor = await getMemberContext(await headers());
  if (!actor) redirect("/acceso");
  return <TrainingApp today={todayInZone(actor.familyTimeZone)} memberName={actor.name} />;
}
