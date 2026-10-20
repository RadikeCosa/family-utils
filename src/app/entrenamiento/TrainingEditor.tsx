"use client";
import { useEffect, useRef, useState } from "react";
import { effortLabel, formatDuration, LIMITS, validateRoutine, validateSession } from "@/lib/training/rules";
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
function move<T>(items: T[], index: number, delta: number): T[] {
  const next = [...items]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next;
}
export async function trainingRequest(path: string, init?: RequestInit) {
  const result = await fetch(`/api/training/${path}`, { cache: "no-store", ...init });
  let body;
  try { body = await result.json(); }
  catch { throw new Error("No se pudo confirmar la respuesta. Conservamos tu formulario para reintentar."); }
  if (!result.ok) throw Object.assign(new Error(body.error ?? "No se pudo completar la operación."), { code: body.code, status: result.status });
  return body;
}
export default function TrainingEditor({ target, today, onClose, onSaved }: { target: EditorTarget; today: string; onClose: () => void; onSaved: () => void }) {
  const existing = target.kind === "sessions" ? target.session : target.duplicate ? undefined : target.routine;
  const source = target.kind === "sessions" ? target.session ?? target.routine : target.routine;
  const session = target.kind === "sessions" ? target.session : undefined;
  const [expectedVersion, setExpectedVersion] = useState(existing?.version);
  const [name, setName] = useState(source?.name ?? "");
  const [blocks, setBlocks] = useState(() => draftBlocks(source?.blocks));
  const [performedOn, setPerformedOn] = useState(session?.performedOn ?? today);
  const [minutes, setMinutes] = useState(session ? String(Math.floor(session.durationSeconds / 60)) : "");
  const [seconds, setSeconds] = useState(session ? String(session.durationSeconds % 60) : "0");
  const [effort, setEffort] = useState(session ? String(session.effort) : "");
  const [note, setNote] = useState(session?.note ?? "");
  const [error, setError] = useState(""); const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false); const [uncertain, setUncertain] = useState(false);
  const [confirm, setConfirm] = useState<"reload" | "close" | null>(null);
  const operationKey = useRef<string | null>(null); const submitted = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null); const errorRef = useRef<HTMLDivElement>(null);
  const isSession = target.kind === "sessions";
  useEffect(() => { operationKey.current = crypto.randomUUID(); heading.current?.focus(); }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const updateBlock = (key: string, patch: Partial<BlockDraft>) => setBlocks((current) => current.map((block) => block.key === key ? { ...block, ...patch } : block));
  function updateExercise(blockKey: string, exerciseKey: string, patch: Partial<ExerciseDraft>) {
    setBlocks((current) => current.map((block) => block.key === blockKey ? { ...block, exercises: block.exercises.map((exercise) => exercise.key === exerciseKey ? { ...exercise, ...patch } : exercise) } : block));
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError(""); setConflict(false);
    let payload: string;
    try {
      if (uncertain && submitted.current) payload = submitted.current;
      else {
        const content = { name, blocks: blocks.map((block) => ({ name: block.name, rounds: Number(block.rounds), exercises: block.exercises.map((exercise) => exercise.mode === "time" ? { name: exercise.name, mode: "time", seconds: Number(exercise.amount) } : { name: exercise.name, mode: "repetitions", repetitions: Number(exercise.amount) }) })) };
        const input = isSession ? validateSession({ ...content, sourceRoutineId: session?.sourceRoutineId ?? target.routine?.id, performedOn, durationSeconds: Number(minutes) * 60 + Number(seconds), effort: Number(effort), note }, today) : validateRoutine(content);
        payload = JSON.stringify({ ...input, ...(existing ? { version: expectedVersion } : { operationKey: operationKey.current }) });
        submitted.current = payload;
      }
    } catch (error) { setError((error as Error).message); return; }
    setBusy(true);
    try {
      await trainingRequest(`${target.kind}${existing ? `/${existing.id}` : ""}`, { method: existing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: payload });
      onSaved();
    } catch (error) {
      const failure = error as Error & { status?: number; code?: string };
      const unknown = !failure.status || failure.status >= 500;
      setUncertain(unknown);
      setError(unknown ? "No pudimos confirmar el guardado. Conservamos tus datos. Reintentá para recuperar el resultado sin duplicarlo." : failure.message);
      setConflict(failure.status === 409);
    } finally { setBusy(false); }
  }
  async function reload() {
    if (!existing) { onClose(); return; }
    setBusy(true);
    try {
      const { item } = await trainingRequest(`${target.kind}/${existing.id}`);
      setName(item.name); setBlocks(draftBlocks(item.blocks)); setExpectedVersion(item.version);
      if (isSession) { setPerformedOn(item.performedOn); setMinutes(String(Math.floor(item.durationSeconds / 60))); setSeconds(String(item.durationSeconds % 60)); setEffort(String(item.effort)); setNote(item.note); }
      submitted.current = null; setUncertain(false); setConflict(false); setConfirm(null); setError("");
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  const title = isSession ? session ? "Corregir entrenamiento" : "Registrar entrenamiento" : target.duplicate ? "Duplicar rutina" : existing ? "Editar rutina" : "Nueva rutina";
  return <section className={styles.editor} aria-labelledby="editor-title">
    <h2 id="editor-title" ref={heading} tabIndex={-1}>{title}</h2>
    <p className={styles.muted}>{isSession ? "Ajustá la copia para reflejar lo que hiciste. La rutina original se conserva." : "Armá tus bloques. Las cantidades de cada ejercicio se repiten en todas las vueltas del bloque."}</p>
    {error && <div className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>{error}{conflict && <button type="button" onClick={() => setConfirm("reload")}>{existing ? "Recargar registro" : "Volver al listado"}</button>}</div>}
    {confirm && <div className={styles.confirm} role="group" aria-label="Confirmar salida">
      <p>{confirm === "reload" ? "Se reemplazará este formulario por el registro guardado. Tus cambios sin guardar se descartarán." : "¿Descartar los cambios de este formulario?"}</p>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => confirm === "reload" ? void reload() : onClose()}>{confirm === "reload" ? "Confirmar recarga" : "Descartar y cerrar"}</button><button type="button" onClick={() => setConfirm(null)}>Seguir editando</button></div>
    </div>}
    <form onSubmit={save}>
      <fieldset disabled={busy || uncertain} className={styles.fields}>
        <legend className={styles.srOnly}>Datos de {isSession ? "entrenamiento" : "rutina"}</legend>
        <label>Nombre<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        {blocks.map((block, blockIndex) => <fieldset className={styles.block} key={block.key}>
          <legend>Bloque {blockIndex + 1}</legend>
          <div className={styles.actions}>
            <button type="button" aria-label={`Subir bloque ${blockIndex + 1}`} disabled={blockIndex === 0} onClick={() => setBlocks((current) => move(current, blockIndex, -1))}>↑ Subir</button>
            <button type="button" aria-label={`Bajar bloque ${blockIndex + 1}`} disabled={blockIndex === blocks.length - 1} onClick={() => setBlocks((current) => move(current, blockIndex, 1))}>↓ Bajar</button>
            <button type="button" disabled={blocks.length === 1} onClick={() => setBlocks((current) => current.filter((item) => item.key !== block.key))}>Quitar bloque {blockIndex + 1}</button>
          </div>
          <div className={styles.row}><label>Nombre del bloque (opcional)<input value={block.name} onChange={(event) => updateBlock(block.key, { name: event.target.value })} /></label>
            <label>Vueltas<input required type="number" inputMode="numeric" min="1" max={LIMITS.rounds} step="1" value={block.rounds} onChange={(event) => updateBlock(block.key, { rounds: event.target.value })} /></label></div>
          {block.exercises.map((exercise, exerciseIndex) => <fieldset className={styles.exercise} key={exercise.key}>
            <legend>Ejercicio {exerciseIndex + 1}</legend>
            <label>Nombre del ejercicio<input required value={exercise.name} onChange={(event) => updateExercise(block.key, exercise.key, { name: event.target.value })} /></label>
            <div className={styles.row}><label>Medida<select value={exercise.mode} onChange={(event) => updateExercise(block.key, exercise.key, { mode: event.target.value as ExerciseDraft["mode"], amount: "" })}><option value="repetitions">Repeticiones</option><option value="time">Tiempo</option></select></label>
              <label>{exercise.mode === "time" ? "Tiempo por vuelta (segundos)" : "Repeticiones por vuelta"}<input required type="number" inputMode="numeric" min="1" max={exercise.mode === "time" ? LIMITS.seconds : LIMITS.repetitions} step="1" value={exercise.amount} onChange={(event) => updateExercise(block.key, exercise.key, { amount: event.target.value })} /></label></div>
            <div className={styles.actions}>
              <button type="button" aria-label={`Subir ejercicio ${exerciseIndex + 1} del bloque ${blockIndex + 1}`} disabled={exerciseIndex === 0} onClick={() => updateBlock(block.key, { exercises: move(block.exercises, exerciseIndex, -1) })}>↑ Subir</button>
              <button type="button" aria-label={`Bajar ejercicio ${exerciseIndex + 1} del bloque ${blockIndex + 1}`} disabled={exerciseIndex === block.exercises.length - 1} onClick={() => updateBlock(block.key, { exercises: move(block.exercises, exerciseIndex, 1) })}>↓ Bajar</button>
              <button type="button" disabled={block.exercises.length === 1} onClick={() => updateBlock(block.key, { exercises: block.exercises.filter((item) => item.key !== exercise.key) })}>Quitar ejercicio {exerciseIndex + 1}</button>
            </div>
          </fieldset>)}
          <button type="button" disabled={block.exercises.length >= LIMITS.exercises} onClick={() => updateBlock(block.key, { exercises: [...block.exercises, newExercise()] })}>Agregar ejercicio al bloque {blockIndex + 1}</button>
        </fieldset>)}
        <button type="button" disabled={blocks.length >= LIMITS.blocks} onClick={() => setBlocks((current) => [...current, newBlock()])}>Agregar bloque</button>
        {isSession && <fieldset className={styles.block}><legend>Cómo fue el entrenamiento</legend>
          <label>Fecha<input required type="date" min="0001-01-01" max={today} value={performedOn} onChange={(event) => setPerformedOn(event.target.value)} /></label>
          <p className={styles.muted}>Duración total, incluyendo descansos y transiciones.</p>
          <div className={styles.row}><label>Minutos<input required type="number" inputMode="numeric" min="0" max="1440" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label><label>Segundos<input required type="number" inputMode="numeric" min="0" max="59" step="1" value={seconds} onChange={(event) => setSeconds(event.target.value)} /></label></div>
          <label>Esfuerzo percibido<select required value={effort} onChange={(event) => setEffort(event.target.value)}><option value="">Elegí de 1 a 10</option>{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} — {effortLabel(value)}</option>)}</select></label>
          <p className={styles.muted}>1–3 suave · 4–6 moderado · 7–8 intenso · 9–10 máximo</p>
          <label>Nota (opcional)<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} aria-describedby="note-help" /></label><small id="note-help">Hasta 2.000 caracteres. Podés anotar diferencias entre vueltas.</small>
        </fieldset>}
      </fieldset>
      <div className={styles.saveBar}><button className={styles.primary} type="submit" disabled={busy}>{busy ? "Guardando…" : uncertain ? "Reintentar guardado" : isSession ? "Guardar entrenamiento" : "Guardar rutina"}</button><button type="button" disabled={busy} onClick={() => setConfirm("close")}>Cancelar</button></div>
    </form>
  </section>;
}
export function BlockSummary({ blocks }: { blocks: TrainingBlock[] }) {
  return <ol className={styles.summary}>{blocks.map((block, index) => <li key={index}><strong>{block.name || `Bloque ${index + 1}`}</strong> · {block.rounds} {block.rounds === 1 ? "vuelta" : "vueltas"}<ul>{block.exercises.map((exercise, index) => <li key={index}>{exercise.name} · {exercise.mode === "time" ? formatDuration(exercise.seconds) : `${exercise.repetitions} repeticiones`}</li>)}</ul></li>)}</ol>;
}
