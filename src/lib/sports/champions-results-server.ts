import { createHash,createHmac,timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { championsEnabled } from "./config";
import { parseChampionsResults } from "./champions-results-rules";
import { activeSportsActor,privateHeaders,reject,sportsActor,sportsBody,sportsResponseError } from "./request";
import { SPORTS_UUID } from "./rules";
type Token={familyId:string;memberId:string;file:string;state:string;expires:number};
type Match={id:string;title:string;status:string;starts_at:Date|null;closed_at:Date|null;home_goals:number|null;away_goals:number|null;source:string|null;checked_at:Date|null;updated_at:Date;result_updated_at:Date|null;resolution_kind:string|null};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function mac(v:string){const secret=process.env.BETTER_AUTH_SECRET;if(!secret)reject(503,"Falta configurar las importaciones.");return createHmac('sha256',secret).update(`champions-results-v1:${v}`).digest('hex');}
function sign(v:Token){const text=Buffer.from(JSON.stringify(v)).toString('base64url');return `${text}.${mac(text)}`;}
function verify(raw:unknown):Token{
 if(typeof raw!=='string'||raw.length>4000)reject(409,"Volvé a revisar los resultados.");
 const [text,signature,extra]=raw.split('.'),expected=Buffer.from(mac(text)),actual=Buffer.from(signature??'');
 if(extra||expected.length!==actual.length||!timingSafeEqual(expected,actual))reject(409,"Vista previa inválida.");
 let t:Token;try{t=JSON.parse(Buffer.from(text,'base64url').toString());}catch{reject(409,"Vista previa inválida.");}
 if(!t||!Number.isSafeInteger(t.expires)||t.expires<=Date.now())reject(409,"La vista previa venció.");return t;
}
async function state(c:PoolClient,family:string,round:string,lock:boolean){
 const jornada=(await c.query("SELECT r.id,r.name,r.original_from,r.original_through FROM sports_football_rounds r JOIN sports_football_seasons s ON s.id=r.season_id AND s.family_id=r.family_id WHERE r.id=$1 AND r.family_id=$2 AND s.competition='champions'",[round,family])).rows[0];
 if(!jornada)reject(404,"No encontramos esta jornada.");
 // Lock events before reading result rows, in the same order as agenda and picks.
 const events=(await c.query<{id:string}>(`SELECT id FROM sports_events WHERE family_id=$1 AND round_id=$2 AND football_category='champions' ORDER BY id ${lock?'FOR UPDATE':''}`,[family,round])).rows;
 const matches=(await c.query<Match>(`SELECT e.id,e.title,e.status,e.starts_at,e.updated_at,c.closed_at,r.home_goals,r.away_goals,r.source,r.checked_at,r.updated_at AS result_updated_at,x.kind AS resolution_kind
 FROM sports_events e LEFT JOIN sports_football_closures c ON c.event_id=e.id AND c.family_id=e.family_id LEFT JOIN sports_football_results r ON r.event_id=e.id AND r.family_id=e.family_id LEFT JOIN sports_football_resolutions x ON x.event_id=e.id AND x.family_id=e.family_id
 WHERE e.id=ANY($1::uuid[]) AND NOT e.hidden AND e.source_absent_at IS NULL ORDER BY e.id`,[events.map(e=>e.id)])).rows;
 return {jornada,matches};
}
export async function importChampionsResults(request:Request){
 if(!championsEnabled())return Response.json({error:"No encontrado."},{status:404,headers:privateHeaders});
 const c=await getPool().connect();
 try{
  const actor=await sportsActor(request,true);
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await activeSportsActor(c,actor,true);
  const body=await sportsBody(request);
  if(body.mode!=='preview'&&body.mode!=='import')reject(400,"Elegí vista previa o confirmación.");
  const parsed=parseChampionsResults(body.bundle);
  if(!parsed.bundle){await c.query("ROLLBACK");return Response.json({valid:false,errors:parsed.issues},{status:400,headers:privateHeaders});}
  const bundle=parsed.bundle,token=body.mode==='import'?verify(body.token):null;
  if(token&&(token.familyId!==actor.familyId||token.memberId!==actor.memberId||token.file!==hash(body.bundle)))reject(409,"El archivo o el administrador cambió. Revisá la vista previa.");
  if(token)await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`champions-agenda:${actor.familyId}`]);
  const current=await state(c,actor.familyId,bundle.roundId,!!token),stateHash=mac(JSON.stringify(current));
  if(token&&token.state!==stateHash)reject(409,"Los datos cambiaron. Revisá nuevamente los resultados.");
  const now=(await c.query<{now:Date}>("SELECT clock_timestamp() AS now")).rows[0].now;
  const errors:Array<{path:string;message:string}>=[];
  for(const [i,r] of bundle.results.entries()){
   const e=current.matches.find(m=>m.id===r.eventId),path=`results[${i}]`;
   if(!e){errors.push({path,message:"El partido no existe en esta jornada o no está disponible."});continue;}
   if(!e.starts_at||e.starts_at>now||!['scheduled','completed'].includes(e.status))errors.push({path,message:"Se requiere un partido iniciado y definitivo; suspendidos, postergados y cancelados requieren resolución administrativa."});
  }
  if(errors.length){await c.query('ROLLBACK');return Response.json({valid:false,errors},{status:400,headers:privateHeaders});}
  const changeRows=bundle.results.map(r=>{const e=current.matches.find(m=>m.id===r.eventId)!;const exists=e.home_goals!==null;const same=exists&&e.home_goals===r.homeGoals&&e.away_goals===r.awayGoals&&e.source===r.source;return{eventId:r.eventId,title:e.title,kind:same?'unchanged':exists?'correction':'new',old:exists?{homeGoals:e.home_goals,awayGoals:e.away_goals,source:e.source}:null,new:{homeGoals:r.homeGoals,awayGoals:r.awayGoals,source:r.source}};});
  const preview={valid:true,summary:{round:current.jornada.name,matches:bundle.results.length,corrections:changeRows.filter(x=>x.kind==='correction').length},results:changeRows};
  if(!token){await c.query('COMMIT');return Response.json({...preview,token:sign({familyId:actor.familyId,memberId:actor.memberId,file:hash(body.bundle),state:stateHash,expires:Date.now()+15*60000})},{headers:privateHeaders});}
  if(changeRows.some(x=>x.kind==='correction')&&body.confirmCorrections!==true)reject(400,"La carga incluye correcciones. Confirmá explícitamente la vista previa para reemplazar los resultados existentes.");
  let changes=0;
  for(const r of bundle.results){
   const e=current.matches.find(e=>e.id===r.eventId)!;
   const exists=e.home_goals!==null,same=exists&&e.home_goals===r.homeGoals&&e.away_goals===r.awayGoals&&e.source===r.source;
   if(same)continue;
   await c.query("UPDATE sports_events SET status='completed',updated_at=clock_timestamp(),updated_by_member_id=$2 WHERE id=$1",[r.eventId,actor.memberId]);
   if(exists){
    const previous={homeGoals:e.home_goals,awayGoals:e.away_goals,source:e.source};
    await c.query("INSERT INTO sports_football_result_corrections(family_id,event_id,previous_home_goals,previous_away_goals,new_home_goals,new_away_goals,previous_source,new_source,checked_at,actor_member_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[actor.familyId,r.eventId,e.home_goals,e.away_goals,r.homeGoals,r.awayGoals,e.source,r.source,bundle.checkedAt,actor.memberId]);
    await c.query("UPDATE sports_football_results SET home_goals=$2,away_goals=$3,source=$4,checked_at=$5,updated_by_member_id=$6,updated_at=clock_timestamp() WHERE event_id=$1 AND family_id=$7",[r.eventId,r.homeGoals,r.awayGoals,r.source,bundle.checkedAt,actor.memberId,actor.familyId]);
    await c.query(`INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,"before","after") VALUES($1,$2,'sports_champions_result',$3,'corrected',$4::jsonb,$5::jsonb)`,[actor.familyId,actor.memberId,r.eventId,JSON.stringify(previous),JSON.stringify({homeGoals:r.homeGoals,awayGoals:r.awayGoals,period:'90_minutes',source:r.source,checkedAt:bundle.checkedAt})]);
   }else{
    await c.query("INSERT INTO sports_football_results(event_id,family_id,home_goals,away_goals,source,checked_at,updated_by_member_id) VALUES($1,$2,$3,$4,$5,$6,$7)",[r.eventId,actor.familyId,r.homeGoals,r.awayGoals,r.source,bundle.checkedAt,actor.memberId]);
    await c.query(`INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after") VALUES($1,$2,'sports_champions_result',$3,'recorded',$4::jsonb)`,[actor.familyId,actor.memberId,r.eventId,JSON.stringify({homeGoals:r.homeGoals,awayGoals:r.awayGoals,period:'90_minutes',source:r.source,checkedAt:bundle.checkedAt})]);
   }
   changes++;
  }
  await c.query('COMMIT');return Response.json({imported:true,changed:changes>0,roundId:bundle.roundId,summary:preview.summary},{headers:privateHeaders});
 }catch(error){await c.query('ROLLBACK');if(error&&typeof error==='object'&&'code'in error&&['23505','40001','40P01'].includes(String(error.code)))return Response.json({error:"Los datos cambiaron. Revisá la vista previa."},{status:409,headers:privateHeaders});const response=sportsResponseError(error);for(const[k,v]of Object.entries(privateHeaders))response.headers.set(k,v);return response;}finally{c.release();}
}
export async function championsResultsTemplate(request:Request){
 if(!championsEnabled())return Response.json({error:"No encontrado."},{status:404,headers:privateHeaders});
 const c=await getPool().connect();
 try{
  const actor=await sportsActor(request,true),round=new URL(request.url).searchParams.get('round');
  if(!round||!SPORTS_UUID.test(round))reject(400,"Elegí una jornada.");
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await activeSportsActor(c,actor,true);
  const data=await state(c,actor.familyId,round,false);await c.query('COMMIT');
  return Response.json({schemaVersion:1,sport:'champions',type:'results',period:'90_minutes',roundId:round,checkedAt:new Date().toISOString(),results:data.matches.filter(m=>m.status!=='cancelled'&&m.resolution_kind!=='void_for_prode').map(m=>({eventId:m.id,title:m.title,homeGoals:m.home_goals,awayGoals:m.away_goals,source:m.source??'https://www.uefa.com/uefachampionsleague/'}))},{headers:privateHeaders});
 }catch(error){await c.query('ROLLBACK');const response=sportsResponseError(error);for(const[k,v]of Object.entries(privateHeaders))response.headers.set(k,v);return response;}finally{c.release();}
}
