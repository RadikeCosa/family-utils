"use client";
import type { TrainingBlock, TrainingExercise } from "@/lib/training/types";
import { LIMITS } from "@/lib/training/rules";
import styles from "./training.module.css";
const newExercise = (): TrainingExercise => ({ name: "", mode: "repetitions", repetitions: 0 });
const newBlock = (): TrainingBlock => ({ name: "", rounds: 1, exercises: [newExercise()] });
function move<T>(items: T[], index: number, delta: number): T[] { const next = [...items]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next; }
export default function BlockFields({ value, onChange }: { value: TrainingBlock[]; onChange: (blocks: TrainingBlock[]) => void }) {
  function update(index: number, patch: Partial<TrainingBlock>) { onChange(value.map((block, i) => i === index ? { ...block, ...patch } : block)); }
  function exercise(index: number, n: number, next: TrainingExercise) { update(index, { exercises: value[index].exercises.map((item, i) => i === n ? next : item) }); }
  return <div className={styles.fields}>{value.map((block, index) => <fieldset key={index} className={styles.block}><legend>Bloque {index + 1}</legend>
    <label>Nombre del bloque (opcional)<input maxLength={80} value={block.name} onChange={e => update(index, { name: e.target.value })} /></label>
    <label>Vueltas<input type="number" min="1" max={LIMITS.rounds} value={block.rounds || ""} onChange={e => update(index, { rounds: Number(e.target.value) })} /></label>
    <div className={styles.actions}><button type="button" disabled={index === 0} onClick={() => onChange(move(value, index, -1))}>Subir bloque {index + 1}</button><button type="button" disabled={index === value.length - 1} onClick={() => onChange(move(value, index, 1))}>Bajar bloque {index + 1}</button><button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>Quitar bloque {index + 1}</button></div>
    {block.exercises.map((item, n) => <fieldset className={styles.exercise} key={n}><legend>Ejercicio {n + 1}</legend>
      <label>Nombre del ejercicio<input maxLength={120} value={item.name} onChange={e => exercise(index, n, { ...item, name: e.target.value })} /></label>
      <div className={styles.row}><label>Medida<select value={item.mode} onChange={e => exercise(index, n, e.target.value === "time" ? { name: item.name, mode: "time", seconds: 0 } : { name: item.name, mode: "repetitions", repetitions: 0 })}><option value="repetitions">Repeticiones</option><option value="time">Tiempo</option></select></label>
      <label>{item.mode === "time" ? "Tiempo por vuelta (segundos)" : "Repeticiones por vuelta"}<input type="number" min="1" max={item.mode === "time" ? LIMITS.seconds : LIMITS.repetitions} value={(item.mode === "time" ? item.seconds : item.repetitions) || ""} onChange={e => exercise(index, n, item.mode === "time" ? { ...item, seconds: Number(e.target.value) } : { ...item, repetitions: Number(e.target.value) })} /></label></div>
      <div className={styles.actions}><button type="button" aria-label={`Subir ejercicio ${n + 1} del bloque ${index + 1}`} disabled={!n} onClick={() => update(index, { exercises: move(block.exercises, n, -1) })}>Subir ejercicio {n + 1}</button><button type="button" aria-label={`Bajar ejercicio ${n + 1} del bloque ${index + 1}`} disabled={n === block.exercises.length - 1} onClick={() => update(index, { exercises: move(block.exercises, n, 1) })}>Bajar ejercicio {n + 1}</button><button type="button" onClick={() => update(index, { exercises: block.exercises.filter((_, i) => i !== n) })}>Quitar ejercicio {n + 1}</button></div>
    </fieldset>)}<button type="button" disabled={block.exercises.length >= LIMITS.exercises} onClick={() => update(index, { exercises: [...block.exercises, newExercise()] })}>Agregar ejercicio al bloque {index + 1}</button>
  </fieldset>)}<button type="button" disabled={value.length >= LIMITS.blocks} onClick={() => onChange([...value, newBlock()])}>Agregar bloque</button></div>;
}
