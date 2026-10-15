"use client";
import { useEffect, useState } from "react";
import type { SportsComment } from "@/lib/sports/types";
import { formatSportsDate } from "@/lib/sports/rules";
import styles from "./sports.module.css";

type ContextKind = "football_day" | "river_match" | "ufc_card";
export default function Comments({ contextKind, contextDate, eventId, members, currentMemberId, isAdmin, previousDates = [], draft, onDraftChange }: {
  contextKind: ContextKind; contextDate?: string; eventId?: string; members:{id:string;name:string}[]; currentMemberId:string; isAdmin:boolean; previousDates?:string[]; draft?:string; onDraftChange?:(value:string)=>void;
}) {
  const params = new URLSearchParams({ contextKind, ...(contextDate ? { contextDate } : {}), ...(eventId ? { eventId } : {}) }).toString();
  const [comments, setComments] = useState<SportsComment[]>([]);
  const [prior, setPrior] = useState<Record<string,SportsComment[]>>({});
  const [localBody, setLocalBody] = useState("");
  const body = draft ?? localBody;
  const setBody = (value:string) => { setLocalBody(value); onDraftChange?.(value); };
  const [loading,setLoading] = useState(true);
  const [edit, setEdit] = useState<{id:string;version:number}|null>(null);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    const response = await fetch(`/api/sports/comments?${params}`, { cache:"no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "No se pudieron cargar los comentarios.");
    setComments(data.comments);
  }
  useEffect(() => { let mounted = true; fetch(`/api/sports/comments?${params}`, { cache:"no-store" }).then(async (response) => { const data=await response.json(); if (!response.ok) throw new Error(data.error); if (mounted) setComments(data.comments); }).catch((reason:unknown) => { if (mounted) setError(reason instanceof Error ? reason.message : "No se pudieron cargar los comentarios."); }).finally(() => { if(mounted)setLoading(false); }); return () => { mounted=false; }; },[params]);
  async function send(path:string,method:string,payload:Record<string,unknown>) {
    setBusy(true); setError("");
    try { const response=await fetch(path,{ method,headers:{"Content-Type":"application/json"},body:JSON.stringify(payload) }); const data=await response.json(); if (!response.ok) throw new Error(data.error ?? "No se pudo guardar."); await load(); setBody(""); setEdit(null); setEditBody(""); }
    catch(reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  async function loadPrior(day:string) {
    try { const previousParams=new URLSearchParams({contextKind:"river_match",contextDate:day,eventId:eventId!}); const response=await fetch(`/api/sports/comments?${previousParams}`,{cache:"no-store"}); const data=await response.json(); if (!response.ok) throw new Error(data.error); setPrior((value)=>({...value,[day]:data.comments})); }
    catch(reason) { setError(reason instanceof Error ? reason.message : "No se pudo abrir la conversación anterior."); }
  }
  return <section id={contextKind === "river_match" && contextDate && eventId ? `river-thread-${eventId}-${contextDate}` : undefined} className={styles.comments} aria-label="Conversación familiar">
    {contextKind === "football_day" && <h3>Resultados del día</h3>}
    {contextKind === "river_match" && <h3>Conversación del partido</h3>}
    {contextKind === "ufc_card" && <h3>Conversación del evento</h3>}
    {previousDates.map((day)=><div key={day} className={styles.previousThread}>
      <a href={`#river-thread-${eventId}-${day}`} onClick={()=>void loadPrior(day)}>Ver conversación del {formatSportsDate(day)} ↗</a>
      <div id={`river-thread-${eventId}-${day}`} hidden={!prior[day]}>{prior[day]?.map((comment)=><CommentItem key={comment.id} comment={comment} memberName={members.find((member)=>member.id===comment.authorMemberId)?.name ?? "Integrante"} mine={comment.authorMemberId===currentMemberId} isAdmin={isAdmin} edit={edit} editBody={editBody} setEdit={setEdit} setEditBody={setEditBody} onSave={async(path,method,payload)=>{await send(path,method,payload);await loadPrior(day);}} busy={busy}/>)}</div>
    </div>)}
    {loading && <p role="status">Cargando comentarios…</p>}
    {!loading && !error && comments.length===0 && <p className={styles.muted}>Todavía no hay comentarios. Empezá la conversación.</p>}
    <ul className={styles.commentList}>{comments.map((comment)=><CommentItem key={comment.id} comment={comment} memberName={members.find((member)=>member.id===comment.authorMemberId)?.name ?? "Integrante"} mine={comment.authorMemberId===currentMemberId} isAdmin={isAdmin} edit={edit} editBody={editBody} setEdit={setEdit} setEditBody={setEditBody} onSave={send} busy={busy}/>)}</ul>
    <form onSubmit={(event)=>{event.preventDefault();void send("/api/sports/comments","POST",{contextKind,contextDate:contextDate??null,contextEventId:eventId??null,body});}}>
      <label>Escribí un comentario<textarea rows={3} disabled={busy} maxLength={2000} value={body} onChange={(event)=>setBody(event.target.value)} required /></label>
      <div className={styles.formFooter}><small>{Array.from(body).length}/2000</small><button className={styles.primary} disabled={busy||!body.trim()}>{busy?"Enviando…":"Comentar"}</button></div>
    </form>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
  </section>;
}

function CommentItem({comment,memberName,mine,isAdmin,edit,editBody,setEdit,setEditBody,onSave,busy}:{comment:SportsComment;memberName:string;mine:boolean;isAdmin:boolean;edit:{id:string;version:number}|null;editBody:string;setEdit:(value:{id:string;version:number}|null)=>void;setEditBody:(value:string)=>void;onSave:(path:string,method:string,payload:Record<string,unknown>)=>Promise<void>;busy:boolean}) {
  const editing=edit?.id===comment.id;
  return <li className={styles.comment}>
    <div className={styles.commentMeta}><strong>{memberName}</strong><time dateTime={new Date(comment.createdAt).toISOString()}>{new Intl.DateTimeFormat("es-AR",{dateStyle:"medium",timeStyle:"short",timeZone:"America/Argentina/Buenos_Aires"}).format(new Date(comment.createdAt))}</time></div>
    {editing?<form onSubmit={(event)=>{event.preventDefault();void onSave(`/api/sports/comments/${comment.id}`,"PATCH",{action:"edit",body:editBody,expectedVersion:edit.version});}}><label>Editar comentario<textarea rows={3} maxLength={2000} value={editBody} onChange={(event)=>setEditBody(event.target.value)} required/></label><div className={styles.formFooter}><button type="button" disabled={busy} onClick={()=>setEdit(null)}>Cancelar</button><button className={styles.primary} disabled={busy||!editBody.trim()}>Guardar</button></div></form>:<p className={styles.commentBody}>{comment.body}</p>}
    <div className={styles.commentActions}>{mine&&!editing&&<button type="button" disabled={busy} onClick={()=>{setEdit({id:comment.id,version:comment.version});setEditBody(comment.body);}}>Editar</button>}{(mine||isAdmin)&&<button type="button" className={styles.dangerText} disabled={busy} onClick={()=>{if(window.confirm("¿Retirar este comentario?"))void onSave(`/api/sports/comments/${comment.id}`,"PATCH",{action:"retire",expectedVersion:comment.version});}}>Retirar</button>}</div>
  </li>;
}
