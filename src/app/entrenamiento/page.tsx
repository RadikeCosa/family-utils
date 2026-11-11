import Experience from "@/components/platform/Experience";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { optionalTrainingMetricsEnabled, optionalTrainingMetricsFormEnabled, trainingEnabled, trainingDiaryEnabled, trainingActivityFormEnabled } from "@/lib/training/config";
import { todayInZone } from "@/lib/training/rules";
import DiaryApp from "./DiaryApp";
import TrainingIdentity from "./TrainingIdentity";
import { diaryTransitioned } from "@/lib/training/diary-state";
import { nextCivilDayAt } from "@/lib/calendar/civil";
import { navigationKey } from "@/lib/navigation/storage";
import TrainingApp from "./TrainingApp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function TrainingPage() {
  if (!trainingEnabled()) notFound();
  const actor = await getMemberContext(await headers());
  if (!actor) redirect("/acceso");
  const scope = navigationKey(actor.familyId, actor.memberId), now = new Date();
  const transitioned = await diaryTransitioned();
  return <><TrainingIdentity scope={scope} />{transitioned
    ? <DiaryApp scope={scope} memberName={actor.name} initialContext={{ today: todayInZone(actor.familyTimeZone, now), timeZone: actor.familyTimeZone, serverNow: now.toISOString(), nextDayAt: nextCivilDayAt(now, actor.familyTimeZone).toISOString(), writable: trainingDiaryEnabled(), activityFormEnabled: trainingActivityFormEnabled() }} />
    : <TrainingApp draftScope={scope} today={todayInZone(actor.familyTimeZone)} memberName={actor.name} optionalMetrics={optionalTrainingMetricsEnabled() && optionalTrainingMetricsFormEnabled()} />}</>;

}

export default async function Page() {
  return <Experience>{await TrainingPage()}</Experience>;
}
