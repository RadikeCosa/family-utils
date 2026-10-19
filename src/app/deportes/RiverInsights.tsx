"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RiverMatchInsights } from "@/lib/sports/types";
import type { RiverStatistics, RiverCuriosities } from "@/lib/sports/river-insights-rules";
import styles from "./agenda.module.css";
const date = (v: string | Date) => new Intl.DateTimeFormat("es-AR", {dateStyle:"medium",timeStyle:"short",timeZone:"America/Argentina/Buenos_Aires"}).format(new Date(v));
type Content = {statistics:RiverStatistics|null;curiosities:RiverCuriosities|null};
function InsightsContent({content,homeTeam="Local",awayTeam="Visitante"}:{content:Content;homeTeam?:string;awayTeam?:string}) {
  const number = new Intl.NumberFormat("es-AR",{maximumFractionDigits:4});
  const value = (v:number|null,unit?:string) => v === null ? "Sin dato" : `${number.format(v)}${unit ? ` ${unit}` : ""}`;
  return <>
    <h4>Estadísticas</h4>
    {content.statistics?.items.length ? <><table className={styles.riverStats}><caption>Comparación del partido</caption><thead><tr><th scope="col">Dato</th><th scope="col">{homeTeam} · Local</th><th scope="col">{awayTeam} · Visitante</th></tr></thead><tbody>{content.statistics.items.map(item=><tr key={item.label}><th scope="row">{item.label}</th><td>{value(item.homeValue,item.unit)}</td><td>{value(item.awayValue,item.unit)}</td></tr>)}</tbody></table><p><a href={content.statistics.source} target="_blank" rel="noopener noreferrer">Fuente de estadísticas</a> · Revisadas el {date(content.statistics.checkedAt)}</p></> : <p>Todavía no se publicaron estadísticas.</p>}
    <h4>Curiosidades</h4>
    {content.curiosities?.items.length ? <><ul>{content.curiosities.items.map((item,i)=><li className={styles.body} key={i}>{item}</li>)}</ul><p><a href={content.curiosities.source} target="_blank" rel="noopener noreferrer">Fuente de curiosidades</a> · Revisadas el {date(content.curiosities.checkedAt)}</p></> : <p>Todavía no se publicaron curiosidades.</p>}
  </>;
}
export function RiverInsights({insights,homeTeam,awayTeam}:{insights:RiverMatchInsights|null;homeTeam:string;awayTeam:string}) {
  return <section className={styles.panel} aria-label="Datos del partido"><h3>Datos del partido</h3><InsightsContent content={insights??{statistics:null,curiosities:null}} homeTeam={homeTeam} awayTeam={awayTeam}/></section>;
}
type Preview = { title:string; before:Content; after:Content; changed:boolean;token:string };
export function RiverInsightsImporter({ eventId }: { eventId: string }) {
  const router=useRouter(), [text,setText]=useState(""), [preview,setPreview]=useState<Preview|null>(null), [busy,setBusy]=useState(false), [error,setError]=useState(""), [message,setMessage]=useState("");
  async function template() {
    setError("");
    try {
      const response=await fetch(`/api/sports/river/insights/templates?event=${eventId}`,{cache:"no-store"}), data=await response.json();
      if(!response.ok) throw Error(data.error);
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})), a=document.createElement("a");a.href=url;a.download="river-datos-partido.json";a.click();URL.revokeObjectURL(url);
    }catch(e){setError(e instanceof Error?e.message:"No se pudo descargar la plantilla.");}
  }
  async function submit(mode:"preview"|"import") {
    setBusy(true);setError("");setMessage("");
    try {
      if(new TextEncoder().encode(text).length>900000)throw Error("El archivo supera 900 KB.");
      const bundle=JSON.parse(text);
      if(bundle.eventId!==eventId)throw Error("El archivo pertenece a otro partido. Abrí ese partido para publicarlo.");
      const response=await fetch("/api/sports/river/insights/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,bundle,...(mode==="import"?{token:preview?.token}:{})})}),data=await response.json();
      if(!response.ok)throw Error(data.error);
      if(mode==="preview")setPreview(data);else{setPreview(null);setMessage(data.changed?"Datos del partido publicados.":"Los datos ya estaban publicados.");router.refresh();}
    }catch(e){setPreview(null);setError(e instanceof SyntaxError?"El JSON no es válido.":e instanceof Error?e.message:"No se pudo publicar.");}finally{setBusy(false);}
  }
  return <section className={styles.importer} aria-label="Publicar datos del partido"><h3>Publicar datos del partido</h3><p>Completá la plantilla en el chat con estadísticas o curiosidades verificadas. Cada sección lleva fuente y fecha. Omitir una sección conserva lo publicado; una lista vacía la retira.</p><button type="button" disabled={busy} onClick={()=>void template()}>Descargar plantilla de datos del partido</button><label>Archivo de datos del partido<input type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const f=e.target.files?.[0];if(!f)return;setPreview(null);setError("");if(f.size>900000){setError("El archivo supera 900 KB.");return;}try{setText(await f.text());}catch{setError("No se pudo leer el archivo.");}}}/></label><label>Contenido JSON de datos del partido<textarea rows={6} disabled={busy} value={text} onChange={e=>{setText(e.target.value);setPreview(null);}}/></label><div className={styles.actions}><button disabled={busy||!text.trim()} onClick={()=>void submit("preview")}>{busy?"Procesando…":"Validar datos del partido"}</button>{preview&&<button disabled={busy} onClick={()=>void submit("import")}>Confirmar datos del partido</button>}</div>{preview&&<div role="status"><h4>{preview.title} · Vista previa, todavía no se guardó</h4><details><summary>Contenido anterior</summary><InsightsContent content={preview.before}/></details><strong>Contenido a publicar</strong><InsightsContent content={preview.after}/>{!preview.changed&&<p>Sin cambios.</p>}</div>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}</section>;
}
