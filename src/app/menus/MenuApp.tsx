"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import styles from "./menus.module.css";
import { addDays, getDayInTimeZone, isMenuDateInRange, isValidDate, startOfWeek, menuDateBounds } from "@/lib/meals/rules";

const authClient = createAuthClient();
type Role = "administrator" | "member";
type MealType = "lunch" | "dinner";
type AttendanceStatus = "present" | "absent" | "unknown";
type Profile = { id: string; name: string; role: Role };
type Attendance = {
  memberId: string;
  status: AttendanceStatus;
  source: "manual" | "calendar" | "unknown";
  version: number;
  updatedByMemberId: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
};
type Suggestion = { id: string; authorMemberId: string; authorName: string; title: string; note: string | null; version: number; createdAt: string; updatedAt: string };
type Selection = { suggestionId: string; title: string | null; confirmedByMemberId: string; confirmedByName: string; confirmedAt: string; version: number };
type Meal = {
  date: string;
  mealType: MealType;
  slotId: string | null;
  attendance: Attendance[];
  suggestions: Suggestion[];
  selection: Selection | null;
  selectionVersion: number;
};
type WeekData = { weekStart: string; weekEnd: string; today: string; timeZone: string; revision: number; currentMemberId: string; currentRole: Role; members: Profile[]; meals: Meal[] };
type DialogState =
  | { kind: "choose"; meal: Meal }
  | { kind: "propose"; meal: Meal }
  | { kind: "edit"; meal: Meal; suggestion: Suggestion }
  | { kind: "withdraw"; meal: Meal; suggestion: Suggestion }
  | { kind: "clear"; meal: Meal };
type ApiError = Error & { status?: number; code?: string };

function clientFamilyDay(timeZone = "America/Argentina/Buenos_Aires") { return getDayInTimeZone(new Date(), timeZone); }
function labelDay(day: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${day}T12:00:00.000Z`));
}
function labelTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value));
}
function mealName(type: MealType) { return type === "lunch" ? "almuerzo" : "cena"; }
function mealTitle(type: MealType) { return type === "lunch" ? "Almuerzo" : "Cena"; }
function statusLabel(status: AttendanceStatus) { return status === "present" ? "En casa" : status === "absent" ? "No estará" : "Sin respuesta"; }
function countAttendance(meal: Meal) {
  const counts = { present: 0, absent: 0, unknown: 0 };
  for (const person of meal.attendance) counts[person.status] += 1;
  return counts;
}

function replaceDateInUrl(day: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("fecha", day);
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
  const [dialogError, setDialogError] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const [choice, setChoice] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [confirmInsideDialog, setConfirmInsideDialog] = useState(false);
  const etag = useRef("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const focusedMealRefs = useRef<Record<MealType, HTMLElement | null>>({ lunch: null, dinner: null });

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

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("fecha");
    const todayAtMount = clientFamilyDay();
    queueMicrotask(() => {
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
    replaceDateInUrl(selectedDate);
    if (data?.weekStart === weekStart) return;
    etag.current = "";
    queueMicrotask(() => void refresh(true));
  }, [dateInitialized, selectedDate, weekStart, data?.weekStart, refresh]);

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

  useEffect(() => {
    const element = dialogRef.current;
    if (dialog && element && !element.open) {
      element.showModal();
      requestAnimationFrame(() => titleInputRef.current?.focus());
    } else if (!dialog && element?.open) {
      element.close();
      requestAnimationFrame(() => openerRef.current?.focus());
    }
  }, [dialog]);

  function navigateToDate(day: string, shouldFollowToday = false) {
    const date = isMenuDateInRange(day, today) ? day : today;
    followsTodayRef.current = shouldFollowToday;
    setSelectedDate(date);
    setError("");
    setNotice(date !== day ? "La fecha queda fuera del período permitido. Mostramos hoy." : "");
  }

  function openDialog(state: DialogState, opener: HTMLElement) {
    openerRef.current = opener;
    setDialogError("");
    setDialogBusy(false);
    setConfirmInsideDialog(false);
    if (state.kind === "choose") {
      const selected = state.meal.selection?.suggestionId;
      setChoice(selected ?? (state.meal.suggestions.length ? "" : "new"));
      setTitle(""); setNote("");
    } else if (state.kind === "propose") {
      setTitle(""); setNote("");
    } else if (state.kind === "edit") {
      setTitle(state.suggestion.title); setNote(state.suggestion.note ?? "");
    }
    setDialog(state);
  }

  function closeDialog() {
    if (dialogBusy) return;
    setDialog(null);
    setDialogError("");
    setConfirmInsideDialog(false);
  }

  async function perform(key: string, action: () => Promise<unknown>, success: string, keepDialog = false): Promise<boolean> {
    if (busyRef.current.has(key)) return false;
    busyRef.current.add(key);
    setBusyKey(key);
    setDialogBusy(true);
    setError(""); setNotice(""); setDialogError("");
    try {
      await action();
      await refresh(true);
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

  async function updateAttendance(meal: Meal, memberId: string, status: AttendanceStatus) {
    const key = `attendance-${meal.date}-${meal.mealType}-${memberId}`;
    await perform(key, () => jsonRequest("/api/meals/attendance", {
      method: "PUT",
      body: JSON.stringify({ date: meal.date, mealType: meal.mealType, memberId, status }),
    }), "Asistencia actualizada.");
  }

  async function saveChoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || dialog.kind !== "choose") return;
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
        expectedVersion: meal.selectionVersion,
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
    if (!dialog || dialog.kind !== "clear") return;
    const meal = dialog.meal;
    await perform(`selection-${meal.date}-${meal.mealType}`, () => jsonRequest("/api/meals/selection", {
      method: "PUT",
      body: JSON.stringify({ date: meal.date, mealType: meal.mealType, suggestionId: null, expectedVersion: meal.selectionVersion }),
    }), "Elección quitada. La idea sigue disponible.");
  }

  function showCurrentSelection() {
    const meal = dialog?.meal;
    closeDialog();
    if (!meal) return;
    requestAnimationFrame(() => focusedMealRefs.current[meal.mealType]?.focus());
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Family Utils, inicio"><span className={styles.mark} aria-hidden="true">f</span>family<span>utils</span></Link>
      <nav className={styles.headerLinks} aria-label="Aplicaciones"><Link href="/tareas">Tareas</Link><Link className={styles.activeLink} href="/menus">Menús</Link><Link href="/familia">Mi familia</Link></nav>
      <button className={styles.exitButton} onClick={() => void authClient.signOut().then(() => router.push("/acceso"))}>Salir</button>
    </header>

    <section className={styles.intro}>
      <p className={styles.eyebrow}>PLANIFICADOR FAMILIAR</p>
      <div className={styles.titleRow}>
        <div><h1>¿Qué comemos?</h1><p>Un plan compartido para cada almuerzo y cena.</p></div>
        <div className={styles.dateNav} aria-label="Navegar por fecha">
          <button aria-label="Día anterior" onClick={() => navigateToDate(addDays(selectedDate, -1))}>←</button>
          <label className={styles.dateInput}><span className={styles.srOnly}>Ir a una fecha</span><input type="date" value={selectedDate} min={bounds.earliest} max={bounds.latest} onChange={(event) => navigateToDate(event.target.value)} /></label>
          <button aria-label="Día siguiente" onClick={() => navigateToDate(addDays(selectedDate, 1))}>→</button>
          <button className={styles.todayButton} onClick={() => navigateToDate(today, true)} disabled={selectedDate === today}>Hoy</button>
        </div>
      </div>
      <p className={styles.dateLabel}>{labelDay(selectedDate)}{selectedDate === today ? " · Hoy" : selectedDate < today ? " · Solo lectura" : ""}</p>
      {error && <p className={styles.error} role="alert">{error} <button onClick={() => void refresh(true)}>Reintentar</button></p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </section>

    <section className={styles.mealList} aria-label={`Comidas del ${labelDay(selectedDate)}`}>
      {(["lunch", "dinner"] as const).map((mealType) => {
        const meal = mealsByType.get(mealType);
        if (!weekReady || !meal || !data) return <article className={styles.mealCard} key={mealType}><h2>{mealTitle(mealType)}</h2><p className={styles.loading}>{!weekReady || loading ? "Cargando…" : "No se pudo cargar esta comida."}</p></article>;
        const past = selectedDate < today;
        const counts = countAttendance(meal);
        const allAbsent = meal.attendance.length > 0 && counts.present === 0 && counts.unknown === 0;
        const key = `${meal.date}-${meal.mealType}`;
        const stateLabel = meal.selection ? "Comida elegida" : "Sin comida elegida";
        return <article className={styles.mealCard} id={`meal-${mealType}`} tabIndex={-1} ref={(node) => { focusedMealRefs.current[mealType] = node; }} key={mealType}>
          <header className={styles.mealHeading}><div><h2>{mealTitle(mealType)}</h2><span>{stateLabel}</span></div>
            {admin && !past && <button className={styles.primaryButton} onClick={(event) => openDialog({ kind: "choose", meal }, event.currentTarget)}>{meal.selection ? "Cambiar comida" : "Elegir comida"}</button>}
          </header>
          {meal.selection ? <div className={styles.selectedMeal}>
            <span className={styles.selectedEyebrow}>PLAN DE LA FAMILIA</span>
            <strong>{meal.selection.title ?? "La idea elegida ya no está disponible"}</strong>
            <small>{meal.selection.confirmedByName} eligió esta comida · {labelTime(meal.selection.confirmedAt)}</small>
            {admin && !past && <button className={styles.textDanger} onClick={(event) => openDialog({ kind: "clear", meal }, event.currentTarget)}>Quitar elección</button>}
          </div> : <p className={styles.noSelection}>Todavía no se eligió una comida para este horario.</p>}

          <div className={styles.summaryRow}>
            <p>{counts.present} en casa · {counts.absent} no estarán · {counts.unknown} sin responder</p>
            {allAbsent && <span className={styles.warning}>Nadie figura en casa; podés elegir de todos modos.</span>}
            {!allAbsent && counts.unknown > 0 && <span className={styles.muted}>{counts.unknown} sin responder</span>}
          </div>

          <details className={styles.details}>
            <summary>Asistencia <span>Editar la de cualquier integrante</span></summary>
            <div className={styles.attendanceList}>
              {meal.attendance.map((record) => {
                const person = data.members.find((candidate) => candidate.id === record.memberId);
                if (!person) return null;
                return <fieldset className={styles.attendancePerson} key={record.memberId}>
                  <legend>{person.name}</legend>
                  <div className={styles.statusChoices} role="radiogroup" aria-label={`Asistencia de ${person.name}`}>
                    {(["present", "absent", "unknown"] as const).map((status) => <label className={styles.statusChoice} key={status}>
                      <input type="radio" name={`attendance-${key}-${record.memberId}`} value={status} checked={record.status === status} disabled={past || busyKey.startsWith(`attendance-${key}-${record.memberId}`)} onChange={() => void updateAttendance(meal, record.memberId, status)} />
                      <span>{statusLabel(status)}</span>
                    </label>)}
                  </div>
                  {record.updatedByName && record.updatedAt && <small className={styles.attribution}>Actualizó {record.updatedByName} · {labelTime(record.updatedAt)}</small>}
                </fieldset>;
              })}
            </div>
          </details>

          <details className={styles.details}>
            <summary>Ideas <span>{meal.suggestions.length}</span></summary>
            <div className={styles.suggestions}>
              {!meal.suggestions.length && <p className={styles.empty}>Todavía no hay ideas. Podés proponer una.</p>}
              {meal.suggestions.map((suggestion) => {
                const selected = meal.selection?.suggestionId === suggestion.id;
                const canManage = !past && (admin || suggestion.authorMemberId === data.currentMemberId) && !selected;
                return <div className={`${styles.suggestion} ${selected ? styles.selectedSuggestion : ""}`} key={suggestion.id}>
                  <div className={styles.suggestionText}><strong>{suggestion.title}</strong>{suggestion.note && <p>{suggestion.note}</p>}<small>Idea de {suggestion.authorName}{selected ? " · Elegida" : ""}</small></div>
                  {canManage && <div className={styles.suggestionActions}>
                    <button onClick={(event) => openDialog({ kind: "edit", meal, suggestion }, event.currentTarget)}>Editar</button>
                    <button onClick={(event) => openDialog({ kind: "withdraw", meal, suggestion }, event.currentTarget)}>Retirar</button>
                  </div>}
                </div>;
              })}
              {!past && <button className={styles.secondaryButton} onClick={(event) => openDialog({ kind: "propose", meal }, event.currentTarget)}>Proponer idea</button>}
            </div>
          </details>
        </article>;
      })}
    </section>

    <footer className={styles.footer}><Link href="/">Family Utils</Link><span aria-live="polite">{loading ? "Actualizando…" : error ? "No se pudo actualizar" : "Plan compartido"}</span></footer>

    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="menu-dialog-title" onCancel={(event) => { event.preventDefault(); closeDialog(); }}>
      {dialog && <>
        <button className={styles.dialogClose} aria-label="Cerrar" onClick={closeDialog}>×</button>
        <h2 id="menu-dialog-title">{dialog.kind === "choose" ? `${dialog.meal.selection ? "Cambiar" : "Elegir"} comida para el ${mealName(dialog.meal.mealType)}` : dialog.kind === "propose" ? `Proponer idea para el ${mealName(dialog.meal.mealType)}` : dialog.kind === "edit" ? "Editar idea" : dialog.kind === "withdraw" ? "Retirar idea" : "Quitar elección"}</h2>
        <p className={styles.dialogDate}>{labelDay(dialog.meal.date)}</p>
        {dialog.kind === "choose" && <form onSubmit={(event) => void saveChoice(event)}>
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
          <DialogError message={dialogError} currentSelection={mealsByType.get(dialog.meal.mealType)?.selection ?? null} conflict={dialogError.includes("cambió")} onViewCurrent={showCurrentSelection} />
          <div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} onClick={closeDialog}>Cancelar</button><button className={styles.primaryButton} disabled={dialogBusy || selectedDate < today || (choice === "new" ? !title.trim() : !choice)}>{dialogBusy ? "Guardando…" : dialog.meal.selection ? "Guardar cambio" : "Elegir comida"}</button></div>
        </form>}
        {dialog.kind === "propose" && <form onSubmit={(event) => void saveProposal(event)}>
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
          {confirmInsideDialog ? <DialogError message={dialogError} /> : null}
          <div className={styles.dialogActions}>{confirmInsideDialog ? <><button className={styles.secondaryButton} onClick={() => setConfirmInsideDialog(false)}>Cancelar</button><button className={styles.textDanger} disabled={dialogBusy || selectedDate < today} onClick={() => void clearSelection()}>{dialogBusy ? "Quitando…" : "Sí, quitar elección"}</button></> : <><button className={styles.secondaryButton} onClick={closeDialog}>Cancelar</button><button className={styles.textDanger} disabled={selectedDate < today} onClick={() => setConfirmInsideDialog(true)}>Quitar elección</button></>}</div>
        </>}
      </>}
    </dialog>
  </main>;
}

function DialogError({ message, conflict = false, currentSelection, onViewCurrent }: { message: string; conflict?: boolean; currentSelection?: Selection | null; onViewCurrent?: () => void }) {
  if (!message) return null;
  return <div className={styles.dialogError} role="alert">
    <p>{message}</p>
    {conflict && (currentSelection
      ? <p>Ahora está elegida “{currentSelection.title ?? "una idea retirada"}”. La eligió {currentSelection.confirmedByName} · {labelTime(currentSelection.confirmedAt)}.</p>
      : <p>Ahora no hay una comida elegida para este horario.</p>)}
    {conflict && onViewCurrent && <button type="button" onClick={onViewCurrent}>Ver la elección actual</button>}
  </div>;
}
