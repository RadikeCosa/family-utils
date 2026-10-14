"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABELS, PERSONAL_STATUSES, STATUS_LABELS, WORK_KINDS, type PersonalStatus, type WorkKind } from "@/lib/library/types";
import { useLibrary } from "./useLibrary";
import WorkForm from "./WorkForm";
import Contributions, { NewContribution } from "./Contributions";
import PersonalForm from "./PersonalForm";
import WorkIcon from "./WorkIcon";
import ChoiceChips, { type ChoiceOption } from "./ChoiceChips";
import WorkDialog from "./WorkDialog";
import styles from "./library.module.css";
type SearchFilters = { q: string; kind: string; status: string; archived: string };
const kindOptions: ChoiceOption[] = [{ value: "", label: "Todo" }, ...WORK_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))];
const statusOptions: ChoiceOption[] = [{ value: "", label: "Todos mis estados" }, { value: "none", label: "Sin estado" }, ...PERSONAL_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))];
const archiveOptions: ChoiceOption[] = [{ value: "", label: "Activas" }, { value: "true", label: "Archivadas" }];
function toFilterString(value: SearchFilters) { const params = new URLSearchParams(); for (const key of ["q", "kind", "status", "archived"] as const) if (value[key]) params.set(key, value[key]); return params.toString(); }
function readSearchFilters(): SearchFilters {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("kind") ?? "", status = params.get("status") ?? "";
  return { q: (params.get("q") ?? "").slice(0, 200), kind: WORK_KINDS.includes(kind as WorkKind) ? kind : "", status: status === "none" || PERSONAL_STATUSES.includes(status as PersonalStatus) ? status : "", archived: params.get("archived") === "true" ? "true" : "" };
}
export default function LibraryApp({ workId, initialFilters = { q: "", kind: "", status: "", archived: "" } }: { workId?: string; initialFilters?: SearchFilters }) {
  const router = useRouter();
  const [search, setSearch] = useState(initialFilters.q);
  const [kind, setKind] = useState(initialFilters.kind);
  const [status, setStatus] = useState(initialFilters.status);
  const [archived, setArchived] = useState(initialFilters.archived);
  const [filters, setFilters] = useState(toFilterString(initialFilters));
  const [moreFilters, setMoreFilters] = useState(!!initialFilters.status || !!initialFilters.archived);
  const [searchAnnouncement, setSearchAnnouncement] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composingRef = useRef(false);
  const lastAppliedSearch = useRef(initialFilters.q);
  const deferredPop = useRef<SearchFilters | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const focusAfterEdit = useRef(false);
  const skipDialogFocusReturn = useRef(false);
  const shouldRestoreDialogFocus = useCallback(() => !skipDialogFocusReturn.current, []);
  const library = useLibrary(workId, filters);
  const { data, loading, busy, error } = library;
  const work = data && "work" in data ? data.work : null;
  useEffect(() => { if (!editing && focusAfterEdit.current && work) { detailHeading.current?.focus(); focusAfterEdit.current = false; } }, [editing, work]);
  useEffect(() => {
    if (workId || !data || !("works" in data)) return;
    if (loading) {
      const timer = setTimeout(() => setSearchAnnouncement("Buscando…"), 400);
      return () => clearTimeout(timer);
    }
    const clear = setTimeout(() => setSearchAnnouncement(""), 0);
    return () => clearTimeout(clear);
  }, [data, loading, workId]);
  const resultAnnouncement = !data || !("works" in data) ? "" : data.works.length === 0 ? "No encontramos resultados" : data.nextCursor ? `${data.works.length} resultados cargados; hay más disponibles` : `${data.works.length} resultados`;
  const writeSearch = (next: SearchFilters) => {
    if (debounce.current) clearTimeout(debounce.current);
    setSearchAnnouncement("");
    setSearch(next.q); setKind(next.kind); setStatus(next.status); setArchived(next.archived);
    lastAppliedSearch.current = next.q;
    const url = new URL(window.location.href);
    for (const key of ["q", "kind", "status", "archived", "cursor"]) url.searchParams.delete(key);
    for (const [key, value] of new URLSearchParams(toFilterString(next))) url.searchParams.set(key, value);
    // Next.js merges its router state for external History API updates and syncs useSearchParams without a server navigation.
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setFilters(toFilterString(next));
  };
  useEffect(() => {
    const onPopState = () => {
      const next = readSearchFilters();
      if (composingRef.current) { deferredPop.current = next; return; }
      if (debounce.current) clearTimeout(debounce.current);
      setSearch(next.q); setKind(next.kind); setStatus(next.status); setArchived(next.archived);
      setMoreFilters(!!next.status || !!next.archived); setFilters(toFilterString(next));
    };
    window.addEventListener("popstate", onPopState);
    return () => { window.removeEventListener("popstate", onPopState); if (debounce.current) clearTimeout(debounce.current); };
  }, []);
  const applyCurrent = (q: string, nextKind = kind, nextStatus = status, nextArchived = archived) => writeSearch({ q: (composingRef.current ? lastAppliedSearch.current : q).trim(), kind: nextKind, status: nextStatus, archived: nextArchived });
  return <main className={styles.page}>
    <header className={styles.header}><Link className={styles.brand} href="/">family utils</Link><nav aria-label="Aplicaciones"><Link href="/tareas">Tareas</Link><Link href="/menus">Menús</Link><Link href="/compras">Compras</Link><Link href="/biblioteca" aria-current="page">Biblioteca</Link><Link href="/familia">Mi familia</Link></nav></header>
    {workId && <Link className={styles.back} href="/biblioteca">← Volver a la biblioteca</Link>}
    <div className={styles.heading}><div><p className={styles.eyebrow}>NUESTRAS OBRAS, NUESTRAS MIRADAS</p><h1 ref={detailHeading} tabIndex={work ? -1 : undefined}>{work?.title ?? "Biblioteca familiar"}</h1>{!workId && <p>Un lugar para lo que nos gusta y lo que queremos descubrir.</p>}</div>{!workId && data && <button className={styles.primary} disabled={adding && busy} onClick={() => { if (!adding) skipDialogFocusReturn.current = false; setAdding(!adding); }}>{adding ? "Cerrar formulario" : "Agregar a la biblioteca"}</button>}</div>
    {error && <p className={styles.error} role="alert">{error} <button onClick={() => void library.refresh()}>Reintentar</button></p>}
    {library.hasChanges && <p className={styles.notice} role="status">Hay cambios en la biblioteca. <button onClick={() => void library.refresh()}>Actualizar</button></p>}
    {loading && !data && <p role="status">Cargando biblioteca…</p>}
    {adding && data && <WorkDialog busy={busy} shouldRestoreFocus={shouldRestoreDialogFocus} onRequestClose={() => { setAdding(false); library.clearDuplicates(); }}><WorkForm key={`${data.familyId}:${data.currentMemberId}:new`} scope={`${data.familyId}:${data.currentMemberId}:new-work`} busy={busy} duplicates={library.duplicates} issue={library.operationIssue} onIdentityChange={library.clearDuplicates} onCancel={() => { setAdding(false); library.clearDuplicates(); }} onSave={async (input) => { const result = await library.mutate("", "POST", input); if (!result) return false; skipDialogFocusReturn.current = true; setAdding(false); router.push(`/biblioteca/${result.id}`); return true; }} /></WorkDialog>}
    {!workId && data && "works" in data && <>
      <form className={styles.filters} aria-busy={loading} onSubmit={(event) => { event.preventDefault(); if (!composingRef.current) applyCurrent(search); }}>
        <label className={styles.searchLabel}>Buscar en la biblioteca<input type="search" value={search} placeholder="Título, autor o creador" onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={(event) => { composingRef.current = false; const value = event.currentTarget.value; const pending = deferredPop.current; deferredPop.current = null; if (pending) { setSearch(pending.q); setKind(pending.kind); setStatus(pending.status); setArchived(pending.archived); setMoreFilters(!!pending.status || !!pending.archived); writeSearch(pending); } else { debounce.current = setTimeout(() => applyCurrent(value), 0); } }} onKeyDown={(event) => { if (event.key === "Enter" && !composingRef.current) { event.preventDefault(); applyCurrent(search); } }} onChange={(event) => { const value = event.target.value; setSearch(value); if (debounce.current) clearTimeout(debounce.current); if (!composingRef.current) debounce.current = setTimeout(() => applyCurrent(value), 300); }} /></label>
        <ChoiceChips name="library-kind" legend="Tipo" value={kind} options={kindOptions} onChange={(value) => applyCurrent(search, value)} />
        <details className={styles.moreFilters} open={moreFilters} onToggle={(event) => setMoreFilters(event.currentTarget.open)}><summary>Más filtros{(Number(!!status) + Number(archived === "true")) > 0 ? ` (${Number(!!status) + Number(archived === "true")})` : ""}</summary><div className={styles.advancedFilters}>
          <ChoiceChips name="library-status" legend="Mi estado" value={status} options={statusOptions} onChange={(value) => applyCurrent(search, kind, value)} />
          <ChoiceChips name="library-archived" legend="Colección" value={archived} options={archiveOptions} onChange={(value) => applyCurrent(search, kind, status, value)} />
          <button type="button" onClick={() => applyCurrent(search, kind, "", "")}>Limpiar filtros adicionales</button>
        </div></details>
        {(search || kind || status || archived) && <button type="button" onClick={() => applyCurrent("", "", "", "")}>Restablecer búsqueda</button>}
      </form>
      <p className={styles.srStatus} role="status" aria-live="polite" aria-atomic="true">{loading ? searchAnnouncement : resultAnnouncement}</p>
      {data.works.length ? <ul className={styles.grid}>{data.works.map((item) => <li key={item.id}><Link className={styles.workCard} href={`/biblioteca/${item.id}`}><span className={styles.icon}><WorkIcon kind={item.kind} /></span><span className={styles.workContent}><span className={styles.eyebrow}>{KIND_LABELS[item.kind]}</span><h2>{item.title}</h2><p>{[item.creator, item.year].filter(Boolean).join(" · ") || "Por descubrir"}</p></span></Link></li>)}</ul> : <section className={styles.empty}><WorkIcon kind="book" /><h2>{filters ? "No encontramos obras con estos filtros" : "Nuestra colección empieza acá"}</h2><p>{filters ? "Probá otro título o ampliá los filtros." : "Agregá una película, un libro, una canción o ese juego que siempre compartimos."}</p></section>}
      {data.nextCursor && <button disabled={loading} onClick={() => void library.more()}>{loading ? "Cargando…" : "Cargar más obras"}</button>}
    </>}
    {work && data && <>
      <div className={styles.actions}>
        {!work.archivedAt && <button disabled={busy} onClick={() => { skipDialogFocusReturn.current = false; setEditing(!editing); library.clearDuplicates(); }}>Editar datos</button>}
        {work.archivedAt && <button disabled={busy} onClick={() => { skipDialogFocusReturn.current = false; setEditing(true); library.clearDuplicates(); }}>Ver datos archivados</button>}
        <button disabled={busy} onClick={async () => { if (window.confirm(work.archivedAt ? "¿Restaurar este contenido?" : "¿Archivar este contenido? Se conservan todos sus aportes.")) await library.mutate(`/${work.id}`, "PATCH", { action: work.archivedAt ? "restore" : "archive", expectedVersion: work.version }); }}>{work.archivedAt ? "Restaurar" : "Archivar"}</button>
      </div>
      {work.archivedAt && <p className={styles.notice}>Este contenido está archivado. Podés restaurarlo o retirar tus aportes.</p>}
      {editing && <WorkDialog busy={busy} shouldRestoreFocus={shouldRestoreDialogFocus} onRequestClose={() => { setEditing(false); library.clearDuplicates(); }}><WorkForm key={`${data.familyId}:${data.currentMemberId}:${work.id}`} scope={`${data.familyId}:${data.currentMemberId}:${work.id}:edit-work`} work={work} busy={busy} duplicates={library.duplicates} issue={library.operationIssue} onIdentityChange={library.clearDuplicates} onCancel={() => { setEditing(false); library.clearDuplicates(); }} onSave={async (input) => { if (!await library.mutate(`/${work.id}`, "PATCH", { ...input, action: "edit" })) return false; skipDialogFocusReturn.current = true; focusAfterEdit.current = true; setEditing(false); return true; }} /></WorkDialog>}
      <section className={styles.card}><p className={styles.eyebrow}>{KIND_LABELS[work.kind]}{work.archivedAt ? " · Archivada" : ""}</p>{work.creator && <p>{work.creator}</p>}{work.year && <p>Año: {work.year}</p>}{work.referenceUrl && <p><a className={styles.reference} href={work.referenceUrl} target="_blank" rel="noopener noreferrer">Abrir enlace de referencia ↗</a></p>}</section>
      <section className={styles.card}><h2>Las miradas de la familia</h2>{work.personal.length ? <ul>{work.personal.map((entry) => <li key={entry.memberId}><strong>{data.members.find((member) => member.id === entry.memberId)?.name ?? "Integrante"}</strong>: {entry.status ? STATUS_LABELS[entry.status] : "Sin estado"} · {entry.rating ? `${entry.rating}/5 estrellas` : "Sin valorar"}</li>)}</ul> : <p>Todavía no hay estados ni valoraciones.</p>}</section>
      {"contributions" in data && <Contributions data={data} busy={busy} loading={loading} save={library.mutate} more={library.more} />}
      <PersonalForm key={`${data.familyId}:${data.currentMemberId}:${work.id}:personal`} work={work} familyId={data.familyId} memberId={data.currentMemberId} busy={busy} onSave={async (input) => !!await library.mutate(`/${work.id}/personal`, "PUT", input)} />
      {"contributions" in data && <NewContribution data={data} busy={busy} save={library.mutate} />}
    </>}
  </main>;
}
