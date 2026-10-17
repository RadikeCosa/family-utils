import { SPORTS_UUID } from "./rules.ts";
import { utcKickoff, type AgendaIssue } from "./champions-rules.ts";
export type ChampionsResultInput = { eventId: string; homeGoals: number; awayGoals: number; source: string };
export type ChampionsResultsBundle = { schemaVersion: 1; sport: "champions"; type: "results"; period: "90_minutes"; checkedAt: string; roundId: string; results: ChampionsResultInput[] };
export function parseChampionsResults(raw: unknown, now = new Date()): { bundle: ChampionsResultsBundle | null; issues: AgendaIssue[] } {
  const issues: AgendaIssue[] = [];
  const add = (path: string,message: string) => issues.push({path,message});
  if (!raw || typeof raw!=="object" || Array.isArray(raw)) return {bundle:null,issues:[{path:"bundle",message:"Se requiere un objeto JSON."}]};
  const b=raw as Record<string,unknown>;
  if(b.schemaVersion!==1||b.sport!=="champions"||b.type!=="results")add("schemaVersion","Usá versión 1, sport champions y type results.");
  if(b.period!=="90_minutes")add("period","Solo se admiten los 90 minutos más descuento; excluí alargue y penales.");
  if(typeof b.roundId!=="string"||!SPORTS_UUID.test(b.roundId))add("roundId","Jornada inválida.");
  if(typeof b.checkedAt!=="string"||!utcKickoff(b.checkedAt)||Date.parse(b.checkedAt)>now.getTime()+600000||Date.parse(b.checkedAt)<now.getTime()-30*86400000)add("checkedAt","Indicá una verificación reciente con zona horaria.");
  const seen=new Set<string>();
  if(!Array.isArray(b.results)||!b.results.length||b.results.length>36)add("results","Incluí entre 1 y 36 resultados definitivos de una jornada.");
  else b.results.forEach((value,i)=>{
    const path=`results[${i}]`;
    if(!value||typeof value!=="object"||Array.isArray(value)){add(path,"Resultado inválido.");return;}
    const r=value as Record<string,unknown>;
    if(typeof r.eventId!=="string"||!SPORTS_UUID.test(r.eventId))add(`${path}.eventId`,"Partido inválido.");
    else {if(seen.has(r.eventId))add(`${path}.eventId`,"Partido duplicado.");seen.add(r.eventId);}
    for(const key of ["homeGoals","awayGoals"])if(!Number.isInteger(r[key])||(r[key] as number)<0||(r[key] as number)>99)add(`${path}.${key}`,"Indicá goles enteros entre 0 y 99 a los 90 minutos.");
    try{const u=new URL(String(r.source));if(u.protocol!=="https:"||u.username||u.password||!["uefa.com","www.uefa.com","es.uefa.com"].includes(u.hostname)||String(r.source).length>1000)throw Error();}catch{add(`${path}.source`,"Indicá la fuente oficial UEFA del resultado.");}
    for(const key of ["extraTime","penalties","aggregate","partial"])if(key in r)add(`${path}.${key}`,"Este importador solo admite resultados definitivos a los 90 minutos.");
  });
  return {bundle:issues.length?null:b as ChampionsResultsBundle,issues};
}
