"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MealType } from "@/lib/meals/rules";
import type { MealIdea } from "@/lib/meals/types";
import styles from "./menus.module.css";

export type BankState = { date: string; mealType: MealType; menu: 1 | 2; opener: HTMLElement; fallbackOpenerId?: string };
type CatalogItem = Pick<MealIdea, "id" | "title" | "note" | "authorMemberId" | "authorName" | "version"> & { lastUsedAt: string | null; archivedAt: string | null };
type Draft = { id?: string; version?: number; title: string; note: string };

export default function IdeaBank({ state, onClose, onUse, onChanged, currentMemberId, adult, today }: {
  state: BankState | null; onClose: () => void; onUse: (idea: Pick<CatalogItem, "id" | "title" | "note" | "authorName">) => Promise<boolean>;
  onChanged: () => Promise<unknown>; currentMemberId: string; adult: boolean; today: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLElement | null>(null), input = useRef<HTMLInputElement>(null), sequence = useRef(0);
  const [items, setItems] = useState<CatalogItem[]>([]), [nextOffset, setNextOffset] = useState<number | null>(null);
  const [query, setQuery] = useState(""), [note, setNote] = useState(""), [archived, setArchived] = useState(false), [manage, setManage] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [hiddenExact, setHiddenExact] = useState<CatalogItem | null>(null);
  const load = useCallback(async (search: string, showArchived: boolean, offset = 0, append = false) => {
    const request = ++sequence.current; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/meals/catalog?q=${encodeURIComponent(search)}&archived=${showArchived ? 1 : 0}&offset=${offset}`, { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo cargar el repertorio.");
      if (request === sequence.current) { setItems(current => append ? current.concat(body.ideas) : body.ideas); setNextOffset(body.nextOffset); }
      if (!showArchived && search.trim()) {
        const hidden = await fetch(`/api/meals/catalog?q=${encodeURIComponent(search.trim())}&archived=1&limit=1`, { cache: "no-store" }).then(r => r.json());
        if (request === sequence.current) setHiddenExact(hidden.ideas?.find((idea: CatalogItem) => normalize(idea.title) === normalize(search)) ?? null);
      } else if (request === sequence.current) setHiddenExact(null);
    } catch (failure) { if (request === sequence.current) setError(failure instanceof Error ? failure.message : "No se pudo cargar el repertorio."); }
    finally { if (request === sequence.current) setBusy(false); }
  }, []);
  useEffect(() => {
    if (!state) { if (dialog.current?.open) dialog.current.close(); return; }
    opener.current = state.opener; dialog.current?.showModal();
    let cancelled = false;
    queueMicrotask(() => { if (cancelled) return; setQuery(""); setNote(""); setArchived(false); setManage(false); setDraft(null); setHiddenExact(null); input.current?.focus(); void load("", false, 0); });
    return () => { cancelled = true; };
  }, [state, load]);
  useEffect(() => { if (!state || archived) return; const timer = window.setTimeout(() => void load(query, false, 0), 220); return () => clearTimeout(timer); }, [query, state, archived, load]);
  function close() { if (!busy) { onClose(); if (opener.current?.isConnected && opener.current.checkVisibility()) opener.current.focus(); else if (state?.fallbackOpenerId) document.getElementById(state.fallbackOpenerId)?.focus(); } }
  async function saveIdea(event: React.FormEvent) {
    event.preventDefault(); if (!draft?.title.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(draft.id ? `/api/meals/ideas/${draft.id}` : "/api/meals/ideas", { method: draft.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft.id ? { title: draft.title, note: draft.note || null, mealTypes: [], packedSuitable: false, expectedVersion: draft.version } : { title: draft.title, note: draft.note || null }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo guardar el plato.");
      setDraft(null); await onChanged(); await load(query, archived, 0);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo guardar el plato."); }
    finally { setBusy(false); }
  }
  async function manageItem(item: CatalogItem, action: "edit" | "archive" | "restore") {
    if (action === "edit") { setDraft({ id: item.id, version: item.version, title: item.title, note: item.note ?? "" }); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/meals/ideas/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, expectedVersion: item.version }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo actualizar el plato.");
      await onChanged(); await load(query, archived, 0);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo actualizar el plato."); }
    finally { setBusy(false); }
  }
  async function choose(item: Pick<CatalogItem, "id" | "title" | "note" | "authorName">) {
    setBusy(true); setError("");
    const ok = await onUse(item);
    if (ok) close(); else setError("No se pudo agregar la comida. El plato sigue disponible; podés intentar de nuevo.");
    setBusy(false);
  }
  const canManage = (item: CatalogItem) => adult || item.authorMemberId === currentMemberId;
  return <dialog ref={dialog} className={`${styles.dialog} ${styles.bankDialog}`} aria-labelledby="catalog-title" onCancel={event => { event.preventDefault(); close(); }}>
    <button className={styles.dialogClose} aria-label="Cerrar repertorio" disabled={busy} onClick={close}>×</button>
    <h2 id="catalog-title">{draft ? (draft.id ? "Editar plato" : "Anotar para otro día") : "Agregar comida"}</h2>
    {draft ? <form onSubmit={event => void saveIdea(event)}>
      <div className={styles.formFields}>
        <label>Nombre<input ref={input} required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>Nota opcional<textarea rows={3} maxLength={1000} value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} /></label>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setDraft(null)}>Volver</button><button className={styles.primaryButton} disabled={busy || !draft.title.trim()}>{busy ? "Guardando…" : "Guardar plato"}</button></div>
    </form> : <>
      <p>{state ? `${state.mealType === "lunch" ? "Almuerzo" : state.mealType === "dinner" ? "Cena" : state.mealType === "breakfast" ? "Desayuno" : "Merienda"} · ${new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${state.date}T12:00:00Z`))}` : "Repertorio familiar"}</p>
      <div className={styles.formFields}><label>¿Qué vamos a comer?<input ref={input} type="search" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" /></label></div>
      <div className={styles.bankToolbar}>
        <div className={styles.viewSwitcher}><button disabled={busy} aria-pressed={!archived} onClick={() => { setArchived(false); void load(query, false, 0); }}>Disponibles</button><button disabled={busy} aria-pressed={archived} onClick={() => { setArchived(true); void load(query, true, 0); }}>Ocultos</button></div>
        {!hiddenExact && !items.some(item => normalize(item.title) === normalize(query)) && <button className={styles.secondaryButton} disabled={busy} onClick={() => { setDraft({ title: query.trim(), note: "" }); setError(""); }}>Anotar para otro día</button>}
      </div>
      {error && <p className={styles.error} role="alert">{error}<button className={styles.expandButton} onClick={() => void load(query, archived, 0)}>Reintentar</button></p>}
      {busy && <p className={styles.loading} role="status">Buscando…</p>}
      {!busy && !items.length && <p className={styles.empty}>{archived ? "No hay platos ocultos." : "Todavía no hay platos en el repertorio."}</p>}
      <div className={styles.bankIdeas}>{items.map(item => <article className={styles.bankIdea} key={item.id}>
        <h3>{item.title}</h3>{item.note && <p>{item.note}</p>}
        <div className={styles.suggestionActions}>
          {!archived && state && state.date >= today && <button disabled={busy} onClick={() => void choose(item)}>{hiddenExact?.id === item.id ? "Volver a usar" : "Agregar"}<span className={styles.srOnly}> {item.title}</span></button>}
          {canManage(item) && (manage || archived) && <>{!archived && <button disabled={busy} onClick={() => manageItem(item, "edit")}>Editar<span className={styles.srOnly}> {item.title}</span></button>}<button disabled={busy} onClick={() => void manageItem(item, archived ? "restore" : "archive")}>{archived ? "Restaurar" : "Ocultar del repertorio"}<span className={styles.srOnly}> {item.title}</span></button></>}
        </div>
      </article>)}</div>
      {!archived && state && query.trim() && !items.some(item => normalize(item.title) === normalize(query)) && <div className={styles.newCatalogChoice}>
        {!hiddenExact && <label>Nota opcional<textarea rows={2} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>}
        {hiddenExact ? <><p>Este plato está oculto.</p><button className={styles.secondaryButton} disabled={busy} onClick={() => void choose(hiddenExact)}>Volver a usar “{hiddenExact.title}”</button></> : <button className={styles.primaryButton} disabled={busy} onClick={() => void choose({ id: "", title: query.trim(), note: note.trim() || null, authorName: "" })}>Agregar “{query.trim()}”</button>}
      </div>}
      {!busy && nextOffset !== null && <button className={styles.expandButton} onClick={() => void load(query, archived, nextOffset, true)}>Ver más platos</button>}
      <button className={styles.inlineAction} disabled={busy} onClick={() => setManage(value => !value)}>{manage ? "Listo" : "Ver todos los platos"}</button>
    </>}
  </dialog>;
}
function normalize(value: string) { return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-AR").trim().replace(/\s+/g, " "); }
