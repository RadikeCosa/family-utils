"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABELS, PERSONAL_STATUSES, STATUS_LABELS, WORK_KINDS } from "@/lib/library/types";
import { useLibrary } from "./useLibrary";
import WorkForm from "./WorkForm";
import PersonalForm from "./PersonalForm";
import styles from "./library.module.css";
function WorkIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v14c-4-1-7 0-9 2-2-2-5-3-9-2z" /></svg>; }
export default function LibraryApp({ workId }: { workId?: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState("");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const library = useLibrary(workId, filters);
  const { data, loading, busy, error } = library;
  const work = data && "work" in data ? data.work : null;
  return <main className={styles.page}>
    <header className={styles.header}><Link className={styles.brand} href="/">family utils</Link><nav aria-label="Aplicaciones"><Link href="/tareas">Tareas</Link><Link href="/menus">Menús</Link><Link href="/compras">Compras</Link><Link href="/biblioteca" aria-current="page">Biblioteca</Link><Link href="/familia">Mi familia</Link></nav></header>
    {workId && <Link className={styles.back} href="/biblioteca">← Volver a la biblioteca</Link>}
    <div className={styles.heading}><div><p className={styles.eyebrow}>NUESTRAS OBRAS, NUESTRAS MIRADAS</p><h1>{work?.title ?? "Biblioteca familiar"}</h1>{!workId && <p>Un lugar para lo que nos gusta y lo que queremos descubrir.</p>}</div>{!workId && data && <button className={styles.primary} onClick={() => setAdding(!adding)}>{adding ? "Cerrar formulario" : "Agregar obra"}</button>}</div>
    {error && <p className={styles.error} role="alert">{error} <button onClick={() => void library.refresh()}>Reintentar</button></p>}
    {library.hasChanges && <p className={styles.notice} role="status">Hay cambios en la biblioteca. <button onClick={() => void library.refresh()}>Actualizar</button></p>}
    {loading && !data && <p role="status">Cargando biblioteca…</p>}
    {adding && data && <section className={styles.card}><WorkForm key={`${data.familyId}:${data.currentMemberId}:new`} scope={`${data.familyId}:${data.currentMemberId}:new-work`} busy={busy} duplicates={library.duplicates} onCancel={() => { setAdding(false); library.clearDuplicates(); }} onSave={async (input) => { const result = await library.mutate("", "POST", input); if (!result) return false; setAdding(false); router.push(`/biblioteca/${result.id}`); return true; }} /></section>}
    {!workId && data && "works" in data && <>
      <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const params = new URLSearchParams(); for (const key of ["kind", "status", "archived"]) if (form.get(key)) params.set(key, String(form.get(key))); if (search.trim()) params.set("q", search.trim()); setFilters(params.toString()); }}>
        <label>Buscar una obra<input type="search" value={search} placeholder="Título o creador" onChange={(event) => setSearch(event.target.value)} /></label>
        <label>Tipo<select name="kind"><option value="">Todos los tipos</option>{WORK_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}</select></label>
        <label>Mi estado<select name="status"><option value="">Todos mis estados</option><option value="none">Sin estado</option>{PERSONAL_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
        <label>Colección<select name="archived"><option value="">Activas</option><option value="true">Archivadas</option></select></label><button type="submit" disabled={loading}>Buscar</button>
      </form>
      {data.works.length ? <ul className={styles.grid}>{data.works.map((item) => <li key={item.id}><Link className={styles.workCard} href={`/biblioteca/${item.id}`}><span className={styles.icon}><WorkIcon /></span><span className={styles.eyebrow}>{KIND_LABELS[item.kind]}</span><h2>{item.title}</h2><p>{[item.creator, item.year].filter(Boolean).join(" · ") || "Por descubrir"}</p><span className={styles.open}>Abrir ficha →</span></Link></li>)}</ul> : <section className={styles.empty}><WorkIcon /><h2>{filters ? "No encontramos obras con estos filtros" : "Nuestra colección empieza acá"}</h2><p>{filters ? "Probá otro título o ampliá los filtros." : "Agregá una película, un libro, una canción o ese juego que siempre compartimos."}</p></section>}
      {data.nextCursor && <button disabled={loading} onClick={() => void library.more()}>{loading ? "Cargando…" : "Cargar más obras"}</button>}
    </>}
    {work && data && <>
      <div className={styles.actions}>
        {!work.archivedAt && <button disabled={busy} onClick={() => { setEditing(!editing); library.clearDuplicates(); }}>Editar ficha</button>}
        <button disabled={busy} onClick={async () => { if (window.confirm(work.archivedAt ? "¿Restaurar esta ficha?" : "¿Archivar esta ficha? Se conservan todos sus aportes.")) await library.mutate(`/${work.id}`, "PATCH", { action: work.archivedAt ? "restore" : "archive", expectedVersion: work.version }); }}>{work.archivedAt ? "Restaurar ficha" : "Archivar ficha"}</button>
      </div>
      {work.archivedAt && <p className={styles.notice}>Ficha archivada. Podés restaurarla o retirar tus aportes.</p>}
      {editing && !work.archivedAt && <section className={styles.card}><WorkForm key={`${data.familyId}:${data.currentMemberId}:${work.id}`} scope={`${data.familyId}:${data.currentMemberId}:${work.id}:edit-work`} work={work} busy={busy} duplicates={library.duplicates} onCancel={() => { setEditing(false); library.clearDuplicates(); }} onSave={async (input) => { if (!await library.mutate(`/${work.id}`, "PATCH", { ...input, action: "edit" })) return false; setEditing(false); return true; }} /></section>}
      <section className={styles.card}><p className={styles.eyebrow}>{KIND_LABELS[work.kind]}{work.archivedAt ? " · Archivada" : ""}</p>{work.creator && <p>{work.creator}</p>}{work.year && <p>Año: {work.year}</p>}{work.referenceUrl && <p><a className={styles.reference} href={work.referenceUrl} target="_blank" rel="noopener noreferrer">Abrir enlace de referencia ↗</a></p>}</section>
      <PersonalForm key={`${data.familyId}:${data.currentMemberId}:${work.id}:personal`} work={work} familyId={data.familyId} memberId={data.currentMemberId} busy={busy} onSave={async (input) => !!await library.mutate(`/${work.id}/personal`, "PUT", input)} />
      <section className={styles.card}><h2>Las miradas de la familia</h2>{work.personal.length ? <ul>{work.personal.map((entry) => <li key={entry.memberId}><strong>{data.members.find((member) => member.id === entry.memberId)?.name ?? "Integrante"}</strong>: {entry.status ? STATUS_LABELS[entry.status] : "Sin estado"} · {entry.rating ? `${entry.rating}/5 estrellas` : "Sin valorar"}</li>)}</ul> : <p>Todavía no hay estados ni valoraciones.</p>}</section>
    </>}
  </main>;
}
