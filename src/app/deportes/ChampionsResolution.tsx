"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./agenda.module.css";

export default function ChampionsResolution({ eventId, title }: { eventId: string; title: string }) {
  const router = useRouter();
  const [action,setAction]=useState<"official_result"|"void_for_prode">("official_result");
  const [home,setHome]=useState(""),[away,setAway]=useState(""),[source,setSource]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  async function submit(){
    const prompt=action==="official_result"?`Registrar el resultado definitivo ${home}–${away} a los 90 minutos para ${title}?`:`Anular ${title} para el prode con el motivo indicado? Esto no declara una cancelación deportiva oficial.`;
    if(!window.confirm(prompt))return;
    setBusy(true);setError("");setMessage("");
    try{
      const body=action==="official_result"?{action,homeGoals:Number(home),awayGoals:Number(away),source,checkedAt:new Date().toISOString()}:{action,reason};
      const response=await fetch(`/api/sports/champions/events/${eventId}/resolution`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),result=await response.json();
      if(!response.ok)throw Error(result.error??"No se pudo resolver el partido.");
      setMessage(action==="official_result"?"Resultado oficial registrado.":"Partido anulado para el prode; conserva el estado deportivo suspendido.");router.refresh();
    }catch(e){setError(e instanceof Error?e.message:"No se pudo resolver el partido.");}finally{setBusy(false);}
  }
  return <details className={styles.admin}><summary>Resolver partido suspendido · {title}</summary>
    <p>Elegí el resultado oficial definitivo a los 90 minutos, o anulá el partido solo para la tabla del prode. La anulación no informa una cancelación deportiva.</p>
    <label>Resolución<select value={action} disabled={busy} onChange={e=>setAction(e.target.value as typeof action)}><option value="official_result">Resultado oficial</option><option value="void_for_prode">Anulación para el prode</option></select></label>
    {action==="official_result"?<><label>Goles local<input inputMode="numeric" value={home} disabled={busy} onChange={e=>setHome(e.target.value)}/></label><label>Goles visitante<input inputMode="numeric" value={away} disabled={busy} onChange={e=>setAway(e.target.value)}/></label><label>Fuente oficial UEFA<input type="url" value={source} disabled={busy} onChange={e=>setSource(e.target.value)}/></label><small>Resultado definitivo a 90 minutos más descuento. No admite marcador parcial, alargue ni penales.</small></>:<label>Motivo auditado<textarea maxLength={500} rows={3} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>}
    <button type="button" disabled={busy||(action==="official_result"&&(!home||!away||!source))||(action==="void_for_prode"&&reason.trim().length<5)} onClick={()=>void submit()}>{busy?"Guardando…":"Revisar y confirmar resolución"}</button>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  </details>;
}
