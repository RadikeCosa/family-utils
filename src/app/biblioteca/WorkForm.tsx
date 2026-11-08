"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { type LibraryWork, type WorkInput } from "@/lib/library/types";
import { codePointLength } from "@/lib/library/rules";
import { appendCast, MAX_SYNOPSIS_LENGTH, movieTextLength, normalizeSynopsis } from "@/lib/library/movie-metadata";
import { useDraft } from "./useDraft";
import { workFieldErrors, revalidateFieldErrors, type FieldErrors, type OperationIssue } from "@/lib/library/form-errors";
import FormIssue from "./FormIssue";
import { focusFirstInvalid } from "./formFocus";
import { genreLabels } from "@/lib/library/genres";
import GenresField from "./GenresField";
import CastField from "./CastField";
import LimitCounter from "./LimitCounter";
import Runtime from "./Runtime";
import WorkConflictReview from "./WorkConflictReview";
import styles from "./library.module.css";

function initialDraft(work?: LibraryWork) {
  return { title: work?.title ?? "", kind: work?.kind ?? "movie", genres: work?.genres ?? [], creator: work?.creator ?? "", year: work?.year?.toString() ?? "", runtimeMinutes: work?.runtimeMinutes?.toString() ?? "", cast: work?.cast ?? [], castPending: "", synopsis: work?.synopsis ?? "", expectedVersion: work?.version ?? 0 };
}
export default function WorkForm({ scope, work, busy, duplicates, issue, onIdentityChange, onSave, onCancel }: { scope: string; work?: LibraryWork; busy: boolean; duplicates: { id: string; title: string; archivedAt: string | null }[]; issue: OperationIssue | null; onIdentityChange: () => void; onSave: (input: WorkInput & { expectedVersion?: number; confirmDuplicate?: boolean }) => Promise<boolean>; onCancel: () => void }) {
  const initial = initialDraft(work);
  const { draft, setDraft, clearDraft, storageError } = useDraft(scope, initial);
  const form = useRef<HTMLFormElement>(null), discardButton = useRef<HTMLButtonElement>(null), keepEditing = useRef<HTMLButtonElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [castNotice, setCastNotice] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = Object.keys(initial).some(key => key !== "expectedVersion" && JSON.stringify(draft[key as keyof typeof draft]) !== JSON.stringify(initial[key as keyof typeof initial]));
  const updateDraft: typeof setDraft = next => { setDraft(next); setErrors(previous => Object.keys(previous).length ? revalidateFieldErrors(previous, workFieldErrors(next)) : previous); };
  const relevantIssue = issue?.path === (work ? `/${work.id}` : "") ? issue : null;
  const conflict = !!work && draft.expectedVersion !== work.version;
  const cast = appendCast(draft.cast, draft.castPending);
  const unavailable = relevantIssue?.code === "NOT_FOUND" || relevantIssue?.status === 404;
  const archived = relevantIssue?.code === "ARCHIVED" || !!work?.archivedAt;
  const blocked = unavailable || archived;
  const errorId = unavailable ? "work-unavailable" : archived ? "work-archived" : undefined;
  useEffect(() => { if (confirmDiscard) keepEditing.current?.focus(); }, [confirmDiscard]);
  function applyCast() {
    if (cast.error) { setErrors(previous => ({ ...previous, castPending: cast.error! })); return; }
    updateDraft({ ...draft, cast: cast.names, castPending: "" });
    setCastNotice(cast.duplicates ? `Se ${cast.duplicates === 1 ? "omitió" : "omitieron"} ${cast.duplicates} ${cast.duplicates === 1 ? "nombre duplicado" : "nombres duplicados"}.` : "Nombres agregados al reparto.");
  }
  async function saveWork(confirmDuplicate = false) {
    if (busy || blocked || conflict) return;
    const nextErrors = workFieldErrors(draft);
    setErrors(nextErrors); setValidationAttempt(value => value + 1);
    if (Object.keys(nextErrors).length) { focusFirstInvalid(form.current, nextErrors); return; }
    setDraft({ ...draft, cast: cast.names, castPending: "" });
    const input = { title: draft.title, kind: "movie" as const, genres: draft.genres, creator: draft.creator || null, year: draft.year ? Number(draft.year) : null, runtimeMinutes: draft.runtimeMinutes ? Number(draft.runtimeMinutes) : null, cast: cast.names, synopsis: normalizeSynopsis(draft.synopsis) || null, referenceUrl: work?.referenceUrl ?? null, expectedVersion: draft.expectedVersion };
    if (await onSave({ ...input, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) })) clearDraft();
  }
  const comparisonRows = work ? [
    { label: "Título", draft: draft.title, current: work.title },
    { label: "Director/a", draft: draft.creator, current: work.creator ?? "" },
    { label: "Año", draft: draft.year, current: work.year?.toString() ?? "" },
    { label: "Duración (minutos)", draft: draft.runtimeMinutes, current: work.runtimeMinutes?.toString() ?? "" },
    { label: "Géneros", draft: genreLabels(draft.genres), current: genreLabels(work.genres) },
    { label: "Reparto", draft: cast.names, current: work.cast },
    { label: "Sinopsis", draft: normalizeSynopsis(draft.synopsis), current: work.synopsis ?? "" },
  ].filter(row => JSON.stringify(row.draft) !== JSON.stringify(row.current)) : [];
  return <form ref={form} noValidate className={styles.workForm} onSubmit={async event => { event.preventDefault(); await saveWork(); }}>
    <header className={styles.dialogHeader}><h2 id="work-dialog-title" tabIndex={-1} autoFocus>{work ? "Editar datos" : "Agregar película"}</h2><p>Solo el título es obligatorio.</p></header>
    {storageError && <p className={styles.notice} role="status">No podemos conservar tu borrador al cerrar o recargar. Podés seguir completando y guardar desde acá.</p>}
    {blocked && <div className={styles.error} role="alert" id={errorId}>{unavailable ? "Este contenido ya no está disponible. Conservamos tu borrador." : "Este contenido está archivado. Restauralo desde el detalle para poder editarlo."}</div>}
    {!blocked && relevantIssue?.code !== "CONFLICT" && relevantIssue?.code !== "DUPLICATE" && <FormIssue disabled={busy} issue={relevantIssue} onRetry={() => form.current?.requestSubmit()} />}
    {Object.keys(errors).length > 0 && <p key={validationAttempt} className={styles.error} role="alert">Revisá {Object.keys(errors).length === 1 ? "el campo indicado" : "los campos indicados"} antes de guardar.</p>}
    <fieldset disabled={busy || blocked} aria-describedby={errorId}>
      <legend>Datos principales</legend>
      <div><label>Título<input name="title" required aria-invalid={!!errors.title} value={draft.title} aria-describedby={`work-title-count${errors.title ? " work-error-title" : ""}`} onChange={event => { onIdentityChange(); updateDraft({ ...draft, title: event.target.value }); }} /></label><LimitCounter id="work-title-count" count={codePointLength(draft.title.trim())} limit={200} label="Título" />{errors.title && <small className={styles.fieldError} id="work-error-title">{errors.title}</small>}</div>
      <div><label>Director/a<input name="creator" aria-invalid={!!errors.creator} aria-describedby={errors.creator ? "work-error-creator" : undefined} value={draft.creator} onChange={event => updateDraft({ ...draft, creator: event.target.value })} /></label>{errors.creator && <small className={styles.fieldError} id="work-error-creator">{errors.creator}</small>}</div>
      <div className={styles.movieMetadata}>
        <div><label>Año de estreno<input name="year" aria-invalid={!!errors.year} aria-describedby={errors.year ? "work-error-year" : undefined} inputMode="numeric" type="number" min="1" max="9999" step="1" value={draft.year} onChange={event => updateDraft({ ...draft, year: event.target.value })} /></label>{errors.year && <small className={styles.fieldError} id="work-error-year">{errors.year}</small>}</div>
        <div><label>Duración (minutos)<input name="runtimeMinutes" aria-invalid={!!errors.runtimeMinutes} aria-describedby={`work-runtime-help${errors.runtimeMinutes ? " work-error-runtimeMinutes" : ""}`} inputMode="numeric" type="number" min="1" max="1440" step="1" placeholder="Ej.: 148" value={draft.runtimeMinutes} onChange={event => updateDraft({ ...draft, runtimeMinutes: event.target.value })} /></label><small id="work-runtime-help">{Number.isInteger(Number(draft.runtimeMinutes)) && Number(draft.runtimeMinutes) > 0 && Number(draft.runtimeMinutes) <= 1440 ? <Runtime minutes={Number(draft.runtimeMinutes)} /> : "Entre 1 y 1440 minutos."}</small>{errors.runtimeMinutes && <small className={styles.fieldError} id="work-error-runtimeMinutes">{errors.runtimeMinutes}</small>}</div>
      </div>
      <GenresField value={draft.genres} onChange={genres => updateDraft({ ...draft, genres })} />
      <details className={styles.moreMovieData}>
        <summary>Sinopsis y reparto <svg className={styles.disclosureArrow} aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></summary>
        <div className={styles.optionalMovieData}>
          <div><label>Sinopsis<textarea name="synopsis" value={draft.synopsis} aria-invalid={!!errors.synopsis} aria-describedby={`work-synopsis-help work-synopsis-count${errors.synopsis ? " work-error-synopsis" : ""}`} onChange={event => updateDraft({ ...draft, synopsis: event.target.value })} /></label><small id="work-synopsis-help">Contá brevemente de qué trata, sin revelar sorpresas.</small><LimitCounter id="work-synopsis-count" count={movieTextLength(normalizeSynopsis(draft.synopsis))} limit={MAX_SYNOPSIS_LENGTH} label="Sinopsis" />{errors.synopsis && <small className={styles.fieldError} id="work-error-synopsis">{errors.synopsis}</small>}</div>
          <CastField names={draft.cast} pending={draft.castPending} error={errors.castPending ?? (conflict ? cast.error ?? undefined : undefined)} notice={castNotice} onPending={value => { setCastNotice(""); updateDraft({ ...draft, castPending: value }); }} onAdd={applyCast} onRemove={index => { setCastNotice(""); updateDraft({ ...draft, cast: draft.cast.filter((_, position) => position !== index) }); }} />
        </div>
      </details>
      {conflict && work && <WorkConflictReview rows={comparisonRows} invalidCast={!!cast.error} onCurrent={() => { onIdentityChange(); setDraft(initialDraft(work)); setErrors({}); setCastNotice(""); }} onDraft={() => { setDraft({ ...draft, cast: cast.names, castPending: "", expectedVersion: work.version }); setCastNotice(cast.duplicates ? `Se ${cast.duplicates === 1 ? "omitió" : "omitieron"} ${cast.duplicates} ${cast.duplicates === 1 ? "nombre duplicado" : "nombres duplicados"}.` : ""); }} />}
      {duplicates.length > 0 && <div className={styles.notice}><p>Ya hay algo parecido en la cinemateca. ¿Es alguno de estos contenidos?</p><ul>{duplicates.map(item => <li key={item.id}><Link href={`/cinemateca/${item.id}`} target="_blank" rel="noopener noreferrer">{item.title}{item.archivedAt ? " (archivado)" : ""} (se abre en una pestaña nueva)</Link></li>)}</ul><button type="button" disabled={conflict} onClick={() => void saveWork(true)}>{work ? "Guardar de todos modos" : "Agregar de todos modos"}</button></div>}
    </fieldset>
    {dirty && !confirmDiscard && <button ref={discardButton} className={styles.discardButton} type="button" disabled={busy} onClick={() => setConfirmDiscard(true)}>Descartar borrador</button>}
    {confirmDiscard ? <div className={styles.discardConfirm} role="group" aria-label="Confirmar descarte"><p>¿Descartar lo que escribiste?</p><button ref={keepEditing} type="button" onClick={() => { setConfirmDiscard(false); requestAnimationFrame(() => discardButton.current?.focus()); }}>Seguir editando</button><button type="button" disabled={busy} onClick={() => { clearDraft(); setConfirmDiscard(false); onCancel(); }}>Descartar y cerrar</button></div> : <footer className={styles.dialogActions}>
      <button className={styles.primary} disabled={busy || blocked || conflict} type="submit">{busy ? "Guardando…" : work ? "Guardar cambios" : "Agregar película"}</button>
      <button type="button" disabled={busy} onClick={onCancel}>Cerrar</button>
    </footer>}
  </form>;
}
