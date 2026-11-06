"use client";
import { GENRES, genreLabels } from "@/lib/library/genres";
import { canonicalLibrarySearch, libraryFilterString, readLibraryFilters, type SearchFilters } from "@/lib/library/filters";
import { familyRating } from "@/lib/library/presentation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/library/types";
import { useLibrary } from "./useLibrary";
import WorkForm from "./WorkForm";
import Contributions, { NewContribution } from "./Contributions";
import PersonalForm from "./PersonalForm";
import WorkIcon from "./WorkIcon";
import WorkDialog from "./WorkDialog";
import styles from "./library.module.css";
const showOptions = [{ value: "", label: "Todas" }, { value: "pending", label: "Quiero ver" }, { value: "in_progress", label: "Viendo" }, { value: "finished", label: "Vistas" }, { value: "none", label: "Sin estado" }, { value: "common_pending", label: "Pendientes en común" }];
function readSearchFilters() { return readLibraryFilters(new URLSearchParams(window.location.search)); }
export default function LibraryApp({ workId, initialFilters = { q: "", view: "", status: "", archived: "", genre: "" } }: { workId?: string; initialFilters?: SearchFilters }) {
  const router = useRouter();
  const [search, setSearch] = useState(initialFilters.q);
  const [view, setView] = useState(initialFilters.view);
  const [status, setStatus] = useState(initialFilters.status);
  const [archived, setArchived] = useState(initialFilters.archived);
  const [filters, setFilters] = useState(libraryFilterString(initialFilters));
  const [genre, setGenre] = useState(initialFilters.genre);
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
    setSearch(next.q); setView(next.view); setStatus(next.status); setArchived(next.archived); setGenre(next.genre);
    lastAppliedSearch.current = next.q;
    const url = new URL(window.location.href);
    url.search = canonicalLibrarySearch(url.searchParams, next);
    // Next.js merges its router state for external History API updates and syncs useSearchParams without a server navigation.
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setFilters(libraryFilterString(next));
  };
  useEffect(() => {
    const normalizeUrl = () => {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.search = canonicalLibrarySearch(cleanUrl.searchParams);
      window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    };
    const onPopState = () => {
      normalizeUrl();
      const next = readSearchFilters();
      if (composingRef.current) { deferredPop.current = next; return; }
      if (debounce.current) clearTimeout(debounce.current);
      setSearch(next.q); setView(next.view); setStatus(next.status); setArchived(next.archived); setGenre(next.genre);
      setFilters(libraryFilterString(next));
    };
    onPopState();
    window.addEventListener("popstate", onPopState);
    return () => { window.removeEventListener("popstate", onPopState); if (debounce.current) clearTimeout(debounce.current); };
  }, []);
  const applyCurrent = (q: string, nextView = view, nextStatus = status, nextArchived = archived, nextGenre = genre) => writeSearch({ q: (composingRef.current ? lastAppliedSearch.current : q).trim(), view: nextView, status: nextStatus, archived: nextArchived, genre: nextGenre });
  return <main className={styles.page}>
    <header className={styles.header}><Link className={styles.brand} href="/">family utils</Link><nav aria-label="Aplicaciones"><Link href="/tareas">Tareas</Link><Link href="/menus">Menús</Link><Link href="/compras">Compras</Link><Link href="/cinemateca" aria-current="page">Cinemateca</Link><Link href="/familia">Mi familia</Link></nav></header>
    {workId && <Link className={styles.back} href="/cinemateca">← Volver a la cinemateca</Link>}
    <div className={styles.heading}><div><h1 ref={detailHeading} tabIndex={work ? -1 : undefined}>{work?.title ?? "Cinemateca familiar"}</h1></div>{!workId && data && <button className={styles.primary} disabled={adding && busy} onClick={() => { if (!adding) skipDialogFocusReturn.current = false; setAdding(!adding); }}>{adding ? "Cerrar formulario" : "Agregar película"}</button>}</div>
    {error && <p className={styles.error} role="alert">{error} <button onClick={() => void library.refresh()}>Reintentar</button></p>}
    {library.hasChanges && <p className={styles.notice} role="status">Hay cambios. Actualizá para ver la colección al día. <button onClick={() => void library.refresh()}>Actualizar</button></p>}
    {loading && !data && <p role="status">Cargando cinemateca…</p>}
    {adding && data && <WorkDialog busy={busy} shouldRestoreFocus={shouldRestoreDialogFocus} onRequestClose={() => { setAdding(false); library.clearDuplicates(); }}><WorkForm key={`${data.familyId}:${data.currentMemberId}:new`} scope={`${data.familyId}:${data.currentMemberId}:new-work`} busy={busy} duplicates={library.duplicates} issue={library.operationIssue} onIdentityChange={library.clearDuplicates} onCancel={() => { setAdding(false); library.clearDuplicates(); }} onSave={async (input) => { const result = await library.mutate("", "POST", input); if (!result) return false; skipDialogFocusReturn.current = true; setAdding(false); router.push(`/cinemateca/${result.id}`); return true; }} /></WorkDialog>}
    {!workId && data && "works" in data && <>
      <form className={styles.filters} aria-busy={loading} onSubmit={(event) => { event.preventDefault(); if (!composingRef.current) applyCurrent(search); }}>
        <label className={styles.searchLabel}>Buscar películas<input type="search" value={search} placeholder="Título o director/a" onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={(event) => { composingRef.current = false; const value = event.currentTarget.value; const pending = deferredPop.current; deferredPop.current = null; if (pending) { setSearch(pending.q); setView(pending.view); setStatus(pending.status); setArchived(pending.archived); setGenre(pending.genre); writeSearch(pending); } else { debounce.current = setTimeout(() => applyCurrent(value), 0); } }} onKeyDown={(event) => { if (event.key === "Enter" && !composingRef.current) { event.preventDefault(); applyCurrent(search); } }} onChange={(event) => { const value = event.target.value; setSearch(value); if (debounce.current) clearTimeout(debounce.current); if (!composingRef.current) debounce.current = setTimeout(() => applyCurrent(value), 300); }} /></label>
        <label>Mostrar<select value={view || status} onChange={(event) => applyCurrent(search, event.target.value === "common_pending" ? "common_pending" : "", event.target.value === "common_pending" ? "" : event.target.value)}>{showOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Género<select value={genre} onChange={(event) => applyCurrent(search, view, status, archived, event.target.value)}><option value="">Todos los géneros</option><option value="none">Sin género</option>{GENRES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <div className={styles.filterExtras}><label className={styles.check}><input type="checkbox" checked={archived === "true"} onChange={(event) => applyCurrent(search, view, status, event.target.checked ? "true" : "")} /><span>Solo archivadas</span></label>
          {(search || view || status || archived || genre) && <button type="button" onClick={() => applyCurrent("", "", "", "", "")}>Limpiar filtros</button>}
        </div>
        {view === "common_pending" && <p className={styles.filterHelp}>Todos los integrantes activos las marcaron como Quiero ver.</p>}
      </form>
      <p className={styles.srStatus} role="status" aria-live="polite" aria-atomic="true">{loading ? searchAnnouncement : resultAnnouncement}</p>
      {data.works.length ? <ul className={styles.grid}>{data.works.map((item) => { const mine = item.personal.find((entry) => entry.memberId === data.currentMemberId); return <li key={item.id}><Link className={styles.workCard} href={`/cinemateca/${item.id}`}><span className={styles.workContent}><h2>{item.title}</h2><p>{[item.creator, item.year].filter(Boolean).join(" · ") || "Por descubrir"}</p><p>{mine?.status ? STATUS_LABELS[mine.status] : "Sin estado"} · {mine?.rating ? `Mi nota: ${mine.rating}/5` : "Sin valorar"}</p>{item.genres.length > 0 && <p>{genreLabels(item.genres).join(" · ")}</p>}<p>{familyRating(item.personal)}</p></span></Link></li>; })}</ul> : <section className={styles.empty}><WorkIcon kind="movie" /><h2>{filters ? "No encontramos películas con estos filtros" : "Nuestra colección empieza acá"}</h2><p>{view === "common_pending" ? "Aparecen cuando todos los integrantes activos las marcan como Quiero ver" : filters ? "Probá otro título o ampliá los filtros." : "Agregá una película que quieran ver o recordar."}</p></section>}
      {data.nextCursor && <button disabled={loading} onClick={() => void library.more()}>{loading ? "Cargando…" : "Cargar más películas"}</button>}
    </>}
    {work && data && <>
      <div className={styles.actions}>
        {!work.archivedAt && <button disabled={busy} onClick={() => { skipDialogFocusReturn.current = false; setEditing(!editing); library.clearDuplicates(); }}>Editar datos</button>}
        {work.archivedAt && <button disabled={busy} onClick={() => { skipDialogFocusReturn.current = false; setEditing(true); library.clearDuplicates(); }}>Ver datos archivados</button>}
        <button disabled={busy} onClick={async () => { if (window.confirm(work.archivedAt ? "¿Restaurar este contenido?" : "¿Archivar este contenido? Se conservan todos sus aportes.")) await library.mutate(`/${work.id}`, "PATCH", { action: work.archivedAt ? "restore" : "archive", expectedVersion: work.version }); }}>{work.archivedAt ? "Restaurar" : "Archivar"}</button>
      </div>
      {work.archivedAt && <p className={styles.notice}>Este contenido está archivado. Podés restaurarlo o retirar tus aportes.</p>}
      {editing && <WorkDialog busy={busy} shouldRestoreFocus={shouldRestoreDialogFocus} onRequestClose={() => { setEditing(false); library.clearDuplicates(); }}><WorkForm key={`${data.familyId}:${data.currentMemberId}:${work.id}`} scope={`${data.familyId}:${data.currentMemberId}:${work.id}:edit-work`} work={work} busy={busy} duplicates={library.duplicates} issue={library.operationIssue} onIdentityChange={library.clearDuplicates} onCancel={() => { setEditing(false); library.clearDuplicates(); }} onSave={async (input) => { if (!await library.mutate(`/${work.id}`, "PATCH", { ...input, action: "edit" })) return false; skipDialogFocusReturn.current = true; focusAfterEdit.current = true; setEditing(false); return true; }} /></WorkDialog>}
      <section className={styles.card}><p className={styles.eyebrow}>{KIND_LABELS[work.kind]}{work.archivedAt ? " · Archivada" : ""}</p>{work.creator && <p>{work.creator}</p>}{work.year && <p>Año: {work.year}</p>}{work.genres.length > 0 && <p>{genreLabels(work.genres).join(" · ")}</p>}</section>
      <PersonalForm key={`${data.familyId}:${data.currentMemberId}:${work.id}:personal`} work={work} familyId={data.familyId} memberId={data.currentMemberId} busy={busy} issue={library.operationIssue} onSave={async (input) => !!await library.mutate(`/${work.id}/personal`, "PUT", input)} />
      <section className={styles.card}><h2>Las miradas de la familia</h2><p>{familyRating(work.personal)}</p>{work.personal.length ? <ul>{work.personal.map((entry) => <li key={entry.memberId}><strong>{data.members.find((member) => member.id === entry.memberId)?.name ?? "Integrante"}</strong>: {entry.status ? STATUS_LABELS[entry.status] : "Sin estado"} · {entry.rating ? `${entry.rating}/5 estrellas` : "Sin valorar"}</li>)}</ul> : <p>Todavía no hay estados ni valoraciones.</p>}</section>
      {"contributions" in data && <Contributions data={data} issue={library.operationIssue} busy={busy} loading={loading} save={library.mutate} more={library.more} />}

      {"contributions" in data && <NewContribution data={data} issue={library.operationIssue} busy={busy} save={library.mutate} />}
    </>}
  </main>;
}
