"use client";
import { useId, useRef, useState } from "react";
import { codePointLength } from "@/lib/library/rules";
import type { Contribution, LibraryDetail } from "@/lib/library/types";
import { contributionFieldErrors, revalidateFieldErrors, type FieldErrors, type OperationIssue } from "@/lib/library/form-errors";
import FormIssue from "./FormIssue";
import { focusFirstInvalid } from "./formFocus";
import CompanionsField from "./CompanionsField";
import { useDraft } from "./useDraft";
import styles from "./library.module.css";
type Save = (path: string, method: string, input: Record<string, unknown>) => Promise<{ id: string } | null>;
function ContributionForm({ data, entry, busy, save, close, issue }: { data: LibraryDetail; entry?: Contribution; busy: boolean; issue: OperationIssue | null; save: Save; close: () => void }) {
  const { draft, setDraft, clearDraft, storageError } = useDraft(`${data.familyId}:${data.currentMemberId}:${data.work.id}:${entry?.id ?? "new"}:contribution`, {
    body: entry?.body ?? "", spoiler: entry?.spoiler ?? false, year: entry?.experience.year?.toString() ?? "", month: entry?.experience.month?.toString() ?? "", day: entry?.experience.day?.toString() ?? "", companionIds: entry?.companionIds ?? [] as string[], expectedVersion: entry?.version ?? 0 });
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const updateDraft: typeof setDraft = (next) => { setDraft(next); setErrors(previous => Object.keys(previous).length ? revalidateFieldErrors(previous, contributionFieldErrors(next)) : previous); };
  const path = `/${data.work.id}/contributions${entry ? `/${entry.id}` : ""}`;
  const relevantIssue = issue?.path === path ? issue : null;
  const conflict = !!entry && draft.expectedVersion !== entry.version;
  return <form ref={form} noValidate onSubmit={async (event) => { event.preventDefault(); const nextErrors = contributionFieldErrors(draft); setErrors(nextErrors); if (Object.keys(nextErrors).length) { focusFirstInvalid(form.current, nextErrors); return; } if (conflict) return;
    const result = await save(`/${data.work.id}/contributions${entry ? `/${entry.id}` : ""}`, entry ? "PATCH" : "POST", { body: draft.body, spoiler: draft.spoiler, experience: { year: draft.year ? Number(draft.year) : null, month: draft.month ? Number(draft.month) : null, day: draft.day ? Number(draft.day) : null }, companionIds: draft.companionIds, expectedVersion: draft.expectedVersion, ...(entry ? { action: "edit" } : {}) });
    if (result) { clearDraft(); close(); }
  }}><fieldset disabled={busy || !!data.work.archivedAt}>
    <legend>{entry ? "Editar mi aporte" : "Compartir un recuerdo o una mirada"}</legend>
    <label htmlFor={`${formId}-body`}>Tu aporte</label><textarea name="body" aria-invalid={!!errors.body} id={`${formId}-body`} rows={6} value={draft.body} onChange={(event) => updateDraft({ ...draft, body: event.target.value })} required aria-describedby={`${formId}-length${errors.body ? ` ${formId}-error-body` : ""}`} /><p id={`${formId}-length`}>{codePointLength(draft.body)} / 5.000 caracteres</p>{errors.body && <p className={styles.fieldError} id={`${formId}-error-body`}>{errors.body}</p>}
    <label className={styles.check}><input type="checkbox" checked={draft.spoiler} onChange={(event) => updateDraft({ ...draft, spoiler: event.target.checked })} />Contiene spoilers</label>
    <fieldset><legend>Fecha de la experiencia (opcional)</legend><p>Completá solo lo que recuerdes: año, año y mes, o fecha completa.</p><div className={styles.dateFields}>
      <div><label>Año<input name="year" aria-invalid={!!errors.year} aria-describedby={errors.year ? `${formId}-error-year` : undefined} type="number" min="1" max="9999" inputMode="numeric" value={draft.year} onChange={(event) => updateDraft({ ...draft, year: event.target.value, ...(!event.target.value ? { month: "", day: "" } : {}) })} /></label>{errors.year && <small className={styles.fieldError} id={`${formId}-error-year`}>{errors.year}</small>}</div>
      <div><label>Mes<select name="month" aria-invalid={!!errors.month} aria-describedby={errors.month ? `${formId}-error-month` : undefined} disabled={!draft.year} value={draft.month} onChange={(event) => updateDraft({ ...draft, month: event.target.value, ...(!event.target.value ? { day: "" } : {}) })}><option value="">No recuerdo</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i+1}>{new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000,i,1)))}</option>)}</select></label>{errors.month && <small className={styles.fieldError} id={`${formId}-error-month`}>{errors.month}</small>}</div>
      <div><label>Día<input name="day" aria-invalid={!!errors.day} aria-describedby={errors.day ? `${formId}-error-day` : undefined} type="number" min="1" max="31" inputMode="numeric" disabled={!draft.month} value={draft.day} onChange={(event) => updateDraft({ ...draft, day: event.target.value })} /></label>{errors.day && <small className={styles.fieldError} id={`${formId}-error-day`}>{errors.day}</small>}</div>
    </div></fieldset>
    <CompanionsField members={data.members} selected={draft.companionIds} onChange={(companionIds) => updateDraft({ ...draft, companionIds })} />
    {conflict && <div className={styles.notice}><p>Este aporte cambió. Versión guardada:</p><p className={styles.body}>{entry.body}</p><button type="button" onClick={() => updateDraft({ ...draft, expectedVersion: entry.version })}>Revisé el aporte: habilitar reintento</button></div>}
    <FormIssue issue={relevantIssue} onRetry={() => form.current?.requestSubmit()} />
    <div className={styles.actions}><button className={styles.primary} type="submit" disabled={conflict}>{entry ? "Guardar aporte" : "Publicar aporte"}</button><button type="button" onClick={() => { clearDraft(); close(); }}>Descartar borrador</button></div>
  </fieldset>{storageError && <p role="status">No pudimos guardar el borrador en este dispositivo. Conservá esta pantalla abierta.</p>}</form>;
}
function ContributionCard({ entry, data, busy, save, issue }: { entry: Contribution; data: LibraryDetail; busy: boolean; save: Save; issue: OperationIssue | null }) {
  const [revealed, setRevealed] = useState(false), [editing, setEditing] = useState(false);
  const name = (id: string) => data.members.find((member) => member.id === id)?.name ?? "Integrante";
  const date = [entry.experience.day, entry.experience.month, entry.experience.year].filter((value) => value !== null).join("/");
  const mine = entry.authorMemberId === data.currentMemberId;
  return <li className={styles.card}><h3>{name(entry.authorMemberId)}</h3><p>Publicado el {new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(entry.createdAt))}</p>{date && <p>Experiencia: {date}</p>}{entry.companionIds.length > 0 && <p>Con {entry.companionIds.map(name).join(", ")}</p>}
    {entry.spoiler && <button aria-expanded={revealed} aria-controls={`spoiler-${entry.id}`} onClick={() => setRevealed(!revealed)}>{revealed ? "Ocultar spoiler" : "Mostrar spoiler"}</button>}
    <div id={`spoiler-${entry.id}`} hidden={entry.spoiler && !revealed}><p className={styles.body}>{entry.body}</p></div>
    {!editing && issue?.path === `/${data.work.id}/contributions/${entry.id}` && <FormIssue issue={issue} />}
    {mine && <div className={styles.actions}>{!data.work.archivedAt && <button disabled={busy} onClick={() => setEditing(!editing)}>Editar mi aporte</button>}<button disabled={busy} onClick={async () => { if (window.confirm("¿Retirar tu aporte? Dejará de verse y no podrá restaurarse desde la app.")) await save(`/${data.work.id}/contributions/${entry.id}`, "PATCH", { action: "retire", expectedVersion: entry.version }); }}>Retirar aporte</button></div>}
    {editing && !data.work.archivedAt && <ContributionForm issue={issue} data={data} entry={entry} busy={busy} save={save} close={() => setEditing(false)} />}
  </li>;
}
export default function Contributions({ data, busy, loading, save, more, issue }: { data: LibraryDetail; busy: boolean; issue: OperationIssue | null; loading: boolean; save: Save; more: () => Promise<void> }) {
  return <section><h2>Aportes y recuerdos</h2>
    {data.contributions.length ? <ul className={styles.contributions}>{data.contributions.map((entry) => <ContributionCard issue={issue} key={entry.id} entry={entry} data={data} busy={busy} save={save} />)}</ul> : <p>Todavía no hay aportes. Cada mirada tiene su lugar.</p>}
    {data.nextCursor && <button disabled={loading} onClick={() => void more()}>{loading ? "Cargando…" : "Cargar más aportes"}</button>}
  </section>;
}

export function NewContribution({ data, busy, save, issue }: { data: LibraryDetail; busy: boolean; save: Save; issue: OperationIssue | null }) {
  const [generation, setGeneration] = useState(0);
  if (data.work.archivedAt) return null;
  return <section data-ui-surface className={styles.card}><ContributionForm issue={issue} key={`${data.familyId}:${data.currentMemberId}:${data.work.id}:new:${generation}`} data={data} busy={busy} save={save} close={() => setGeneration((current) => current + 1)} /></section>;
}
