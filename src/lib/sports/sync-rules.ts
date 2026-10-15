import { sportsNowDay, sportsWeek } from "./rules.ts";

const aliases = new Map<string,string>([
  ["club atletico river plate","river plate"], ["club atletico river","river plate"], ["river","river plate"],
  ["julien leblanc","julien leblanc"], ["lone er kavanagh","lone er kavanagh"], ["loneer kavanagh","lone er kavanagh"],
  ["abdul rakhman yakhyaev","abdul rakhman yakhyaev"], ["suyoung you","su young you"], ["su young you","su young you"],
]);
export function normalizeSportsAlias(value: string) {
  const normalized=value.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().replace(/[’'`]/g," ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
  return aliases.get(normalized)??normalized;
}
export function argentinaDate(now: Date) { return sportsNowDay(now); }
export function argentinaAddDays(day: string, amount: number) { const date=new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate()+amount); return date.toISOString().slice(0,10); }
export function ufcHorizon(now = new Date()) {
  const week=sportsWeek(now); const end=argentinaAddDays(week.end,15);
  return { from:week.start, through:end, weeks:3 };
}
export function riverFuture(event: { eventDate: string|null; startsAt: string|Date|null }, now = new Date()) {
  if(event.startsAt) return new Date(event.startsAt).getTime()>now.getTime();
  return !!event.eventDate && event.eventDate>=argentinaDate(now);
}
export type SyncFailureState={ consecutiveFailures:number; nextAttemptAt:string|Date|null; leaseUntil:string|Date|null; lastSuccessAt:string|Date|null; coveredThrough:string|null };
export function failureBackoffMinutes(failures: number) { return failures<=1?10:failures===2?60:360; }
function elapsed(value:string|Date|null, now:Date) { return value?now.getTime()-new Date(value).getTime():Infinity; }
export type LocalSyncFacts={ riverEvents:Array<{eventDate:string|null;startsAt:string|Date|null;status:string;sourceProvider:string|null;sourceAbsentAt:string|Date|null}>; ufcEvents:Array<{eventDate:string|null;mainCardStartsAt:string|Date|null;status:string;sourceProvider:string|null;sourceAbsentAt:string|Date|null}>; river:SyncFailureState; ufc:SyncFailureState; ufcListingCoversThrough:string|null; ufcPendingRetryDue?:boolean; ufcPartial?:boolean };
export type SyncDecision={ needed:boolean; eligible:boolean; dueAt:string|null; reason:"missing"|"review"|"fresh"|"cooldown"|"leased" };
function decision(needed:boolean,state:SyncFailureState,now:Date,minSpacingMs:number):SyncDecision {
  if(!needed)return {needed:false,eligible:false,dueAt:null,reason:"fresh"};
  const lease=state.leaseUntil?new Date(state.leaseUntil).getTime():0;
  if(lease>now.getTime())return {needed:true,eligible:false,dueAt:new Date(lease).toISOString(),reason:"leased"};
  const next=state.nextAttemptAt?new Date(state.nextAttemptAt).getTime():0;
  const spacing=state.lastSuccessAt?new Date(state.lastSuccessAt).getTime()+minSpacingMs:0;
  const due=Math.max(next,spacing);
  return due>now.getTime()?{needed:true,eligible:false,dueAt:new Date(due).toISOString(),reason:"cooldown"}:{needed:true,eligible:true,dueAt:null,reason:state.lastSuccessAt?"review":"missing"};
}
export function riverSyncDecision(facts:LocalSyncFacts,now=new Date()):SyncDecision {
  const today=argentinaDate(now); const future=facts.riverEvents.filter(event=>!event.sourceAbsentAt&&event.status!=="cancelled"&&event.status!=="completed"&&riverFuture(event,now)).sort((a,b)=>(a.startsAt?new Date(a.startsAt).getTime():Infinity)-(b.startsAt?new Date(b.startsAt).getTime():Infinity)||String(a.eventDate).localeCompare(String(b.eventDate)));
  const confirmed=facts.river.coveredThrough&&facts.river.coveredThrough>=today&&!facts.riverEvents.some(event=>event.sourceProvider&&event.eventDate&&event.eventDate<=today&&event.status!=="completed"&&event.status!=="cancelled");
  let needed=!confirmed&&future.length<3;
  const next=future[0];
  if(next?.eventDate&&next.startsAt==null&&next.eventDate<=argentinaAddDays(today,14)) needed=true;
  if(next?.startsAt&&new Date(next.startsAt).getTime()-now.getTime()<=48*3600000&&elapsed(facts.river.lastSuccessAt,now)>6*3600000) needed=true;
  if(facts.river.coveredThrough&&facts.river.coveredThrough<today)needed=true;
  if(confirmed&&facts.river.lastSuccessAt&&elapsed(facts.river.lastSuccessAt,now)>=6*3600000)needed=true;
  const pendingHour=next?.startsAt==null&&!!next?.eventDate&&next.eventDate<=argentinaAddDays(today,14);
  return decision(needed,facts.river,now,pendingHour?6*3600000:60*60000);
}
export function ufcSyncDecision(facts:LocalSyncFacts,now=new Date()):SyncDecision {
  const horizon=ufcHorizon(now); const inHorizon=facts.ufcEvents.filter(event=>event.sourceProvider==="ufc_official"&&event.eventDate&&event.eventDate>=horizon.from&&event.eventDate<horizon.through&&!event.sourceAbsentAt&&event.status!=="cancelled");
  const knownComplete=!!facts.ufc.coveredThrough&&facts.ufc.coveredThrough>=horizon.through&&facts.ufcListingCoversThrough&&facts.ufcListingCoversThrough>=horizon.through;
  let needed=!knownComplete&&(!facts.ufc.coveredThrough||facts.ufc.coveredThrough<horizon.through);
  if(!knownComplete&&!facts.ufc.coveredThrough)needed=true;
  if(facts.ufc.coveredThrough&&facts.ufc.coveredThrough<horizon.through)needed=true;
  const dueCard=inHorizon.some(event=>event.mainCardStartsAt&&new Date(event.mainCardStartsAt).getTime()>now.getTime()&&new Date(event.mainCardStartsAt).getTime()-now.getTime()<7*86400000&&elapsed(facts.ufc.lastSuccessAt,now)>12*3600000);
  const duePending=!!facts.ufcPendingRetryDue;
  needed=needed||dueCard||duePending;
  if(knownComplete&&facts.ufc.lastSuccessAt&&elapsed(facts.ufc.lastSuccessAt,now)>=12*3600000)needed=true;
  const result=decision(needed,facts.ufc,now,duePending||facts.ufcPartial?0:60*60000);
  return result;
}
export function shouldMarkUfcAbsent(eventDate:string|null,now=new Date()) { return !!eventDate&&eventDate>=argentinaDate(now); }
