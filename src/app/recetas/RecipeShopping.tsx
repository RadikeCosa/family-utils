"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ShoppingList } from "@/lib/shopping/types";
import type { ObservedItem, Recipe, TransferCommand, TransferRow } from "@/lib/recipes/types";
import styles from "./recipes.module.css";
type Observation = { ingredientId: string; observed: ObservedItem[] };
export default function RecipeShopping({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]), [lists, setLists] = useState<ShoppingList[]>([]), [destination, setDestination] = useState(""), [newName, setNewName] = useState("");
  const [rows, setRows] = useState<TransferRow[]>([]), [token, setToken] = useState<string | null>(null), [changed, setChanged] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [complete, setComplete] = useState<{ listId: string; added: number; edited: number } | null>(null), [uncertain, setUncertain] = useState(false);
  const pending = useRef<(TransferCommand & { action: string; token: string }) | null>(null);
  const generation = useRef(0);
  const loadLists = async () => {
    const response = await fetch("/api/shopping", { cache: "no-store" }); const body = await response.json();
    if (!response.ok) throw new Error(body.error); setLists(body.lists.filter((list: ShoppingList) => list.canEdit));
  };
  useEffect(() => { const requests = generation; let active = true; void fetch("/api/shopping", { cache: "no-store" }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error); if (active) setLists(body.lists.filter((list: ShoppingList) => list.canEdit)); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; requests.current++; }; }, []);
  function command(): TransferCommand { return { recipeId: recipe.id, destination: destination === "new" ? { newListName: newName } : { listId: destination }, rows }; }
  function editRow(id: string, patch: Partial<TransferRow>) {
    generation.current++; setRows(current => current.map(r => r.ingredientId === id ? { ...r, ...patch } : r));
    if ("name" in patch) setToken(null);
  }
  function applyObservations(observations: Observation[], initial: boolean) {
    setRows(current => current.map(row => {
      const obs = observations.find(o => o.ingredientId === row.ingredientId); if (!obs) return row;
      const stillExists = obs.observed.some(i => i.id === row.itemId);
      return { ...row, observed: obs.observed, ...(initial && row.observed.length === 0 && obs.observed.length ? { action: "keep" as const, itemId: obs.observed[0].id } : !stillExists && row.action !== "add" ? { action: "add" as const, itemId: null } : {}) };
    }));
  }
  async function prepare() {
    const gen = ++generation.current; setBusy(true); setError("");
    try {
      const response = await fetch("/api/shopping/recipe-transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command(), action: "prepare" }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (gen === generation.current) { applyObservations(body.observations, true); setToken(body.token); setChanged([]); }
    } catch (e) { if (gen === generation.current) setError(e instanceof Error ? e.message : "No se pudo revisar."); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!pending.current) { if (!token) return; pending.current = { ...command(), action: "confirm", token }; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/shopping/recipe-transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status >= 500) { setUncertain(true); throw new Error("No pudimos confirmar la respuesta. Reintentá el mismo envío para evitar duplicados."); }
        pending.current = null; setUncertain(false);
        if (body.code === "REVIEW_CHANGED") { applyObservations(body.observations, false); setChanged(body.observations.map((o: Observation) => o.ingredientId)); }
        if (["DESTINATION_UNAVAILABLE", "LIST_NOT_EDITABLE", "NO_ACCESS", "OPERATION_EXPIRED", "INVALID_OPERATION"].includes(body.code)) { setToken(null); if (body.code !== "NO_ACCESS") void loadLists().catch(() => {}); }
        throw new Error(body.error);
      }
      pending.current = null; setUncertain(false); setComplete(body);
    } catch (e) { if (pending.current) setUncertain(true); setError(e instanceof Error ? e.message : "No se recibió confirmación. Reintentá el mismo envío."); } finally { setBusy(false); }
  }
  if (complete) return <section className={styles.notice} role="status"><p>Envío confirmado: {complete.added} filas agregadas y {complete.edited} modificadas.</p><Link href={`/compras/${complete.listId}`}>Abrir lista de compras</Link> <button onClick={onClose}>Cerrar</button></section>;
  return <section className={`${styles.card} ${styles.stack}`} aria-label="Pasar ingredientes a Compras"><h2>Pasar ingredientes a Compras</h2><p>Elegí lo que necesitás comprar. Las cantidades de la receta no se modificarán.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {uncertain ? <><p>El envío puede haberse guardado. Conservamos exactamente la misma operación para verificar su resultado.</p><button className={styles.primary} disabled={busy} onClick={() => void confirm()}>Reintentar el mismo envío</button></> : <>
      {!rows.length ? <><fieldset><legend>Ingredientes que necesitás comprar</legend>{recipe.ingredients.map(i => <label key={i.id} className={styles.check}><input type="checkbox" checked={selected.includes(i.id)} onChange={e => setSelected(current => e.target.checked ? [...current, i.id] : current.filter(id => id !== i.id))} />{i.name}{i.quantity ? ` · ${i.quantity}` : ""}</label>)}</fieldset><button disabled={!selected.length} onClick={() => setRows(recipe.ingredients.filter(i => selected.includes(i.id)).map(i => ({ ingredientId: i.id, name: i.name, quantity: i.quantity, brand: null, action: "add", itemId: null, observed: [] })))}>Revisar ingredientes</button></> : <>
        <fieldset disabled={busy} className={styles.stack}><legend>Destino y cantidades de compra</legend>
          <label>Lista de compras<select value={destination} onChange={e => { generation.current++; setDestination(e.target.value); setToken(null); setRows(current => current.map(r => ({ ...r, action: "add", itemId: null, observed: [] }))); setChanged([]); }}><option value="">Elegí una lista</option>{lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}<option value="new">Crear una lista nueva</option></select></label>
          {destination === "new" && <label>Nombre de la nueva lista<input required maxLength={160} value={newName} onChange={e => { setNewName(e.target.value); setToken(null); }} /></label>}
          <ol className={styles.ingredients}>{rows.map(row => {
            const ingredient = recipe.ingredients.find(i => i.id === row.ingredientId)!;
            return <li key={row.ingredientId} className={`${styles.ingredient} ${changed.includes(row.ingredientId) ? styles.changed : ""}`}>
              <p>En la receta: {ingredient.name}{ingredient.quantity ? ` · ${ingredient.quantity}` : ""}</p>
              <label>Producto a comprar<input required maxLength={160} value={row.name} onChange={e => editRow(row.ingredientId, { name: e.target.value })} /></label>
              <div className={styles.fields}><label>Cantidad de compra<input maxLength={100} value={row.quantity ?? ""} onChange={e => editRow(row.ingredientId, { quantity: e.target.value })} /></label><label>Marca opcional<input maxLength={160} value={row.brand ?? ""} onChange={e => editRow(row.ingredientId, { brand: e.target.value })} /></label></div>
              {row.observed.length > 0 && <><p>Ya aparece en esta lista:</p><ul>{row.observed.map(i => <li key={i.id}>{i.name} · {i.quantity || "Sin cantidad"}{i.brand ? ` · ${i.brand}` : ""} · <strong>{i.purchased ? "Comprado (no indica existencias en casa)" : "Pendiente"}</strong></li>)}</ul>
                <label>Qué hacer<select value={row.action} onChange={e => editRow(row.ingredientId, { action: e.target.value as TransferRow["action"], itemId: e.target.value === "add" ? null : row.itemId ?? row.observed[0].id })}><option value="keep">Dejar la fila existente como está</option><option value="edit">Editar la fila existente</option><option value="add">Agregar otra como pendiente</option></select></label>
                {row.action !== "add" && <label>Fila existente<select value={row.itemId ?? ""} onChange={e => editRow(row.ingredientId, { itemId: e.target.value })}>{row.observed.map(i => <option key={i.id} value={i.id}>{i.name} · {i.quantity || "Sin cantidad"} · {i.brand || "Sin marca"} · {i.purchased ? "Comprado" : "Pendiente"} · {i.id.slice(0, 8)}</option>)}</select></label>}
                {row.observed.some(i => i.purchased) && <p><strong>Si necesitás comprar más, elegí “Agregar otra como pendiente”.</strong> Editar una cantidad no desmarca una compra.</p>}
              </>}
              {changed.includes(row.ingredientId) && <label className={styles.check}><input type="checkbox" checked={false} onChange={() => setChanged(current => current.filter(id => id !== row.ingredientId))} />Revisé las coincidencias actualizadas y mi decisión</label>}
            </li>;
          })}</ol>
        </fieldset>
        <div className={styles.actions}><button disabled={busy || !destination || (destination === "new" && !newName.trim()) || rows.some(r => !r.name.trim())} onClick={() => void prepare()}>Consultar coincidencias</button><button className={styles.primary} disabled={busy || !token || !!changed.length} onClick={() => void confirm()}>{busy ? "Procesando…" : "Confirmar envío"}</button><button disabled={busy} onClick={() => { setRows([]); setToken(null); setChanged([]); }}>Volver a seleccionar</button></div>
        {!token && <p>Consultá coincidencias para revisar y habilitar la confirmación.</p>}
      </>}
      <button disabled={busy} onClick={onClose}>Cancelar</button>
    </>}
  </section>;
}
