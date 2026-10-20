"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { effortLabel, formatDuration } from "@/lib/training/rules";
import type { TrainingPage, TrainingRoutine, TrainingSession } from "@/lib/training/types";
import TrainingEditor, { BlockSummary, trainingRequest, type EditorTarget } from "./TrainingEditor";
import styles from "./training.module.css";

type Tab = "routines" | "sessions";
export default function TrainingApp({ today: initialToday, memberName }: { today: string; memberName: string }) {
  const [tab, setTab] = useState<Tab>("routines"); const [archived, setArchived] = useState(false);
  const [items, setItems] = useState<(TrainingRoutine | TrainingSession)[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [today, setToday] = useState(initialToday); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [editor, setEditor] = useState<EditorTarget | null>(null); const [detail, setDetail] = useState<TrainingRoutine | TrainingSession | null>(null);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const generation = useRef(0); const heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(async (after?: string) => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams(tab === "routines" ? { archived: String(archived) } : {});
      if (after) query.set("cursor", after);
      const data: TrainingPage<TrainingRoutine | TrainingSession> = await trainingRequest(`${tab}?${query}`);
      if (current !== generation.current) return;
      setItems((previous) => after ? [...previous, ...data.items] : data.items); setCursor(data.nextCursor); setToday(data.today);
    } catch (error) { if (current === generation.current) setError((error as Error).message); }
    finally { if (current === generation.current) setLoading(false); }
  }, [tab, archived]);
  useEffect(() => {
    let mounted = true; const tracker = generation;
    queueMicrotask(() => { if (mounted) void load(); });
    return () => { mounted = false; tracker.current++; };
  }, [load]);
  async function open(item: TrainingRoutine | TrainingSession) {
    setBusy(true); setError("");
    try { const data = await trainingRequest(`${tab}/${item.id}`); setToday(data.today); setDetail(data.item); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function changeArchive(routine: TrainingRoutine) {
    setBusy(true); setError("");
    try {
      await trainingRequest(`routines/${routine.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: routine.version, action: routine.archivedAt ? "restore" : "archive" }) });
      setDetail(null); setNotice(routine.archivedAt ? "Rutina restaurada." : "Rutina archivada. Tus entrenamientos se conservan."); await load();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  function closeEditor() { setEditor(null); requestAnimationFrame(() => heading.current?.focus()); }
  function saved() {
    const savedTab = editor?.kind ?? tab;
    closeEditor(); setDetail(null); setNotice("Guardado. Tus datos ya están disponibles en tus dispositivos.");
    if (savedTab !== tab) { setItems([]); setCursor(null); setTab(savedTab); } else void load();
  }
  const routine = detail && "archivedAt" in detail ? detail : null;
  const session = detail && "performedOn" in detail ? detail : null;
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.back}>← Aplicaciones</Link><span className={styles.private}>Espacio personal</span></header>
    <div className={styles.hero}><p className={styles.eyebrow}>A TU RITMO</p><h1 ref={heading} tabIndex={-1}>Entrenamiento</h1><p>{memberName}, este es tu espacio para organizar tus rutinas y recordar cómo te fue.</p></div>
    {editor ? <TrainingEditor key={`${editor.kind}-${"session" in editor ? editor.session?.id : editor.routine?.id}-${"duplicate" in editor && editor.duplicate ? "copy" : "edit"}`} target={editor} today={today} onClose={closeEditor} onSaved={saved} /> : <>
      <nav className={styles.tabs} aria-label="Entrenamiento"><button disabled={busy} aria-current={tab === "routines" ? "page" : undefined} onClick={() => { setTab("routines"); setItems([]); setCursor(null); setDetail(null); setNotice(""); }}>Mis rutinas</button><button disabled={busy} aria-current={tab === "sessions" ? "page" : undefined} onClick={() => { setTab("sessions"); setItems([]); setCursor(null); setDetail(null); setNotice(""); }}>Historial</button></nav>
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {error && <div role="alert" className={styles.error}>{error}<button type="button" onClick={() => { setDetail(null); void load(); }}>Actualizar listado</button></div>}
      {detail ? <section className={styles.card} aria-labelledby="detail-title"><button type="button" onClick={() => setDetail(null)}>← Volver al listado</button><h2 id="detail-title">{detail.name}</h2>
        {routine?.archivedAt && <p className={styles.muted}>Rutina archivada. Restaurala para registrar un entrenamiento.</p>}
        {session && <><p>{displayDate(session.performedOn)} · {formatDuration(session.durationSeconds)} · Esfuerzo {session.effort}/10 ({effortLabel(session.effort)})</p>{session.note && <p className={styles.note}>{session.note}</p>}</>}
        <BlockSummary blocks={detail.blocks} />
        <div className={styles.actions}>
          {routine && <><button className={styles.primary} disabled={busy || !!routine.archivedAt} onClick={() => setEditor({ kind: "sessions", routine })}>Registrar entrenamiento</button><button onClick={() => setEditor({ kind: "routines", routine })}>Editar rutina</button><button onClick={() => setEditor({ kind: "routines", routine, duplicate: true })}>Duplicar rutina</button><button disabled={busy} onClick={() => void changeArchive(routine)}>{routine.archivedAt ? "Restaurar rutina" : "Archivar rutina"}</button></>}
          {session && <button className={styles.primary} onClick={() => setEditor({ kind: "sessions", session })}>Corregir entrenamiento</button>}
        </div>
      </section> : <section aria-labelledby="collection-title">
        <div className={styles.toolbar}><h2 id="collection-title">{tab === "routines" ? "Mis rutinas" : "Historial"}</h2>{tab === "routines" && <button className={styles.primary} onClick={() => setEditor({ kind: "routines" })}>Nueva rutina</button>}</div>
        {tab === "routines" && <label className={styles.filter}>Mostrar<select value={String(archived)} onChange={(event) => { setArchived(event.target.value === "true"); setItems([]); setCursor(null); setNotice(""); }}><option value="false">Rutinas activas</option><option value="true">Rutinas archivadas</option></select></label>}
        {loading && <p role="status">Cargando…</p>}
        {!loading && !error && !items.length && <div className={styles.empty}><h3>{tab === "sessions" ? "Tu próximo entrenamiento empieza acá" : archived ? "No tenés rutinas archivadas" : "Armá tu primera rutina"}</h3><p>{tab === "sessions" ? "Elegí una rutina en Mis rutinas y registrá lo que hiciste, cuánto duró y cómo te sentiste." : "Combiná ejercicios por repeticiones y tiempo, organizados en bloques con sus vueltas."}</p></div>}
        <div className={styles.grid}>{items.map((item) => <article className={styles.card} key={item.id}><h3>{item.name}</h3>{"performedOn" in item ? <><p>{displayDate(item.performedOn)}</p><p>{formatDuration(item.durationSeconds)} · Esfuerzo {item.effort}/10</p><p className={styles.muted}>{effortLabel(item.effort)}</p></> : <p className={styles.muted}>{item.blocks.length} {item.blocks.length === 1 ? "bloque" : "bloques"} · {item.blocks.reduce((sum, block) => sum + block.exercises.length, 0)} ejercicios</p>}<button disabled={busy || loading} aria-label={`Ver ${item.name}`} onClick={() => void open(item)}>Ver detalle →</button></article>)}</div>
        {cursor && <button type="button" disabled={loading} onClick={() => void load(cursor)}>Ver más</button>}
      </section>}
    </>}
  </main>;
}
function displayDate(date: string) { return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", dateStyle: "long" }).format(new Date(`${date}T12:00:00Z`)); }
