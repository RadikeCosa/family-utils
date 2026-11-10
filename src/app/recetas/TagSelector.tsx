"use client";
import { useEffect, useId, useState } from "react";
import { normalizeTagNameV1, parseTags, tagCompare } from "@/lib/recipes/tags";
import type { RecipeTag } from "@/lib/recipes/types";
import styles from "./recipes.module.css";
type Choice = { name: string; slug: string };
export type TagOption = RecipeTag & { count?: number };
export default function TagSelector({ label, selected, onChange, options, disabled = false }: {
  label: string; selected: Choice[]; onChange: (tags: Choice[]) => void; options?: TagOption[]; disabled?: boolean;
}) {
  const id = useId(), editing = options === undefined;
  const [available, setAvailable] = useState<TagOption[]>([]), [query, setQuery] = useState(""), [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1), [error, setError] = useState("");
  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    void fetch("/api/recipes/tags?mode=edit", { cache: "no-store", signal: controller.signal }).then(async r => {
      const body = await r.json(); if (!r.ok) throw new Error(body.error); setAvailable(body.tags ?? []);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudieron cargar sugerencias."); });
    return () => controller.abort();
  }, [editing]);
  const normalized = normalizeTagNameV1(query.trim().replace(/^#/, ""));
  const choices: (Choice & { count?: number; create?: boolean })[] = (options ?? available).filter(t => t.slug.includes(normalized));
  let creatable: Choice | undefined;
  if (editing && query.trim()) { try { creatable = parseTags([query])[0]; } catch { /* Validation is shown when trying to add. */ } }
  if (creatable && ![...choices, ...selected].some(t => t.slug === creatable!.slug)) choices.push({ ...creatable, create: true });
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  const picked = (slug: string) => selected.some(t => t.slug === slug);
  function choose(index: number) {
    const tag = choices[index]; if (!tag || disabled || (!picked(tag.slug) && (tag.count === 0 || selected.length >= 10))) return;
    const next = picked(tag.slug) ? selected.filter(t => t.slug !== tag.slug) : [...selected, { name: tag.name, slug: tag.slug }];
    onChange(next.sort((a, b) => tagCompare(a.slug, b.slug))); setQuery(""); setActive(-1); setError("");
  }
  return <div className={styles.tagSelector} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setOpen(false); setActive(-1); } }}>
    <label htmlFor={id}>{label}</label>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open && !disabled} aria-controls={`${id}-options`}
      aria-activedescendant={open && active >= 0 && choices[active] ? `${id}-option-${active}` : undefined}
      aria-describedby={`${id}-help`} autoComplete="off" disabled={disabled} value={query}
      onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true); setActive(-1); }}
      onKeyDown={e => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setActive(i => !choices.length ? -1 : i < 0 ? (e.key === "ArrowDown" ? 0 : choices.length - 1) : (i + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length); }
        if (e.key === "Escape") { e.preventDefault(); setOpen(false); setActive(-1); }
        if (e.key === "Enter") { e.preventDefault(); if (open && active >= 0) choose(active); else if (editing && query.trim()) {
          try { const tag = parseTags([query])[0], index = choices.findIndex(t => t.slug === tag.slug); if (index >= 0) choose(index); } catch (e) { setError((e as Error).message); }
        } }
      }} />
    <p id={`${id}-help`} className={styles.muted}>{editing ? "Elegí una sugerencia o escribí una etiqueta y presioná Enter. Hasta 10 etiquetas." : "Se mostrarán recetas con todas las etiquetas seleccionadas."}</p>
    {open && !disabled && <ul id={`${id}-options`} role="listbox" aria-label={label} aria-multiselectable="true" className={styles.tagOptions}>
      {choices.map((t, i) => <li key={t.slug} id={`${id}-option-${i}`} role="option" aria-selected={picked(t.slug)}
        aria-disabled={!picked(t.slug) && (t.count === 0 || selected.length >= 10)} data-active={active === i}
        onMouseDown={e => e.preventDefault()} onClick={() => choose(i)}>
        {t.create ? `Crear etiqueta #${t.name}` : `#${t.name}`}{t.count !== undefined ? ` (${t.count})` : ""}{picked(t.slug) ? " · seleccionada" : ""}
      </li>)}
      {!choices.length && <li role="option" aria-selected="false" aria-disabled="true">Sin sugerencias</li>}
    </ul>}
    <div role="group" className={styles.tags} aria-label={`Selección: ${label}`}>{selected.map(t => <button type="button" disabled={disabled} key={t.slug}
      aria-label={`Quitar etiqueta ${t.name}`} onClick={() => onChange(selected.filter(s => s.slug !== t.slug))}>#{t.name} ×</button>)}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>;
}
