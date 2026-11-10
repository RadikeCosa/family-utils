"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { parseTags } from "@/lib/recipes/tags";
import RecipeIcon from "./RecipeIcon";
import TagSelector from "./TagSelector";
import styles from "./recipes.module.css";
export default function NewRecipeDialog({ onClose, onCreated, onVisit }: {
  onClose: () => void; onCreated: (id: string) => void; onVisit: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId();
  const [title, setTitle] = useState(""), [tags, setTags] = useState<string[]>([]), [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [existing, setExisting] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.querySelector("h2")?.setAttribute("autofocus", "");
    element.showModal();
    const viewport = window.visualViewport;
    const syncViewport = () => {
      if (!viewport || viewport.height < 180) return;
      element.style.setProperty("--recipe-dialog-height", `${viewport.height}px`);
      element.style.setProperty("--recipe-dialog-top", `${viewport.offsetTop + viewport.height / 2}px`);
    };
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    syncViewport();
    return () => {
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      element.close(); document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setExisting(null);
    try {
      const response = await fetch("/api/recipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, tags }) });
      const body = await response.json();
      if (!response.ok) { if (body.existing) setExisting(body.existing.id); throw new Error(body.error); }
      onCreated(body.idea.id);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear la receta. Probá otra vez."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.createDialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className={styles.dialogHeading}>
      <div><h2 id={`${id}-title`} tabIndex={-1}>Nueva receta</h2></div>
      <button type="button" className={styles.iconButton} aria-label="Cerrar nueva receta" disabled={busy} onClick={onClose}><RecipeIcon name="close" /></button>
    </div>
    <p id={`${id}-intro`} className={styles.dialogIntro}>Solo el nombre es obligatorio. Podés completar el resto después.</p>
    <form onSubmit={event => void create(event)} className={styles.newRecipeForm}>
      <fieldset disabled={busy}>
        <label htmlFor={`${id}-name`}>Nombre de la receta</label>
        <input id={`${id}-name`} name="recipeTitle" required maxLength={160} autoComplete="off" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ej. Tarta de verduras…" />
        <details className={styles.optionalTags} onToggle={e => setAdvanced(e.currentTarget.open)}>
          <summary><RecipeIcon name="tag" /><span>Agregar etiquetas</span><span className={styles.optionalLabel}>Opcional</span><RecipeIcon name="arrow" className={styles.optionalDisclosure} /></summary>
          {advanced && <TagSelector label="Etiquetas" selected={parseTags(tags)} onChange={values => setTags(values.map(t => t.name))} disabled={busy} />}
        </details>
      </fieldset>
      {error && <div role="alert" className={styles.error}>{error} {existing && <Link href={`/recetas/${existing}`} onClick={() => onVisit(existing)}>Abrir receta existente</Link>}</div>}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.quietButton} disabled={busy} onClick={onClose}>Cancelar</button>
        <button className={styles.primary} disabled={busy}>{busy ? "Creando…" : "Crear receta"}<RecipeIcon name="arrow" /></button>
      </div>
    </form>
  </dialog>;
}
