"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ShoppingData, ShoppingItem, ShoppingList } from "@/lib/shopping/types";
import styles from "./shopping.module.css";

type ProductDraft = { id?: string; name: string; brand: string; quantity: string; expectedVersion?: number };
type ManagementDraft = { name: string; memberIds: string[]; ownerMemberId: string; reason: string; expectedVersion: number };
const emptyProduct = (): ProductDraft => ({ name: "", brand: "", quantity: "" });
const formatDate = (value: string) => new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

export default function ShoppingApp({ listId }: { listId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<ShoppingData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const [name, setName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(emptyProduct);
  const [management, setManagement] = useState<ManagementDraft | null>(null);
  const etag = useRef("");
  const generation = useRef(0);
  const applied = useRef({ revision: -1, accessRevision: -1 });
  const pending = useRef<AbortController | null>(null);
  const mutating = useRef(false);
  const lastActivity = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (force = false) => {
    if (!navigator.onLine || (pending.current && !force) || (mutating.current && !force)) return;
    if (force) pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const requestGeneration = ++generation.current;
    try {
      const response = await fetch("/api/shopping", { signal: controller.signal, headers: etag.current ? { "If-None-Match": etag.current } : {} });
      if (requestGeneration !== generation.current) return;
      if (response.status === 304) { setUpdatedAt(new Date().toISOString()); return; }
      const body = await response.json();
      if (requestGeneration !== generation.current) return;
      if (!response.ok) throw new Error(body.error || "No se pudieron actualizar las listas.");
      const incoming = body as ShoppingData;
      if (incoming.revision < applied.current.revision || incoming.accessRevision < applied.current.accessRevision) return;
      applied.current = { revision: incoming.revision, accessRevision: incoming.accessRevision };
      etag.current = response.headers.get("etag") ?? "";
      setData(incoming);
      setUpdatedAt(new Date().toISOString());
    } catch (cause) {
      if (!controller.signal.aborted && requestGeneration === generation.current) setError(cause instanceof Error ? cause.message : "No se pudo conectar. Conservamos tus datos.");
    } finally { if (pending.current === controller) pending.current = null; }
  }, []);

  useEffect(() => {
    lastActivity.current = Date.now();
    const initial = window.setTimeout(() => void refresh(), 0);
    const generationRef = generation;
    const active = () => {
      const idle = Date.now() - lastActivity.current >= 120_000;
      lastActivity.current = Date.now();
      if (idle && document.visibilityState === "visible") void refresh();
    };
    const resume = () => {
      if (document.visibilityState === "visible") { lastActivity.current = Date.now(); void refresh(true); }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastActivity.current < 120_000) void refresh();
    }, 30_000);
    window.addEventListener("pointerdown", active, { passive: true });
    window.addEventListener("keydown", active);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(timer);
      clearTimeout(initial);
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      pending.current?.abort();
      ++generationRef.current;
    };
  }, [refresh]);

  async function mutate(path: string, method: string, body: unknown): Promise<{ id: string } | null> {
    if (mutating.current) return null;
    mutating.current = true;
    setBusy(true); setError(""); setNotice("");
    pending.current?.abort(); ++generation.current;
    try {
      const response = await fetch(`/api/shopping${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) {
        await refresh(true);
        throw new Error(value.error || "No se pudo guardar. Conservamos tu borrador.");
      }
      await refresh(true);
      return value;
    } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : "No se pudo conectar. Conservamos tu borrador."); return null; }
    finally { mutating.current = false; setBusy(false); }
  }

  const list = data?.lists.find((value) => value.id === listId);
  const currentItem = list?.items.find((item) => item.id === draft.id);
  const base = list ? `/${list.id}` : "";
  const hasDraft = !!(draft.name || draft.brand || draft.quantity || draft.id);
  const permissionMessage = list?.archivedAt ? "La lista está archivada. Tu borrador sigue disponible para copiar." : list && !list.canEdit ? "Solo lectura. Si estabas escribiendo, conservamos tu borrador para copiarlo." : "";

  async function copyDraft() {
    try { await navigator.clipboard.writeText([draft.name, draft.brand, draft.quantity].filter(Boolean).join(" · ")); setNotice("Borrador copiado."); }
    catch { setError("No se pudo copiar. Podés seleccionar y copiar el texto del formulario."); }
  }
  async function shareList(value: ShoppingList) {
    const url = `${location.origin}/compras/${value.id}`;
    try {
      if (navigator.share) await navigator.share({ title: value.name, url });
      else { await navigator.clipboard.writeText(url); setNotice("Enlace copiado. Solo abre para integrantes de tu familia."); }
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("No se pudo compartir el enlace."); }
  }
  function editItem(item: ShoppingItem) {
    if (hasDraft && !window.confirm("¿Reemplazar el borrador actual?")) return;
    setDraft({ id: item.id, name: item.name, brand: item.brand ?? "", quantity: item.quantity ?? "", expectedVersion: item.version });
    nameInput.current?.focus();
  }
  function openManagement(value: ShoppingList) {
    setManagement({ name: value.name, memberIds: value.editorIds.filter((id) => data?.members.some((member) => member.id === id && !member.archivedAt)), ownerMemberId: "", reason: "", expectedVersion: value.version });
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/">family utils</Link>
      <nav aria-label="Aplicaciones"><Link href="/tareas">Tareas</Link><Link href="/menus">Menús</Link><Link href="/compras" aria-current="page">Compras</Link><Link href="/familia">Mi familia</Link></nav>
    </header>
    <div className={styles.heading}><div><p className={styles.eyebrow}>EN FAMILIA</p><h1>{list?.name ?? "Listas de compras"}</h1><p>Lo que hace falta, en un mismo lugar.</p></div><button type="button" disabled={busy} onClick={() => void refresh(true)}>Actualizar</button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {updatedAt && <p className={styles.muted}>Última actualización: <time dateTime={updatedAt}>{formatDate(updatedAt)}</time></p>}
    {!data && !error && <p role="status">Cargando listas…</p>}
    {data && !listId && <>
      <form className={styles.card} onSubmit={async (event) => {
        event.preventDefault();
        const created = await mutate("", "POST", { name });
        if (created) { setName(""); router.push(`/compras/${created.id}`); }
      }}><h2>Nueva lista</h2><label>Nombre de la lista (opcional)<input value={name} maxLength={160} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="Usaremos tu nombre si lo dejás vacío" /></label><button className={styles.primary} disabled={busy}>Crear lista</button></form>
      <div className={styles.actions}><h2>{showArchived ? "Listas archivadas" : "Listas activas"}</h2><button type="button" aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Ver activas" : "Ver archivadas"}</button></div>
      <div className={styles.listGrid}>{data.lists.filter((value) => !!value.archivedAt === showArchived).map((value) => <Link className={styles.listCard} key={value.id} href={`/compras/${value.id}`}><h3>{value.name}</h3><p>De {value.ownerName}</p><p>{value.items.filter((item) => item.purchased).length} de {value.items.length} comprados</p><span className={styles.badge}>{value.archivedAt ? "Archivada · solo lectura" : value.canEdit ? "Podés editar" : "Solo lectura"}</span></Link>)}</div>
      {!data.lists.some((value) => !!value.archivedAt === showArchived) && <p>Todavía no hay listas {showArchived ? "archivadas" : "activas"}.</p>}
    </>}
    {data && listId && !list && <section className={styles.card}><h2>No encontramos esta lista</h2><p>Puede pertenecer a otra familia o haber dejado de estar disponible.</p><Link href="/compras">Volver a las listas</Link></section>}
    {data && list && <>
      <Link className={styles.back} href="/compras">← Todas las listas</Link>
      <section className={styles.card} aria-label="Datos de la lista">
        <div className={styles.actions}><span className={styles.badge}>{list.archivedAt ? "Archivada · solo lectura" : list.canEdit ? "Podés editar" : "Solo lectura"}</span><button onClick={() => void shareList(list)}>Compartir enlace</button></div>
        <p>Creada por {list.creatorName} · Dueño actual: {list.ownerName}</p>
        <p>{list.items.filter((item) => item.purchased).length} de {list.items.length} comprados</p>
        <div className={styles.actions}>
          {(list.canManage || data.currentRole === "administrator") && <button disabled={busy} onClick={() => openManagement(list)}>{list.canManage ? "Administrar lista" : "Transferir propiedad"}</button>}
          {list.canEdit && <button disabled={busy || !list.items.some((item) => item.purchased)} onClick={() => { if (window.confirm("¿Desmarcar todos los productos comprados para reutilizar la lista?")) void mutate(`${base}/reset`, "POST", {}); }}>Desmarcar todos</button>}
          {list.canManage && <button disabled={busy} onClick={() => { if (window.confirm(list.archivedAt ? "¿Restaurar esta lista?" : "¿Archivar esta lista y dejarla en modo consulta?")) void mutate(base, "PATCH", { action: list.archivedAt ? "restore" : "archive", expectedVersion: list.version }); }}>{list.archivedAt ? "Restaurar lista" : "Archivar lista"}</button>}
        </div>
      </section>
      {management && <section className={styles.card} aria-label="Administrar lista"><h2>Administrar lista</h2>
        {management.expectedVersion !== list.version && <p role="alert">La gestión de esta lista cambió. Revisá su nombre, dueño y editores actuales antes de reintentar. <button onClick={() => setManagement({ ...management, expectedVersion: list.version })}>Revisé los cambios: habilitar reintento</button></p>}
        {list.canManage && <>
          <form onSubmit={async (event) => { event.preventDefault(); if (await mutate(base, "PATCH", { action: "rename", name: management.name, expectedVersion: management.expectedVersion })) setManagement(null); }}><label>Nombre de la lista<input required maxLength={160} disabled={busy} value={management.name} onChange={(event) => setManagement({ ...management, name: event.target.value })} /></label><button disabled={busy || management.expectedVersion !== list.version}>Guardar nombre</button></form>
          <form onSubmit={async (event) => { event.preventDefault(); if (await mutate(`${base}/editors`, "PUT", management)) setManagement(null); }}><fieldset disabled={busy}><legend>Quiénes pueden editar</legend>{data.members.filter((member) => !member.archivedAt && member.id !== list.ownerMemberId).map((member) => <label className={styles.checkLabel} key={member.id}><input type="checkbox" checked={management.memberIds.includes(member.id)} onChange={(event) => setManagement({ ...management, memberIds: event.target.checked ? [...management.memberIds, member.id] : management.memberIds.filter((id) => id !== member.id) })} />{member.name}</label>)}</fieldset><p className={styles.muted}>Editores actuales: {list.editorIds.map((id) => data.members.find((member) => member.id === id)?.name).join(", ") || "Solo el dueño"}</p><button disabled={busy || management.expectedVersion !== list.version}>Guardar editores</button></form>
        </>}
        {data.currentRole === "administrator" && <form onSubmit={async (event) => {
          event.preventDefault(); if (!window.confirm("¿Transferir la propiedad y quitar todos los permisos de edición anteriores?")) return;
          if (await mutate(`${base}/transfer`, "POST", management)) setManagement(null);
        }}><h3>Transferir propiedad</h3><label>Nuevo dueño<select required disabled={busy} value={management.ownerMemberId} onChange={(event) => setManagement({ ...management, ownerMemberId: event.target.value })}><option value="">Elegir integrante</option>{data.members.filter((member) => !member.archivedAt && member.id !== list.ownerMemberId).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>Motivo<textarea required maxLength={1000} disabled={busy} value={management.reason} onChange={(event) => setManagement({ ...management, reason: event.target.value })} /></label><p className={styles.muted}>Se conserva el creador original y se quitan todos los editores anteriores.</p><button disabled={busy || management.expectedVersion !== list.version}>Transferir lista</button></form>}
        {!list.canManage && data.currentRole !== "administrator" && <p role="status">La propiedad cambió. Conservamos el borrador de administración para copiarlo.</p>}
        <div className={styles.actions}><button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText([management.name, management.memberIds.map((id) => data.members.find((member) => member.id === id)?.name).join(", "), management.reason].filter(Boolean).join("\n")); setNotice("Borrador de administración copiado."); }
          catch { setError("No se pudo copiar el borrador de administración."); }
        }}>Copiar borrador de administración</button>
        <button disabled={busy} onClick={() => setManagement(null)}>Cerrar administración</button></div>
      </section>}
      {(list.canEdit || hasDraft) && <form className={styles.card} aria-label="Producto" onSubmit={async (event) => {
        event.preventDefault();
        if (!list.canEdit) return;
        if (await mutate(draft.id ? `${base}/items/${draft.id}` : `${base}/items`, draft.id ? "PATCH" : "POST", draft)) { setDraft(emptyProduct()); nameInput.current?.focus(); }
      }}><h2>{draft.id ? "Editar producto" : "Agregar producto"}</h2>
        {permissionMessage && <p role="status">{permissionMessage}</p>}
        <fieldset disabled={busy}><label>Nombre del producto<input ref={nameInput} list="shopping-products" required maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><datalist id="shopping-products">{data.suggestions.filter((suggestion) => !suggestion.hidden).map((suggestion) => <option key={suggestion.id} value={suggestion.name} />)}</datalist>
          <div className={styles.fields}><label>Marca (opcional)<input maxLength={160} value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label><label>Cantidad (opcional)<input maxLength={100} placeholder="Ej.: 500 g o 2 paquetes" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label></div>
        </fieldset>
        {draft.id && currentItem && draft.expectedVersion !== currentItem.version && <div className={styles.notice}><p>Datos actuales: {currentItem.name} · {currentItem.brand || "Sin marca"} · {currentItem.quantity || "Sin cantidad"}</p><button type="button" onClick={() => { setDraft({ ...draft, expectedVersion: currentItem.version }); }}>Revisé los cambios: habilitar reintento</button></div>}
        {draft.id && !currentItem && <p role="alert">El producto fue quitado. Copiá el borrador o guardalo como nuevo.</p>}
        <div className={styles.actions}><button className={styles.primary} disabled={busy || !list.canEdit || (!!draft.id && (!currentItem || draft.expectedVersion !== currentItem.version))}>{draft.id ? "Guardar producto" : "Agregar producto"}</button>
          {hasDraft && <><button type="button" onClick={() => void copyDraft()}>Copiar borrador</button><button type="button" disabled={busy} onClick={() => { if (window.confirm("¿Descartar este borrador?")) { setDraft(emptyProduct()); } }}>Descartar borrador</button></>}
          {draft.id && !currentItem && list.canEdit && <button type="button" onClick={() => { setDraft({ name: draft.name, brand: draft.brand, quantity: draft.quantity }); }}>Usar como producto nuevo</button>}
        </div>
      </form>}
      <section aria-label="Productos de la lista">
        {!list.items.length && <p className={styles.card}>Esta lista todavía no tiene productos.</p>}
        {[false, true].map((purchased) => <div key={String(purchased)}><h2>{purchased ? "Comprados" : "Pendientes"} ({list.items.filter((item) => item.purchased === purchased).length})</h2><ul className={styles.products}>{list.items.filter((item) => item.purchased === purchased).map((item) => <li className={styles.product} key={item.id}>
          <button className={styles.purchaseButton} aria-label={`${item.purchased ? "Desmarcar" : "Marcar comprado"} ${item.name}`} aria-pressed={item.purchased} disabled={busy || !list.canEdit} onClick={() => void mutate(`${base}/items/${item.id}/purchased`, "PUT", { purchased: !item.purchased })}><span aria-hidden="true">{item.purchased ? "✓" : "○"}</span></button>
          <div className={styles.productInfo}><h3 className={item.purchased ? styles.purchased : undefined}>{item.name}</h3>{(item.brand || item.quantity) && <p>{[item.brand, item.quantity].filter(Boolean).join(" · ")}</p>}<small>Último cambio: {item.updatedByName} · {formatDate(item.updatedAt)}</small>{item.purchased && <small>Comprado por {item.purchasedByName}</small>}</div>
          {list.canEdit && <div className={styles.itemActions}><button disabled={busy} aria-label={`Editar ${item.name}`} onClick={() => editItem(item)}>Editar</button><button disabled={busy} aria-label={`Quitar ${item.name}`} onClick={() => { if (window.confirm(`¿Quitar ${item.name} de esta lista?`)) void mutate(`${base}/items/${item.id}`, "DELETE", { expectedVersion: item.version }); }}>Quitar</button></div>}
        </li>)}</ul></div>)}
      </section>
    </>}
    {data && <details className={styles.card}><summary>Administrar sugerencias de la familia</summary><p>Aprendemos nombres al marcar productos como comprados. Ocultar evita que vuelvan a sugerirse hasta que alguien los restaure.</p><ul className={styles.suggestions}>{data.suggestions.map((suggestion) => <li key={suggestion.id}><span>{suggestion.name}{suggestion.hidden ? " · Oculta" : ""}</span><button disabled={busy} aria-label={`${suggestion.hidden ? "Restaurar" : "Ocultar"} sugerencia ${suggestion.name}`} onClick={() => void mutate(`/suggestions/${suggestion.id}`, "PATCH", { hidden: !suggestion.hidden, expectedVersion: suggestion.version })}>{suggestion.hidden ? "Restaurar" : "Ocultar"}</button></li>)}</ul>{!data.suggestions.length && <p>Todavía no hay sugerencias.</p>}</details>}
  </main>;
}
