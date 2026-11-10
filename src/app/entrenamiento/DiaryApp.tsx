"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import DateNavigation from "@/components/calendar/DateNavigation";
import { updateNavigation, updateNavigationHash, useDetailTitle, useNavigationHash, useNavigationQuery } from "@/components/platform/navigation";
import { civilLabel, civilWeekStart } from "@/lib/calendar/civil";
import { countsLabel, dayIndicator, diaryDate, DIARY_MAX, DIARY_MIN, entryTitle, statusLabel, weekDates, emptyCounts, type DayCounts, type DiaryContext, type DiaryEntry } from "@/lib/training/diary";
import { diaryRequest, type EntryPage, type EntryResponse } from "@/lib/training/diary-client";
import { clearTrainingHandoffs, readTrainingHandoff, type TrainingHandoff } from "@/lib/training/drafts";
import { formatDuration } from "@/lib/training/rules";
import DiaryEditor, { type DiaryEditorTarget } from "./DiaryEditor";
import TrainingApp from "./TrainingApp";
import { BlockSummary } from "./TrainingEditor";
import styles from "./training.module.css";
type Summary = DiaryContext & { days: { date: string; counts: DayCounts }[] };
export default function DiaryApp({ initialContext, memberName, scope }: { initialContext: DiaryContext; memberName: string; scope: string }) {
  const params = useNavigationQuery(), hash = useNavigationHash();
  const requested = params.get("fecha"), detailId = params.get("detalle"), templates = params.get("seccion") === "plantillas", archived = params.get("archived") === "true";
  const [ctx, setContext] = useState(initialContext), [dateNotice, setDateNotice] = useState("");
  let date = ctx.today, invalid = false;
  if (requested) { try { date = diaryDate(requested); } catch { invalid = true; } }
  let query = "";
  try { query = new URLSearchParams(hash.replace(/^#/, "")).get("q")?.slice(0, 200) ?? ""; } catch { /* Invalid fragments behave like an empty search. */ }
  const [searchInput, setSearchInput] = useState(query), [search, setSearch] = useState(query);
  const [page, setPage] = useState<EntryPage | null>(null), [summary, setSummary] = useState<Summary | null>(null), [detail, setDetail] = useState<DiaryEntry | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [refreshToken, setRefreshToken] = useState(0);
  const [editor, setEditor] = useState<DiaryEditorTarget | null>(null), [handoff, setHandoff] = useState<TrainingHandoff | null>(null);
  const [pending, setPending] = useState<{ id: string; body: string } | null>(null);
  const opener = useRef<HTMLElement | null>(null), heading = useRef<HTMLHeadingElement>(null), detailHeading = useRef<HTMLHeadingElement>(null), generation = useRef(0);
  const week = civilWeekStart(date), searching = search.length >= 3;
  useDetailTitle(detail ? entryTitle(detail) : null);
  useEffect(() => { detailHeading.current?.focus(); }, [detail?.id, detail?.version]);
  useEffect(() => { if (invalid) { updateNavigation({ fecha: null }, "replace"); queueMicrotask(() => setDateNotice("La fecha no es válida. Mostramos hoy.")); } }, [invalid]);
  useEffect(() => { queueMicrotask(() => { setSearchInput(query); setSearch(query); }); }, [query]);
  useEffect(() => { const timer = setTimeout(() => { updateNavigationHash(searchInput); setSearch(searchInput); }, 300); return () => clearTimeout(timer); }, [searchInput]);
  useEffect(() => { queueMicrotask(() => setHandoff(readTrainingHandoff(scope))); }, [scope]);
  useEffect(() => {
    if (!handoff) return;
    const timer = setTimeout(() => { clearTrainingHandoffs(); setHandoff(null); }, Math.max(0, handoff.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [handoff]);
  const loadedScope = useRef("");
  const load = useCallback(async (after?: string) => {
    const sequence = ++generation.current; setLoading(true); setError("");
    const loadScope = JSON.stringify([date, search, archived]);
    if (loadedScope.current !== loadScope) { loadedScope.current = loadScope; setPage(null); }
    try {
      const listPromise = searching ? diaryRequest<EntryPage>("search", { method: "POST", body: JSON.stringify({ query: search, archived, ...(after ? { cursor: after } : {}) }) }) : diaryRequest<EntryPage>(`entries?date=${date}&archived=${archived}${after ? `&cursor=${encodeURIComponent(after)}` : ""}`);
      const [list, nextSummary] = await Promise.all([listPromise, diaryRequest<Summary>(`summary?weekStart=${week}`)]);
      if (sequence !== generation.current) return;
      setPage(current => after && current ? { ...list, items: [...current.items, ...list.items] } : list); setSummary(nextSummary); setContext(nextSummary);
    } catch (error) { if (sequence === generation.current) setError((error as Error).message); }
    finally { if (sequence === generation.current) setLoading(false); }
  }, [date, week, search, searching, archived]);
  useEffect(() => { let active = true; const tracker = generation; queueMicrotask(() => { if (active && !templates) void load(); }); return () => { active = false; tracker.current++; }; }, [load, templates, refreshToken]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setDetail(null); if (detailId && !templates) { setBusy(true); void diaryRequest<EntryResponse>(`entries/${detailId}`).then(data => { if (active) { setDetail(data.item); setContext(data); } }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setBusy(false); }); } } });
    return () => { active = false; };
  }, [detailId, templates, refreshToken]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setRefreshToken(value => value + 1); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    const interval = setInterval(refresh, 60_000), midnight = setTimeout(refresh, Math.max(1, new Date(ctx.nextDayAt).getTime() - new Date(ctx.serverNow).getTime() + 50));
    return () => { clearInterval(interval); clearTimeout(midnight); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [ctx.nextDayAt, ctx.serverNow]);
  function selectDate(next: string, follow = false) {
    try { diaryDate(next); } catch { next = ctx.today; setDateNotice("La fecha no es válida. Mostramos hoy."); }
    updateNavigation({ fecha: follow ? null : next, detalle: null, seccion: null }, "push"); setNotice("");
  }
  function openEditor(target: DiaryEditorTarget) { opener.current = document.activeElement as HTMLElement; setEditor(target); }
  function closeEditor() { setEditor(null); requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); else heading.current?.focus(); }); }
  function saved(entry: DiaryEntry) { closeEditor(); updateNavigation({ fecha: entry.date, detalle: entry.id, seccion: null }, "push"); setNotice("Anotación guardada."); setHandoff(null); setRefreshToken(value => value + 1); }
  async function action(entry: DiaryEntry, action: string, retry?: string) {
    if (busy) return;
    if (!retry && !window.confirm(action === "archive" ? "¿Archivar esta anotación? Podés recuperarla después." : action === "restore" ? "¿Restaurar esta anotación?" : "¿Marcar este plan como no realizado?")) return;
    const body = retry ?? JSON.stringify({ action, version: entry.version, operationKey: crypto.randomUUID() });
    setBusy(true); setError("");
    try { await diaryRequest<EntryResponse>(`entries/${entry.id}`, { method: "PATCH", body }); setPending(null); setNotice("Anotación actualizada."); setRefreshToken(value => value + 1); }
    catch (error) { const failure = error as Error & { status?: number }; if (!failure.status || failure.status >= 500) setPending({ id: entry.id, body }); setError(failure.message); }
    finally { setBusy(false); }
  }
  async function restoreHandoff() {
    const current = readTrainingHandoff(scope);
    if (!current) { setHandoff(null); setNotice("El formulario conservado venció y se eliminó de esta pestaña."); return; }
    setBusy(true); setError("");
    try {
      const entry = current.entryId ? (await diaryRequest<EntryResponse>(`entries/${current.entryId}`)).item : undefined;
      openEditor({ mode: entry ? "edit" : "create", date: current.input.date, kind: current.input.kind, destination: current.input.result !== null ? "result" : "plan", restored: current.input, entry }); setHandoff(null);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  const nav = <nav className={styles.tabs} aria-label="Entrenamiento"><button aria-current={!templates ? "page" : undefined} onClick={() => updateNavigation({ seccion: null, detalle: null }, "push")}>Diario</button><button aria-current={templates ? "page" : undefined} onClick={() => updateNavigation({ seccion: "plantillas", detalle: null }, "push")}>Plantillas</button></nav>;
  if (templates && !editor) return <><div className={styles.page}>{nav}</div><TrainingApp today={ctx.today} memberName={memberName} optionalMetrics asTemplates readOnly={!ctx.writable} onUseRoutine={template => openEditor({ mode: "create", date, destination: date > ctx.today ? "plan" : "result", template })} /></>;
  return <main data-app-frame className={styles.page}>
    <header data-legacy-chrome className={styles.header}><Link href="/" className={styles.back}>← Aplicaciones</Link><span className={styles.private}>Espacio personal</span></header>
    <div data-page-heading className={styles.hero}><p className={styles.eyebrow}>UN DÍA A LA VEZ</p><h1 tabIndex={-1} ref={heading}>Entrenamiento</h1><p>{memberName}, anotá lo que hiciste y lo que tenés previsto.</p></div>
    {!editor && nav}
    {!ctx.writable && <p className={styles.notice}>Modo de consulta. Tus anotaciones se conservan y se pueden consultar.</p>}
    {editor ? <DiaryEditor key={`${editor.mode}-${editor.entry?.id ?? "new"}`} target={editor} today={ctx.today} onClose={closeEditor} onSaved={saved} /> : <>
      {handoff && <section className={styles.confirm}><p>Hay un formulario conservado al actualizar. Se elimina a los 30 minutos.</p><button disabled={busy || !ctx.writable} onClick={() => void restoreHandoff()}>Recuperar formulario</button><button onClick={() => { clearTrainingHandoffs(); setHandoff(null); }}>Descartar formulario</button></section>}
      <DateNavigation date={date} today={ctx.today} min={DIARY_MIN} max={DIARY_MAX} step={7} className={styles.dateNavigation} onSelect={selectDate} />
      <ol className={styles.week} aria-label="Semana de entrenamiento">{weekDates(week).map(day => {
        const counts = summary?.days.find(item => item.date === day)?.counts ?? emptyCounts();
        return <li key={day}><button aria-pressed={date === day} aria-current={day === ctx.today ? "date" : undefined} aria-label={`${civilLabel(day)}${day === ctx.today ? ", hoy" : ""}. ${countsLabel(counts)}`} onClick={() => selectDate(day)}><span>{new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short" }).format(new Date(`${day}T12:00:00Z`))}</span><strong>{Number(day.slice(-2))}</strong><span aria-hidden="true" className={styles.weekMarker}>{dayIndicator(counts) === "Sin anotaciones" ? "·" : `${dayIndicator(counts).includes("No realizado") || dayIndicator(counts).includes("no realizado") ? "!" : dayIndicator(counts).includes("planificado") || dayIndicator(counts) === "Planificado" ? "○" : "✓"}${dayIndicator(counts).startsWith("Descanso") ? " D" : ""}`}</span><small>{dayIndicator(counts)}</small></button></li>;
      })}</ol>
      <p className={styles.muted}>✓ realizado · ○ planificado · ! no realizado · D descanso</p>
      <h2>{date === ctx.today ? "Hoy · " : ""}{civilLabel(date)}</h2>
      <p className={styles.muted}>{countsLabel(summary?.days.find(day => day.date === date)?.counts ?? emptyCounts())}</p>
      {ctx.writable && <div className={styles.actions}><button className={styles.primary} disabled={date > ctx.today || busy || !!pending} onClick={() => openEditor({ mode: "create", date, destination: "result" })}>Registrar lo realizado</button><button disabled={busy || !!pending} onClick={() => openEditor({ mode: "create", date, destination: "plan" })}>Planificar entrenamiento</button><button disabled={busy || !!pending} onClick={() => openEditor({ mode: "create", date, kind: "rest", destination: date > ctx.today ? "plan" : "result" })}>Anotar descanso</button></div>}
      <div className={styles.searchBar}><label>Buscar en mi diario<input type="search" value={searchInput} onChange={e => setSearchInput(e.target.value)} maxLength={200} placeholder="Por ejemplo, correr o piernas" /></label><label>Archivo<select value={String(archived)} onChange={e => updateNavigation({ archived: e.target.value === "true" ? "true" : null }, "replace")}><option value="false">Solo activas</option><option value="true">Incluir archivadas</option></select></label></div>
      {searchInput.length > 0 && searchInput.length < 3 && <p>Escribí al menos 3 caracteres para buscar.</p>}
      <p role="status" aria-live="polite" className={styles.muted}>{dateNotice || notice || (loading ? "Cargando anotaciones…" : `${searching ? "Búsqueda" : civilLabel(date)}: ${page?.items.length ?? 0} anotaciones cargadas.`)}</p>
      {error && <div role="alert" className={styles.error}>{error}<button disabled={busy || loading} onClick={() => { if (pending) { void action({ id: pending.id } as DiaryEntry, "", pending.body); } else { setRefreshToken(value => value + 1); } }}>{pending ? "Reintentar la misma operación" : "Actualizar"}</button></div>}
      {detail && <section data-ui-surface className={styles.card} aria-labelledby="entry-detail-title"><button onClick={() => updateNavigation({ detalle: null }, "push")}>Cerrar detalle</button><h2 id="entry-detail-title" tabIndex={-1} ref={detailHeading}>{entryTitle(detail)}</h2><p>{civilLabel(detail.date)} · {statusLabel(detail)}</p><Content content={detail.result ?? detail.plan} />{detail.result !== null && detail.plan !== null && <details><summary>Lo planificado</summary><Content content={detail.plan} /></details>}
        {ctx.writable && <div className={styles.actions}>
          {detail.archivedAt ? <button disabled={busy || !!pending} onClick={() => void action(detail, "restore")}>Restaurar anotación</button> : <>
            {detail.result === null && detail.date <= ctx.today && <button disabled={busy || !!pending} className={styles.primary} onClick={() => openEditor({ mode: "result", entry: detail, date: detail.date, destination: "result" })}>Registrar lo realizado</button>}
            {detail.result === null && <button disabled={busy || !!pending} onClick={() => openEditor({ mode: "reschedule", entry: detail, date: detail.date > ctx.today ? detail.date : ctx.today })}>{detail.date > ctx.today ? "Reprogramar para hoy" : "Reprogramar"}</button>}
            <button disabled={busy || !!pending} onClick={() => openEditor({ mode: "edit", entry: detail, date: detail.date, destination: detail.result !== null ? "result" : "plan" })}>{detail.result !== null ? "Corregir lo realizado" : "Editar plan"}</button>
            {detail.result === null && detail.disposition !== "skipped" && <button disabled={busy || !!pending} onClick={() => void action(detail, "skip")}>Marcar no realizado</button>}
            <button disabled={busy || !!pending} onClick={() => void action(detail, "archive")}>Archivar anotación</button>
          </>}
          <button disabled={busy || !!pending} onClick={() => openEditor({ mode: "copy", entry: detail, date: ctx.today })}>Copiar a otra fecha</button>
        </div>}
      </section>}
      {!loading && !error && page && !page.items.length && <div className={styles.empty}><h3>{searching ? "Sin resultados" : "Sin anotaciones"}</h3><p>{searching ? "Probá con otro texto o incluí las archivadas." : "Podés registrar lo realizado, planificar o anotar descanso."}</p></div>}
      <div className={styles.diaryList}>{page?.items.map(entry => <article key={entry.id} data-ui-surface className={styles.card}><p className={styles.eyebrow}>{statusLabel(entry)}</p><h3>{entryTitle(entry)}</h3><p>{civilLabel(entry.date)}</p>{(entry.result ?? entry.plan)?.text && <p className={styles.note}>{(entry.result ?? entry.plan)?.text}</p>}<button disabled={busy} onClick={() => updateNavigation({ detalle: entry.id }, "push")}>Ver anotación</button></article>)}</div>
      {page?.nextCursor && <button disabled={loading} onClick={() => void load(page.nextCursor!)}>Ver más anotaciones</button>}
    </>}
  </main>;
}
function Content({ content }: { content: DiaryEntry["plan"] }) {
  if (content === null) return null;
  return <div><p className={styles.note}>{content.text}</p>{content.durationSeconds != null && <p>Duración: {formatDuration(content.durationSeconds)}</p>}{content.effort != null && <p>Esfuerzo: {content.effort}/10</p>}{content.blocks?.length ? <BlockSummary blocks={content.blocks} /> : null}</div>;
}
