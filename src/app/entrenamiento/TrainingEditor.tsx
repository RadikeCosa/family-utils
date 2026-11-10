"use client";
import { clearTrainingHandoffs, saveTrainingHandoff } from "@/lib/training/drafts";
import type { DiaryInput } from "@/lib/training/diary";
import BlockFields from "./BlockFields";
import { useEffect, useRef, useState } from "react";
import { effortLabel, formatDuration, validateRoutine, validateSession } from "@/lib/training/rules";
import type { TrainingBlock, TrainingRoutine, TrainingSession } from "@/lib/training/types";
import styles from "./training.module.css";

export type EditorTarget = { kind: "routines"; routine?: TrainingRoutine; duplicate?: boolean } | { kind: "sessions"; routine?: TrainingRoutine; session?: TrainingSession };
type ExerciseDraft = { key: string; name: string; mode: "repetitions" | "time"; amount: string };
type BlockDraft = { key: string; name: string; rounds: string; exercises: ExerciseDraft[] };
const newExercise = (): ExerciseDraft => ({ key: crypto.randomUUID(), name: "", mode: "repetitions", amount: "" });
const newBlock = (): BlockDraft => ({ key: crypto.randomUUID(), name: "", rounds: "1", exercises: [newExercise()] });
function draftBlocks(blocks?: TrainingBlock[]): BlockDraft[] {
  return blocks?.map((block) => ({ key: crypto.randomUUID(), name: block.name, rounds: String(block.rounds), exercises: block.exercises.map((exercise) => ({ key: crypto.randomUUID(), name: exercise.name, mode: exercise.mode, amount: String(exercise.mode === "time" ? exercise.seconds : exercise.repetitions) })) })) ?? [newBlock()];
}
export async function trainingRequest(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (path === "sessions" || path.startsWith("sessions/") || path.startsWith("sessions?")) headers.set("X-Training-Contract", "2");
  const result = await fetch(`/api/training/${path}`, { cache: "no-store", ...init, headers });
  let body;
  try { body = await result.json(); }
  catch { throw new Error("No se pudo confirmar la respuesta. Conservamos tu formulario para reintentar."); }
  if (!result.ok) throw Object.assign(new Error(body.error ?? "No se pudo completar la operación."), { code: body.code, status: result.status });
  return body;
}
export default function TrainingEditor({ target, today, optionalMetrics, draftScope, templateMode = false, onClose, onSaved }: { target: EditorTarget; today: string; optionalMetrics: boolean; draftScope?: string; templateMode?: boolean; onClose: () => void; onSaved: () => void }) {
  const existing = target.kind === "sessions" ? target.session : target.duplicate ? undefined : target.routine;
  const source = target.kind === "sessions" ? target.session ?? target.routine : target.routine;
  const session = target.kind === "sessions" ? target.session : undefined;
  const isSession = target.kind === "sessions";
  const [expectedVersion, setExpectedVersion] = useState(existing?.version);
  const [name, setName] = useState(source?.name ?? "");
  const [blocks, setBlocks] = useState(() => draftBlocks(source?.blocks));
  const [performedOn, setPerformedOn] = useState(session?.performedOn ?? today);
  const [minutes, setMinutes] = useState(session?.durationSeconds != null ? String(Math.floor(session.durationSeconds / 60)) : "");
  const [seconds, setSeconds] = useState(session?.durationSeconds != null ? String(session.durationSeconds % 60) : optionalMetrics ? "" : "0");
  const [effort, setEffort] = useState(session?.effort != null ? String(session.effort) : "");
  const [note, setNote] = useState(session?.note ?? "");
  const [adjusting, setAdjusting] = useState(false);
  const [clientUpdate, setClientUpdate] = useState(false);
  const [error, setError] = useState(""); const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false); const [uncertain, setUncertain] = useState(false);
  const [confirm, setConfirm] = useState<"reload" | "close" | null>(null);
  const operationKey = useRef<string | null>(null); const submitted = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null); const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { operationKey.current = crypto.randomUUID(); heading.current?.focus(); }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError(""); setConflict(false);
    let payload: string;
    try {
      if (uncertain && submitted.current) payload = submitted.current;
      else {
        const content = { name, blocks: blocks.map((block) => ({ name: block.name, rounds: Number(block.rounds), exercises: block.exercises.map((exercise) => exercise.mode === "time" ? { name: exercise.name, mode: "time", seconds: Number(exercise.amount) } : { name: exercise.name, mode: "repetitions", repetitions: Number(exercise.amount) }) })) };
        const totalDuration = minutes === "" && seconds === "" ? null : (minutes === "" ? 0 : Number(minutes)) * 60 + (seconds === "" ? 0 : Number(seconds));
        const input = isSession ? validateSession({ ...content, sourceRoutineId: session?.sourceRoutineId ?? target.routine?.id, performedOn, durationSeconds: totalDuration, effort: effort === "" ? null : Number(effort), note }, today, optionalMetrics) : validateRoutine(content);
        payload = JSON.stringify({ ...input, ...(existing ? { version: expectedVersion } : { operationKey: operationKey.current }) });
        submitted.current = payload;
      }
    } catch (error) { setError((error as Error).message); return; }
    setBusy(true);
    try {
      await trainingRequest(`${target.kind}${existing ? `/${existing.id}` : ""}`, { method: existing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: payload });
      clearTrainingHandoffs(); onSaved();
    } catch (error) {
      const failure = error as Error & { status?: number; code?: string };
      const unknown = !failure.status || failure.status >= 500;
      setUncertain(unknown);
      setError(unknown ? "No pudimos confirmar el guardado. Conservamos tus datos. Reintentá para recuperar el resultado sin duplicarlo." : failure.message);
      setClientUpdate(failure.code === "CLIENT_UPDATE_REQUIRED");
      setConflict(failure.code === "VERSION_CONFLICT");
    } finally { setBusy(false); }
  }
  function preserveAndUpdate() {
    const input: DiaryInput = { date: performedOn, kind: "training", plan: null, result: { title: name, text: note, blocks: blocks.map(block => ({ name: block.name, rounds: Number(block.rounds), exercises: block.exercises.map(exercise => exercise.mode === "time" ? { name: exercise.name, mode: "time" as const, seconds: Number(exercise.amount) } : { name: exercise.name, mode: "repetitions" as const, repetitions: Number(exercise.amount) }) })), durationSeconds: minutes === "" && seconds === "" ? null : Number(minutes) * 60 + Number(seconds), effort: effort === "" ? null : Number(effort) }, disposition: "open", sourceRoutineId: session?.sourceRoutineId ?? (target.kind === "sessions" ? target.routine?.id ?? null : null) };
    if (!draftScope || !saveTrainingHandoff(draftScope, input, session?.id)) { setError("No pudimos conservar el formulario en esta pestaña. Copiá tus datos antes de actualizar."); return; }
    window.location.reload();
  }
  async function reload() {
    if (!existing) { onClose(); return; }
    setBusy(true);
    try {
      const { item } = await trainingRequest(`${target.kind}/${existing.id}`);
      setName(item.name); setBlocks(draftBlocks(item.blocks)); setExpectedVersion(item.version);
      if (isSession) { setPerformedOn(item.performedOn); setMinutes(item.durationSeconds == null ? "" : String(Math.floor(item.durationSeconds / 60))); setSeconds(item.durationSeconds == null ? "" : String(item.durationSeconds % 60)); setEffort(item.effort == null ? "" : String(item.effort)); setNote(item.note); }
      submitted.current = null; setUncertain(false); setConflict(false); setConfirm(null); setError("");
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  const routineNoun = templateMode ? "plantilla" : "rutina";
  const title = isSession ? session ? "Corregir entrenamiento" : "Registrar entrenamiento" : target.duplicate ? `Duplicar ${routineNoun}` : existing ? `Editar ${routineNoun}` : `Nueva ${routineNoun}`;
  return <section className={styles.editor} aria-labelledby="editor-title">
    <h2 id="editor-title" ref={heading} tabIndex={-1}>{title}</h2>
    <p className={styles.muted}>{isSession ? "Registrá esta rutina y ajustá la copia si hiciste algo distinto. La rutina original se conserva." : "Armá tus bloques. Las cantidades de cada ejercicio se repiten en todas las vueltas del bloque."}</p>
    {clientUpdate && <div className={styles.notice}><p>Podés conservar este formulario durante 30 minutos en esta sesión de pestaña y recuperarlo al actualizar.</p><button type="button" onClick={preserveAndUpdate}>Conservar y actualizar</button></div>}
    {error && <div className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>{error}{conflict && <button type="button" onClick={() => setConfirm("reload")}>{existing ? "Recargar registro" : "Volver al listado"}</button>}</div>}
    {confirm && <div className={styles.confirm} role="group" aria-label="Confirmar salida">
      <p>{confirm === "reload" ? "Se reemplazará este formulario por el registro guardado. Tus cambios sin guardar se descartarán." : "¿Descartar los cambios de este formulario?"}</p>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => confirm === "reload" ? void reload() : onClose()}>{confirm === "reload" ? "Confirmar recarga" : "Descartar y cerrar"}</button><button type="button" onClick={() => setConfirm(null)}>Seguir editando</button></div>
    </div>}
    <form noValidate onSubmit={save}>
      <fieldset disabled={busy || uncertain} className={styles.fields}>
        <legend className={styles.srOnly}>Datos de {isSession ? "entrenamiento" : "rutina"}</legend>
        {isSession && <fieldset className={styles.block}><legend>Datos del entrenamiento</legend>
          <label>Fecha<input required type="date" min="0001-01-01" max={today} value={performedOn} onChange={(event) => setPerformedOn(event.target.value)} /></label>
          {!optionalMetrics && <p className={styles.muted}>La fecha, duración y esfuerzo son obligatorios.</p>}
          {optionalMetrics && <>
            <p className={styles.muted}>Duración total, incluyendo descansos y transiciones. Si completás un campo, el otro se toma como cero.</p>
            <div className={styles.row}><label>Minutos (opcional)<input type="number" inputMode="numeric" min="0" max="1440" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label><label>Segundos (opcional)<input type="number" inputMode="numeric" min="0" max="59" step="1" value={seconds} onChange={(event) => setSeconds(event.target.value)} /></label></div>
            <label>Esfuerzo percibido (opcional)<select value={effort} onChange={(event) => setEffort(event.target.value)}><option value="">Sin informar</option>{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} — {effortLabel(value)}</option>)}</select></label>
            <p className={styles.muted}>1–3 suave · 4–6 moderado · 7–8 intenso · 9–10 máximo</p>
          </>}
          {!optionalMetrics && <><p className={styles.muted}>Duración total, incluyendo descansos y transiciones.</p><div className={styles.row}><label>Minutos<input required type="number" inputMode="numeric" min="0" max="1440" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label><label>Segundos<input required type="number" inputMode="numeric" min="0" max="59" step="1" value={seconds} onChange={(event) => setSeconds(event.target.value)} /></label></div><label>Esfuerzo percibido<select required value={effort} onChange={(event) => setEffort(event.target.value)}><option value="">Elegí de 1 a 10</option>{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} — {effortLabel(value)}</option>)}</select></label><p className={styles.muted}>1–3 suave · 4–6 moderado · 7–8 intenso · 9–10 máximo</p></>}
          <label>Nota (opcional)<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} aria-describedby="note-help" /></label><small id="note-help">Hasta 2.000 caracteres. Podés anotar diferencias entre vueltas.</small>
        </fieldset>}
        {isSession && <section aria-label="Resumen de la rutina"><h3>Rutina</h3><BlockSummary blocks={blocks.map((block) => ({ name: block.name, rounds: Number(block.rounds) || 0, exercises: block.exercises.map((exercise) => exercise.mode === "time" ? { name: exercise.name, mode: "time", seconds: Number(exercise.amount) || 0 } : { name: exercise.name, mode: "repetitions", repetitions: Number(exercise.amount) || 0 }) }))} /></section>}
        {isSession && <details className={styles.adjustments} open={adjusting} onToggle={(event) => setAdjusting(event.currentTarget.open)}><summary>Ajustar lo realizado</summary><div className={styles.fields}><label>Nombre<input required value={name} onChange={(event) => setName(event.target.value)} /></label><BlockFields value={blocks.map(block => ({ name: block.name, rounds: Number(block.rounds), exercises: block.exercises.map(exercise => exercise.mode === "time" ? { name: exercise.name, mode: "time" as const, seconds: Number(exercise.amount) } : { name: exercise.name, mode: "repetitions" as const, repetitions: Number(exercise.amount) }) }))} onChange={next => setBlocks(draftBlocks(next))} /></div></details>}
        {!isSession && <>
        <label>Nombre<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <BlockFields value={blocks.map(block => ({ name: block.name, rounds: Number(block.rounds), exercises: block.exercises.map(exercise => exercise.mode === "time" ? { name: exercise.name, mode: "time" as const, seconds: Number(exercise.amount) } : { name: exercise.name, mode: "repetitions" as const, repetitions: Number(exercise.amount) }) }))} onChange={next => setBlocks(draftBlocks(next))} />
        </>}
      </fieldset>
      <div className={styles.saveBar}><button className={styles.primary} type="submit" disabled={busy}>{busy ? "Guardando…" : uncertain ? "Reintentar guardado" : isSession ? "Guardar entrenamiento" : `Guardar ${routineNoun}`}</button><button type="button" disabled={busy} onClick={() => setConfirm("close")}>Cancelar</button></div>
    </form>
  </section>;
}
export function BlockSummary({ blocks }: { blocks: TrainingBlock[] }) {
  return <ol className={styles.summary}>{blocks.map((block, index) => <li key={index}><strong>{block.name || `Bloque ${index + 1}`}</strong> · {block.rounds} {block.rounds === 1 ? "vuelta" : "vueltas"}<ul>{block.exercises.map((exercise, index) => <li key={index}>{exercise.name} · {exercise.mode === "time" ? formatDuration(exercise.seconds) : `${exercise.repetitions} repeticiones`}</li>)}</ul></li>)}</ol>;
}
