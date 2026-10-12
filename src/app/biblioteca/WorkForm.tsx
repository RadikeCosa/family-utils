"use client";
import { KIND_LABELS, WORK_KINDS, type LibraryWork, type WorkInput } from "@/lib/library/types";
import { codePointLength } from "@/lib/library/rules";
import { useDraft } from "./useDraft";
import styles from "./library.module.css";
export default function WorkForm({ scope, work, busy, onSave, onCancel }: { scope: string; work?: LibraryWork; busy: boolean; onSave: (input: WorkInput) => Promise<boolean>; onCancel: () => void }) {
  const { draft, setDraft, clearDraft, storageError } = useDraft(scope, { title: work?.title ?? "", kind: work?.kind ?? "movie", creator: work?.creator ?? "", year: work?.year?.toString() ?? "", referenceUrl: work?.referenceUrl ?? "" });
  return <form onSubmit={async (event) => { event.preventDefault(); if (await onSave({ title: draft.title, kind: draft.kind, creator: draft.creator || null, year: draft.year ? Number(draft.year) : null, referenceUrl: draft.referenceUrl || null })) clearDraft(); }}>
    <fieldset disabled={busy}>
      <legend>{work ? "Editar ficha" : "Agregar una obra"}</legend>
      <label>Título<input autoFocus required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><small>{codePointLength(draft.title)}/200 caracteres</small></label>
      <label>Tipo de obra<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as WorkInput["kind"] })}>{WORK_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}</select></label>
      <details><summary>Datos opcionales</summary>
        <label>Autor o creador<input value={draft.creator} onChange={(event) => setDraft({ ...draft, creator: event.target.value })} /></label>
        <label>Año<input inputMode="numeric" type="number" min="1" max="9999" step="1" value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value })} /></label>
        <label>Enlace de referencia<input type="url" value={draft.referenceUrl} onChange={(event) => setDraft({ ...draft, referenceUrl: event.target.value })} /></label>
      </details>
      {storageError && <p role="status">El borrador se conserva solo mientras esta pantalla siga abierta.</p>}
      <div className={styles.actions}><button className={styles.primary} disabled={codePointLength(draft.title.trim()) > 200} type="submit">{busy ? "Guardando…" : "Guardar ficha"}</button><button type="button" onClick={() => { clearDraft(); onCancel(); }}>Descartar</button></div>
    </fieldset>
  </form>;
}
