"use client";
import { Fragment, useRef, useState } from "react";
import Link from "next/link";
import { type LibraryWork, type WorkInput } from "@/lib/library/types";
import { codePointLength } from "@/lib/library/rules";
import { useDraft } from "./useDraft";
import { workFieldErrors, revalidateFieldErrors, type FieldErrors, type OperationIssue } from "@/lib/library/form-errors";
import FormIssue from "./FormIssue";
import { focusFirstInvalid } from "./formFocus";
import styles from "./library.module.css";

export default function WorkForm({ scope, work, busy, duplicates, issue, onIdentityChange, onSave, onCancel }: { scope: string; work?: LibraryWork; busy: boolean; duplicates: { id: string; title: string; archivedAt: string | null }[]; issue: OperationIssue | null; onIdentityChange: () => void; onSave: (input: WorkInput & { expectedVersion?: number; confirmDuplicate?: boolean }) => Promise<boolean>; onCancel: () => void }) {
  const { draft, setDraft, clearDraft, storageError } = useDraft(scope, { title: work?.title ?? "", kind: work?.kind ?? "movie", creator: work?.creator ?? "", year: work?.year?.toString() ?? "", referenceUrl: work?.referenceUrl ?? "", expectedVersion: work?.version ?? 0 });
  const form = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const updateDraft: typeof setDraft = (next) => { setDraft(next); setErrors(previous => Object.keys(previous).length ? revalidateFieldErrors(previous, workFieldErrors(next)) : previous); };
  const relevantIssue = issue?.path === (work ? `/${work.id}` : "") ? issue : null;
  const [detailsOpen, setDetailsOpen] = useState(() => !!(draft.creator || draft.year || draft.referenceUrl));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const input = () => ({ title: draft.title, kind: "movie" as const, creator: draft.creator || null, year: draft.year ? Number(draft.year) : null, referenceUrl: draft.referenceUrl || null, expectedVersion: draft.expectedVersion });
  const conflict = !!work && draft.expectedVersion !== work.version;
  const unavailable = relevantIssue?.code === "NOT_FOUND" || relevantIssue?.status === 404;
  const archived = relevantIssue?.code === "ARCHIVED" || !!work?.archivedAt;
  const blocked = unavailable || archived;
  const errorId = unavailable ? "work-unavailable" : archived ? "work-archived" : undefined;
  async function saveWork(confirmDuplicate = false) {
    if (busy || blocked || conflict) return;
    const nextErrors = workFieldErrors(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { focusFirstInvalid(form.current, nextErrors); return; }
    if (await onSave({ ...input(), ...(confirmDuplicate ? { confirmDuplicate: true } : {}) })) clearDraft();
  }
  const comparisonRows = work ? [
    { label: "Título", draft: draft.title || "Sin título", current: work.title },
    { label: "Dirección (director/a)", draft: draft.creator || "Sin dato", current: work.creator || "Sin dato" },
    { label: "Año", draft: draft.year || "Sin dato", current: work.year?.toString() || "Sin dato" },
    { label: "Enlace", draft: draft.referenceUrl || "Sin dato", current: work.referenceUrl || "Sin dato" },
  ].map((row) => ({ ...row, changed: row.draft !== row.current })) : [];
  return <form ref={form} noValidate className={styles.workForm} onSubmit={async (event) => { event.preventDefault(); await saveWork(); }}>
    <header className={styles.dialogHeader}><h2 id="work-dialog-title">{work ? "Editar datos" : "Agregar película"}</h2><p>{work ? "Actualizá los datos de este contenido." : "Escribí el título de la película. Lo demás es opcional."}</p></header>
    {storageError && <p className={styles.notice} role="status">No podemos conservar tu borrador al cerrar o recargar. Podés seguir completando y guardar desde acá.</p>}
    {blocked && <div className={styles.error} role="alert" id={errorId}>{unavailable ? "Este contenido ya no está disponible. Conservamos tu borrador." : "Este contenido está archivado. Restauralo desde el detalle para poder editarlo."}</div>}
    {!blocked && relevantIssue?.code !== "CONFLICT" && relevantIssue?.code !== "DUPLICATE" && <FormIssue disabled={busy} issue={relevantIssue} onRetry={() => form.current?.requestSubmit()} />}
    <fieldset disabled={busy || blocked} aria-describedby={errorId}>
      <div><label>Título<input name="title" autoFocus required aria-invalid={!!errors.title} value={draft.title} aria-describedby={`work-title-count${errors.title ? " work-error-title" : ""}`} onChange={(event) => { onIdentityChange(); updateDraft({ ...draft, title: event.target.value }); }} /></label><small id="work-title-count">{codePointLength(draft.title)}/200 caracteres</small>{errors.title && <small className={styles.fieldError} id="work-error-title">{errors.title}</small>}</div>
      <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}><summary>Agregar más detalles</summary>
        <div><label>Dirección (director/a)<input name="creator" aria-invalid={!!errors.creator} aria-describedby={errors.creator ? "work-error-creator" : undefined} maxLength={200} value={draft.creator} onChange={(event) => updateDraft({ ...draft, creator: event.target.value })} /></label>{errors.creator && <small className={styles.fieldError} id="work-error-creator">{errors.creator}</small>}</div>
        <div><label>Año de estreno<input name="year" aria-invalid={!!errors.year} aria-describedby={errors.year ? "work-error-year" : undefined} inputMode="numeric" type="number" min="1" max="9999" step="1" value={draft.year} onChange={(event) => updateDraft({ ...draft, year: event.target.value })} /></label>{errors.year && <small className={styles.fieldError} id="work-error-year">{errors.year}</small>}</div>
        <div><label>Enlace<input name="referenceUrl" aria-invalid={!!errors.referenceUrl} aria-describedby={errors.referenceUrl ? "work-error-referenceUrl" : undefined} type="url" maxLength={2048} value={draft.referenceUrl} onChange={(event) => updateDraft({ ...draft, referenceUrl: event.target.value })} /></label>{errors.referenceUrl && <small className={styles.fieldError} id="work-error-referenceUrl">{errors.referenceUrl}</small>}</div>
      </details>
      {conflict && work && <section className={styles.versionReview} aria-labelledby="version-review-title"><h3 id="version-review-title">El contenido cambió mientras lo editabas</h3><p>Revisá las diferencias antes de elegir qué guardar.</p><div className={styles.comparison}><strong>Dato</strong><strong>Tu borrador</strong><strong>Datos actuales</strong>
        {comparisonRows.map((row) => <Fragment key={row.label}><span className={row.changed ? styles.comparisonChanged : undefined}>{row.changed ? `${row.label} · cambió` : row.label}</span><span className={row.changed ? styles.comparisonChanged : undefined}>{row.draft}</span><span className={row.changed ? styles.comparisonChanged : undefined}>{row.current}</span></Fragment>)}
      </div><div className={styles.actions}><button type="button" onClick={() => { onIdentityChange(); updateDraft({ title: work.title, kind: work.kind, creator: work.creator ?? "", year: work.year?.toString() ?? "", referenceUrl: work.referenceUrl ?? "", expectedVersion: work.version }); }}>Usar datos actuales</button><button type="button" className={styles.primary} onClick={() => setDraft({ ...draft, expectedVersion: work.version })}>Revisé los cambios: conservar mi borrador</button></div></section>}
      {duplicates.length > 0 && <div className={styles.notice}><p>Ya hay algo parecido en la cinemateca. ¿Es alguno de estos contenidos?</p><ul>{duplicates.map((item) => <li key={item.id}><Link href={`/cinemateca/${item.id}`} target="_blank" rel="noopener noreferrer">{item.title}{item.archivedAt ? " (archivado)" : ""} (se abre en una pestaña nueva)</Link></li>)}</ul><button type="button" disabled={conflict} onClick={() => void saveWork(true)}>{work ? "Guardar de todos modos" : "Agregar de todos modos"}</button></div>}
    </fieldset>
    {confirmDiscard ? <div className={styles.discardConfirm} role="group" aria-label="Confirmar descarte"><p>¿Descartar lo que escribiste?</p><button type="button" autoFocus onClick={() => setConfirmDiscard(false)}>Seguir editando</button><button type="button" disabled={busy} onClick={() => { clearDraft(); setConfirmDiscard(false); onCancel(); }}>Descartar y cerrar</button></div> : <footer className={styles.dialogActions}>
      <button className={styles.primary} disabled={busy || blocked || conflict} type="submit">{busy ? "Guardando…" : work ? "Guardar cambios" : "Agregar película"}</button>
      <button type="button" disabled={busy} onClick={onCancel}>Cerrar</button>
      <button className={styles.discardButton} type="button" disabled={busy} onClick={() => setConfirmDiscard(true)}>Descartar borrador</button>
    </footer>}
  </form>;
}
