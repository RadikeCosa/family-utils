"use client";
import { useState } from "react";
import { PERSONAL_STATUSES, STATUS_LABELS, type LibraryWork, type PersonalStatus } from "@/lib/library/types";
import { useDraft } from "./useDraft";
import styles from "./library.module.css";
export default function PersonalForm({ work, familyId, memberId, busy, onSave }: { work: LibraryWork; familyId: string; memberId: string; busy: boolean; onSave: (input: { status: PersonalStatus | null; rating: number | null; expectedVersion: number }) => Promise<boolean> }) {
  const mine = work.personal.find((entry) => entry.memberId === memberId);
  const { draft, setDraft, clearDraft, storageError } = useDraft(`${familyId}:${memberId}:${work.id}:personal`, { status: mine?.status ?? "", rating: mine?.rating?.toString() ?? "", expectedVersion: mine?.version ?? 0 });
  const conflict = draft.expectedVersion !== (mine?.version ?? 0);
  const [notice, setNotice] = useState("");
  return <section className={styles.card}><h2>Mi experiencia</h2><form onSubmit={async (event) => { event.preventDefault(); if (await onSave({ status: (draft.status || null) as PersonalStatus | null, rating: draft.rating ? Number(draft.rating) : null, expectedVersion: draft.expectedVersion })) { setDraft({ ...draft, expectedVersion: draft.expectedVersion + 1 }); clearDraft(); setNotice("Guardamos tu estado y valoración."); } }}><fieldset disabled={busy || !!work.archivedAt}>
    <label>Mi estado<select value={draft.status} onChange={(event) => { setDraft({ ...draft, status: event.target.value }); setNotice(""); }}><option value="">Sin estado</option>{PERSONAL_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
    <label>Mi valoración<select value={draft.rating} onChange={(event) => { setDraft({ ...draft, rating: event.target.value }); setNotice(""); }}><option value="">Sin valorar</option>{[1,2,3,4,5].map((rating) => <option key={rating} value={rating}>{rating} {rating === 1 ? "estrella" : "estrellas"}</option>)}</select></label>
    {conflict && <div className={styles.notice}><p>Datos guardados: {mine?.status ? STATUS_LABELS[mine.status] : "Sin estado"}; {mine?.rating ? `${mine.rating}/5 estrellas` : "Sin valorar"}.</p><button type="button" onClick={() => setDraft({ ...draft, expectedVersion: mine?.version ?? 0 })}>Revisé mis datos: habilitar reintento</button></div>}
    <button className={styles.primary} disabled={conflict} type="submit">Guardar mi experiencia</button>
  </fieldset></form>{notice && <p role="status">{notice}</p>}{storageError && <p role="status">El borrador se conserva solo mientras esta pantalla siga abierta.</p>}</section>;
}
