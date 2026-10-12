"use client";
import Link from "next/link";
import { KIND_LABELS, WORK_KINDS, type LibraryWork, type WorkInput } from "@/lib/library/types";
import { codePointLength } from "@/lib/library/rules";
import { useDraft } from "./useDraft";
import styles from "./library.module.css";
export default function WorkForm({ scope, work, busy, duplicates, onIdentityChange, onSave, onCancel }: { scope: string; work?: LibraryWork; busy: boolean; duplicates: { id: string; title: string; archivedAt: string | null }[]; onIdentityChange: () => void; onSave: (input: WorkInput & { expectedVersion?: number; confirmDuplicate?: boolean }) => Promise<boolean>; onCancel: () => void }) {
  const { draft, setDraft, clearDraft, storageError } = useDraft(scope, { title: work?.title ?? "", kind: work?.kind ?? "movie", creator: work?.creator ?? "", year: work?.year?.toString() ?? "", referenceUrl: work?.referenceUrl ?? "", expectedVersion: work?.version ?? 0 });
  const input = () => ({ title: draft.title, kind: draft.kind, creator: draft.creator || null, year: draft.year ? Number(draft.year) : null, referenceUrl: draft.referenceUrl || null, expectedVersion: draft.expectedVersion });
  const conflict = !!work && draft.expectedVersion !== work.version;
  return <form onSubmit={async (event) => { event.preventDefault(); if (await onSave(input())) clearDraft(); }}>
    <fieldset disabled={busy}>
      <legend>{work ? "Editar ficha" : "Agregar una obra"}</legend>
      <label>Título<input autoFocus required value={draft.title} onChange={(event) => { onIdentityChange(); setDraft({ ...draft, title: event.target.value }); }} /><small>{codePointLength(draft.title)}/200 caracteres</small></label>
      <label>Tipo de obra<select value={draft.kind} onChange={(event) => { onIdentityChange(); setDraft({ ...draft, kind: event.target.value as WorkInput["kind"] }); }}>{WORK_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}</select></label>
      <details><summary>Datos opcionales</summary>
        <label>Autor o creador<input value={draft.creator} onChange={(event) => setDraft({ ...draft, creator: event.target.value })} /></label>
        <label>Año<input inputMode="numeric" type="number" min="1" max="9999" step="1" value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value })} /></label>
        <label>Enlace de referencia<input type="url" value={draft.referenceUrl} onChange={(event) => setDraft({ ...draft, referenceUrl: event.target.value })} /></label>
      </details>
      {storageError && <p role="status">El borrador se conserva solo mientras esta pantalla siga abierta.</p>}
      {conflict && <div className={styles.notice}><p>La ficha cambió. Datos actuales: {work?.title}, {work?.creator || "sin creador"}, {work?.year || "sin año"}, {work ? KIND_LABELS[work.kind] : ""}, {work?.referenceUrl || "sin enlace"}.</p><button type="button" onClick={() => setDraft({ ...draft, expectedVersion: work!.version })}>Revisé los cambios: habilitar reintento</button></div>}
      {duplicates.length > 0 && <div className={styles.notice}><p>¿Es alguna de estas obras?</p><ul>{duplicates.map((item) => <li key={item.id}><Link href={`/biblioteca/${item.id}`}>{item.title}{item.archivedAt ? " (archivada)" : ""}</Link></li>)}</ul><button type="button" disabled={conflict} onClick={async () => { if (await onSave({ ...input(), confirmDuplicate: true })) clearDraft(); }}>Es otra obra: guardar igualmente</button></div>}
      <div className={styles.actions}><button className={styles.primary} disabled={conflict || codePointLength(draft.title.trim()) > 200} type="submit">{busy ? "Guardando…" : "Guardar ficha"}</button><button type="button" onClick={() => { clearDraft(); onCancel(); }}>Descartar</button></div>
    </fieldset>
  </form>;
}
