"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RiverOfficialLineup } from "@/lib/sports/types";
import styles from "./agenda.module.css";
const date = (v: string | Date) => new Intl.DateTimeFormat("es-AR", {dateStyle:"medium",timeStyle:"short",timeZone:"America/Argentina/Buenos_Aires"}).format(new Date(v));
export function RiverLineup({ lineup }: { lineup: RiverOfficialLineup | null }) {
  return <section className={styles.panel} aria-label="Formación oficial"><h3>Formación oficial</h3>{lineup ? <><p className={styles.body}>{lineup.body}</p><p><a href={lineup.source} target="_blank" rel="noopener noreferrer">Ver fuente de la formación</a></p><small>Revisada el {date(lineup.checkedAt)} · Publicada por {lineup.authorName} · {date(lineup.updatedAt)}</small></> : <p>Todavía no se publicó.</p>}</section>;
}
type Preview = { title: string; before: {body:string;source:string;checkedAt:string} | null; after: {body:string;source:string;checkedAt:string}; changed: boolean; token: string };
export function RiverLineupImporter({ eventId }: { eventId: string }) {
  const router=useRouter(), [text,setText]=useState(""), [preview,setPreview]=useState<Preview|null>(null), [busy,setBusy]=useState(false), [error,setError]=useState(""), [message,setMessage]=useState("");
  async function template() {
    setError("");
    try {
      const response=await fetch(`/api/sports/river/lineup/templates?event=${eventId}`,{cache:"no-store"}), data=await response.json();
      if(!response.ok) throw Error(data.error);
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})), a=document.createElement("a");a.href=url;a.download="river-formacion-oficial.json";a.click();URL.revokeObjectURL(url);
    }catch(e){setError(e instanceof Error?e.message:"No se pudo descargar la plantilla.");}
  }
  async function submit(mode:"preview"|"import") {
    setBusy(true);setError("");setMessage("");
    try {
      if(new TextEncoder().encode(text).length>900000)throw Error("El archivo supera 900 KB.");
      const bundle=JSON.parse(text);
      if(bundle.eventId!==eventId)throw Error("El archivo pertenece a otro partido. Abrí ese partido para publicarlo.");
      const response=await fetch("/api/sports/river/lineup/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,bundle,...(mode==="import"?{token:preview?.token}:{})})}),data=await response.json();
      if(!response.ok)throw Error(data.error);
      if(mode==="preview")setPreview(data);else{setPreview(null);setMessage(data.changed?"Formación oficial publicada.":"La formación ya estaba publicada.");router.refresh();}
    }catch(e){setPreview(null);setError(e instanceof SyntaxError?"El JSON no es válido.":e instanceof Error?e.message:"No se pudo publicar.");}finally{setBusy(false);}
  }
  return <section className={styles.importer} aria-label="Publicar formación oficial"><h3>Publicar formación oficial</h3><p>Descargá la plantilla de este partido y completala en el chat con la formación confirmada y su fuente HTTPS. Hasta 4.000 caracteres.</p><button type="button" disabled={busy} onClick={()=>void template()}>Descargar plantilla de formación oficial</button><label>Archivo de formación oficial<input type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const f=e.target.files?.[0];if(!f)return;setPreview(null);setError("");if(f.size>900000){setError("El archivo supera 900 KB.");return;}try{setText(await f.text());}catch{setError("No se pudo leer el archivo.");}}}/></label><label>Contenido JSON de formación oficial<textarea rows={6} disabled={busy} value={text} onChange={e=>{setText(e.target.value);setPreview(null);}}/></label><div className={styles.actions}><button disabled={busy||!text.trim()} onClick={()=>void submit("preview")}>{busy?"Procesando…":"Validar formación oficial"}</button>{preview&&<button disabled={busy} onClick={()=>void submit("import")}>Confirmar formación oficial</button>}</div>{preview&&<div role="status"><h4>{preview.title} · Vista previa, todavía no se guardó</h4>{preview.before&&<><strong>Anterior</strong><p className={styles.body}>{preview.before.body}</p><p>{preview.before.source} · {date(preview.before.checkedAt)}</p></>}<strong>{preview.before?"Nueva versión":"Formación a publicar"}</strong><p className={styles.body}>{preview.after.body}</p><p>{preview.after.source} · {date(preview.after.checkedAt)}</p>{!preview.changed&&<p>Sin cambios.</p>}</div>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}</section>;
}
