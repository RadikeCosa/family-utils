"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Recipe, RecipeDraft } from "@/lib/recipes/types";
import { draftText } from "@/lib/recipes/rules";
import RecipeBackLink from "./RecipeBackLink";
import RecipeEditor from "./RecipeEditor";
import RecipeShopping from "./RecipeShopping";
import RecipeToMenu from "./RecipeToMenu";
import styles from "./recipes.module.css";
export default function RecipeDetail({ id }: { id: string }) {
  const [recipe, setRecipe] = useState<Recipe | null>(null), [editing, setEditing] = useState(false), [buying, setBuying] = useState(false), [planning, setPlanning] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [comparison, setComparison] = useState<Recipe | null>(null), [existing, setExisting] = useState<string | null>(null);
  const etag = useRef<string | null>(null), sequence = useRef(0);
  const load = useCallback(async (compare = false) => {
    const seq = ++sequence.current;
    try {
      const response = await fetch(`/api/recipes/${id}`, { headers: !compare && etag.current ? { "If-None-Match": etag.current } : {} });
      if (response.status === 304) return;
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (seq === sequence.current) { if (compare) setComparison(body.recipe); else { setRecipe(body.recipe); etag.current = response.headers.get("etag"); } }
    } catch (e) { if (seq === sequence.current) setError(e instanceof Error ? e.message : "No se pudo consultar."); }
  }, [id]);
  useEffect(() => { const requests = sequence; void load(); return () => { requests.current++; }; }, [load]);
  useEffect(() => { if (editing || buying || planning) return; const focus = () => void load(); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [load, editing, buying, planning]);
  async function save(draft: RecipeDraft | { action: string }) {
    if (!recipe) return; setBusy(true); setError(""); setExisting(null); sequence.current++;
    try {
      const response = await fetch(`/api/recipes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, expectedVersion: recipe.version }) });
      const body = await response.json();
      if (!response.ok) { if (body.existing) setExisting(body.existing.id); throw new Error(body.error); }
      etag.current = null; setEditing(false); setComparison(null); setNotice(body.changed ? "Receta guardada." : "La receta ya estaba actualizada."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); } finally { setBusy(false); }
  }
  return <><p><RecipeBackLink recipeId={id} /></p>
    {error && <p className={styles.error} role="alert">{error} {existing && <Link href={`/recetas/${existing}`}>Abrir receta existente</Link>}{!recipe && <button onClick={() => void load()}>Reintentar</button>}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {!recipe ? !error && <p role="status">Cargando receta…</p> : <><h1>{recipe.title}</h1>
      <div className={styles.tags}>{(recipe.tags ?? []).map(tag => <Link key={tag.id} href={`/recetas?tag=${encodeURIComponent(tag.slug)}`}>#{tag.name}</Link>)}</div>
      {recipe.archivedAt && <p className={styles.notice}>Plato oculto. Podés consultarlo, editarlo y enviar ingredientes a Compras. Para elegirlo nuevamente en Menús hay que restaurarlo.</p>}
      {recipe.updatedByName && <p className={styles.muted}>Última edición: {recipe.updatedByName} · {new Date(recipe.updatedAt).toLocaleString("es-AR")}</p>}
      {editing ? <><RecipeEditor initial={{ ...recipe, tags: (recipe.tags ?? []).map(t => t.name) }} busy={busy} onSave={save} onServer={() => load(true)} onCancel={() => { if (window.confirm("¿Descartar el borrador y cargar la versión actual?")) { setEditing(false); setComparison(null); setError(""); etag.current = null; void load(); } }} />{comparison && <section className={styles.card} aria-label="Versión actual del servidor"><h2>Versión actual · {comparison.version}</h2><pre className={styles.preparation}>{draftText({ ...comparison, tags: (comparison.tags ?? []).map(t => t.name) })}</pre><p>Tu borrador sigue arriba. Copialo antes de descartarlo para cargar esta versión.</p></section>}</> : <>
        <div className={styles.actions}><button onClick={() => { sequence.current++; setEditing(true); setBuying(false); setPlanning(false); setError(""); }}>Editar receta</button>{recipe.canManage && <button disabled={busy} onClick={() => { if (window.confirm(recipe.archivedAt ? "¿Restaurar este plato?" : "¿Ocultar este plato del repertorio? Las elecciones existentes se conservan.")) void save({ action: recipe.archivedAt ? "restore" : "archive" }); }}>{recipe.archivedAt ? "Restaurar plato" : "Ocultar plato"}</button>}</div>
        {recipe.note && <p className={styles.preparation}>{recipe.note}</p>}<p>{recipe.yieldText ? `Rendimiento: ${recipe.yieldText}` : "Rendimiento todavía sin completar."}</p>
        <h2>Ingredientes</h2>{recipe.ingredients.length ? <ul>{recipe.ingredients.map(i => <li key={i.id}><p>{i.name}{i.quantity ? ` · ${i.quantity}` : ""}</p></li>)}</ul> : <p>Todavía no se cargaron ingredientes.</p>}
        <h2>Preparación</h2><p className={styles.preparation}>{recipe.preparation || "Todavía no se cargó la preparación."}</p>
        <div className={styles.actions}><button disabled={!recipe.ingredients.length} onClick={() => { sequence.current++; setBuying(true); setPlanning(false); }}>Pasar ingredientes a Compras</button><button disabled={!!recipe.archivedAt} onClick={() => { sequence.current++; setPlanning(true); setBuying(false); }}>Usar en Menús</button></div>
        {buying && <RecipeShopping recipe={recipe} onClose={() => setBuying(false)} />}
        {planning && <RecipeToMenu recipeId={recipe.id} onClose={() => setPlanning(false)} />}
      </>}
    </>}
  </>;
}
