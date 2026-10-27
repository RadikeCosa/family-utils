"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthClient } from "@/lib/family-auth-client";
import { addDays, getDayInTimeZone, hasMealAttendance, isMenuDateInRange, isValidDate, MEAL_LABELS, MEAL_TYPES, menuDateBounds, startOfWeek, type MealType, type ParticipationStatus } from "@/lib/meals/rules";
import { canChangePerson, menuSummary, needsMeal, participationSummary, STATUS_LABELS, type DailyIdea, type DailyPerson, type MenuNumber } from "@/lib/meals/daily";
import type { PlannerMeal, PlannerWeek } from "@/lib/meals/planner-server";
import { countChosenMeals, mealChoiceState } from "@/lib/meals/presentation";
import IdeaBank, { type BankState } from "./IdeaBank";
import styles from "./menus.module.css";

const authClient = createAuthClient();
type Action = Record<string, unknown>;
type Confirmation = { date: string; mealType: MealType; version: string; kind: "confirm" | "remove-second" | "clear"; idea?: DailyIdea; catalogIdeaId?: string; menu?: MenuNumber };
const dayLabel = (day: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));
const familyDay = () => getDayInTimeZone();
type MealDisclosure = { detail: boolean; people: boolean };
const closedMeal: MealDisclosure = { detail: false, people: false };
const mealButtonId = (date: string, type: MealType) => `meal-${date}-${type}-toggle`;

export default function MenuApp() {
  const router = useRouter();
  const [dayState, setDayState] = useState(() => ({ date: familyDay(), meals: {} as Partial<Record<MealType, MealDisclosure>> }));
  const date = dayState.date;
  const selectDate = useCallback((next: string) => {
    setDayState(current => current.date === next ? current : { date: next, meals: {} });
  }, []);
  function toggleMeal(type: MealType, section: keyof MealDisclosure) {
    setDayState(current => {
      if (current.date !== date) return current;
      const meal = current.meals[type] ?? closedMeal;
      return { ...current, meals: { ...current.meals, [type]: { ...meal, [section]: !meal[section] } } };
    });
  }
  const [view, setView] = useState<"day" | "week">("day");
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<PlannerWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const working = useRef(false), sequence = useRef(0), followsToday = useRef(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState<(() => Promise<boolean>) | null>(null);
  const [undo, setUndo] = useState<{ date: string; type: MealType; person: DailyPerson; version: string } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [bank, setBank] = useState<BankState | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLElement | null>(null), openerFallback = useRef<string | null>(null);
  const today = data?.today ?? familyDay();
  const bounds = menuDateBounds(today), week = startOfWeek(date);
  const activeWeek = useRef(week);
  const weekReady = data?.weekStart === week;
  const adult = data?.currentRole === "administrator";

  useEffect(() => {
    function readUrl() {
      const params = new URLSearchParams(window.location.search), requested = params.get("fecha"), now = familyDay();
      const valid = requested && isValidDate(requested) && isMenuDateInRange(requested, now);
      followsToday.current = !requested || !valid;
      activeWeek.current = startOfWeek(valid ? requested : now);
      selectDate(valid ? requested : now);
      setView(params.get("vista") === "semana" ? "week" : "day");
      if (requested && !valid) {
        setNotice("La fecha no es válida. Mostramos hoy.");
        const url = new URL(window.location.href); url.searchParams.set("fecha", now); window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      }
      setReady(true);
    }
    readUrl();
    window.addEventListener("popstate", readUrl);
    return () => window.removeEventListener("popstate", readUrl);
  }, [selectDate]);

  const refresh = useCallback(async () => {
    if (activeWeek.current !== week) return null;
    const request = ++sequence.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/meals/planner?weekStart=${week}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo cargar el plan.");
      if (request !== sequence.current || activeWeek.current !== week) return null;
      setData(body);
      if (followsToday.current) { activeWeek.current = startOfWeek(body.today); selectDate(body.today); }
      return body as PlannerWeek;
    } catch (failure) {
      if (request === sequence.current && activeWeek.current === week) setError(failure instanceof Error ? failure.message : "No se pudo cargar el plan.");
      return null;
    } finally { if (request === sequence.current && activeWeek.current === week) setLoading(false); }
  }, [week, selectDate]);

  useEffect(() => { let cancelled = false; if (ready) queueMicrotask(() => { if (!cancelled) void refresh(); }); return () => { cancelled = true; }; }, [ready, refresh]);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      if (followsToday.current) { const day = getDayInTimeZone(new Date(), data?.timeZone); activeWeek.current = startOfWeek(day); selectDate(day); }
      if (ready) void refresh();
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    const timer = window.setInterval(resume, 60_000);
    return () => { window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); clearInterval(timer); };
  }, [data?.timeZone, ready, refresh, selectDate]);

  useEffect(() => {
    if (confirmation && !dialog.current?.open) dialog.current?.showModal();
    else if (!confirmation && dialog.current?.open) {
      dialog.current.close();
      if (opener.current?.isConnected && opener.current.checkVisibility()) opener.current.focus();
      else if (openerFallback.current) document.getElementById(openerFallback.current)?.focus();
    }
  }, [confirmation]);

  function navigate(next: string, nextView = view, follow = false) {
    if (working.current) return;
    const valid = isValidDate(next) && isMenuDateInRange(next, today);
    const chosen = valid ? next : today;
    followsToday.current = follow;
    activeWeek.current = startOfWeek(chosen);
    selectDate(chosen); setView(nextView); setUndo(null); setRetry(null); setError("");
    if (!valid) setNotice("La fecha no es válida. Mostramos hoy."); else setNotice("");
    const url = new URL(window.location.href);
    url.searchParams.set("fecha", chosen); url.searchParams.set("vista", nextView === "week" ? "semana" : "dia");
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}`);
  }

  async function mutate(meal: PlannerMeal, action: Action, success: string, remember?: DailyPerson): Promise<boolean> {
    if (working.current) return false;
    working.current = true; setBusy(true); setError(""); setNotice(""); setRetry(null); setUndo(null);
    try {
      const response = await fetch("/api/meals/planner", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: meal.date, mealType: meal.mealType, expectedVersion: meal.version, ...action }) });
      const body = await response.json().catch(() => ({ error: "No se pudo guardar el cambio. Volvé a intentar." }));
      if (!response.ok) {
        if (response.status === 409 || body.code === "MEAL_DAY_CLOSED") {
          const latest = await refresh();
          const current = latest?.meals.find(m => m.date === meal.date && m.mealType === meal.mealType);
          if (current) setConfirmation(c => c ? { ...c, version: current.version } : c);
        } else setRetry(() => () => mutate(meal, action, success, remember));
        throw new Error(body.error ?? "No se pudo guardar el cambio.");
      }
      // Show only acknowledged state; a failed refresh cannot undo a successful write.
      setData(current => current ? { ...current, meals: current.meals.map(m => m.date === meal.date && m.mealType === meal.mealType ? { ...m, plan: body.plan, version: body.version } : m) } : current);
      if (remember) setUndo({ date: meal.date, type: meal.mealType, person: remember, version: body.version });
      setNotice(success);
      await refresh();
      return true;
    } catch (failure) {
      setError(failure instanceof TypeError ? "No se pudo conectar. El cambio no se guardó." : failure instanceof Error ? failure.message : "No se pudo guardar el cambio.");
      if (failure instanceof TypeError) setRetry(() => () => mutate(meal, action, success, remember));
      return false;
    } finally { working.current = false; setBusy(false); }
  }

  function ask(meal: PlannerMeal, kind: Confirmation["kind"], menu?: MenuNumber, idea?: DailyIdea, catalogIdeaId?: string) {
    const destination = meal.plan.menus.length === 1 ? 1 : menu;
    if (kind === "confirm" && destination && !meal.plan.menus.find(m => m.number === destination)?.selection) {
      void mutate(meal, { action: "confirm", menu: destination, ...(catalogIdeaId ? { catalogIdeaId } : idea?.id ? { suggestionId: idea.id } : { title: idea?.title, note: idea?.note }) }, "Menú confirmado.");
      return;
    }
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openerFallback.current = mealButtonId(meal.date, meal.mealType);
    setError(""); setConfirmation({ date: meal.date, mealType: meal.mealType, version: meal.version, kind, menu: destination, idea, catalogIdeaId });
  }
  const currentMeal = confirmation && data?.meals.find(m => m.date === confirmation.date && m.mealType === confirmation.mealType);
  const currentSelection = currentMeal?.plan.menus.find(m => m.number === confirmation?.menu)?.selection;
  async function confirm() {
    if (!confirmation || !currentMeal) return;
    const c = confirmation;
    const action = c.kind === "confirm" ? { action: "confirm", menu: c.menu, replace: !!currentSelection, ...(c.catalogIdeaId ? { catalogIdeaId: c.catalogIdeaId } : c.idea?.id ? { suggestionId: c.idea.id } : { title: c.idea?.title, note: c.idea?.note }) }
      : { action: c.kind, menu: c.menu, confirm: true };
    if (await mutate({ ...currentMeal, version: c.version }, action, "Plan guardado.")) setConfirmation(null);
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Family Utils, inicio"><span className={styles.mark} aria-hidden="true">f</span>family<span>utils</span></Link>
      <nav className={styles.headerLinks} aria-label="Aplicaciones"><Link href="/tareas">Tareas</Link><Link className={styles.activeLink} href="/menus" onClick={e => { e.preventDefault(); navigate(today, "day", true); }}>Menús</Link><Link href="/compras">Compras</Link><Link href="/familia">Mi familia</Link></nav>
      <button className={styles.exitButton} onClick={() => void authClient.signOut().then(() => router.push("/acceso"))}>Salir</button>
    </header>
    <section className={styles.intro}>
      <h1 className={styles.dailyTitle}>¿Qué comemos?</h1>
      <div className={styles.dailyNavigation}>
        <button aria-label="Día anterior" disabled={busy} onClick={() => navigate(addDays(date, -1))}>←</button>
        <label><span className={styles.srOnly}>Ir a una fecha</span><input aria-label="Ir a una fecha" type="date" value={date} min={bounds.earliest} max={bounds.latest} disabled={busy} onChange={e => navigate(e.target.value)} /></label>
        <button aria-label="Día siguiente" disabled={busy} onClick={() => navigate(addDays(date, 1))}>→</button>
        <button disabled={busy} onClick={() => navigate(today, "day", true)}>Hoy</button>
      </div>
      <p className={styles.dateLabel}>{date === today ? "Hoy · " : ""}{dayLabel(date)}{date < today ? " · Solo lectura" : ""}</p>
      {view === "day" && weekReady && data && <p className={styles.dailySummary}>{countChosenMeals(data.meals, date)} de 4 comidas elegidas</p>}
      <div className={styles.viewButtons} aria-label="Vista del planificador"><button aria-pressed={view === "day"} disabled={busy} onClick={() => navigate(date, "day", followsToday.current)}>Día</button><button aria-pressed={view === "week"} disabled={busy} onClick={() => navigate(date, "week", followsToday.current)}>Semana</button></div>
      <p className={styles.srOnly} role="status">{busy ? "Guardando…" : loading ? "Actualizando…" : "Plan actualizado"}</p>
      {notice && <p className={styles.notice} role="status">{notice}{undo && <button disabled={busy} onClick={() => {
        const meal = data?.meals.find(m => m.date === undo.date && m.mealType === undo.type);
        if (meal) void mutate({ ...meal, version: undo.version }, { action: "person", memberId: undo.person.memberId, status: undo.person.status, ...(undo.person.menu ? { menu: undo.person.menu } : {}) }, "Cambio deshecho.");
      }}>Deshacer</button>}</p>}
      {error && !confirmation && <p className={styles.error} role="alert">{error} <button disabled={busy} onClick={() => { if (retry) void retry(); else { setError(""); void refresh(); } }}>Reintentar</button></p>}
    </section>
    {!weekReady || !data ? <p role="status">{loading ? "Cargando el plan…" : "No se pudo cargar el plan."}</p> : view === "week" ? <section className={styles.dailyWeek} aria-label="Semana, solo lectura">
      <p className={styles.muted}>Vista de consulta. Abrí un día para editarlo.</p>
      {Array.from({ length: 7 }, (_, i) => addDays(week, i)).map(day => <article key={day} className={styles.mealCard}>
        <button className={styles.weekDayButton} onClick={() => navigate(day, "day")}>{dayLabel(day)}{day === today ? " · Hoy" : ""}</button>
        {data.meals.filter(m => m.date === day).map(meal => <div className={styles.weekMealSummary} key={meal.mealType}><strong>{MEAL_LABELS[meal.mealType]}</strong>
          {meal.readOnly ? <span>Plan anterior · Solo lectura</span> : meal.plan.menus.map(menu => <span key={menu.number}>{menu.selection?.title ?? "Todavía no elegimos qué comer"}{hasMealAttendance(meal.mealType) ? ` · ${menuSummary(meal.plan, menu.number)}` : ""}</span>)}
          {hasMealAttendance(meal.mealType) && <small>{participationSummary(meal.plan.people)}</small>}
        </div>)}
      </article>)}
    </section> : <section className={styles.mealList} aria-label={`Comidas del ${dayLabel(date)}`}>
      {MEAL_TYPES.map(type => {
        const meal = data.meals.find(m => m.date === date && m.mealType === type)!;
        return <DailyMeal key={`${date}-${type}`} meal={meal} data={data} busy={busy} adult={!!adult} readOnly={date < today || meal.readOnly} disclosure={dayState.meals[type] ?? closedMeal} onToggle={section => toggleMeal(type, section)} onMutate={mutate} onAsk={ask} onBank={(target, event) => { setBank({ date, mealType: type, menu: target, opener: event, fallbackOpenerId: mealButtonId(date, type) }); }} />;
      })}
    </section>}
    <footer className={styles.footer}><Link href="/">Family Utils</Link><span role="status">{busy ? "Guardando…" : loading ? "Actualizando…" : "Plan compartido"}</span></footer>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="confirm-menu-title" onCancel={e => { e.preventDefault(); if (!busy) setConfirmation(null); }}>
      {confirmation && currentMeal && <>
        <h2 id="confirm-menu-title">{confirmation.kind === "remove-second" ? "Quitar opción 2" : confirmation.kind === "clear" ? "Quitar comida" : currentSelection ? "Cambiar comida" : "Agregar comida"}</h2>
        <p>{MEAL_LABELS[confirmation.mealType]} · {dayLabel(confirmation.date)}</p>
        {confirmation.kind === "confirm" ? <>
          <p>{currentSelection ? <>Se cambiará <strong>{currentSelection.title}</strong> por <strong>{confirmation.idea?.title}</strong>.</> : <strong>{confirmation.idea?.title}</strong>}</p>
        </> : confirmation.kind === "remove-second" ? <p>{currentMeal.plan.people.filter(p => p.menu === 2).map(p => data?.members.find(m => m.id === p.memberId)?.name).join(", ") || "No hay personas asignadas a la opción 2"}. Al quitarla, las personas asignadas vuelven a la opción 1{!currentMeal.plan.menus[0].selection ? ", que todavía no tiene una comida elegida" : ""}.</p> : <p>Se quita “{currentSelection?.title}”. Las personas mantienen su asignación.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.dialogActions}><button className={styles.secondaryButton} disabled={busy} onClick={() => { setConfirmation(null); setError(""); }}>Cancelar</button><button className={styles.primaryButton} disabled={busy || (confirmation.kind === "confirm" && !confirmation.menu) || !!currentMeal.readOnly} onClick={() => void confirm()}>{busy ? "Guardando…" : confirmation.kind === "remove-second" ? "Quitar y reasignar" : currentSelection && confirmation.kind === "confirm" ? "Guardar cambio" : "Agregar comida"}</button></div>
      </>}
    </dialog>
    <IdeaBank state={bank} onClose={() => setBank(null)} onChanged={refresh} currentMemberId={data?.currentMemberId ?? ""} adult={!!adult} today={today} onUse={async idea => {
      const meal = data?.meals.find(m => m.date === bank?.date && m.mealType === bank.mealType);
      if (!meal || !bank) return false;
      const selection = meal.plan.menus.find(m => m.number === bank.menu)?.selection;
      if (selection) { setBank(null); ask(meal, "confirm", bank.menu, { id: "", title: idea.title, note: idea.note, authorName: idea.authorName }, idea.id || undefined); return true; }
      const saved = await mutate(meal, { action: "confirm", menu: bank.menu, ...(idea.id ? { catalogIdeaId: idea.id } : { title: idea.title, note: idea.note }) }, "Comida agregada.");
      if (saved) setBank(null);
      return saved;
    }} />
  </main>;
}

type DailyMealProps = { disclosure: MealDisclosure; onToggle: (section: keyof MealDisclosure) => void; meal: PlannerMeal; data: PlannerWeek; busy: boolean; adult: boolean; readOnly: boolean;
  onMutate: (meal: PlannerMeal, action: Action, success: string, remember?: DailyPerson) => Promise<boolean>;
  onAsk: (meal: PlannerMeal, kind: Confirmation["kind"], menu?: MenuNumber, idea?: DailyIdea) => void;
  onBank: (menu: MenuNumber, opener: HTMLElement) => void;
};
function DailyMeal({ meal, data, busy, adult, readOnly, disclosure, onToggle, onMutate, onAsk, onBank }: DailyMealProps) {
  const [expanded, setExpanded] = useState(false);
  const attendance = hasMealAttendance(meal.mealType);
  const choice = mealChoiceState(meal);
  const toggleId = mealButtonId(meal.date, meal.mealType);
  const detailId = `meal-${meal.date}-${meal.mealType}-detail`;
  return <article className={styles.compactDayMeal} aria-label={MEAL_LABELS[meal.mealType]}>
    <h2 className={styles.compactDayHeading}><button id={toggleId} aria-expanded={disclosure.detail} aria-controls={detailId} onClick={() => onToggle("detail")}><span>{MEAL_LABELS[meal.mealType]}</span><span className={styles.disclosureHint} aria-hidden="true">{disclosure.detail ? "Cerrar −" : "Ver +"}</span></button></h2>
    <div className={styles.mealOverview}>
      <span className={choice.complete ? styles.choiceComplete : styles.choicePending}>{choice.label}</span>
      {!meal.readOnly && meal.plan.menus.map(menu => <p key={menu.number}>{meal.plan.menus.length > 1 && <small>Opción {menu.number}</small>}<strong>{menu.selection?.title ?? "Sin elegir"}</strong></p>)}
    </div>
    <div id={detailId} hidden={!disclosure.detail} className={styles.mealDetail}>
    {meal.readOnly ? <><p className={styles.warning}>Plan anterior · Solo lectura. {meal.reason}</p><PreviousPlan meal={meal} data={data} /></> : <>
      {meal.plan.menus.map(menu => <div className={styles.dailyMenu} key={menu.number}>
        <div>{meal.plan.menus.length > 1 && <small>OPCIÓN {menu.number}</small>}<strong>{menu.selection?.title ?? "Todavía no elegimos qué comer"}</strong>
          {menu.selection?.note && <p>{menu.selection.note}</p>}
          {attendance && <span>{menuSummary(meal.plan, menu.number)}</span>}
          {attendance && <small>{meal.plan.people.filter(p => p.menu === menu.number).map(p => data.members.find(m => m.id === p.memberId)?.name).filter(Boolean).join(" · ")}</small>}
        </div>
        {!readOnly && <div className={styles.menuActions}>{menu.selection ? adult && <><button disabled={busy} onClick={e => onBank(menu.number, e.currentTarget)}>{"Cambiar comida"}</button><button disabled={busy} onClick={() => onAsk(meal, "clear", menu.number)}>Quitar comida</button></> : <button className={styles.primaryButton} disabled={busy} onClick={e => onBank(menu.number, e.currentTarget)}>Agregar comida</button>}{adult && menu.number === 2 && <button disabled={busy} onClick={() => onAsk(meal, "remove-second", 2)}>Quitar opción 2</button>}</div>}
      </div>)}
      {adult && !readOnly && attendance && meal.plan.menus.length === 1 && <button className={styles.inlineAction} disabled={busy} onClick={() => void onMutate(meal, { action: "add-second" }, "Segunda opción agregada.")}>Agregar otra opción</button>}
      {attendance && <div className={styles.dailyPeople}>
        <p className={styles.dailySummary}>{participationSummary(meal.plan.people)}</p>
        {meal.plan.people.map(person => {
          const profile = data.members.find(m => m.id === person.memberId)!;
          const disabled = busy || readOnly || !canChangePerson(data.currentRole, data.currentMemberId, person.memberId);
          return <div className={styles.dailyPerson} key={person.memberId}>
            <strong>{profile.name}</strong>
            <div className={styles.personChoices} role="group" aria-label={`Preparación para ${profile.name}`}>
              {(["home", "away", "packed"] as const).map(status => <button key={status} aria-pressed={person.status === status} disabled={disabled} onClick={() => void onMutate(meal, { action: "person", memberId: person.memberId, status: person.status === status ? "unknown" : status }, "Elección guardada.", person)}>{status === "home" ? "Come en casa" : status === "packed" ? "Se lleva comida" : "No necesita comida"}</button>)}
            </div>
            {person.status === "unknown" && <small>Falta indicar</small>}
            {needsMeal(person.status) && meal.plan.menus.length === 2 && <label className={styles.personMenu}><span>Opción para {profile.name}</span><select aria-label={`Comida de ${profile.name}`} value={person.menu ?? 1} disabled={disabled} onChange={e => void onMutate(meal, { action: "person", memberId: person.memberId, status: person.status, menu: Number(e.target.value) }, "Comida asignada.", person)}>{meal.plan.menus.map(m => <option key={m.number} value={m.number}>Opción {m.number} · {m.selection?.title ?? "Sin elegir"}</option>)}</select></label>}
          </div>;
        })}
      </div>}
      {readOnly && <p className={styles.muted}>Solo lectura</p>}
      {meal.previous && <details className={styles.details} open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}><summary>Información anterior</summary><PreviousPlan meal={meal} data={data} /></details>}
    </>}
    </div>
  </article>;
}
function PreviousPlan({ meal, data }: { meal: PlannerMeal; data: PlannerWeek }) {
  if (!meal.previous) return <p>Sin información anterior.</p>;
  return <div className={styles.previousPlan}>
    {meal.previous.groups.map(group => <p key={group.id}><strong>{group.kind === "home" ? "Casa" : group.kind === "packed" ? "Lunchera" : "Compartido"}</strong> · {group.followsHome ? "Comparte el plato de casa" : meal.previous?.suggestions.find(i => i.id === group.suggestionId)?.title ?? "Sin plato identificado"}<br />{meal.previous?.participants.filter(p => p.groupId === group.id).map(p => data.members.find(m => m.id === p.memberId)?.name ?? "Integrante anterior").join(" · ")}</p>)}
    {meal.previous.participants.map(p => <p key={p.memberId}>{data.members.find(m => m.id === p.memberId)?.name ?? "Integrante anterior"}: {STATUS_LABELS[p.status as ParticipationStatus] ?? "Sin elegir"}</p>)}
    {!meal.previous.groups.length && meal.previous.selection && <p>{meal.previous.selection.title}</p>}
  </div>;
}
