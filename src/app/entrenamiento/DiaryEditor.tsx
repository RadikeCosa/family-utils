"use client";
import { useEffect, useRef, useState } from "react";
import { diaryContent, DIARY_MAX, DIARY_MIN, entryTitle, validateDiary, type DiaryContent, type DiaryEntry, type DiaryInput, type DiaryKind } from "@/lib/training/diary";
import { diaryRequest, type EntryResponse } from "@/lib/training/diary-client";
import { clearTrainingHandoffs } from "@/lib/training/drafts";
import type { TrainingRoutine } from "@/lib/training/types";
import ActivityTimingFields, { initialTiming, resolveTiming } from "./ActivityTimingFields";
import { formatActivityDuration as formatDuration } from "@/lib/training/timing";
import BlockFields from "./BlockFields";
import { BlockSummary, trainingRequest } from "./TrainingEditor";
import styles from "./training.module.css";
export type DiaryEditorTarget = { mode: "create" | "edit" | "result" | "copy" | "reschedule"; date: string; kind?: DiaryKind; destination?: "plan" | "result"; entry?: DiaryEntry; template?: TrainingRoutine; restored?: DiaryInput };
export default function DiaryEditor({ target, today, timeZone, serverNow, activityFormEnabled = false, onClose, onSaved }: { target: DiaryEditorTarget; today: string; timeZone: string; serverNow: string; activityFormEnabled?: boolean; onClose: () => void; onSaved: (entry: DiaryEntry) => void }) {
  const [entry, setEntry] = useState(target.entry);
  const kind = entry?.kind ?? target.kind ?? "training";
  const [copySource, setCopySource] = useState<"plan" | "result">(entry?.result != null ? "result" : "plan");
  const [destination, setDestination] = useState<"plan" | "result">(target.destination ?? (target.mode === "result" || entry?.result != null ? "result" : "plan"));
  const restored = target.restored;
  const initial = restored ? restored.result ?? restored.plan : target.template ? { title: target.template.name, blocks: target.template.blocks } : target.mode === "result" ? entry?.result ?? (entry?.plan ? { title: entry.plan.title, text: entry.plan.text, blocks: entry.plan.blocks } : null) : entry?.result ?? entry?.plan;
  const [content, setContent] = useState<DiaryContent>(initial ?? {}), [date, setDate] = useState(restored?.date ?? target.date);
  const [timingDraft, setTimingDraft] = useState(() => initialTiming(initial?.timing));
  const [sourceRoutineId, setSourceRoutineId] = useState(restored?.sourceRoutineId ?? entry?.sourceRoutineId ?? target.template?.id ?? null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<DiaryEntry | null>(null), [expectedVersion, setExpectedVersion] = useState(entry?.version);
  const [templates, setTemplates] = useState<TrainingRoutine[]>([]), [templateCursor, setTemplateCursor] = useState<string | null>(null), [templateLoading, setTemplateLoading] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), errorRef = useRef<HTMLDivElement>(null), submitted = useRef<{ path: string; method: string; payload: string } | null>(null);
  const operationKey = useRef<string | null>(null), dirty = useRef(false);
  useEffect(() => { operationKey.current = crypto.randomUUID(); heading.current?.focus(); }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => { if (dirty.current || uncertain) e.preventDefault(); };
    window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect);
  }, [uncertain]);
  function change(patch: Partial<DiaryContent>) { dirty.current = true; setContent(current => ({ ...current, ...patch })); }
  function close() { if ((dirty.current || uncertain) && !window.confirm("¿Descartar los cambios de este formulario?")) return; clearTrainingHandoffs(); onClose(); }
  async function loadTemplates(after?: string) {
    setTemplateLoading(true); setError("");
    try { const data = await trainingRequest(`routines?archived=false${after ? `&cursor=${encodeURIComponent(after)}` : ""}`); setTemplates(current => after ? [...current, ...data.items] : data.items); setTemplateCursor(data.nextCursor); }
    catch (error) { setError((error as Error).message); } finally { setTemplateLoading(false); }
  }
  async function applyTemplate(id: string) {
    if ((content.title || content.text || content.blocks?.length) && !window.confirm(`¿Reemplazar título y ejercicios de ${destination === "plan" ? "lo planificado" : "lo realizado"} con esta rutina? Tu comentario y horarios se conservan.`)) return;
    setBusy(true); setError("");
    try { const { item } = await trainingRequest(`routines/${id}`); if (item.archivedAt) throw new Error("La plantilla fue archivada."); setContent(current => ({ ...current, title: item.name, blocks: item.blocks })); if (!entry) setSourceRoutineId(item.id); dirty.current = true; }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setError(""); setConflict(false);
    let sent = false;
    try {
      if (!uncertain || !submitted.current) {
        let payload: Record<string, unknown>, path = "entries", method = "POST";
        const timing = activityFormEnabled && kind === "training" ? resolveTiming(timingDraft, date, timeZone, !!entry && date !== entry.date && target.mode !== "result") : undefined;
        if (target.mode === "copy") payload = { action: "copy", sourceId: entry!.id, content: copySource, date, ...(timing !== undefined ? { timing } : {}) };
        else if (target.mode === "reschedule") { path += `/${entry!.id}`; method = "PATCH"; payload = { action: "reschedule", date, version: expectedVersion, ...(timing !== undefined ? { timing } : {}) }; }
        else {
          const validated = diaryContent({ ...content, ...(timing !== undefined ? { timing } : {}) }, kind);
          if (destination === "result" && validated?.timing && Date.parse(validated.timing.endAt) > Date.parse(serverNow)) throw new Error("La actividad no puede finalizar después de ahora en la zona familiar.");
          if (entry && date !== entry.date && !window.confirm(`¿Mover al ${date} y ${target.mode === "result" ? "registrar actividad" : "guardar los cambios"}? El plan original se conserva si estás registrando el resultado.`)) return;
          const input = validateDiary({ date, kind, plan: entry?.plan ?? null, result: entry?.result ?? null, disposition: destination === "result" ? "open" : entry?.disposition ?? "open", sourceRoutineId, [destination]: validated }, today);
          if (entry) { path += `/${entry.id}`; method = "PATCH"; payload = target.mode === "result" ? { action: "result", content: validated, version: expectedVersion, ...(date !== entry.date ? { date } : {}) } : { action: "edit", input, version: expectedVersion }; }
          else payload = { input };
        }
        submitted.current = { path, method, payload: JSON.stringify({ ...payload, operationKey: operationKey.current }) };
      }
      setBusy(true);
      const attempt = submitted.current!;
      sent = true;
      const data = await diaryRequest<EntryResponse>(attempt.path, { method: attempt.method, body: attempt.payload });
      dirty.current = false; clearTrainingHandoffs(); onSaved(data.item);
    } catch (error) {
      const failure = error as Error & { status?: number; code?: string };
      setUncertain(sent && (!failure.status || failure.status >= 500 && failure.code !== "DIARY_READ_ONLY"));
      setConflict(failure.code === "VERSION_CONFLICT"); setError(failure.message);
    } finally { setBusy(false); }
  }
  async function reviewConflict() {
    setBusy(true);
    try { setLatest((await diaryRequest<EntryResponse>(`entries/${entry!.id}`)).item); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  function reapply() {
    if (!latest) return;
    if (destination === "plan" && latest.result !== null) { setError("Esta anotación ya tiene un resultado. Conservá tu borrador o cargá la versión guardada antes de continuar."); return; }
    setExpectedVersion(latest.version); operationKey.current = crypto.randomUUID(); submitted.current = null; setConflict(false); setError("");
    // The result correction must always retain the most recent saved plan.
    setEntry(latest);
    setLatest(null);
  }
  const title = target.mode === "copy" ? "Copiar a otra fecha" : target.mode === "reschedule" ? "Reprogramar entrenamiento" : destination === "plan" ? kind === "rest" ? "Planificar descanso" : "Planificar entrenamiento" : activityFormEnabled ? "Registrar actividad" : "Registrar lo realizado";
  const preview = entry?.[copySource];
  return <section className={styles.editor} aria-labelledby="diary-editor-title">
    <h2 id="diary-editor-title" ref={heading} tabIndex={-1}>{title}</h2>
    {target.mode === "result" && entry && date !== entry.date && <p>El plan del {entry.date} se conservará. Al guardar, la actividad se moverá al {date}; te pediremos confirmación.</p>}
    {error && <div role="alert" className={styles.error} ref={errorRef} tabIndex={-1}>{error}{conflict && <button type="button" disabled={busy} onClick={() => void reviewConflict()}>Revisar versión guardada</button>}</div>}
    {latest && <aside className={styles.confirm}><h3>Versión guardada en otro dispositivo</h3><p>Tu borrador completo sigue en el formulario.</p><p>{entryTitle(latest)}</p><p>Fecha: {latest.date} · Versión {latest.version}</p><p>Plan: {latest.plan?.text || latest.plan?.title || "Sin texto"}</p><p>Resultado: {latest.result?.text || latest.result?.title || "Sin texto"}</p>{latest.plan?.blocks?.length ? <details><summary>Ejercicios del plan guardado</summary><BlockSummary blocks={latest.plan.blocks} /></details> : null}{latest.result?.blocks?.length ? <details><summary>Ejercicios realizados guardados</summary><BlockSummary blocks={latest.result.blocks} /></details> : null}<button type="button" onClick={reapply}>Usar esta versión como base y conservar mi borrador</button><button type="button" onClick={() => { if (window.confirm("¿Descartar tu borrador y cargar la versión guardada?")) { dirty.current = false; onSaved(latest); } }}>Descartar y recargar</button></aside>}
    <form noValidate onSubmit={save}><fieldset disabled={busy || uncertain} className={styles.fields}><legend className={styles.srOnly}>Datos de la anotación</legend>
      <label>Fecha<input type="date" min={target.mode === "reschedule" ? today : DIARY_MIN} max={destination === "result" && target.mode !== "copy" && target.mode !== "reschedule" ? today : DIARY_MAX} value={date} disabled={target.mode === "result" && !activityFormEnabled} onChange={e => { dirty.current = true; setDate(e.target.value); }} /></label>
      {target.mode === "copy" ? <><label>Contenido a copiar<select value={copySource} onChange={e => { const source = e.target.value as "plan" | "result"; setCopySource(source); setTimingDraft(initialTiming(entry?.[source]?.timing)); }}>{entry?.result !== null && <option value="result">Lo realizado</option>}{entry?.plan !== null && <option value="plan">Lo planificado</option>}</select></label><p>Se creará un plan nuevo. Vista previa:</p><div className={styles.card}><h3>{kind === "rest" ? "Descanso" : preview?.title || "Entrenamiento"}</h3><p className={styles.note}>{preview?.text}</p>{preview?.blocks?.length ? <BlockSummary blocks={preview.blocks} /> : null}</div></> : target.mode === "reschedule" ? <p>Se moverá la misma anotación desde {entry?.date}. El contenido se conserva.</p> : <>
        {!activityFormEnabled && !entry && <label>Esta anotación es<select value={destination} onChange={e => { dirty.current = true; setDestination(e.target.value as "plan" | "result"); }}><option value="plan">Lo planificado</option><option value="result" disabled={date > today}>Lo realizado</option></select></label>}
        <p className={styles.muted}>{kind === "rest" ? "El descanso se registra aunque no agregues una nota." : "Una frase alcanza. Agregá detalle solo cuando lo necesites."}</p>
        <label>{destination === "plan" ? "¿Qué tenés previsto?" : "¿Qué hiciste?"}<textarea rows={4} maxLength={2000} value={content.text ?? ""} onChange={e => change({ text: e.target.value })} /></label>
        <label>Título (opcional)<input value={content.title ?? ""} maxLength={120} onChange={e => change({ title: e.target.value })} /></label>
        {kind === "training" && <>
          <details className={styles.adjustments}><summary onClick={() => { if (!templates.length) void loadTemplates(); }}>{activityFormEnabled ? "Usar una rutina guardada (opcional)" : `Usar una plantilla en ${destination === "plan" ? "lo planificado" : "lo realizado"}`}</summary>{templateLoading && <p role="status">Cargando rutinas…</p>}{!templateLoading && !templates.length && <p>No hay rutinas activas. Podés registrar la actividad con texto libre.</p>}{templates.map(template => <button key={template.id} type="button" onClick={() => void applyTemplate(template.id)}>{template.name}</button>)}{templateCursor && <button type="button" disabled={templateLoading} onClick={() => void loadTemplates(templateCursor)}>Ver más rutinas</button>}</details>
          {activityFormEnabled ? <>
            <ActivityTimingFields value={timingDraft} onChange={value => { dirty.current = true; setTimingDraft(value); }} date={date} timeZone={timeZone} planned={destination === "plan"} historicalDuration={content.durationSeconds} />
            {destination === "result" && <label>Intensidad percibida (opcional)<select value={content.effort ?? ""} onChange={e => change({ effort: e.target.value === "" ? null : Number(e.target.value) })}><option value="">Sin informar</option>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}/10 · {i < 3 ? "Suave" : i < 7 ? "Moderada" : "Muy intensa"}</option>)}</select></label>}
          </> : content.timing ? <p>Horarios guardados. Duración: {formatDuration(content.durationSeconds!)}. Se conservan al editar; cambiar de fecha requiere el formulario de horarios.</p> : <><label>Duración total en segundos (opcional)<input type="number" min="1" max="86400" value={content.durationSeconds ?? ""} onChange={e => change({ durationSeconds: e.target.value === "" ? null : Number(e.target.value) })} /></label><label>Esfuerzo percibido (opcional)<select value={content.effort ?? ""} onChange={e => change({ effort: e.target.value === "" ? null : Number(e.target.value) })}><option value="">Sin informar</option>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}/10</option>)}</select></label></>}
          <details className={styles.adjustments}><summary>Agregar detalle</summary><BlockFields value={content.blocks ?? []} onChange={blocks => change({ blocks })} /></details>
        </>}

      </>}
      {activityFormEnabled && kind === "training" && (target.mode === "reschedule" || target.mode === "copy") && <ActivityTimingFields value={timingDraft} onChange={value => { dirty.current = true; setTimingDraft(value); }} date={date} timeZone={timeZone} planned />}
    </fieldset><div className={styles.saveBar}><button className={styles.primary} type="submit" disabled={busy || conflict}>{busy ? "Guardando…" : uncertain ? "Reintentar guardado" : target.mode === "copy" ? "Crear copia planificada" : target.mode === "reschedule" ? "Confirmar reprogramación" : activityFormEnabled && kind === "training" ? destination === "result" ? "Guardar actividad" : "Guardar plan" : "Guardar anotación"}</button><button type="button" disabled={busy} onClick={close}>Cancelar</button></div></form>
  </section>;
}
