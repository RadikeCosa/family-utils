"use client";
import { genreLabels } from "@/lib/library/genres";
import { canonicalLibrarySearch, libraryFilterString, readLibraryFilters, type SearchFilters } from "@/lib/library/filters";
import { familyRating, commonMemberLabels } from "@/lib/library/presentation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AvailabilityDetails, AvailabilityFilters } from "./AvailabilityView";
const AvailabilityTools = dynamic(() => import("./AvailabilityTools"));
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/library/types";
import { useLibrary } from "./useLibrary";
import WorkForm from "./WorkForm";
import Contributions, { NewContribution } from "./Contributions";
import PersonalForm from "./PersonalForm";
import WorkIcon from "./WorkIcon";
import MovieCard from "./MovieCard";
import Runtime from "./Runtime";
import WorkDialog from "./WorkDialog";
import GenreFilter from "./GenreFilter";
import styles from "./library.module.css";
const showOptions = [{ value: "", label: "Todas" }, { value: "pending", label: "Quiero ver" }, { value: "in_progress", label: "Viendo" }, { value: "finished", label: "Vistas" }, { value: "none", label: "Sin estado" }, { value: "common_pending", label: "Todos queremos ver" }];
function readSearchFilters() { return readLibraryFilters(new URLSearchParams(window.location.search)); }
export default function LibraryApp({ workId, initialFilters = { q: "", view: "", status: "", archived: "", genre: "", withMember: "" } }: { workId?: string; initialFilters?: SearchFilters }) {
  const router = useRouter();
  const [search, setSearch] = useState(initialFilters.q);
  const [view, setView] = useState(initialFilters.view);
  const [status, setStatus] = useState(initialFilters.status);
  const [archived, setArchived] = useState(initialFilters.archived);
  const [filters, setFilters] = useState(libraryFilterString(initialFilters));
  const [genre, setGenre] = useState(initialFilters.genre);
  const [withMember, setWithMember] = useState(initialFilters.withMember);
  const [availabilityPlatforms, setAvailabilityPlatforms] = useState<string[]>(initialFilters.platforms ?? []);
  const [free, setFree] = useState(initialFilters.free ?? false);
  const [filterNotice, setFilterNotice] = useState("");
  const [searchAnnouncement, setSearchAnnouncement] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
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
  const writeSearch = useCallback((next: SearchFilters) => {
    if (debounce.current) clearTimeout(debounce.current);
    setSearchAnnouncement("");
    setSearch(next.q); setView(next.view); setStatus(next.status); setArchived(next.archived); setGenre(next.genre); setWithMember(next.withMember);
    setAvailabilityPlatforms(next.platforms ?? []); setFree(next.free ?? false);
    lastAppliedSearch.current = next.q;
    const url = new URL(window.location.href);
    url.search = canonicalLibrarySearch(url.searchParams, next);
    // Next.js merges its router state for external History API updates and syncs useSearchParams without a server navigation.
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setFilters(libraryFilterString(next));
  }, []);
  const recoverUnavailableMember = useCallback(() => {
    const next = readSearchFilters();
    writeSearch({ ...next, view: "", status: "", withMember: "" });
    setFilterNotice("Ese integrante ya no está disponible. Quitamos el filtro");
  }, [writeSearch]);
  const library = useLibrary(workId, filters, recoverUnavailableMember);
  const { data, loading, busy, error } = library;
  const commonMembers = data ? commonMemberLabels(data.members, data.currentMemberId) : [];
  const selectedMember = view === "pair_pending" ? commonMembers.find(member => member.id === withMember) : undefined;
  const selectedCount = data && "works" in data ? data.commonPendingCounts.find(entry => entry.memberId === withMember)?.count ?? 0 : 0;
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
  const resultAnnouncement = selectedMember ? `${selectedCount} ${selectedCount === 1 ? "película" : "películas"} en común con ${selectedMember.label}` : !data || !("works" in data) ? "" : data.works.length === 0 ? "No encontramos resultados" : data.nextCursor ? `${data.works.length} resultados cargados; hay más disponibles` : `${data.works.length} resultados`;
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
      setSearch(next.q); setView(next.view); setStatus(next.status); setArchived(next.archived); setGenre(next.genre); setWithMember(next.withMember);
      setFilters(libraryFilterString(next));
    };
    onPopState();
    window.addEventListener("popstate", onPopState);
    return () => { window.removeEventListener("popstate", onPopState); if (debounce.current) clearTimeout(debounce.current); };
  }, []);
  const applyCurrent = (q: string, nextView = view, nextStatus = status, nextArchived = archived, nextGenre = genre, nextMember = withMember, nextPlatforms = availabilityPlatforms, nextFree = free) => { setFilterNotice(""); writeSearch({ q: (composingRef.current ? lastAppliedSearch.current : q).trim(), view: nextView, status: nextStatus, archived: nextArchived, genre: nextGenre, withMember: nextMember, platforms: nextPlatforms, free: nextFree }); };
  return <main className={styles.page}>
    <header className={styles.header}><Link className={styles.brand} href="/">family utils</Link><nav aria-label="Aplicaciones"><Link href="/tareas">Tareas</Link><Link href="/menus">Menús</Link><Link href="/compras">Compras</Link><Link href="/cinemateca" aria-current="page">Cinemateca</Link><Link href="/familia">Mi familia</Link></nav></header>
    {workId && <Link className={styles.back} href="/cinemateca">← Volver a la cinemateca</Link>}
    <div className={styles.heading}><div><h1 ref={detailHeading} tabIndex={-1}>{work?.title ?? "Cinemateca familiar"}</h1></div>{!workId && data && <button className={styles.primary} disabled={adding && busy} onClick={() => { if (!adding) skipDialogFocusReturn.current = false; setAdding(!adding); }}>{adding ? "Cerrar formulario" : "Agregar película"}</button>}</div>
    {error && <p className={styles.error} role="alert">{error} {library.readErrorCode === "INVALID" && view === "pair_pending" && <button onClick={() => applyCurrent(search, "", "", archived, genre, "")}>Quitar selección</button>} <button onClick={() => void library.refresh()}>Reintentar</button></p>}
    {filterNotice && <p className={styles.notice} role="status">{filterNotice}</p>}
    {library.hasChanges && <p className={styles.notice} role="status">Hay cambios. Actualizá para ver la colección al día. <button onClick={() => void library.refresh()}>Actualizar</button></p>}
    {loading && !data && <p role="status">Cargando cinemateca…</p>}
    {adding && data && <WorkDialog busy={busy} shouldRestoreFocus={shouldRestoreDialogFocus} onRequestClose={() => { setAdding(false); library.clearDuplicates(); }}><WorkForm key={`${data.familyId}:${data.currentMemberId}:new`} scope={`${data.familyId}:${data.currentMemberId}:new-work`} busy={busy} duplicates={library.duplicates} issue={library.operationIssue} onIdentityChange={library.clearDuplicates} onCancel={() => { setAdding(false); library.clearDuplicates(); }} onSave={async (input) => { const result = await library.mutate("", "POST", input); if (!result) return false; skipDialogFocusReturn.current = true; setAdding(false); router.push(`/cinemateca/${result.id}`); return true; }} /></WorkDialog>}
    {!workId && data && "works" in data && <>
      <form className={styles.filters} aria-busy={loading} onSubmit={(event) => { event.preventDefault(); if (!composingRef.current) applyCurrent(search); }}>
        <label className={styles.searchLabel}>Buscar películas<input ref={searchInput} type="search" value={search} placeholder="Título o director/a" onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={(event) => { composingRef.current = false; const value = event.currentTarget.value; const pending = deferredPop.current; deferredPop.current = null; if (pending) { setSearch(pending.q); setView(pending.view); setStatus(pending.status); setArchived(pending.archived); setGenre(pending.genre); setWithMember(pending.withMember); writeSearch(pending); } else { debounce.current = setTimeout(() => applyCurrent(value), 0); } }} onKeyDown={(event) => { if (event.key === "Enter" && !composingRef.current) { event.preventDefault(); applyCurrent(search); } }} onChange={(event) => { const value = event.target.value; setSearch(value); if (debounce.current) clearTimeout(debounce.current); if (!composingRef.current) debounce.current = setTimeout(() => applyCurrent(value), 300); }} /></label>
        <div className={styles.quickFilters} role="group" aria-label="Mostrar películas">
          {showOptions.map(option => <button key={option.value} type="button" aria-pressed={(view || status) === option.value} onClick={() => applyCurrent(search, option.value === "common_pending" ? "common_pending" : "", option.value === "common_pending" ? "" : option.value, archived, genre, "")}>{option.label}</button>)}
        </div>
        {commonMembers.length > 0 && <div className={styles.commonSection}>
          <p id="common-members-label" className={styles.filterHelp}>En común con vos</p>
          <div className={styles.quickFilters} role="group" aria-labelledby="common-members-label">
            {commonMembers.map(member => <button key={member.id} type="button" aria-pressed={view === "pair_pending" && withMember === member.id} onClick={() => applyCurrent(search, view === "pair_pending" && withMember === member.id ? "" : "pair_pending", "", archived, genre, view === "pair_pending" && withMember === member.id ? "" : member.id)}>{member.label} · {data.commonPendingCounts.find(entry => entry.memberId === member.id)?.count ?? 0}</button>)}
          </div>
        </div>}
        <div className={styles.collectionTools}>
          <GenreFilter value={genre} onChange={(nextGenre) => applyCurrent(search, view, status, archived, nextGenre)} />
          <div className={styles.archiveSwitch} role="group" aria-label="Ubicación de las películas">
            <button type="button" aria-pressed={!archived} onClick={() => applyCurrent(search, view, status, "")}>Colección</button>
            <button type="button" aria-pressed={archived === "true"} onClick={() => applyCurrent(search, view, status, "true")}>Archivadas</button>
          </div>
        </div>
        {(search || view || status || archived || genre || availabilityPlatforms.length > 0 || free) && <div className={styles.filterExtras}>
          <button type="button" className={styles.clearFilters} onClick={() => { applyCurrent("", "", "", "", "", "", [], false); searchInput.current?.focus(); }}>Limpiar filtros</button>
        </div>}
        {archived && <p className={styles.filterHelp}>Estás viendo las películas archivadas. Podés restaurarlas desde su ficha.</p>}
        {selectedMember && <p className={styles.filterHelp}>Vos y {selectedMember.label} quieren ver estas películas.</p>}
        {view === "common_pending" && <p className={styles.filterHelp}>Todos los integrantes activos las marcaron como Quiero ver.</p>}
      </form>
      {data.availabilityEnabled && <div className={styles.availabilityControls}>{data.availabilitySummary && <AvailabilityFilters summary={data.availabilitySummary} selected={availabilityPlatforms} free={free} onChange={(platforms, nextFree) => applyCurrent(search, view, status, archived, genre, withMember, platforms, nextFree)} />}<AvailabilityTools canManage={data.canManagePlatforms ?? false} onSaved={library.refresh} /></div>}
      <p className={styles.srStatus} role="status" aria-live="polite" aria-atomic="true">{loading ? searchAnnouncement : resultAnnouncement}</p>
      {data.works.length ? <ul className={styles.grid}>{data.works.map(item => <li key={item.id}><MovieCard work={item} memberId={data.currentMemberId} /></li>)}</ul> : <section className={styles.empty}><WorkIcon kind="movie" /><h2>{filters ? "No encontramos películas con estos filtros" : "Nuestra colección empieza acá"}</h2><p>{selectedMember ? `No hay películas que vos y ${selectedMember.label} quieran ver con estos filtros.` : view === "common_pending" ? "Aparecen cuando todos los integrantes activos las marcan como Quiero ver" : filters ? "Probá otro título o ampliá los filtros." : "Agregá una película que quieran ver o recordar."}</p></section>}
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
      <section className={styles.card}><p className={styles.eyebrow}>{KIND_LABELS[work.kind]}{work.archivedAt ? " · Archivada" : ""}</p>{work.creator && <p>{work.creator}</p>}{work.year && <p>Año: {work.year}</p>}{work.runtimeMinutes != null && <p>Duración: <Runtime minutes={work.runtimeMinutes} /></p>}{work.genres.length > 0 && <p>{genreLabels(work.genres).join(" · ")}</p>}</section>
      {work.synopsis && <section className={styles.card}><h2>Sinopsis</h2><p className={styles.body}>{work.synopsis}</p></section>}
      {work.cast.length > 0 && <section className={styles.card}><h2>Reparto</h2><ol className={styles.detailCast}>{work.cast.map(name => <li key={name}>{name}</li>)}</ol></section>}
      {data.availabilityEnabled && work.availability && <section className={styles.card}><h2>Dónde verla en Argentina</h2><AvailabilityDetails value={work.availability} />{!work.archivedAt && <AvailabilityTools key={`${data.familyId}:${data.currentMemberId}:${work.id}:availability`} workId={work.id} value={work.availability} canManage={data.canManagePlatforms ?? false} onSaved={library.refresh} />}</section>}
      <PersonalForm key={`${data.familyId}:${data.currentMemberId}:${work.id}:personal`} work={work} familyId={data.familyId} memberId={data.currentMemberId} busy={busy} issue={library.operationIssue} onSave={async (input) => !!await library.mutate(`/${work.id}/personal`, "PUT", input)} />
      <section className={styles.card}><h2>Las miradas de la familia</h2><p>{familyRating(work.personal)}</p>{work.personal.length ? <ul>{work.personal.map((entry) => <li key={entry.memberId}><strong>{data.members.find((member) => member.id === entry.memberId)?.name ?? "Integrante"}</strong>: {entry.status ? STATUS_LABELS[entry.status] : "Sin estado"} · {entry.rating ? `${entry.rating}/5 estrellas` : "Sin valorar"}</li>)}</ul> : <p>Todavía no hay estados ni valoraciones.</p>}</section>
      {"contributions" in data && <Contributions data={data} issue={library.operationIssue} busy={busy} loading={loading} save={library.mutate} more={library.more} />}

      {"contributions" in data && <NewContribution data={data} issue={library.operationIssue} busy={busy} save={library.mutate} />}
    </>}
  </main>;
}
