"use client";
import { useRecipeQuery } from "./useRecipeQuery";
import { useUnifiedUI } from "@/components/platform/navigation";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readRecipeFilters } from "@/lib/recipes/filters";
import RecipeIcon from "./RecipeIcon";
import NewRecipeDialog from "./NewRecipeDialog";
import TagSelector from "./TagSelector";
import { catalogMemory, catalogOrigin, rememberCatalogOrigin, clearCatalogMemory, acceptCatalogFamily, type CatalogPage } from "./catalog-memory";
import styles from "./recipes.module.css";
function entryId() {
  if (!window.history.state?.recipeEntry) window.history.replaceState({ ...window.history.state, recipeEntry: catalogOrigin.current?.href === `${window.location.pathname}${window.location.search}` ? catalogOrigin.current.entry : crypto.randomUUID() }, "");
  return window.history.state.recipeEntry as string;
}
export default function RecipeList() {
  const unified = useUnifiedUI();
  const router = useRouter(), sequence = useRef(0), params = useRecipeQuery();
  const { query, archived, slugs, queryKey } = readRecipeFilters(params);
  const [typing, setTyping] = useState({ source: query, value: query }), [data, setData] = useState<CatalogPage | null>(null);
  if (typing.source !== query) setTyping({ source: query, value: query });
  const typed = typing.source === query ? typing.value : query;
  const setTyped = (value: string) => setTyping({ source: query, value });
  const [createOpen, setCreateOpen] = useState(false), [filtersOpen, setFiltersOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(true), [stale, setStale] = useState(false);
  const [warning, setWarning] = useState("");
  const currentKey = useRef(""), currentData = useRef<CatalogPage | null>(null), leaving = useRef(false);
  const setSearch = useCallback((search: URLSearchParams, mode: "push" | "replace") => {
    if (mode === "push") setWarning("");
    const href = `/recetas${search.size ? `?${search}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` === href) return;
    window.history[mode === "push" ? "pushState" : "replaceState"](unified ? window.history.state : { ...window.history.state,
      recipeEntry: mode === "push" ? crypto.randomUUID() : entryId() }, "", href);
    window.dispatchEvent(new Event("family-navigation"));
  }, [unified]);
  useEffect(() => {
    if (typed === query) return;
    const timer = setTimeout(() => { const search = new URLSearchParams(window.location.search); if (typed.trim()) search.set("q", typed.trim()); else search.delete("q"); setSearch(search, "replace"); }, 220);
    return () => clearTimeout(timer);
  }, [typed, query, setSearch]);
  async function load(cursor?: string, restore = false) {
    const seq = ++sequence.current;
    setBusy(true); setError("");
    const key = `${unified ? "unified" : entryId()}|${queryKey}`, cached = restore && !unified ? catalogMemory.get(key) : undefined;
    try {
      if (cached) {
        const response = await fetch("/api/recipes?revisionOnly=1", { cache: "no-store" }), body = await response.json();
        if (seq !== sequence.current) return;
        if (!response.ok) { if (response.status === 403) { clearCatalogMemory(); setData(null); currentData.current = null; } throw new Error(body.error); }
        acceptCatalogFamily(body.familyId);
        if (cached.data.familyId === body.familyId) {
          currentKey.current = key; currentData.current = cached.data; setData(cached.data); setStale(cached.data.revision !== body.revision);
          const restoreScroll = cached.scroll;
          leaving.current = true;
          requestAnimationFrame(() => requestAnimationFrame(() => { if (seq === sequence.current) { window.scrollTo(0, restoreScroll); leaving.current = false; } })); return;
        }
        setData(null); currentData.current = null;
      }
      const search = new URLSearchParams(queryKey); search.set("archived", archived ? "1" : "0");
      if (cursor) search.set("cursor", cursor);
      const response = await fetch(`/api/recipes?${search}`, { cache: "no-store" }), body = await response.json();
      if (seq !== sequence.current) return;
      if (response.status === 409 && body.code === "CATALOG_CHANGED") { setStale(true); return; }
      if (!response.ok) { if (response.status === 403) { clearCatalogMemory(); setData(null); currentData.current = null; } throw new Error(body.error); }
      acceptCatalogFamily(body.familyId); leaving.current = false;
      const added = body.ideas.length;
      const page: CatalogPage = body;
      if (cursor && currentKey.current === key && currentData.current) page.ideas = [...currentData.current.ideas, ...page.ideas];
      currentKey.current = key; currentData.current = page; setData(page); setStale(false);
      catalogMemory.set(key, { data: page, scroll: cursor ? window.scrollY : 0 });
      // Bound memory to the most recent history entries.
      if (catalogMemory.size > 20) catalogMemory.delete(catalogMemory.keys().next().value!);
      setNotice(cursor ? `${added} recetas añadidas.` : "");
      if (page.ignoredTags.length) {
        setWarning(`Se quitaron etiquetas que ya no están disponibles: ${page.ignoredTags.map(t => `#${t}`).join(", ")}.`);
        const clean = new URLSearchParams(queryKey); clean.delete("tag");
        slugsFrom(queryKey).filter(t => !page.ignoredTags.includes(t)).forEach(t => clean.append("tag", t)); setSearch(clean, "replace");
      }
    } catch (e) { if (seq === sequence.current) setError(e instanceof Error ? e.message : "No se pudo cargar."); }
    finally { if (seq === sequence.current) setBusy(false); }
  }
  const loadFromEffect = useEffectEvent(load);
  useEffect(() => {
    const requests = sequence;
    const timer = setTimeout(() => { setData(null); currentData.current = null; setStale(false); void loadFromEffect(undefined, true); }, 0);
    return () => { clearTimeout(timer); requests.current++; };
  }, [queryKey]);
  useEffect(() => {
    if (unified) return;
    const scroll = () => { if (leaving.current) return; const cached = catalogMemory.get(currentKey.current); if (cached) cached.scroll = window.scrollY; };
    // Keep already loaded pages on focus; only validate their revision.
    const focus = () => { if (catalogMemory.has(currentKey.current)) void loadFromEffect(undefined, true); else void loadFromEffect(); };
    window.addEventListener("scroll", scroll, { passive: true }); window.addEventListener("focus", focus);
    return () => { window.removeEventListener("scroll", scroll); window.removeEventListener("focus", focus); };
  }, [unified]);
  function changeTags(tags: { slug: string }[]) { const search = new URLSearchParams(queryKey); search.delete("tag"); tags.forEach(t => search.append("tag", t.slug)); setSearch(search, unified ? "replace" : "push"); }
  function changeArchived(value: boolean) { const search = new URLSearchParams(queryKey); if (value) search.set("archived", "true"); else search.delete("archived"); setSearch(search, "push"); }
  function remember(recipeId: string) {
    if (unified) return;
    leaving.current = true;
    const cached = catalogMemory.get(currentKey.current); if (cached) cached.scroll = window.scrollY;
    rememberCatalogOrigin(recipeId, `${window.location.pathname}${window.location.search}`, entryId());
  }
  function clearFilters() { setTyped(""); setSearch(new URLSearchParams(), "push"); }
  const selected = slugs.map(slug => ({ slug, name: data?.tags.find(t => t.slug === slug)?.name ?? slug }));
  const filterCount = slugs.length + (archived ? 1 : 0);
  return <div className={styles.catalog}>
    <div className={styles.catalogHeading}>
      <div><p className={styles.eyebrow}><RecipeIcon name="book" /> EL RECETARIO FAMILIAR</p><h1>Recetas</h1><p className={styles.catalogIntro}>Los platos que nos gusta compartir.</p></div>
      <button className={`${styles.primary} ${styles.newRecipeButton}`} onClick={() => setCreateOpen(true)}><RecipeIcon name="plus" />Nueva receta</button>
    </div>
    <div className={styles.catalogTools}>
      <div className={styles.searchField}>
        <RecipeIcon name="search" />
        <label className={styles.srOnly} htmlFor="recipe-search">Buscar recetas</label>
        <input id="recipe-search" name="recipeSearch" type="search" autoComplete="off" placeholder="Buscá por nombre…" value={typed} onChange={e => { setWarning(""); setTyped(e.target.value); }} maxLength={160} />
      </div>
      <button ref={filterButton} className={styles.filterButton} aria-label="Filtros" aria-expanded={filtersOpen} aria-controls="recipe-filter-panel" data-active={filterCount > 0} onClick={() => setFiltersOpen(!filtersOpen)}>
        <RecipeIcon name="filters" />Filtros{filterCount > 0 && <span className={styles.filterBadge} aria-hidden="true">{filterCount}</span>}
      </button>
    </div>
    {filtersOpen && <section id="recipe-filter-panel" className={styles.filterPanel} aria-label="Filtros de recetas" onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) { setFiltersOpen(false); filterButton.current?.focus(); } }}>
      <div className={styles.filterPanelHeading}><h2>Filtrar recetas</h2><button className={styles.quietButton} onClick={() => { setFiltersOpen(false); filterButton.current?.focus(); }}>Listo</button></div>
      <div className={styles.availability} role="group" aria-label="Estado de las recetas"><button aria-pressed={!archived} onClick={() => changeArchived(false)}>Disponibles</button><button aria-pressed={archived} onClick={() => changeArchived(true)}>Ocultas</button></div>
      <TagSelector label="Filtrar por etiquetas" selected={selected} options={data?.tags ?? []} onChange={changeTags} showSelected={false} />
    </section>}
    <div className={styles.collectionHeading}>
      <p role="status" aria-live="polite">{busy ? "Buscando…" : data ? <><strong>{data.total}</strong> {data.total === 1 ? "receta" : "recetas"}{archived ? " ocultas" : ""}<span className={styles.srOnly}>. {notice}</span></> : notice}</p>
      {(query || filterCount > 0) && <button className={styles.clearFilters} onClick={clearFilters}>Limpiar filtros</button>}
    </div>
    {filterCount > 0 && <div className={`${styles.tags} ${styles.activeFilters}`} aria-label="Filtros activos" role="group">
      {archived && <button aria-label="Quitar filtro Ocultas" onClick={() => changeArchived(false)}>Ocultas<RecipeIcon name="close" /></button>}
      {selected.map(tag => <button key={tag.slug} aria-label={`Quitar etiqueta ${tag.name}`} onClick={() => changeTags(selected.filter(t => t.slug !== tag.slug))}>#{tag.name}<RecipeIcon name="close" /></button>)}
    </div>}
    {warning && <p className={styles.filterWarning} role="status">{warning}</p>}
    {error && <div role="alert" className={styles.error}>{error} <button onClick={() => void load()}>Reintentar consulta</button></div>}
    {stale && <div className={styles.notice} role="status">El recetario se actualizó. Actualizá la lista para seguir viendo recetas. <button disabled={busy} onClick={() => void load()}>Actualizar lista</button></div>}
    <ul className={styles.recipeList} aria-label="Recetas de la familia" aria-busy={busy}>{(data?.ideas ?? []).map((item, index) => <li className={styles.recipeRow} key={item.id}>
      <Link className={styles.recipeRowLink} aria-label={item.title} href={`/recetas/${item.id}`} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) remember(item.id); }}>
        <span className={styles.recipeMark} data-tone={index % 3}><RecipeIcon name="bowl" /></span>
        <div className={styles.recipeRowText}><h2>{item.title}</h2>{item.note && <p className={styles.noteSummary}>{item.note}</p>}</div>
        <RecipeIcon name="arrow" className={styles.rowArrow} />
      </Link>
      {!!item.tags?.length && <div className={`${styles.tags} ${styles.rowTags}`}>{item.tags.map(tag => <button key={tag.id} aria-pressed={slugs.includes(tag.slug)} disabled={busy || (!slugs.includes(tag.slug) && slugs.length >= 10)} onClick={() => changeTags(slugs.includes(tag.slug) ? selected.filter(t => t.slug !== tag.slug) : [...selected, tag])}>#{tag.name}</button>)}</div>}
    </li>)}</ul>
    {!data && busy && <div className={styles.listSkeleton} aria-hidden="true">{[0, 1, 2].map(n => <div key={n}><span /><i /></div>)}</div>}
    {!busy && !error && data && !data.ideas.length && <div className={styles.emptyCatalog}>
      <span className={styles.emptyMark}><RecipeIcon name={query || filterCount ? "search" : "book"} /></span>
      <h2>{query || filterCount ? "No encontramos esa receta" : "Tu recetario empieza acá"}</h2>
      <p>{query || filterCount ? "Probá con otro nombre o quitá alguna etiqueta." : "Agregá tu primera receta y tené tus platos favoritos siempre a mano."}</p>
    </div>}
    {data?.nextCursor && <div className={styles.loadMore}><button disabled={busy || stale} onClick={() => void load(data.nextCursor!)}>{busy ? "Cargando…" : "Ver más recetas"}<RecipeIcon name="arrow" /></button></div>}
    {createOpen && <NewRecipeDialog onClose={() => setCreateOpen(false)} onVisit={remember} onCreated={id => { remember(id); setCreateOpen(false); router.push(`/recetas/${id}`); }} />}
  </div>;
}
function slugsFrom(search: string) { return new URLSearchParams(search).getAll("tag"); }
