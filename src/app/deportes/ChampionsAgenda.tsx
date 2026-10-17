"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import type { ChampionsPageData } from "@/lib/sports/champions-server";
import type { FootballChoice, FootballPredictionView } from "@/lib/sports/football-predictions-server";
import { sportsNowDay } from "@/lib/sports/rules";
import ChampionsImporter from "./ChampionsImporter";
import ChampionsResultsImporter from "./ChampionsResultsImporter";
import ChampionsResolution from "./ChampionsResolution";
import Comments, { type CommentEditDraft } from "./Comments";
import styles from "./agenda.module.css";
export type ChampionsThreadDraft = { body:string; edit:CommentEditDraft|null };
const dayLabel = (d: string | null) => d ? new Intl.DateTimeFormat("es-AR", { dateStyle:"full",timeZone:"America/Argentina/Buenos_Aires" }).format(new Date(`${d}T12:00:00Z`)) : "Fecha a confirmar";
const timeLabel = (s: string | null) => s ? new Intl.DateTimeFormat("es-AR", { hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"America/Argentina/Buenos_Aires" }).format(new Date(s)) : "Horario a confirmar";
const statuses: Record<string,string> = {scheduled:"Programado",postponed:"Postergado",suspended:"Suspendido",cancelled:"Cancelado",completed:"Finalizado"};
export default function ChampionsAgenda({ initial, admin, familyId, currentMemberId, members, drafts, onDraftChange, navigationFocusRef }: { initial: ChampionsPageData; admin: boolean; familyId:string; currentMemberId:string; members:Array<{id:string;name:string}>; drafts:Record<string,ChampionsThreadDraft>; onDraftChange:(key:string,patch:Partial<ChampionsThreadDraft>,expected?:Partial<ChampionsThreadDraft>)=>void; navigationFocusRef:RefObject<boolean> }) {
  const router = useRouter();
  const mutationVersion = useRef(0);
  const roundHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(navigationFocusRef.current){roundHeading.current?.focus();navigationFocusRef.current=false;}},[navigationFocusRef]);
  const [data,setData]=useState(initial),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState(""),[message,setMessage]=useState("");
  const round=data.rounds.find(r=>r.id===data.selectedRoundId);
  const draftKey=round?`${familyId}:${currentMemberId}:${round.id}`:"";
  useEffect(()=>{
    const controller=new AbortController();
    const refresh=async()=>{const version=mutationVersion.current;try{const r=await fetch(`/api/sports/champions${initial.selectedRoundId ? `?round=${initial.selectedRoundId}`:""}`,{cache:"no-store",signal:controller.signal});const body=await r.json();if(r.ok){if(version===mutationVersion.current)setData(body);}else setError(body.error??"No se pudo actualizar la jornada.");}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"No se pudo actualizar la jornada.");}};
    const timer=setInterval(()=>void refresh(),30000);
    return()=>{controller.abort();clearInterval(timer);};
  },[initial.selectedRoundId]);
  async function choose(id:string,choice:FootballChoice|null){
    mutationVersion.current++;
    setBusy(id);setError("");setMessage("");
    try{
      const r=await fetch(`/api/sports/champions/events/${id}/predictions`,{method:choice?"PUT":"DELETE",headers:{"Content-Type":"application/json"},...(choice?{body:JSON.stringify({choice})}:{})});
      const result=await r.json();if(!r.ok){router.refresh();throw new Error(result.error??"No se pudo guardar.");}
      setData(current=>({...current,matches:current.matches.map(m=>m.id===id?{...m,prediction:result as FootballPredictionView}:m)}));setMessage(choice?"Se guardó tu pronóstico.":"Se eliminó tu pronóstico.");
    }catch(e){setError(e instanceof Error?e.message:"No se pudo guardar.");}finally{mutationVersion.current++;setBusy(null);}
  }
  const computable=data.matches.filter(m=>m.status!=="cancelled"&&m.resolutionKind!=="void_for_prode"),chosen=computable.filter(m=>m.prediction.ownChoice!==null).length;
  const days=[...new Set(data.matches.map(m=>m.startsAt?sportsNowDay(new Date(m.startsAt)):m.eventDate))];
  return <>
    <nav className={styles.agenda} aria-label="Jornadas de Champions"><h2>Jornadas</h2><div className={styles.eventSelector}>{data.rounds.map(r=><button key={r.id} aria-pressed={r.id===data.selectedRoundId} onClick={()=>{navigationFocusRef.current=true;router.replace(`/deportes?sport=champions&round=${r.id}`,{scroll:false});}}><strong>{r.name}</strong><span>{r.season}</span><small>{dayLabel(r.originalFrom)}{r.originalThrough!==r.originalFrom?` a ${dayLabel(r.originalThrough)}`:""}</small><span>{r.partial?"Parcial":"Finalizada"}</span></button>)}</div></nav>
    {round ? <><article className={styles.hero}><p className={styles.eyebrow}>UEFA CHAMPIONS LEAGUE · {round.season}</p><h2 ref={roundHeading} tabIndex={-1}>{round.name}</h2><p>{round.partial?"Jornada parcial":"Jornada finalizada"}</p><p>Tus pronósticos: {chosen} de {computable.length}</p><p><a href="#champions-round-thread">Ir a la conversación de la jornada</a></p><small>Local, empate o visitante a los 90 minutos más descuento. Tus elecciones son privadas hasta el cierre de cada partido.</small></article>
    <section aria-label="Partidos de Champions">{days.map(day=><section key={day??"unknown"}><h3>{dayLabel(day)}</h3><div className={styles.championsMatches}>{data.matches.filter(m=>(m.startsAt?sportsNowDay(new Date(m.startsAt)):m.eventDate)===day).map(m=><article className={styles.panel} key={m.id} aria-label={m.title}>
      <p className={styles.eyebrow}>{timeLabel(m.startsAt)} · {m.resolutionKind==="void_for_prode"?"Anulado para el prode":statuses[m.status]??m.status}</p><h4>{m.home} <span>vs</span> {m.away}</h4><p>{m.venue??"Estadio a confirmar"}{m.neutralVenue?" · Sede neutral (local y visitante nominales)":""}</p>{m.channel&&<p>Dónde verlo: {m.channel}</p>}
      {m.resolutionKind==="void_for_prode"&&<p>Sin puntos ni resultado deportivo cargado. Motivo para el prode: {m.resolutionReason}</p>}
      {data.table?.results.filter(r=>r.eventId===m.id).map(r=><p key={r.eventId}><strong>Resultado a los 90 minutos: {r.homeGoals}–{r.awayGoals}</strong> · <a href={r.source} target="_blank" rel="noreferrer">Fuente del resultado</a></p>)}
      <fieldset className={styles.championsPicks} disabled={!!busy||!m.prediction.canPredict}><legend>Pronóstico de {m.title}</legend>{([['home',`Local: ${m.home}`],['draw','Empate'],['away',`Visitante: ${m.away}`]] as const).map(([value,label])=><button type="button" key={value} aria-pressed={m.prediction.ownChoice===value} onClick={()=>void choose(m.id,value)}>{label}</button>)}</fieldset>
      {m.prediction.ownChoice&&<p>Tu pronóstico: {m.prediction.ownChoice==='home'?m.home:m.prediction.ownChoice==='away'?m.away:'Empate'}</p>}
      {m.prediction.canPredict&&m.prediction.ownChoice&&<button disabled={!!busy} onClick={()=>void choose(m.id,null)}>Borrar mi pronóstico de {m.title}</button>}
      {!m.prediction.canPredict&&<p>{m.resolutionKind==="void_for_prode"?"Partido excluido de la tabla del prode.":m.prediction.closed?"Pronósticos cerrados":m.startsAt?"Este partido todavía no admite cambios.":"Sin horario confirmado no se puede pronosticar."}</p>}
      {m.prediction.closed&&m.prediction.choices.length>0&&<details><summary>Pronósticos del partido</summary><ul>{m.prediction.choices.map(c=><li key={c.memberId}>{c.name}: {c.choice==='home'?m.home:c.choice==='away'?m.away:'Empate'}</li>)}</ul></details>}
      {m.checkedAt&&<small>Datos verificados el {dayLabel(sportsNowDay(new Date(m.checkedAt)))}{m.sourceUrl&&<> · <a href={m.sourceUrl} target="_blank" rel="noreferrer">Fuente UEFA</a></>}</small>}
    </article>)}</div></section>)}</section></> : <section className={styles.panel}><h2>No hay jornadas cargadas</h2><p>La próxima agenda de Champions aparecerá acá.</p></section>}
    {round&&data.table&&<section className={styles.panel} aria-label="Tabla familiar de Champions"><h3>Tabla familiar · {data.table.partial?"Parcial":"Final"}</h3><p>{data.table.resolvedMatches} de {data.table.totalMatches} partidos computables resueltos. Un punto por acertar local, empate o visitante a los 90 minutos más descuento; alargue y penales no suman puntos.</p>{data.table.standings.length>0?<table className={styles.ranking}><caption>{round.name} · los empates comparten puesto</caption><thead><tr><th scope="col">Puesto</th><th scope="col">Integrante</th><th scope="col">Puntos</th></tr></thead><tbody>{data.table.standings.map(row=><tr key={row.memberId}><td>{row.position}</td><th scope="row">{row.name}</th><td>{row.points}</td></tr>)}</tbody></table>:<p>La tabla aparece con el primer resultado computable.</p>}</section>}
    {round&&<div id="champions-round-thread" className={styles.championsThread} tabIndex={-1}><Comments key={round.id} contextKind="champions_round" apiPath={`/api/sports/champions/rounds/${round.id}/comments`} members={members} currentMemberId={currentMemberId} isAdmin={admin} draft={drafts[draftKey]?.body??""} onDraftChange={(body,expected)=>onDraftChange(draftKey,{body},expected===undefined?undefined:{body:expected})} editDraft={drafts[draftKey]?.edit??null} onEditDraftChange={(edit,expected)=>onDraftChange(draftKey,{edit},expected===undefined?undefined:{edit:expected})}/></div>}
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {admin&&<>{data.matches.filter(m=>m.status==="suspended"&&!m.resolutionKind).map(m=><ChampionsResolution key={m.id} eventId={m.id} title={m.title}/>)}<ChampionsImporter roundId={data.selectedRoundId}/>{data.selectedRoundId&&<ChampionsResultsImporter roundId={data.selectedRoundId}/>}</>}
  </>;
}
