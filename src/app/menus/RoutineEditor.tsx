"use client";
import { useRef, useState } from "react";
import { PARTICIPATION_LABELS, PARTICIPATION_STATUSES, routineFor, type MealType, type WeeklyParticipation, type ParticipationStatus } from "@/lib/meals/rules";
import styles from "./menus.module.css";

type Profile={id:string;name:string};
type Routine={id:string;memberId:string;mealType:MealType;startsOn:string;name:string;weekdays:WeeklyParticipation};
const DAYS=["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const emptyWeek=():WeeklyParticipation=>["unknown","unknown","unknown","unknown","unknown","unknown","unknown"];
export default function RoutineEditor({members,today,onSaved}:{members:Profile[];today:string;onSaved:()=>Promise<unknown>}) {
 const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null);
 const [routines,setRoutines]=useState<Routine[]>([]);
 const [memberId,setMemberId]=useState(members[0]?.id??"");
 const [mealType,setMealType]=useState<MealType>("lunch");
 const [startsOn,setStartsOn]=useState(today);
 const [name,setName]=useState("Rutina habitual");
 const [weekdays,setWeekdays]=useState<WeeklyParticipation>(emptyWeek);
 const [loaded,setLoaded]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 function loadFields(person:string,type:MealType,date:string,list:Routine[]) {
  const current=routineFor(list,person,type,date) as Routine|undefined;
  setWeekdays(current?[...current.weekdays]:emptyWeek());setName(current?.name??"Rutina habitual");
 }
 async function open() {
  dialog.current?.showModal();setLoaded(false);setBusy(true);setError("");setNotice("");
  try {
   const response=await fetch("/api/meals/routines",{cache:"no-store"});
   const body=await response.json();if(!response.ok)throw new Error(body.error??"No se pudieron cargar las rutinas.");
   setRoutines(body.routines);setLoaded(true);setStartsOn(today);loadFields(memberId,mealType,today,body.routines);
  }catch(error){setError((error as Error).message);}finally{setBusy(false);}
 }
 function close(){if(busy)return;dialog.current?.close();opener.current?.focus();}
 async function save(event:React.FormEvent) {
  event.preventDefault();setBusy(true);setError("");setNotice("");
  try {
   const response=await fetch("/api/meals/routines",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({memberId,mealType,startsOn,name,weekdays})});
   const body=await response.json();if(!response.ok)throw new Error(body.error??"No se pudo guardar la rutina.");
   setRoutines(current=>current.filter(r=>r.id!==body.routine.id).concat(body.routine));
   await onSaved();setNotice("Rutina guardada. Las distribuciones ya guardadas se conservan.");
  }catch(error){setError((error as Error).message);}finally{setBusy(false);}
 }
 return <>
  <button ref={opener} className={styles.expandButton} onClick={()=>void open()}>Rutinas</button>
  <dialog ref={dialog} className={styles.dialog} aria-labelledby="routine-title" onCancel={event=>{event.preventDefault();close();}}>
   <button className={styles.dialogClose} aria-label="Cerrar rutinas" disabled={busy} onClick={close}>×</button>
   <h2 id="routine-title">Rutinas de comidas</h2>
   <p>Definí quién come en casa o lleva comida cada día. Para vacaciones, guardá una rutina desde la fecha de inicio y otra al volver. Los platos se eligen por separado.</p>
   <form onSubmit={event=>void save(event)}>
    <fieldset className={styles.routineFields} disabled={busy}>
     <legend className={styles.srOnly}>Configurar rutina semanal</legend>
     <div className={styles.formFields}>
      <label>Integrante<select aria-label="Integrante" value={memberId} onChange={event=>{setMemberId(event.target.value);loadFields(event.target.value,mealType,startsOn,routines);}}>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label>Comida de la rutina<select aria-label="Comida de la rutina" value={mealType} onChange={event=>{const type=event.target.value as MealType;setMealType(type);loadFields(memberId,type,startsOn,routines);}}><option value="lunch">Almuerzo</option><option value="dinner">Cena</option></select></label>
      <label>A partir de<input type="date" required min={today} value={startsOn} onChange={event=>setStartsOn(event.target.value)} /></label>
      <label>Nombre de la rutina<input required maxLength={80} value={name} onChange={event=>setName(event.target.value)} /></label>
      {DAYS.map((day,index)=><label key={day}>{day}<select aria-label={day} value={weekdays[index]} onChange={event=>setWeekdays(current=>current.map((status,i)=>i===index?event.target.value as ParticipationStatus:status) as WeeklyParticipation)}>{PARTICIPATION_STATUSES.map(status=><option key={status} value={status}>{PARTICIPATION_LABELS[status]}</option>)}</select></label>)}
     </div>
    </fieldset>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {notice&&<p className={styles.notice} role="status">{notice}</p>}
    <div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={close}>Cerrar</button><button className={styles.primaryButton} disabled={busy||!loaded||!memberId}>{busy?"Guardando…":"Guardar rutina"}</button></div>
   </form>
   {routines.some(r=>r.memberId===memberId&&r.mealType===mealType)&&<section className={styles.routineHistory} aria-label="Rutinas anteriores y programadas"><h3>Copiar una rutina</h3><p className={styles.muted}>Copiá una semana y elegí arriba desde qué fecha usarla.</p>{routines.filter(r=>r.memberId===memberId&&r.mealType===mealType).sort((a,b)=>b.startsOn.localeCompare(a.startsOn)).map(r=><button className={styles.expandButton} disabled={busy} key={r.id} onClick={()=>{setName(r.name);setWeekdays([...r.weekdays]);setNotice("");}}>{r.name} · desde {r.startsOn.split("-").reverse().join("/")}</button>)}</section>}
  </dialog>
 </>;
}
