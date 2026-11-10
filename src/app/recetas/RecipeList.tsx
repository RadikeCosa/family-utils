"use client";
import { useRecipeQuery } from "./useRecipeQuery";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseTags } from "@/lib/recipes/tags";
import { readRecipeFilters } from "@/lib/recipes/filters";
import TagSelector from "./TagSelector";
import { catalogMemory, catalogOrigin, clearCatalogMemory, acceptCatalogFamily, type CatalogPage } from "./catalog-memory";
import styles from "./recipes.module.css";
function entryId() {
  if (!window.history.state?.recipeEntry) window.history.replaceState({ ...window.history.state, recipeEntry: catalogOrigin.current?.href === `${window.location.pathname}${window.location.search}` ? catalogOrigin.current.entry : crypto.randomUUID() }, "");
  return window.history.state.recipeEntry as string;
}
export default function RecipeList() {
  const router = useRouter(), sequence = useRef(0), params = useRecipeQuery();
  const { query, archived, slugs, queryKey } = readRecipeFilters(params);
  const [typing, setTyping] = useState({ source: query, value: query }), [data, setData] = useState<CatalogPage | null>(null);
  if (typing.source !== query) setTyping({ source: query, value: query });
  const typed = typing.source === query ? typing.value : query;
  const setTyped = (value: string) => setTyping({ source: query, value });
  const [title, setTitle] = useState(""), [newTags, setNewTags] = useState<string[]>([]);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(true), [stale, setStale] = useState(false);
  const [warning, setWarning] = useState("");
  const [creating, setCreating] = useState(false), [existing, setExisting] = useState<string | null>(null);
  const currentKey = useRef(""), currentData = useRef<CatalogPage | null>(null), leaving = useRef(false);
  const setSearch = useCallback((search: URLSearchParams, mode: "push" | "replace") => {
    if (mode === "push") setWarning("");
    const href = `/recetas${search.size ? `?${search}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` === href) return;
    window.history[mode === "push" ? "pushState" : "replaceState"]({ ...window.history.state,
      recipeEntry: mode === "push" ? crypto.randomUUID() : entryId() }, "", href);
    window.dispatchEvent(new Event("family-navigation"));
  }, []);
  useEffect(() => {
    if (typed === query) return;
    const timer = setTimeout(() => { const search = new URLSearchParams(window.location.search); if (typed.trim()) search.set("q", typed.trim()); else search.delete("q"); setSearch(search, "replace"); }, 220);
    return () => clearTimeout(timer);
  }, [typed, query, setSearch]);
  async function load(cursor?: string, restore = false) {
    const seq = ++sequence.current;
    setBusy(true); setError("");
    const key = `${entryId()}|${queryKey}`, cached = restore ? catalogMemory.get(key) : undefined;
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
    const scroll = () => { if (leaving.current) return; const cached = catalogMemory.get(currentKey.current); if (cached) cached.scroll = window.scrollY; };
    // Keep already loaded pages on focus; only validate their revision.
    const focus = () => { if (catalogMemory.has(currentKey.current)) void loadFromEffect(undefined, true); else void loadFromEffect(); };
    window.addEventListener("scroll", scroll, { passive: true }); window.addEventListener("focus", focus);
    return () => { window.removeEventListener("scroll", scroll); window.removeEventListener("focus", focus); };
  }, []);
  function changeTags(tags: { slug: string }[]) { const search = new URLSearchParams(queryKey); search.delete("tag"); tags.forEach(t => search.append("tag", t.slug)); setSearch(search, "push"); }
  function changeArchived(value: boolean) { const search = new URLSearchParams(queryKey); if (value) search.set("archived", "true"); else search.delete("archived"); setSearch(search, "push"); }
  function remember(recipeId: string) {
    leaving.current = true;
    const cached = catalogMemory.get(currentKey.current); if (cached) cached.scroll = window.scrollY;
    catalogOrigin.current = { recipeId, href: `${window.location.pathname}${window.location.search}`, entry: entryId(), pending: true };
  }
  async function create(event: React.FormEvent) {
    event.preventDefault(); setCreating(true); setError(""); setExisting(null);
    try {
      const response = await fetch("/api/recipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, tags: newTags }) });
      const body = await response.json(); if (!response.ok) { if (body.existing) setExisting(body.existing.id); throw new Error(body.error); }
      remember(body.idea.id); router.push(`/recetas/${body.idea.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear."); } finally { setCreating(false); }
  }
  const selected = slugs.map(slug => ({ slug, name: data?.tags.find(t => t.slug === slug)?.name ?? slug }));
  return <><h1>Recetas</h1><p className={styles.muted}>Los platos de siempre, con un lugar para completar cómo los preparamos.</p>
    <form className={styles.form} onSubmit={event => void create(event)}>
      <div className={styles.toolbar}><label>Nombre del nuevo plato<input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} required /></label><button className={styles.primary} disabled={creating}>Crear receta</button></div>
      <TagSelector label="Etiquetas del nuevo plato" selected={parseTags(newTags)} onChange={tags => setNewTags(tags.map(t => t.name))} disabled={creating} />
    </form>
    <div className={styles.toolbar}><label>Buscar recetas<input type="search" value={typed} onChange={e => { setWarning(""); setTyped(e.target.value); }} maxLength={160} /></label>
      <button data-legacy-sections aria-pressed={!archived} onClick={() => changeArchived(false)}>Disponibles</button><button data-legacy-sections aria-pressed={archived} onClick={() => changeArchived(true)}>Ocultas</button></div>
    <TagSelector label="Filtrar por etiquetas" selected={selected} options={data?.tags ?? []} onChange={changeTags} disabled={busy} />
    {(query || slugs.length > 0) && <button onClick={() => { const search = new URLSearchParams(queryKey); search.delete("q"); search.delete("tag"); setTyped(""); setSearch(search, "push"); }}>Limpiar filtros</button>}
    {error && <p role="alert" className={styles.error}>{error} {existing ? <Link href={`/recetas/${existing}`}>Abrir receta existente</Link> : <button onClick={() => void load()}>Reintentar consulta</button>}</p>}
    <p role="status" aria-live="polite">{busy ? "Buscando…" : data ? `${data.total} recetas encontradas. ${notice} ${warning}` : notice}</p>
    {stale && <div className={styles.notice} role="status">El catálogo cambió. Actualizá la lista para continuar. <button disabled={busy} onClick={() => void load()}>Actualizar lista</button></div>}
    <ul className={styles.recipeList} aria-label="Recetas de la familia" aria-busy={busy}>{(data?.ideas ?? []).map(item => <li className={styles.recipeRow} key={item.id}>
      <h2><Link href={`/recetas/${item.id}`} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) remember(item.id); }}>{item.title}</Link></h2>
      {item.note && <p className={styles.noteSummary}>{item.note}</p>}
      <div className={styles.tags}>{(item.tags ?? []).map(tag => <button key={tag.id} aria-pressed={slugs.includes(tag.slug)} disabled={busy || (!slugs.includes(tag.slug) && slugs.length >= 10)} onClick={() => {
        changeTags(slugs.includes(tag.slug) ? selected.filter(t => t.slug !== tag.slug) : [...selected, tag]);
      }}>#{tag.name}</button>)}</div>
    </li>)}</ul>
    {!busy && !error && data && !data.ideas.length && <p>{query || slugs.length ? "No hay recetas con estos filtros. Probá quitar alguna etiqueta o cambiar el nombre." : "Todavía no hay recetas en esta vista."}</p>}
    {data?.nextCursor && <button disabled={busy || stale} onClick={() => void load(data.nextCursor!)}>Ver más recetas</button>}
  </>;
}
function slugsFrom(search: string) { return new URLSearchParams(search).getAll("tag"); }
