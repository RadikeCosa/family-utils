"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthClient } from "@/lib/family-auth-client";
import styles from "./menus.module.css";
import RoutineEditor from "./RoutineEditor";
import WeekPlanner from "./WeekPlanner";
import IdeaBank, { type BankState } from "./IdeaBank";
import type { Meal, Group, WeekData, Selection, Suggestion } from "@/lib/meals/types";
import { PARTICIPATION_STATUSES, PARTICIPATION_LABELS, type ParticipationStatus as AttendanceStatus, MEAL_TYPES, MEAL_LABELS, hasMealAttendance, type MealType, addDays, formatMealAttribution, getDayInTimeZone, isMenuDateInRange, isValidDate, startOfWeek, menuDateBounds } from "@/lib/meals/rules";

const authClient = createAuthClient();
type DialogState =
  | { kind: "choose"; meal: Meal; suggestionId?: string; group?: Group }
  | { kind: "attendance"; meal: Meal }
  | { kind: "propose"; meal: Meal }
  | { kind: "edit"; meal: Meal; suggestion: Suggestion }
  | { kind: "withdraw"; meal: Meal; suggestion: Suggestion }
  | { kind: "clear" | "link" | "unlink"; meal: Meal; group: Group }
  | { kind: "reset"; meal: Meal }
  | { kind: "group"; meal: Meal; action: "create" | "rename" | "delete"; group?: Group };
type ApiError = Error & { status?: number; code?: string };

function clientFamilyDay(timeZone = "America/Argentina/Buenos_Aires") { return getDayInTimeZone(new Date(), timeZone); }
function labelDay(day: string) {
  const label = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${day}T12:00:00.000Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function labelTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value));
}
function groupKey(group: Group) { return group.isDefault ? group.kind : group.id ?? group.kind; }
function mealTitle(type: MealType) { return MEAL_LABELS[type]; }
function statusLabel(status: AttendanceStatus) { return PARTICIPATION_LABELS[status]; }
function countAttendance(meal: Meal) {
  const counts = { home: 0, packed: 0, away: 0, unknown: 0 };
  for (const person of meal.attendance) counts[person.status] += 1;
  return counts;
}

function replaceDateInUrl(day: string, view: "week" | "day") {
  const url = new URL(window.location.href);
  url.searchParams.set("fecha", day);
  url.searchParams.set("vista", view === "week" ? "semana" : "dia");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({})) as { error?: unknown; code?: unknown };
  if (!response.ok) {
    const error = new Error(typeof body.error === "string" ? body.error : "No se pudo completar la acción.") as ApiError;
    error.status = response.status;
    error.code = typeof body.code === "string" ? body.code : undefined;
    throw error;
  }
  return body as T;
}

export default function MenuApp() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(clientFamilyDay);
  const [view, setView] = useState<"week" | "day">("week");
  const followsTodayRef = useRef(true);
  const [data, setData] = useState<WeekData | null>(null);
  const observedClientDay = useRef(clientFamilyDay());
  const [dateInitialized, setDateInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const busyRef = useRef(new Set<string>());
  const requestSequence = useRef(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [bank, setBank] = useState<BankState | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const [choice, setChoice] = useState("");
  const [targetGroup, setTargetGroup] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [expandedMeals, setExpandedMeals] = useState<Set<MealType>>(new Set());
  const [expandedIdeas, setExpandedIdeas] = useState<Set<string>>(new Set());
  const etag = useRef("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogMealTypeRef = useRef<MealType>("lunch");
  const focusedMealRefs = useRef<Record<MealType, HTMLElement | null>>({ breakfast: null, lunch: null, snack: null, dinner: null });

  const weekStart = startOfWeek(selectedDate);
  const admin = data?.currentRole === "administrator";
  const today = data?.today ?? clientFamilyDay(data?.timeZone);
  const bounds = menuDateBounds(today);
  const weekReady = data?.weekStart === weekStart;
  const mealsByType = useMemo(() => {
    const map = new Map<MealType, Meal>();
    if (weekReady) for (const meal of data?.meals ?? []) if (meal.date === selectedDate) map.set(meal.mealType, meal);
    return map;
  }, [data, selectedDate, weekReady]);

  const dialogGroup = dialog?.meal.groups.find(group => groupKey(group) === targetGroup) ?? (targetGroup ? undefined : dialog?.meal.groups[0]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("fecha");
    const todayAtMount = clientFamilyDay();
    queueMicrotask(() => {
      setView(params.get("vista") === "semana" ? "week" : requested || params.get("vista") === "dia" ? "day" : "week");
      if (requested) {
        followsTodayRef.current = false;
        if (isValidDate(requested) && isMenuDateInRange(requested, todayAtMount)) {
          setSelectedDate(requested);
        } else {
          setNotice("La fecha no es válida o queda fuera del período permitido. Mostramos hoy.");
          setSelectedDate(todayAtMount);
        }
      }
      setDateInitialized(true);
    });
  }, []);

  const refresh = useCallback(async (force = false) => {
    const sequence = ++requestSequence.current;
    const requestedWeek = startOfWeek(selectedDate);
    setLoading(true);
    try {
      const response = await fetch(`/api/meals?weekStart=${requestedWeek}`, {
        cache: "no-store",
        headers: !force && etag.current ? { "If-None-Match": etag.current } : {},
      });
      if (sequence !== requestSequence.current) return;
      if (response.status === 304) return null;
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "No se pudo cargar la semana.");
      etag.current = response.headers.get("ETag") ?? "";
      const week = body as WeekData;
      if (!isMenuDateInRange(selectedDate, week.today)) {
        followsTodayRef.current = false;
        setSelectedDate(week.today);
        setNotice("La fecha no es válida o queda fuera del período permitido. Mostramos hoy.");
      } else if (followsTodayRef.current && selectedDate !== week.today) {
        setSelectedDate(week.today);
      }
      setData(week);
      setError("");
      return body as WeekData;
    } catch (caught) {
      if (sequence === requestSequence.current) setError(caught instanceof Error ? caught.message : "No se pudo cargar la semana.");
      return null;
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (!dateInitialized) return;
    replaceDateInUrl(selectedDate, view);
    if (data?.weekStart === weekStart) return;
    etag.current = "";
    queueMicrotask(() => void refresh(true));
  }, [dateInitialized, selectedDate, view, weekStart, data?.weekStart, refresh]);

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === "visible") {
        void refresh(true);
      }
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const currentDay = clientFamilyDay(data?.timeZone);
      if (currentDay !== observedClientDay.current) {
        observedClientDay.current = currentDay;
        void refresh(true);
      }
    }, 30_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh, data?.today, data?.timeZone]);

  const dialogKind = dialog?.kind;
  useEffect(() => {
    const element = dialogRef.current;
    if (dialogKind && element) {
      if (!element.open) element.showModal();
      requestAnimationFrame(() => (titleInputRef.current ?? element.querySelector<HTMLButtonElement>("button"))?.focus());
    } else if (!dialogKind && element?.open) {
      element.close();
      requestAnimationFrame(() => {
        if (openerRef.current?.isConnected) openerRef.current.focus();
        else focusedMealRefs.current[dialogMealTypeRef.current]?.focus();
      });
    }
  }, [dialogKind]);

  function navigateToDate(day: string, shouldFollowToday = false) {
    const date = isMenuDateInRange(day, today) ? day : today;
    followsTodayRef.current = shouldFollowToday;
    setSelectedDate(date);
    setError("");
    setNotice(date !== day ? "La fecha queda fuera del período permitido. Mostramos hoy." : "");
  }

  function openDialog(state: DialogState, opener: HTMLElement) {
    openerRef.current = opener;
    dialogMealTypeRef.current = state.meal.mealType;
    setDialogError("");
    setDialogBusy(false);
    if (state.kind === "choose" || state.kind === "clear" || state.kind === "link" || state.kind === "unlink") {
      const group = state.group ?? state.meal.groups[0];
      setTargetGroup(groupKey(group));
    }
    if (state.kind === "choose") {
      const selected = (state.group ?? state.meal.groups[0]).selection?.suggestionId;
      setChoice(state.suggestionId ?? selected ?? (state.meal.suggestions.length ? "" : "new"));
      setTitle(""); setNote("");
    } else if (state.kind === "propose") {
      setTitle(""); setNote("");
    } else if (state.kind === "group") {
      setTitle(state.group?.name ?? "");
    } else if (state.kind === "edit") {
      setTitle(state.suggestion.title); setNote(state.suggestion.note ?? "");
    }
    setDialog(state);
  }

  function closeDialog() {
    if (dialogBusy) return;
    setDialog(null);
    setDialogError("");
  }

  async function perform(key: string, action: () => Promise<unknown>, success: string, keepDialog = false): Promise<boolean> {
    if (busyRef.current.has(key)) return false;
    busyRef.current.add(key);
    setBusyKey(key);
    setDialogBusy(true);
    setError(""); setNotice(""); setDialogError("");
    try {
      await action();
      const latest = await refresh(true);
      if (keepDialog && latest) {
        setDialog((current) => {
          if (!current) return current;
          const meal = latest.meals.find((item) => item.date === current.meal.date && item.mealType === current.meal.mealType);
          return meal ? { ...current, meal } : current;
        });
      }
      setNotice(success);
      if (!keepDialog) setDialog(null);
      return true;
    } catch (caught) {
      const failure = caught as ApiError;
      if (failure.code === "MEAL_DAY_CLOSED") {
        setDialogError("Este día ya no se puede editar. Actualizamos la información; podés copiar el texto antes de cerrar.");
        await refresh(true);
      } else if (failure.status === 409) {
        setDialogError("Alguien cambió esta comida mientras editabas. La elección actual ya está actualizada; tu borrador sigue aquí.");
        const latest = await refresh(true);
        if (latest && dialog) {
          const currentMeal = latest.meals.find((meal) => meal.date === dialog.meal.date && meal.mealType === dialog.meal.mealType);
          if (currentMeal) setDialog((current) => current ? { ...current, meal: currentMeal } as DialogState : current);
        }
      } else {
        setDialogError(failure.message || "No se pudo completar la acción.");
      }
      return false;
    } finally {
      busyRef.current.delete(key);
      setBusyKey("");
      setDialogBusy(false);
    }
  }

  async function updateAttendance(meal: Meal, memberId: string, status: AttendanceStatus | "inherit", groupId?: string | null) {
    const key = `attendance-${meal.date}-${meal.mealType}-${memberId}`;
    if (status !== "inherit") {
      const destination = status === "home" ? meal.groups.find(group=>group.kind==="home")?.id ?? null
        : status === "packed" ? groupId ?? meal.groups.find(group=>group.kind==="packed"&&group.isDefault)?.id ?? null : null;
      setDialog(current=>current?.kind==="attendance"?{...current,meal:{...current.meal,attendance:current.meal.attendance.map(person=>person.memberId===memberId?{...person,status,groupId:destination}:person)}}:current);
    }
    const saved = await perform(key, () => jsonRequest("/api/meals/attendance", {
      method: "PUT",
      body: JSON.stringify({ date: meal.date, mealType: meal.mealType, memberId, status, groupId }),
    }), "Participación actualizada.", true);
    if (!saved) {
      const latest = await refresh(true);
      const actual = latest?.meals.find(item=>item.date===meal.date&&item.mealType===meal.mealType) ?? meal;
      setDialog(current=>current?.kind==="attendance"?{...current,meal:actual}:current);
    }
  }

  async function saveChoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || dialog.kind !== "choose" || !dialogGroup) return;
    const meal = dialog.meal;
    const isNew = choice === "new";
    const key = `selection-${meal.date}-${meal.mealType}`;
    const saved = await perform(key, () => jsonRequest("/api/meals/selection", {
      method: "PUT",
      body: JSON.stringify({
        date: meal.date,
        mealType: meal.mealType,
        suggestionId: isNew ? null : choice,
        ...(isNew ? { title: title.trim(), note: note.trim() } : {}),
        expectedVersion: dialogGroup.selectionVersion,
        groupId: dialogGroup.id, groupKind: dialogGroup.kind,
      }),
    }), "Comida elegida para la familia.", true);
    if (!saved) return;
    setDialog(null);
  }

  async function saveProposal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || dialog.kind !== "propose") return;
    const meal = dialog.meal;
    await perform(`proposal-${meal.date}-${meal.mealType}`, () => jsonRequest("/api/meals/suggestions", {
      method: "POST",
      body: JSON.stringify({ date: meal.date, mealType: meal.mealType, title: title.trim(), note: note.trim() }),
    }), "Idea agregada.");
  }

  async function saveEditedSuggestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || dialog.kind !== "edit") return;
    const { suggestion } = dialog;
    await perform(`suggestion-${suggestion.id}`, () => jsonRequest(`/api/meals/suggestions/${suggestion.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: suggestion.version, title: title.trim(), note: note.trim() }),
    }), "Idea actualizada.");
  }

  async function withdrawSuggestion() {
    if (!dialog || dialog.kind !== "withdraw") return;
    const { suggestion } = dialog;
    await perform(`suggestion-${suggestion.id}`, () => jsonRequest(`/api/meals/suggestions/${suggestion.id}`, {
      method: "DELETE", body: JSON.stringify({ expectedVersion: suggestion.version }),
    }), "Idea retirada.");
  }

  async function clearSelection() {
    if (!dialog || dialog.kind !== "clear" || !dialogGroup) return;
    const meal = dialog.meal;
    await perform(`selection-${meal.date}-${meal.mealType}`, () => jsonRequest("/api/meals/selection", {
      method: "PUT",
      body: JSON.stringify({ date: meal.date, mealType: meal.mealType, suggestionId: null, expectedVersion: dialogGroup.selectionVersion, groupId: dialogGroup.id, groupKind: dialogGroup.kind }),
    }), "Elección quitada. La idea sigue disponible.");
  }

  async function saveLink() {
    if (!dialog || (dialog.kind !== "link" && dialog.kind !== "unlink") || !dialogGroup) return;
    await perform(`selection-${dialog.meal.date}-${dialog.meal.mealType}`, () => jsonRequest("/api/meals/selection", {
      method: "PUT", body: JSON.stringify({date:dialog.meal.date,mealType:dialog.meal.mealType,groupId:dialogGroup.id,groupKind:dialogGroup.kind,mode:dialog.kind,expectedVersion:dialogGroup.selectionVersion}),
    }), dialog.kind === "link" ? "Lunchera vinculada a Casa." : "Lunchera independiente.");
  }
  async function saveGroup(event?: React.FormEvent) {
    event?.preventDefault();
    if (!dialog || dialog.kind !== "group") return;
    await perform(`group-${dialog.meal.date}-${dialog.meal.mealType}`, () => jsonRequest("/api/meals/groups", {
      method: dialog.action === "create" ? "POST" : dialog.action === "rename" ? "PATCH" : "DELETE",
      body:JSON.stringify({date:dialog.meal.date,mealType:dialog.meal.mealType,groupId:dialog.group?.id,groupKind:dialog.group?.kind,name:title.trim()}),
    }), dialog.action === "delete" ? "Lunchera eliminada." : "Lunchera guardada.");
  }
  async function resetDistribution() {
    if (!dialog || dialog.kind !== "reset") return;
    await perform(`distribution-${dialog.meal.date}-${dialog.meal.mealType}`,()=>jsonRequest("/api/meals/distribution",{
      method:"DELETE",body:JSON.stringify({date:dialog.meal.date,mealType:dialog.meal.mealType}),
    }),"La distribución vuelve a seguir la rutina. Los platos se conservaron.");
  }

  async function proposeBankIdea(id:string,date:string,type:MealType) {
    const latest=await refresh(true);
    const meal=latest?.meals.find(item=>item.date===date&&item.mealType===type);
    setView("day");setExpandedMeals(current=>new Set(current).add(type));
    setBank(null);
    if(meal&&admin) {
      const original=bank?.mealType===type?bank.group:undefined;
      const group=original?meal.groups.find(item=>groupKey(item)===groupKey(original)):undefined;
      if(original&&!group){setDialog(null);setNotice("Idea agregada. El grupo cambió; elegí un destino disponible.");return;}
      openDialog({kind:"choose",meal,suggestionId:id,group},focusedMealRefs.current[type]??openerRef.current!);
    } else {setDialog(null);setNotice("Idea agregada desde el banco.");}
  }

  function showCurrentSelection() {
    const meal = dialog?.meal;
    closeDialog();
    if (!meal) return;
    requestAnimationFrame(() => focusedMealRefs.current[meal.mealType]?.focus());
  }

  return <main className={`${styles.page} ${view === "week" ? styles.weekPage : ""}`}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Family Utils, inicio"><span className={styles.mark} aria-hidden="true">f</span>family<span>utils</span></Link>
      <nav className={styles.headerLinks} aria-label="Aplicaciones"><Link href="/tareas">Tareas</Link><Link className={styles.activeLink} href="/menus">Menús</Link><Link href="/compras">Compras</Link><Link href="/familia">Mi familia</Link></nav>
      <button className={styles.exitButton} onClick={() => void authClient.signOut().then(() => router.push("/acceso"))}>Salir</button>
    </header>

    <section className={styles.intro}>
      <p className={styles.eyebrow}>PLANIFICADOR FAMILIAR</p>
      <div className={styles.titleRow}>
        <div><h1>¿Qué comemos?</h1><p>Un plan compartido para las comidas de cada día.</p>{data && <div className={styles.plannerTools}>{admin && <RoutineEditor members={data.members} today={today} onSaved={() => refresh(true)} />}<button className={styles.expandButton} onClick={event=>setBank({date:selectedDate,mealType:"lunch",opener:event.currentTarget})}>Banco de ideas</button></div>}</div>
        <div className={styles.dateNav} aria-label={view === "week" ? "Navegar por semana" : "Navegar por fecha"}>
          <button aria-label={view === "week" ? "Semana anterior" : "Día anterior"} onClick={() => navigateToDate(addDays(selectedDate, view === "week" ? -7 : -1))}>←</button>
          <label className={styles.dateInput}><span className={styles.srOnly}>Ir a una fecha</span><input type="date" value={selectedDate} min={bounds.earliest} max={bounds.latest} onChange={(event) => {setView("day");navigateToDate(event.target.value);}} /></label>
          <button aria-label={view === "week" ? "Semana siguiente" : "Día siguiente"} onClick={() => navigateToDate(addDays(selectedDate, view === "week" ? 7 : 1))}>→</button>
          <button className={styles.todayButton} onClick={() => navigateToDate(today, true)} disabled={selectedDate === today}>Hoy</button>
        </div>
      </div>
      <div className={styles.viewSwitcher} aria-label="Vista del planificador">
        <button disabled={!dateInitialized} aria-pressed={view === "week"} onClick={() => setView("week")}>Semana</button>
        <button disabled={!dateInitialized} aria-pressed={view === "day"} onClick={() => setView("day")}>Día</button>
      </div>
      <p className={styles.dateLabel}>{view === "week" ? `Semana del ${new Intl.DateTimeFormat("es-AR", {timeZone:"UTC",day:"numeric",month:"long",year:"numeric"}).formatRange(new Date(`${weekStart}T12:00:00.000Z`),new Date(`${addDays(weekStart,6)}T12:00:00.000Z`))}` : labelDay(selectedDate)}{view === "day" ? selectedDate === today ? " · Hoy" : selectedDate < today ? " · Solo lectura" : "" : ""}</p>
      {error && <p className={styles.error} role="alert">{error} <button onClick={() => void refresh(true)}>Reintentar</button></p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </section>

    {view === "week" && <WeekPlanner data={weekReady ? data : null} onSelect={day => {setView("day");navigateToDate(day);}} />}
    {view === "day" && <section className={styles.mealList} aria-label={`Comidas del ${labelDay(selectedDate)}`}>
      {MEAL_TYPES.map((mealType) => {
        const meal = mealsByType.get(mealType);
        const compact = !hasMealAttendance(mealType);
        const expanded = !compact || expandedMeals.has(mealType);
        if (!weekReady || !meal || !data) return <article className={styles.mealCard} key={mealType}><h2>{mealTitle(mealType)}</h2><p className={styles.loading}>{!weekReady || loading ? "Cargando…" : "No se pudo cargar esta comida."}</p></article>;
        const past = selectedDate < today;
        const counts = countAttendance(meal);
        const allAbsent = meal.attendance.length > 0 && counts.home === 0 && counts.packed === 0 && counts.unknown === 0;
        const key = `${meal.date}-${meal.mealType}`;
        const selectedIds = new Set(meal.groups.flatMap(group => group.selection ? [group.selection.suggestionId] : []));
        const alternatives = meal.suggestions.filter(suggestion => meal.groups.length > 1 || !selectedIds.has(suggestion.id));
        const visibleIdeas = expandedIdeas.has(key) ? alternatives : alternatives.slice(0, 3);
        return <article className={`${styles.mealCard} ${compact ? styles.compactMeal : ""}`} id={`meal-${mealType}`} tabIndex={-1} ref={(node) => { focusedMealRefs.current[mealType] = node; }} key={mealType}>
          <header className={styles.mealHeading}>
            <div><h2>{mealTitle(mealType)}</h2>{compact && !expanded && <span>{meal.selection?.title ?? "Sin plan"}</span>}</div>
            {compact && <button className={styles.expandButton} aria-expanded={expanded} aria-controls={`content-${mealType}`} onClick={() => setExpandedMeals((current) => {
              const next = new Set(current);
              if (next.has(mealType)) next.delete(mealType); else next.add(mealType);
              return next;
            })}>{expanded ? "Cerrar" : "Ver plan"}<span className={styles.srOnly}> de {mealTitle(mealType).toLowerCase()}</span></button>}

          </header>
          <div id={`content-${mealType}`} hidden={!expanded}>
            <div className={styles.groupList}>
              {meal.groups.map(group => {
                const people = meal.attendance.filter(person => group.id ? person.groupId === group.id : !person.groupId && person.status === group.kind);
                return <section className={styles.groupBlock} key={group.id ?? group.kind} aria-label={`${group.name} · ${mealTitle(mealType)}`}>
                  <header className={styles.groupHeading}>
                    {!compact && <div><h3>{group.name}</h3><small>{people.length ? people.map(person => data.members.find(member => member.id === person.memberId)?.name).join(" · ") : "Sin personas asignadas"}</small></div>}
                    {admin && !past && !group.selection && !group.followsHome && <button className={styles.primaryButton} onClick={event => openDialog({kind:"choose",meal,group},event.currentTarget)}>Elegir comida<span className={styles.srOnly}> para {group.name}</span></button>}
                    {(!!group.selection || !past && group.kind === "packed") && <details className={styles.actionsMenu}>
                      <summary aria-label={`Acciones de ${group.name} · ${mealTitle(mealType).toLowerCase()}`}>⋯</summary>
                      <div className={styles.actionOptions}>
                        {admin && !past && <>
                          <button onClick={event => {const menu=event.currentTarget.closest("details")!;menu.open=false;openDialog({kind:"choose",meal,group},menu.querySelector("summary")!);}}>{group.selection ? "Cambiar comida" : "Elegir comida"}</button>
                          {(group.selection || group.followsHome) && <button onClick={event => {const menu=event.currentTarget.closest("details")!;menu.open=false;openDialog({kind:"clear",meal,group},menu.querySelector("summary")!);}}>Quitar elección</button>}
                          {group.kind === "packed" && <button onClick={event => {const menu=event.currentTarget.closest("details")!;menu.open=false;openDialog({kind:group.followsHome?"unlink":"link",meal,group},menu.querySelector("summary")!);}}>{group.followsHome ? "Desvincular de Casa" : "Lo mismo que en casa"}</button>}
                        </>}
                        {group.selection && <button onClick={event=>{const menu=event.currentTarget.closest("details")!;menu.open=false;setBank({date:meal.date,mealType:meal.mealType,source:meal.suggestions.find(idea=>idea.id===group.selection?.suggestionId),opener:menu.querySelector("summary")!});}}>Guardar en banco</button>}
                        {!past && group.kind === "packed" && <>
                          <button onClick={event => {const menu=event.currentTarget.closest("details")!;menu.open=false;openDialog({kind:"group",action:"rename",meal,group},menu.querySelector("summary")!);}}>Renombrar lunchera</button>
                          <button onClick={event => {const menu=event.currentTarget.closest("details")!;menu.open=false;openDialog({kind:"group",action:"delete",meal,group},menu.querySelector("summary")!);}}>Eliminar lunchera</button>
                        </>}
                      </div>
                    </details>}
                  </header>
                  {group.followsHome && <p className={styles.linkedNote}>Lo mismo que en casa · vinculada</p>}
                  {group.selection ? <div className={styles.selectedMeal}><span className={styles.selectedEyebrow}>COMIDA ELEGIDA</span><strong>{group.selection.title ?? "La idea ya no está disponible"}</strong><small>{formatMealAttribution(group.selection.proposedById,group.selection.proposedByName,group.selection.confirmedByMemberId,group.selection.confirmedByName)} · {labelTime(group.selection.confirmedAt)}</small></div>
                    : <p className={styles.noSelection}>{group.followsHome ? "Pendiente: falta elegir la comida de Casa." : "Todavía no se eligió una comida para este horario."}</p>}
                </section>;
              })}
            </div>

            <section className={styles.ideasSection} aria-label={`Ideas para ${mealTitle(mealType).toLowerCase()}`}>
              <div className={styles.ideasHeading}><h3>{selectedIds.size ? "Otras ideas" : "Ideas"}</h3>
                {!past && <div className={styles.inlineActions}><button className={styles.expandButton} onClick={(event) => openDialog({ kind: "propose", meal }, event.currentTarget)}>Proponer idea</button><button className={styles.expandButton} onClick={event=>setBank({date:meal.date,mealType:meal.mealType,opener:event.currentTarget})}>Buscar en banco</button></div>}
              </div>
              <div className={styles.suggestions}>
                {!alternatives.length && <p className={styles.empty}>{selectedIds.size ? "Podés proponer otra alternativa." : "Todavía no hay ideas. Podés proponer una."}</p>}
                {visibleIdeas.map((suggestion) => {
                  const selected = selectedIds.has(suggestion.id);
                  const canManage = !past && !selected && (admin || suggestion.authorMemberId === data.currentMemberId);
                  return <div className={styles.suggestion} key={suggestion.id}>
                    <div className={styles.suggestionText}><strong>{suggestion.title}</strong>{suggestion.note && <p>{suggestion.note}</p>}<small>Idea de {suggestion.authorName}{selected ? ` · Elegida para ${meal.groups.filter(group=>group.selection?.suggestionId===suggestion.id).map(group=>group.name).join(", ")}` : ""}</small></div>
                    <div className={styles.suggestionActions}>
                      {admin && !past && <button onClick={(event) => openDialog({ kind: "choose", meal, suggestionId: suggestion.id }, event.currentTarget)}>Elegir<span className={styles.srOnly}> {suggestion.title}</span></button>}
                      <details className={styles.actionsMenu}>
                        <summary aria-label={`Acciones de idea ${suggestion.title}`}>⋯</summary>
                        <div className={styles.actionOptions}>
                          <button onClick={event=>{const menu=event.currentTarget.closest("details")!;menu.open=false;setBank({date:meal.date,mealType:meal.mealType,source:suggestion,opener:menu.querySelector("summary")!});}}>Guardar en banco</button>
                          {canManage && <>
                            <button onClick={event=>{const menu=event.currentTarget.closest("details")!;menu.open=false;openDialog({kind:"edit",meal,suggestion},menu.querySelector("summary")!);}}>Editar</button>
                            <button onClick={event=>{const menu=event.currentTarget.closest("details")!;menu.open=false;openDialog({kind:"withdraw",meal,suggestion},menu.querySelector("summary")!);}}>Retirar</button>
                          </>}
                        </div>
                      </details>
                    </div>
                  </div>;
                })}
                {alternatives.length > 3 && <button className={styles.expandButton} aria-expanded={expandedIdeas.has(key)} onClick={() => setExpandedIdeas((current) => {
                  const next = new Set(current);
                  if (next.has(key)) next.delete(key); else next.add(key);
                  return next;
                })}>{expandedIdeas.has(key) ? "Ver menos" : `Ver todas (${alternatives.length})`}</button>}
              </div>
            </section>

            {hasMealAttendance(mealType) && <div className={styles.summaryRow}>
              <p>{counts.home} en casa · {counts.packed} llevan · {counts.away} afuera · {counts.unknown} por definir</p>
              {!past && <button className={styles.expandButton} aria-label={`Editar quiénes comen en ${mealTitle(mealType).toLowerCase()}`} onClick={(event) => openDialog({ kind: "attendance", meal }, event.currentTarget)}>Editar</button>}
              <span className={styles.muted}>{meal.distributionOrigin}</span>
              {allAbsent && <span className={styles.warning}>Nadie necesita comida de casa; podés elegir de todos modos.</span>}
            </div>}
          </div>
        </article>;
      })}
    </section>}

    <footer className={styles.footer}><Link href="/">Family Utils</Link><span aria-live="polite">{loading ? "Actualizando…" : error ? "No se pudo actualizar" : "Plan compartido"}</span></footer>

    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="menu-dialog-title" onCancel={(event) => { event.preventDefault(); closeDialog(); }}>
      {dialog && <>
        <button className={styles.dialogClose} aria-label="Cerrar" onClick={closeDialog}>×</button>
        <h2 id="menu-dialog-title">{dialog.kind === "choose" ? `${dialogGroup?.selection ? "Cambiar" : "Elegir"} comida · ${mealTitle(dialog.meal.mealType)}` : dialog.kind === "propose" ? `Proponer idea · ${mealTitle(dialog.meal.mealType)}` : dialog.kind === "attendance" ? `Quiénes comen · ${mealTitle(dialog.meal.mealType)}` : dialog.kind === "edit" ? "Editar idea" : dialog.kind === "withdraw" ? "Retirar idea" : dialog.kind === "group" ? `${dialog.action === "create" ? "Crear" : dialog.action === "rename" ? "Renombrar" : "Eliminar"} lunchera` : dialog.kind === "reset" ? "Volver a la rutina" : dialog.kind === "link" ? "Lo mismo que en casa" : dialog.kind === "unlink" ? "Desvincular lunchera" : "Quitar elección"}</h2>
        <p className={styles.dialogDate}>{labelDay(dialog.meal.date)}</p>
        {dialog.kind === "choose" && <form onSubmit={(event) => void saveChoice(event)}>
          <button type="button" className={styles.expandButton} onClick={event=>setBank({date:dialog.meal.date,mealType:dialog.meal.mealType,group:dialogGroup,opener:event.currentTarget})}>Buscar en banco</button>
          {dialog.meal.groups.length > 1 && <div className={styles.formFields}><label>Para quién<select aria-label="Para quién" value={targetGroup} onChange={event => setTargetGroup(event.target.value)}>{dialog.meal.groups.map(group=><option key={group.id??group.kind} value={groupKey(group)}>{group.name}</option>)}</select></label></div>}
          {dialog.meal.suggestions.length > 0 && <fieldset className={styles.choiceList}>
            <legend>Elegí una idea</legend>
            {dialog.meal.suggestions.map((suggestion, index) => <label className={styles.choiceOption} key={suggestion.id}>
              <input ref={index === 0 ? titleInputRef : undefined} type="radio" name="meal-choice" value={suggestion.id} checked={choice === suggestion.id} onChange={() => setChoice(suggestion.id)} />
              <span><strong>{suggestion.title}</strong>{suggestion.note && <small>{suggestion.note}</small>}</span>
            </label>)}
          </fieldset>}
          <label className={styles.newChoice}><input type="radio" name="meal-choice" value="new" checked={choice === "new"} onChange={() => setChoice("new")} /> Escribir otra comida</label>
          {choice === "new" && <div className={styles.formFields}>
            <label>Comida<input ref={titleInputRef} name="title" required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" /></label>
            <label>Nota opcional<input name="note" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} autoComplete="off" /></label>
          </div>}
          <DialogError message={dialogError} currentSelection={dialogGroup?.selection ?? null} conflict={dialogError.includes("cambió")} onViewCurrent={showCurrentSelection} />
          <div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} onClick={closeDialog}>Cancelar</button><button className={styles.primaryButton} disabled={dialogBusy || !dialogGroup || selectedDate < today || (choice === "new" ? !title.trim() : !choice)}>{dialogBusy ? "Guardando…" : dialogGroup?.selection ? "Guardar cambio" : "Elegir comida"}</button></div>
        </form>}
        {dialog.kind === "propose" && <form onSubmit={(event) => void saveProposal(event)}>
          <button type="button" className={styles.expandButton} onClick={event=>setBank({date:dialog.meal.date,mealType:dialog.meal.mealType,opener:event.currentTarget})}>Buscar en banco</button>
          <div className={styles.formFields}><label>Comida<input ref={titleInputRef} required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" /></label><label>Nota opcional<input maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} autoComplete="off" /></label></div>
          <DialogError message={dialogError} />
          <div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} onClick={closeDialog}>Cancelar</button><button className={styles.primaryButton} disabled={dialogBusy || selectedDate < today || !title.trim()}>{dialogBusy ? "Guardando…" : "Agregar idea"}</button></div>
        </form>}
        {dialog.kind === "edit" && <form onSubmit={(event) => void saveEditedSuggestion(event)}>
          <div className={styles.formFields}><label>Comida<input ref={titleInputRef} required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" /></label><label>Nota opcional<input maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} autoComplete="off" /></label></div>
          <DialogError message={dialogError} />
          <div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} onClick={closeDialog}>Cancelar</button><button className={styles.primaryButton} disabled={dialogBusy || selectedDate < today || !title.trim()}>{dialogBusy ? "Guardando…" : "Guardar idea"}</button></div>
        </form>}
        {dialog.kind === "withdraw" && <>
          <p>¿Retirar “{dialog.suggestion.title}”? No se podrá elegir mientras esté retirada.</p>
          <DialogError message={dialogError} />
          <div className={styles.dialogActions}><button className={styles.secondaryButton} onClick={closeDialog}>Cancelar</button><button className={styles.textDanger} disabled={dialogBusy || selectedDate < today} onClick={() => void withdrawSuggestion()}>{dialogBusy ? "Retirando…" : "Retirar idea"}</button></div>
        </>}
        {dialog.kind === "clear" && <>
          <p>Se quitará la comida elegida. La idea seguirá disponible para volver a elegirla.</p>
          <DialogError message={dialogError} />
          <div className={styles.dialogActions}><button className={styles.secondaryButton} onClick={closeDialog}>Cancelar</button><button className={styles.textDanger} disabled={dialogBusy || !dialogGroup || selectedDate < today} onClick={() => void clearSelection()}>{dialogBusy ? "Quitando…" : "Sí, quitar elección"}</button></div>
        </>}
        {dialog.kind === "attendance" && <>
          <div className={styles.attendanceList}>
            {dialog.meal.attendance.map((record) => {
              const person = data?.members.find((candidate) => candidate.id === record.memberId);
              if (!person) return null;
              return <fieldset className={styles.attendancePerson} key={record.memberId}>
                <legend>{person.name}</legend>
                <div className={styles.statusChoices} role="radiogroup" aria-label={`Asistencia de ${person.name}`}>
                  {PARTICIPATION_STATUSES.map((status) => <label className={styles.statusChoice} key={status}>
                    <input type="radio" name={`attendance-${record.memberId}`} value={status} checked={record.status === status} disabled={dialogBusy || dialog.meal.date < today || busyKey !== ""} onChange={() => void updateAttendance(dialog.meal, record.memberId, status)} />
                    <span>{statusLabel(status)}</span>
                  </label>)}
                </div>
                {record.status === "packed" && <div className={styles.formFields}><label>Lunchera de {person.name}<select aria-label={`Lunchera de ${person.name}`} value={record.groupId??""} disabled={dialogBusy} onChange={event=>void updateAttendance(dialog.meal,record.memberId,"packed",event.target.value||null)}>{!dialog.meal.groups.some(group=>group.kind==="packed")&&<option value="">Lunchera</option>}{dialog.meal.groups.filter(group=>group.kind==="packed").map(group=><option key={group.id??group.kind} value={group.id??""}>{group.name}</option>)}</select></label></div>}
                {!dialog.meal.distributionSaved && <button className={styles.expandButton} disabled={dialogBusy} onClick={()=>void updateAttendance(dialog.meal,record.memberId,"inherit")}>Usar rutina de {person.name}</button>}
                {record.updatedByName && record.updatedAt && <small className={styles.attribution}>Actualizó {record.updatedByName} · {labelTime(record.updatedAt)}</small>}
              </fieldset>;
            })}
          </div>
          <p className={styles.muted} role="status">{dialogBusy ? "Guardando asistencia…" : "Los cambios se guardan al elegir una opción."}</p>
          <DialogError message={dialogError} />
          <p className={styles.muted}>{dialog.meal.distributionOrigin}</p>
          <div className={styles.dialogActions}>
            <button className={styles.secondaryButton} disabled={dialogBusy} onClick={event=>openDialog({kind:"group",action:"create",meal:dialog.meal},event.currentTarget)}>Crear lunchera</button>
            <button className={styles.secondaryButton} disabled={dialogBusy} onClick={event=>openDialog({kind:"reset",meal:dialog.meal},event.currentTarget)}>Volver a la rutina</button>
            <button className={styles.primaryButton} disabled={dialogBusy} onClick={closeDialog}>Listo</button>
          </div>
        </>}
        {(dialog.kind === "link" || dialog.kind === "unlink") && <>
          <p>{dialog.kind === "link" ? "Esta lunchera seguirá el menú de Casa, incluidos los cambios posteriores. Reemplazará su elección actual." : "Esta lunchera conservará el plato actual y dejará de seguir los cambios de Casa."}</p>
          <DialogError message={dialogError} />
          <div className={styles.dialogActions}><button className={styles.secondaryButton} onClick={closeDialog}>Cancelar</button><button className={styles.primaryButton} disabled={dialogBusy || !dialogGroup} onClick={()=>void saveLink()}>{dialogBusy?"Guardando…":"Confirmar"}</button></div>
        </>}
        {dialog.kind === "reset" && <>
          <p>Se descartarán la distribución guardada y los ajustes de esta fecha, incluso los realizados por otra persona. Los platos se conservarán y quienes llevan comida pasarán a Lunchera.</p>
          {dialog.meal.noRoutineMemberIds.length > 0 && <p className={styles.warning}>Sin rutina cargada: quedarán por definir {dialog.meal.noRoutineMemberIds.map(id=>data?.members.find(member=>member.id===id)?.name).join(", ")}.</p>}
          <DialogError message={dialogError} />
          <div className={styles.dialogActions}><button className={styles.secondaryButton} onClick={closeDialog}>Cancelar</button><button className={styles.primaryButton} disabled={dialogBusy} onClick={()=>void resetDistribution()}>{dialogBusy?"Guardando…":"Sí, volver a la rutina"}</button></div>
        </>}
        {dialog.kind === "group" && <form onSubmit={event=>void saveGroup(event)}>
          {dialog.action === "delete" ? <p>¿Eliminar “{dialog.group?.name}”? Primero debe quedar sin personas ni elección propia.</p> : <div className={styles.formFields}><label>Nombre de la lunchera<input ref={titleInputRef} required maxLength={80} value={title} onChange={event=>setTitle(event.target.value)} /></label></div>}
          <DialogError message={dialogError} />
          <div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} onClick={closeDialog}>Cancelar</button><button className={dialog.action==="delete"?styles.textDanger:styles.primaryButton} disabled={dialogBusy||dialog.action!=="delete"&&!title.trim()}>{dialogBusy?"Guardando…":dialog.action==="delete"?"Eliminar lunchera":"Guardar lunchera"}</button></div>
        </form>}

      </>}
    </dialog>
    {data && <IdeaBank state={bank} onClose={()=>setBank(null)} onChanged={()=>refresh(true)} onUse={proposeBankIdea} currentMemberId={data.currentMemberId} adult={admin} today={today} />}
  </main>;
}

function DialogError({ message, conflict = false, currentSelection, onViewCurrent }: { message: string; conflict?: boolean; currentSelection?: Selection | null; onViewCurrent?: () => void }) {
  if (!message) return null;
  return <div className={styles.dialogError} role="alert">
    <p>{message}</p>
    {conflict && (currentSelection
      ? <p>Ahora está elegida “{currentSelection.title ?? "una idea retirada"}”. {formatMealAttribution(currentSelection.proposedById, currentSelection.proposedByName, currentSelection.confirmedByMemberId, currentSelection.confirmedByName)} · {labelTime(currentSelection.confirmedAt)}.</p>
      : <p>Ahora no hay una comida elegida para este horario.</p>)}
    {conflict && onViewCurrent && <button type="button" onClick={onViewCurrent}>Ver la elección actual</button>}
  </div>;
}
