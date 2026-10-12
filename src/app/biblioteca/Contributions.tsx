"use client";
import { useId, useState } from "react";
import { codePointLength } from "@/lib/library/rules";
import type { Contribution, LibraryDetail } from "@/lib/library/types";
import { useDraft } from "./useDraft";
import styles from "./library.module.css";
type Save = (path: string, method: string, input: Record<string, unknown>) => Promise<{ id: string } | null>;
function ContributionForm({ data, entry, busy, save, close }: { data: LibraryDetail; entry?: Contribution; busy: boolean; save: Save; close: () => void }) {
  const { draft, setDraft, clearDraft, storageError } = useDraft(`${data.familyId}:${data.currentMemberId}:${data.work.id}:${entry?.id ?? "new"}:contribution`, {
    body: entry?.body ?? "", spoiler: entry?.spoiler ?? false, year: entry?.experience.year?.toString() ?? "", month: entry?.experience.month?.toString() ?? "", day: entry?.experience.day?.toString() ?? "", companionIds: entry?.companionIds ?? [] as string[], expectedVersion: entry?.version ?? 0 });
  const formId = useId();
  const [invalid, setInvalid] = useState("");
  const conflict = !!entry && draft.expectedVersion !== entry.version;
  return <form onSubmit={async (event) => { event.preventDefault(); if (!draft.body.trim() || codePointLength(draft.body.trim()) > 5000) { setInvalid("Escribí entre 1 y 5.000 caracteres."); return; }
    const result = await save(`/${data.work.id}/contributions${entry ? `/${entry.id}` : ""}`, entry ? "PATCH" : "POST", { body: draft.body, spoiler: draft.spoiler, experience: { year: draft.year ? Number(draft.year) : null, month: draft.month ? Number(draft.month) : null, day: draft.day ? Number(draft.day) : null }, companionIds: draft.companionIds, expectedVersion: draft.expectedVersion, ...(entry ? { action: "edit" } : {}) });
    if (result) { clearDraft(); close(); }
  }}><fieldset disabled={busy || !!data.work.archivedAt}>
    <legend>{entry ? "Editar mi aporte" : "Compartir un recuerdo o una mirada"}</legend>
    <label htmlFor={`${formId}-body`}>Tu aporte</label><textarea id={`${formId}-body`} rows={6} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} required aria-describedby={`${formId}-length`} /><p id={`${formId}-length`}>{codePointLength(draft.body)} / 5.000 caracteres</p>
    <label className={styles.check}><input type="checkbox" checked={draft.spoiler} onChange={(event) => setDraft({ ...draft, spoiler: event.target.checked })} />Contiene spoilers</label>
    <fieldset><legend>Fecha de la experiencia (opcional)</legend><p>Completá solo lo que recuerdes: año, año y mes, o fecha completa.</p><div className={styles.dateFields}>
      <label>Año<input type="number" min="1" max="9999" inputMode="numeric" value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value, ...(!event.target.value ? { month: "", day: "" } : {}) })} /></label>
      <label>Mes<select disabled={!draft.year} value={draft.month} onChange={(event) => setDraft({ ...draft, month: event.target.value, ...(!event.target.value ? { day: "" } : {}) })}><option value="">No recuerdo</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i+1}>{new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000,i,1)))}</option>)}</select></label>
      <label>Día<input type="number" min="1" max="31" inputMode="numeric" disabled={!draft.month} value={draft.day} onChange={(event) => setDraft({ ...draft, day: event.target.value })} /></label>
    </div></fieldset>
    <fieldset><legend>¿Con quién? (opcional)</legend>{data.members.map((member) => <label className={styles.check} key={member.id}><input type="checkbox" checked={draft.companionIds.includes(member.id)} onChange={(event) => setDraft({ ...draft, companionIds: event.target.checked ? [...draft.companionIds, member.id] : draft.companionIds.filter((id) => id !== member.id) })} />{member.name}{member.archivedAt ? " (perfil archivado)" : ""}</label>)}</fieldset>
    {conflict && <div className={styles.notice}><p>Este aporte cambió. Versión guardada:</p><p className={styles.body}>{entry.body}</p><button type="button" onClick={() => setDraft({ ...draft, expectedVersion: entry.version })}>Revisé el aporte: habilitar reintento</button></div>}
    {invalid && <p role="alert">{invalid}</p>}
    <div className={styles.actions}><button className={styles.primary} type="submit" disabled={conflict}>{entry ? "Guardar aporte" : "Publicar aporte"}</button><button type="button" onClick={() => { clearDraft(); close(); }}>Descartar borrador</button></div>
  </fieldset>{storageError && <p role="status">No pudimos guardar el borrador en este dispositivo. Conservá esta pantalla abierta.</p>}</form>;
}
function ContributionCard({ entry, data, busy, save }: { entry: Contribution; data: LibraryDetail; busy: boolean; save: Save }) {
  const [revealed, setRevealed] = useState(false), [editing, setEditing] = useState(false);
  const name = (id: string) => data.members.find((member) => member.id === id)?.name ?? "Integrante";
  const date = [entry.experience.day, entry.experience.month, entry.experience.year].filter((value) => value !== null).join("/");
  const mine = entry.authorMemberId === data.currentMemberId;
  return <li className={styles.card}><h3>{name(entry.authorMemberId)}</h3><p>Publicado el {new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(entry.createdAt))}</p>{date && <p>Experiencia: {date}</p>}{entry.companionIds.length > 0 && <p>Con {entry.companionIds.map(name).join(", ")}</p>}
    {entry.spoiler && <button aria-expanded={revealed} aria-controls={`spoiler-${entry.id}`} onClick={() => setRevealed(!revealed)}>{revealed ? "Ocultar spoiler" : "Mostrar spoiler"}</button>}
    <div id={`spoiler-${entry.id}`} hidden={entry.spoiler && !revealed}><p className={styles.body}>{entry.body}</p></div>
    {mine && <div className={styles.actions}>{!data.work.archivedAt && <button disabled={busy} onClick={() => setEditing(!editing)}>Editar mi aporte</button>}<button disabled={busy} onClick={async () => { if (window.confirm("¿Retirar tu aporte? Dejará de verse y no podrá restaurarse desde la app.")) await save(`/${data.work.id}/contributions/${entry.id}`, "PATCH", { action: "retire", expectedVersion: entry.version }); }}>Retirar aporte</button></div>}
    {editing && !data.work.archivedAt && <ContributionForm data={data} entry={entry} busy={busy} save={save} close={() => setEditing(false)} />}
  </li>;
}
export default function Contributions({ data, busy, loading, save, more }: { data: LibraryDetail; busy: boolean; loading: boolean; save: Save; more: () => Promise<void> }) {
  const [generation, setGeneration] = useState(0);
  return <section><h2>Aportes y recuerdos</h2>{!data.work.archivedAt && <div className={styles.card}><ContributionForm key={`${data.familyId}:${data.currentMemberId}:${data.work.id}:new:${generation}`} data={data} busy={busy} save={save} close={() => setGeneration(generation + 1)} /></div>}
    {data.contributions.length ? <ul className={styles.contributions}>{data.contributions.map((entry) => <ContributionCard key={entry.id} entry={entry} data={data} busy={busy} save={save} />)}</ul> : <p>Todavía no hay aportes. Cada mirada tiene su lugar.</p>}
    {data.nextCursor && <button disabled={loading} onClick={() => void more()}>{loading ? "Cargando…" : "Cargar más aportes"}</button>}
  </section>;
}
