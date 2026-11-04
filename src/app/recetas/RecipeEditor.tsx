"use client";
import { useRef, useState } from "react";
import type { RecipeDraft } from "@/lib/recipes/types";
import { draftText } from "@/lib/recipes/rules";
import styles from "./recipes.module.css";
export default function RecipeEditor({ initial, busy, onSave, onCancel, onServer }: { initial: RecipeDraft; busy: boolean; onSave: (draft: RecipeDraft) => Promise<void>; onCancel: () => void; onServer: () => Promise<void> }) {
  const [draft, setDraft] = useState<RecipeDraft>(() => structuredClone(initial)), [notice, setNotice] = useState("");
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  function move(index: number, step: number) {
    const rows = [...draft.ingredients], target = index + step, id = rows[index].id;
    [rows[index], rows[target]] = [rows[target], rows[index]]; setDraft({ ...draft, ingredients: rows });
    setNotice(`${rows[target].name || "Ingrediente"}, posición ${target + 1} de ${rows.length}.`);
    requestAnimationFrame(() => buttons.current.get(id)?.focus());
  }
  async function copy() { try { await navigator.clipboard.writeText(draftText(draft)); setNotice("Borrador copiado."); } catch { setNotice("No se pudo copiar. Seleccioná el texto del borrador que aparece abajo."); } }
  return <form className={styles.form} onSubmit={e => { e.preventDefault(); void onSave(draft); }}>
    <fieldset disabled={busy} className={styles.form}><legend>Editar receta</legend>
      <label>Nombre<input required maxLength={160} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>Nota opcional<textarea maxLength={1000} rows={2} value={draft.note ?? ""} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
      <label>Porciones o rendimiento<input maxLength={100} value={draft.yieldText ?? ""} onChange={e => setDraft({ ...draft, yieldText: e.target.value })} placeholder="Por ejemplo, 4 personas" /></label>
      <h2>Ingredientes</h2><ol className={styles.ingredients}>{draft.ingredients.map((row, index) => <li className={styles.ingredient} key={row.id}>
        <div className={styles.fields}><label>Ingrediente {index + 1}<input required maxLength={160} value={row.name} onChange={e => setDraft({ ...draft, ingredients: draft.ingredients.map(i => i.id === row.id ? { ...i, name: e.target.value } : i) })} /></label><label>Cantidad {index + 1}<input maxLength={100} value={row.quantity ?? ""} onChange={e => setDraft({ ...draft, ingredients: draft.ingredients.map(i => i.id === row.id ? { ...i, quantity: e.target.value } : i) })} /></label></div>
        <div className={styles.actions}><button type="button" ref={element => { if (element) buttons.current.set(row.id, element); else buttons.current.delete(row.id); }} aria-label={`Subir ingrediente ${index + 1}`} aria-disabled={index === 0} onClick={() => { if (index > 0) move(index, -1); }}>Subir</button><button type="button" aria-label={`Bajar ingrediente ${index + 1}`} aria-disabled={index === draft.ingredients.length - 1} onClick={() => { if (index < draft.ingredients.length - 1) move(index, 1); }}>Bajar</button><button type="button" aria-label={`Quitar ingrediente ${index + 1}`} onClick={() => setDraft({ ...draft, ingredients: draft.ingredients.filter(i => i.id !== row.id) })}>Quitar</button></div>
      </li>)}</ol>
      <button type="button" disabled={draft.ingredients.length >= 100} onClick={() => setDraft({ ...draft, ingredients: [...draft.ingredients, { id: crypto.randomUUID(), name: "", quantity: null }] })}>Agregar ingrediente</button>
      <label>Preparación<textarea rows={10} maxLength={20000} value={draft.preparation ?? ""} onChange={e => setDraft({ ...draft, preparation: e.target.value })} /></label>
    </fieldset>
    <p role="status" aria-live="polite">{notice}</p>
    <div className={styles.actions}><button className={styles.primary} disabled={busy}>{busy ? "Guardando…" : "Guardar receta"}</button><button type="button" disabled={busy} onClick={onCancel}>Descartar borrador</button><button type="button" onClick={() => void copy()}>Copiar borrador</button><button type="button" disabled={busy} onClick={() => void onServer()}>Consultar versión actual</button></div>
    <details><summary>Texto del borrador para copiar</summary><pre className={styles.preparation}>{draftText(draft)}</pre></details>
  </form>;
}
