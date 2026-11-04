"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./recipes.module.css";
type Item = { id: string; title: string; note: string | null };
export default function RecipeList() {
  const router = useRouter(), sequence = useRef(0);
  const [query, setQuery] = useState(""), [archived, setArchived] = useState(false), [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<number | null>(null), [title, setTitle] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [creating, setCreating] = useState(false), [existing, setExisting] = useState<string | null>(null);
  const load = useCallback(async (offset = 0) => {
    const seq = ++sequence.current; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/recipes?q=${encodeURIComponent(query)}&archived=${archived ? 1 : 0}&offset=${offset}`, { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (sequence.current === seq) { setItems(current => offset ? [...current, ...body.ideas] : body.ideas); setNext(body.nextOffset); }
    } catch (e) { if (sequence.current === seq) setError(e instanceof Error ? e.message : "No se pudo cargar."); }
    finally { if (sequence.current === seq) setBusy(false); }
  }, [query, archived]);
  useEffect(() => { const requests = sequence; const timer = setTimeout(() => void load(), 220); return () => { clearTimeout(timer); requests.current++; }; }, [load]);
  useEffect(() => { const focus = () => void load(); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault(); setCreating(true); setError(""); setExisting(null);
    try {
      const response = await fetch("/api/recipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      const body = await response.json();
      if (!response.ok) { if (body.existing) setExisting(body.existing.id); throw new Error(body.error); }
      router.push(`/recetas/${body.idea.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear."); } finally { setCreating(false); }
  }
  return <><h1>Recetas</h1><p className={styles.muted}>Los platos de siempre, con un lugar para completar cómo los preparamos.</p>
    <form className={styles.toolbar} onSubmit={event => void create(event)}><label>Nombre del nuevo plato<input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} required /></label><button className={styles.primary} disabled={creating}>Crear receta</button></form>
    <div className={styles.toolbar}><label>Buscar recetas<input type="search" value={query} onChange={e => setQuery(e.target.value)} maxLength={160} /></label><button aria-pressed={!archived} onClick={() => setArchived(false)}>Disponibles</button><button aria-pressed={archived} onClick={() => setArchived(true)}>Ocultas</button></div>
    {error && <p role="alert" className={styles.error}>{error} {existing ? <Link href={`/recetas/${existing}`}>Abrir receta existente</Link> : <button onClick={() => void load()}>Reintentar consulta</button>}</p>}
    {busy && <p role="status">Buscando…</p>}
    <section className={styles.grid} aria-label="Recetas de la familia">{items.map(item => <article className={styles.card} key={item.id}><h2><Link href={`/recetas/${item.id}`}>{item.title}</Link></h2><p>{item.note || "Podés completar sus ingredientes y preparación."}</p></article>)}</section>
    {!busy && !items.length && <p>Todavía no hay recetas en esta vista.</p>}
    {next !== null && <button disabled={busy} onClick={() => void load(next)}>Ver más recetas</button>}
  </>;
}
