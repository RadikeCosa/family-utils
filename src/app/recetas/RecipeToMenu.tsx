"use client";
import { useNavigationQuery, useUnifiedUI } from "@/components/platform/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MEAL_TYPES, MEAL_LABELS, getDayInTimeZone, type MealType } from "@/lib/meals/rules";
import type { PlannerWeek } from "@/lib/meals/planner-server";
import styles from "./recipes.module.css";
export default function RecipeToMenu({ recipeId, onClose }: { recipeId: string; onClose: () => void }) {
  const params = useNavigationQuery();
  const unified = useUnifiedUI();
  const requestedDate = params.get("fecha"), requestedMeal = params.get("comida");
  const [date, setDate] = useState(getDayInTimeZone()), [mealType, setMealType] = useState<MealType>("lunch"), [menu, setMenu] = useState(1);
  const [data, setData] = useState<PlannerWeek | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [replace, setReplace] = useState(false);
  useEffect(() => {
    if (!unified) return;
    queueMicrotask(() => {
      if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) setDate(requestedDate);
      if (requestedMeal && MEAL_TYPES.includes(requestedMeal as MealType)) setMealType(requestedMeal as MealType);
    });
  }, [unified, requestedDate, requestedMeal]);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/meals/planner?weekStart=${date}`, { cache: "no-store" }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); if (!cancelled) setData(body); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [date]);
  const meal = data?.meals.find(m => m.date === date && m.mealType === mealType), selection = meal?.plan.menus.find(m => m.number === menu)?.selection;
  async function use(action: "propose" | "confirm") {
    if (!meal) return; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/meals/planner", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, mealType, menu, action, catalogIdeaId: recipeId, expectedVersion: meal.version, replace }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setNotice(action === "propose" ? "Plato propuesto." : "Comida confirmada.");
      const current = await fetch(`/api/meals/planner?weekStart=${date}`, { cache: "no-store" }).then(r => r.json()); setData(current); setReplace(false);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); } finally { setBusy(false); }
  }
  return <section data-ui-surface className={`${styles.card} ${styles.stack}`} aria-label="Usar receta en Menús"><h2>Usar en Menús</h2>
    <label>Fecha<input type="date" value={date} onChange={e => { setDate(e.target.value); setData(null); setReplace(false); setNotice(""); }} /></label>
    <label>Comida<select value={mealType} onChange={e => { setMealType(e.target.value as MealType); setMenu(1); setReplace(false); }}>{MEAL_TYPES.map(t => <option key={t} value={t}>{MEAL_LABELS[t]}</option>)}</select></label>
    {meal && <label>Opción<select value={menu} onChange={e => { setMenu(Number(e.target.value)); setReplace(false); }}>{meal.plan.menus.map(m => <option key={m.number} value={m.number}>Opción {m.number} · {m.selection?.title ?? "Sin elegir"}</option>)}</select></label>}
    {selection && <p>Actualmente: <strong>{selection.title}</strong>.</p>}
    {selection && data?.currentRole === "administrator" && <label className={styles.check}><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Confirmo reemplazar la comida actual</label>}
    {error && <p className={styles.error} role="alert">{error} <button disabled={busy} onClick={async () => { const response = await fetch(`/api/meals/planner?weekStart=${date}`, { cache: "no-store" }); if (response.ok) { setData(await response.json()); setReplace(false); setError(""); } }}>Consultar elección actual</button></p>}
    {notice && <p className={styles.notice} role="status">{notice} <Link href={`/menus?fecha=${date}&comida=${mealType}`}>Abrir Menús</Link></p>}
    <div className={styles.actions}><button disabled={busy || !meal || meal.readOnly || date < (data?.today ?? date)} onClick={() => void use("propose")}>Proponer plato</button><button disabled={busy || !meal || meal.readOnly || date < (data?.today ?? date) || (!!selection && (data?.currentRole !== "administrator" || !replace))} onClick={() => void use("confirm")}>Confirmar comida</button><button disabled={busy} onClick={onClose}>Cerrar</button></div>
  </section>;
}
