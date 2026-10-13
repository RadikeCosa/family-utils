"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MEAL_TYPES, MEAL_LABELS, normalizeMealIdea, type MealType, type IdeaFields } from "@/lib/meals/rules";
import type { Group, MealIdea, Suggestion } from "@/lib/meals/types";
import styles from "./menus.module.css";

export type BankState={date:string;mealType:MealType;group?:Group;source?:Suggestion;opener:HTMLElement};
type Draft=IdeaFields&{id?:string;version?:number};
const emptyDraft=():Draft=>({title:"",note:null,mealTypes:[],packedSuitable:false});
export default function IdeaBank({state,onClose,onChanged,onUse,currentMemberId,adult,today}:{state:BankState|null;onClose:()=>void;onChanged:()=>Promise<unknown>;onUse:(idea:MealIdea,date:string,type:MealType)=>Promise<void>;currentMemberId:string;adult:boolean;today:string}) {
 const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLElement|null>(null),titleInput=useRef<HTMLInputElement>(null);
 const sequence=useRef(0),working=useRef(false);
 const [ideas,setIdeas]=useState<MealIdea[]>([]),[archived,setArchived]=useState(false),[busy,setBusy]=useState(false);
 const [search,setSearch]=useState(""),[filter,setFilter]=useState<MealType|"">(""),[packedOnly,setPackedOnly]=useState(false),[limit,setLimit]=useState(20);
 const [targetType,setTargetType]=useState<MealType>("lunch");
 const [draft,setDraft]=useState<Draft|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const invalidate=useCallback(()=>{sequence.current++;},[]);
 const load=useCallback(async(showArchived:boolean)=>{
  const request=++sequence.current;setBusy(true);setError("");
  try {
   const response=await fetch(`/api/meals/ideas${showArchived?"?archived=1":""}`,{cache:"no-store"});
   const body=await response.json();if(!response.ok)throw new Error(body.error??"No se pudo cargar el banco.");
   if(request===sequence.current)setIdeas(body.ideas);
  }catch(error){if(request===sequence.current)setError((error as Error).message);}finally{if(request===sequence.current)setBusy(false);}
 },[]);
 useEffect(()=>{
  if(state) {
   opener.current=state.opener;dialog.current?.showModal();
   let cancelled=false;
   queueMicrotask(()=>{
    if(cancelled)return;
    setArchived(false);setSearch("");setFilter("");setPackedOnly(false);setLimit(20);setTargetType(state.mealType);setNotice("");
    setDraft(state.source?{title:state.source.title,note:state.source.note,mealTypes:[state.mealType],packedSuitable:false}:null);
    void load(false).then(()=>{if(!cancelled&&state.source)titleInput.current?.focus();});
   });
   return ()=>{cancelled=true;invalidate();};
  }
  if(dialog.current?.open){dialog.current.close();if(opener.current?.isConnected)opener.current.focus();}
 },[state,load,invalidate]);
 function close(){if(!busy&&!working.current)onClose();}
 async function request(url:string,method:string,body:unknown) {
  const response=await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok){if(response.status===409)await load(archived);throw new Error(data.error??"No se pudo guardar la idea.");}
  return data;
 }
 async function save(event:React.FormEvent) {
  event.preventDefault();if(!draft||working.current)return;working.current=true;setBusy(true);setError("");setNotice("");
  try {
   await request(draft.id?`/api/meals/ideas/${draft.id}`:"/api/meals/ideas",draft.id?"PATCH":"POST",{...draft,expectedVersion:draft.version});
   setDraft(null);await load(archived);await onChanged();setNotice("Idea guardada en el banco. Las comidas planificadas se conservan.");
  }catch(error){setError((error as Error).message);}finally{working.current=false;setBusy(false);}
 }
 async function archive(idea:MealIdea) {
  if(working.current)return;working.current=true;setBusy(true);setError("");setNotice("");
  try {
   await request(`/api/meals/ideas/${idea.id}`,"PATCH",{action:archived?"restore":"archive",expectedVersion:idea.version});
   await load(archived);await onChanged();setNotice(archived?"Idea restaurada.":"Idea archivada. Las comidas planificadas se conservan.");
  }catch(error){setError((error as Error).message);}finally{working.current=false;setBusy(false);}
 }
 async function proposeIdea(idea:MealIdea) {
  if(!state||working.current)return;working.current=true;setBusy(true);setError("");
  try {
   await onUse(idea,state.date,targetType);
  }catch(error){setError((error as Error).message);}finally{working.current=false;setBusy(false);}
 }
 function edit(idea?:MealIdea) {
  setDraft(idea?{id:idea.id,version:idea.version,title:idea.title,note:idea.note,mealTypes:[...idea.mealTypes],packedSuitable:idea.packedSuitable}:emptyDraft());
  setError("");setNotice("");requestAnimationFrame(()=>titleInput.current?.focus());
 }
 const visible=ideas.filter(idea=>(!filter||idea.mealTypes.includes(filter))&&(!packedOnly||idea.packedSuitable)&&normalizeMealIdea(idea.title).includes(normalizeMealIdea(search)));
 const dateLabel=state?new Intl.DateTimeFormat("es-AR",{timeZone:"UTC",day:"numeric",month:"long",year:"numeric"}).format(new Date(`${state.date}T12:00:00.000Z`)):"";
 return <dialog ref={dialog} className={`${styles.dialog} ${styles.bankDialog}`} aria-labelledby="bank-title" onCancel={event=>{event.preventDefault();close();}}>
  <button className={styles.dialogClose} aria-label="Cerrar banco de ideas" disabled={busy} onClick={close}>×</button>
  <h2 id="bank-title">Banco de ideas</h2>
  {draft?<form onSubmit={event=>void save(event)}>
   <fieldset className={styles.routineFields} disabled={busy}><legend className={styles.srOnly}>{draft.id?"Editar idea del banco":"Guardar idea en el banco"}</legend>
    <div className={styles.formFields}>
     <label>Nombre de la idea<input ref={titleInput} required maxLength={160} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})} /></label>
     <label>Nota opcional<textarea maxLength={1000} rows={3} value={draft.note??""} onChange={event=>setDraft({...draft,note:event.target.value})} /></label>
    </div>
    <fieldset className={styles.tagChoices}><legend>Para qué comidas</legend>{MEAL_TYPES.map(type=><label key={type}><input type="checkbox" checked={draft.mealTypes.includes(type)} onChange={event=>setDraft({...draft,mealTypes:event.target.checked?draft.mealTypes.concat(type):draft.mealTypes.filter(item=>item!==type)})} />{MEAL_LABELS[type]}</label>)}</fieldset>
    <label className={styles.checkLabel}><input type="checkbox" checked={draft.packedSuitable} onChange={event=>setDraft({...draft,packedSuitable:event.target.checked})} />Apta para lunchera</label>
   </fieldset>
   {error&&<p className={styles.error} role="alert">{error}</p>}
   <div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={()=>{setDraft(null);setError("");}}>Volver al banco</button><button className={styles.primaryButton} disabled={busy||!draft.title.trim()}>{busy?"Guardando…":"Guardar en banco"}</button></div>
  </form>:<>
   <p>Ideas para reutilizar. Cambiar una idea del banco no modifica lo que ya planificaron.</p>
   <div className={styles.bankToolbar}>
    <div className={styles.viewSwitcher}><button disabled={busy} aria-pressed={!archived} onClick={()=>{setArchived(false);setLimit(20);void load(false);}}>Activas</button><button disabled={busy} aria-pressed={archived} onClick={()=>{setArchived(true);setLimit(20);void load(true);}}>Archivadas</button></div>
    <button className={styles.secondaryButton} disabled={busy} onClick={()=>edit()}>Nueva idea</button>
   </div>
   <div className={styles.formFields}>
    <label>Buscar ideas<input type="search" value={search} onChange={event=>{setSearch(event.target.value);setLimit(20);}} /></label>
    <label>Filtrar por comida<select aria-label="Filtrar por comida" value={filter} onChange={event=>{setFilter(event.target.value as MealType|"");setLimit(20);}}><option value="">Todas las comidas</option>{MEAL_TYPES.map(type=><option key={type} value={type}>{MEAL_LABELS[type]}</option>)}</select></label>
   </div>
   <label className={styles.checkLabel}><input type="checkbox" checked={packedOnly} onChange={event=>{setPackedOnly(event.target.checked);setLimit(20);}} />Solo aptas para lunchera</label>
   {!archived&&state&&<div className={styles.bankDestination}><p>Proponer para el {dateLabel}</p><label>Comida de destino<select aria-label="Comida de destino" value={targetType} disabled={busy} onChange={event=>setTargetType(event.target.value as MealType)}>{MEAL_TYPES.map(type=><option key={type} value={type}>{MEAL_LABELS[type]}</option>)}</select></label>{state.date<today&&<p className={styles.warning}>Este día es de solo lectura. Elegí otra fecha en el planificador para proponer.</p>}</div>}
   {error&&<p className={styles.error} role="alert">{error}<button className={styles.expandButton} disabled={busy} onClick={()=>void load(archived)}>Reintentar</button></p>}
   {notice&&<p className={styles.notice} role="status">{notice}</p>}
   {busy&&<p className={styles.loading} role="status">Actualizando banco…</p>}
   {!busy&&!visible.length&&<p className={styles.empty}>{ideas.length?"No hay ideas que coincidan con estos filtros.":archived?"No hay ideas archivadas.":"El banco está vacío. Podés crear una idea para reutilizar."}</p>}
   <div className={styles.bankIdeas}>{visible.slice(0,limit).map(idea=><article className={styles.bankIdea} key={idea.id}>
    <h3>{idea.title}</h3>{idea.note&&<p>{idea.note}</p>}
    <div className={styles.bankTags}>{idea.mealTypes.map(type=><span key={type}>{MEAL_LABELS[type]}</span>)}{idea.packedSuitable&&<span>Apta para lunchera</span>}</div>
    <small>Guardada por {idea.authorName}</small>
    <div className={styles.suggestionActions}>
     {!archived&&<button disabled={busy||!state||state.date<today} onClick={()=>void proposeIdea(idea)}>{adult?"Elegir":"Proponer"}<span className={styles.srOnly}> {idea.title}</span></button>}
     {(adult||idea.authorMemberId===currentMemberId)&&<>{!archived&&<button disabled={busy} onClick={()=>edit(idea)}>Editar<span className={styles.srOnly}> {idea.title}</span></button>}<button disabled={busy} onClick={()=>void archive(idea)}>{archived?"Restaurar":"Archivar"}<span className={styles.srOnly}> {idea.title}</span></button></>}
    </div>
   </article>)}</div>
   {visible.length>limit&&<button className={styles.expandButton} disabled={busy} onClick={()=>setLimit(current=>current+20)}>Ver más ideas</button>}
  </>}
 </dialog>;
}
