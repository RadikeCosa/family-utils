"use client";
import { useId, useRef, useState } from "react";
import { PERSONAL_STATUSES, STATUS_LABELS, type LibraryWork, type PersonalStatus } from "@/lib/library/types";
import type { OperationIssue } from "@/lib/library/form-errors";
import FormIssue from "./FormIssue";
import ChoiceChips from "./ChoiceChips";
import RatingField from "./RatingField";
import { useDraft } from "./useDraft";
import styles from "./library.module.css";
export default function PersonalForm({ work, familyId, memberId, busy, issue, onSave }: { work: LibraryWork; familyId: string; memberId: string; busy: boolean; issue: OperationIssue | null; onSave: (input: { status: PersonalStatus | null; rating: number | null; expectedVersion: number }) => Promise<boolean> }) {
  const form = useRef<HTMLFormElement>(null);
  const statusName = useId();
  const relevantIssue = issue?.path === `/${work.id}/personal` ? issue : null;
  const mine = work.personal.find((entry) => entry.memberId === memberId);
  const { draft, setDraft, clearDraft, storageError } = useDraft(`${familyId}:${memberId}:${work.id}:personal`, { status: mine?.status ?? "", rating: mine?.rating?.toString() ?? "", expectedVersion: mine?.version ?? 0 });
  const conflict = draft.expectedVersion !== (mine?.version ?? 0);
  const [notice, setNotice] = useState("");
  const dirty = draft.status !== (mine?.status ?? "") || draft.rating !== (mine?.rating?.toString() ?? "");
  return <section className={styles.card}><h2>Mi estado y valoración</h2><form ref={form} onSubmit={async (event) => { event.preventDefault(); if (busy || conflict || work.archivedAt) return; if (await onSave({ status: (draft.status || null) as PersonalStatus | null, rating: draft.rating ? Number(draft.rating) : null, expectedVersion: draft.expectedVersion })) { setDraft({ ...draft, expectedVersion: draft.expectedVersion + 1 }); clearDraft(); setNotice("Guardamos tu estado y valoración."); } }}><fieldset disabled={busy || !!work.archivedAt}>
    <div className={styles.personalLayout}>
      <div className={styles.personalState}><ChoiceChips name={statusName} legend="Mi estado" value={draft.status} options={[{ value: "", label: "Sin estado" }, ...PERSONAL_STATUSES.map(status => ({ value: status, label: STATUS_LABELS[status] }))]} onChange={(status) => { setDraft({ ...draft, status }); setNotice(""); }} /></div>
      <RatingField value={draft.rating} onChange={(rating) => { setDraft({ ...draft, rating }); setNotice(""); }} />
    </div>
    {dirty && <p className={styles.unsaved} role="status">Cambios sin guardar</p>}
    {conflict && <div className={styles.notice}><p>Datos guardados: {mine?.status ? STATUS_LABELS[mine.status] : "Sin estado"}; {mine?.rating ? `${mine.rating}/5 estrellas` : "Sin valorar"}.</p><button type="button" onClick={() => setDraft({ ...draft, expectedVersion: mine?.version ?? 0 })}>Revisé mis datos: habilitar reintento</button></div>}
    <FormIssue issue={relevantIssue} onRetry={() => form.current?.requestSubmit()} />
    <button className={styles.primary} disabled={conflict} type="submit">Guardar estado y valoración</button>
  </fieldset></form>{notice && <p role="status">{notice}</p>}{storageError && <p role="status">El borrador se conserva solo mientras esta pantalla siga abierta.</p>}</section>;
}
