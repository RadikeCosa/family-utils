"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { KIND_LABELS, WORK_KINDS, type LibraryWork, type WorkInput } from "@/lib/library/types";
import { codePointLength } from "@/lib/library/rules";
import { useDraft } from "./useDraft";
import ChoiceChips, { type ChoiceOption } from "./ChoiceChips";
import styles from "./library.module.css";

const kindOptions: ChoiceOption[] = WORK_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }));
type OperationIssue = { code: string; status: number } | null;
export default function WorkForm({ scope, work, busy, duplicates, issue, onIdentityChange, onSave, onCancel }: { scope: string; work?: LibraryWork; busy: boolean; duplicates: { id: string; title: string; archivedAt: string | null }[]; issue: OperationIssue; onIdentityChange: () => void; onSave: (input: WorkInput & { expectedVersion?: number; confirmDuplicate?: boolean }) => Promise<boolean>; onCancel: () => void }) {
  const { draft, setDraft, clearDraft, storageError } = useDraft(scope, { title: work?.title ?? "", kind: work?.kind ?? "movie", creator: work?.creator ?? "", year: work?.year?.toString() ?? "", referenceUrl: work?.referenceUrl ?? "", expectedVersion: work?.version ?? 0 });
  const [detailsOpen, setDetailsOpen] = useState(() => !!(draft.creator || draft.year || draft.referenceUrl));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const input = () => ({ title: draft.title, kind: draft.kind, creator: draft.creator || null, year: draft.year ? Number(draft.year) : null, referenceUrl: draft.referenceUrl || null, expectedVersion: draft.expectedVersion });
  const conflict = !!work && draft.expectedVersion !== work.version;
  const unavailable = issue?.code === "NOT_FOUND" || issue?.status === 404;
  const archived = issue?.code === "ARCHIVED" || !!work?.archivedAt;
  const blocked = unavailable || archived;
  const errorId = unavailable ? "work-unavailable" : archived ? "work-archived" : undefined;
  const comparisonRows = work ? [
    { label: "Tipo", draft: KIND_LABELS[draft.kind], current: KIND_LABELS[work.kind] },
    { label: "Título", draft: draft.title || "Sin título", current: work.title },
    { label: "Autor o creador", draft: draft.creator || "Sin dato", current: work.creator || "Sin dato" },
    { label: "Año", draft: draft.year || "Sin dato", current: work.year?.toString() || "Sin dato" },
    { label: "Enlace", draft: draft.referenceUrl || "Sin dato", current: work.referenceUrl || "Sin dato" },
  ].map((row) => ({ ...row, changed: row.draft !== row.current })) : [];
  return <form className={styles.workForm} onSubmit={async (event) => { event.preventDefault(); if (!blocked && await onSave(input())) clearDraft(); }}>
    <header className={styles.dialogHeader}><p className={styles.eyebrow}>{work ? "BIBLIOTECA FAMILIAR" : "SUMAR ALGO QUE NOS GUSTA"}</p><h2 id="work-dialog-title">{work ? "Editar datos" : "Agregar a la biblioteca"}</h2><p>{work ? "Actualizá los datos de este contenido." : "Elegí el tipo y escribí el título. Lo demás es opcional."}</p></header>
    {storageError && <p className={styles.notice} role="status">No podemos conservar tu borrador al cerrar o recargar. Podés seguir completando y guardar desde acá.</p>}
    {blocked && <div className={styles.error} role="alert" id={errorId}>{unavailable ? "Este contenido ya no está disponible. Conservamos tu borrador." : "Este contenido está archivado. Restauralo desde el detalle para poder editarlo."}</div>}
    {issue && issue.code !== "CONFLICT" && !blocked && <p className={styles.error} role="alert">No pudimos guardar los cambios. Conservamos tu borrador. Revisá la conexión e intentá de nuevo.</p>}
    <fieldset disabled={busy || blocked} aria-describedby={errorId}>
      <ChoiceChips name="work-kind" legend="¿Qué querés agregar?" value={draft.kind} options={kindOptions} onChange={(kind) => { onIdentityChange(); setDraft({ ...draft, kind: kind as WorkInput["kind"] }); }} />
      <label>Título<input autoFocus required maxLength={200} value={draft.title} aria-describedby="work-title-count" onChange={(event) => { onIdentityChange(); setDraft({ ...draft, title: event.target.value }); }} /><small id="work-title-count">{codePointLength(draft.title)}/200 caracteres</small></label>
      <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}><summary>Agregar más detalles</summary>
        <label>Autor o creador<input maxLength={200} value={draft.creator} onChange={(event) => setDraft({ ...draft, creator: event.target.value })} /></label>
        <label>Año de publicación o estreno<input inputMode="numeric" type="number" min="1" max="9999" step="1" value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value })} /></label>
        <label>Enlace<input type="url" maxLength={2048} value={draft.referenceUrl} onChange={(event) => setDraft({ ...draft, referenceUrl: event.target.value })} /></label>
      </details>
      {conflict && work && <section className={styles.versionReview} aria-labelledby="version-review-title"><h3 id="version-review-title">El contenido cambió mientras lo editabas</h3><p>Revisá las diferencias antes de elegir qué guardar.</p><div className={styles.comparison}><strong>Dato</strong><strong>Tu borrador</strong><strong>Datos actuales</strong>
        {comparisonRows.map((row) => <Fragment key={row.label}><span className={row.changed ? styles.comparisonChanged : undefined}>{row.changed ? `${row.label} · cambió` : row.label}</span><span className={row.changed ? styles.comparisonChanged : undefined}>{row.draft}</span><span className={row.changed ? styles.comparisonChanged : undefined}>{row.current}</span></Fragment>)}
      </div><div className={styles.actions}><button type="button" onClick={() => { onIdentityChange(); setDraft({ title: work.title, kind: work.kind, creator: work.creator ?? "", year: work.year?.toString() ?? "", referenceUrl: work.referenceUrl ?? "", expectedVersion: work.version }); }}>Usar datos actuales</button><button type="button" className={styles.primary} onClick={() => setDraft({ ...draft, expectedVersion: work.version })}>Revisé los cambios: conservar mi borrador</button></div></section>}
      {duplicates.length > 0 && <div className={styles.notice}><p>Ya hay algo parecido en la biblioteca. ¿Es alguno de estos contenidos?</p><ul>{duplicates.map((item) => <li key={item.id}><Link href={`/biblioteca/${item.id}`} target="_blank" rel="noopener noreferrer">{item.title}{item.archivedAt ? " (archivado)" : ""} (se abre en una pestaña nueva)</Link></li>)}</ul><button type="button" disabled={conflict} onClick={async () => { if (await onSave({ ...input(), confirmDuplicate: true })) clearDraft(); }}>{work ? "Guardar de todos modos" : "Agregar de todos modos"}</button></div>}
    </fieldset>
    {confirmDiscard ? <div className={styles.discardConfirm} role="group" aria-label="Confirmar descarte"><p>¿Descartar lo que escribiste?</p><button type="button" autoFocus onClick={() => setConfirmDiscard(false)}>Seguir editando</button><button type="button" disabled={busy} onClick={() => { clearDraft(); setConfirmDiscard(false); onCancel(); }}>Descartar y cerrar</button></div> : <footer className={styles.dialogActions}>
      <button className={styles.primary} disabled={busy || blocked || conflict || codePointLength(draft.title.trim()) === 0 || codePointLength(draft.title.trim()) > 200} type="submit">{busy ? "Guardando…" : work ? "Guardar cambios" : "Agregar a la biblioteca"}</button>
      <button type="button" disabled={busy} onClick={onCancel}>Cerrar</button>
      <button className={styles.discardButton} type="button" disabled={busy} onClick={() => setConfirmDiscard(true)}>Descartar borrador</button>
    </footer>}
  </form>;
}
