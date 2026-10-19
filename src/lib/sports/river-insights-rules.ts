import { SPORTS_UUID } from "./rules.ts";
export type RiverStatistic = { label: string; homeValue: number | null; awayValue: number | null; unit?: string };
export type RiverStatistics = { items: RiverStatistic[]; source: string; checkedAt: string };
export type RiverCuriosities = { items: string[]; source: string; checkedAt: string };
export type RiverInsightsBundle = { version: 1; eventId: string; statistics?: RiverStatistics; curiosities?: RiverCuriosities };
const record = (v: unknown): v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function metadata(v: Record<string,unknown>, now: Date) {
  if (typeof v.source !== "string" || v.source.length > 1000 || typeof v.checkedAt !== "string" || !Number.isFinite(Date.parse(v.checkedAt)) || Date.parse(v.checkedAt) > now.getTime()+600000) return null;
  try { const u = new URL(v.source); if(u.protocol!=="https:" || u.username || u.password) return null; }catch{return null;}
  return {source:v.source,checkedAt:new Date(v.checkedAt).toISOString()};
}
export function parseRiverInsights(value: unknown, now = new Date()): RiverInsightsBundle | null {
  if(!record(value) || value.version!==1 || value.example===true || typeof value.eventId!=="string" || !SPORTS_UUID.test(value.eventId) || (!Object.hasOwn(value,"statistics")&&!Object.hasOwn(value,"curiosities")))return null;
  const result: RiverInsightsBundle = {version:1,eventId:value.eventId};
  if(Object.hasOwn(value,"statistics")) {
    const v=value.statistics;if(!record(v)||!Array.isArray(v.items)||v.items.length>30)return null;
    const meta=metadata(v,now);if(!meta)return null;
    const items:RiverStatistic[]=[];const labels=new Set<string>();
    const validValue=(x:unknown)=>x===null || (typeof x==="number" && Number.isFinite(x) && x>=0 && x<=1e9);
    for(const item of v.items){
      if(!record(item)||typeof item.label!=="string"||!item.label.trim()||Array.from(item.label.trim()).length>80||!validValue(item.homeValue)||!validValue(item.awayValue)||(item.homeValue===null&&item.awayValue===null)||(item.unit!==undefined&&(typeof item.unit!=="string"||Array.from(item.unit).length>30)))return null;
      const key=item.label.trim().toLocaleLowerCase("es");if(labels.has(key))return null;labels.add(key);
      items.push({label:item.label.trim(),homeValue:item.homeValue as number|null,awayValue:item.awayValue as number|null,...(typeof item.unit==="string"?{unit:item.unit.trim()}:{})});
    }
    result.statistics={...meta,items};
  }
  if(Object.hasOwn(value,"curiosities")) {
    const v=value.curiosities;if(!record(v)||!Array.isArray(v.items)||v.items.length>20)return null;
    const meta=metadata(v,now);if(!meta)return null;
    if(v.items.some(x=>typeof x!=="string"||!x.trim()||Array.from(x.trim()).length>500))return null;
    result.curiosities={...meta,items:v.items.map(x=>(x as string).trim())};
  }
  return result;
}
