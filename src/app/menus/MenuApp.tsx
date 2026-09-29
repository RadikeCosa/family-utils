"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import styles from "./menus.module.css";

const authClient = createAuthClient();
type Role = "administrator" | "member";
type MealType = "lunch" | "dinner";
type AttendanceStatus = "present" | "absent" | "unknown";
type Profile = { id: string; name: string; role: Role };
type Attendance = { memberId: string; status: AttendanceStatus; source: "manual" | "calendar" | "unknown"; version: number; updatedByMemberId: string | null; updatedByName: string | null };
type Suggestion = { id: string; authorMemberId: string; authorName: string; title: string; note: string | null; version: number; createdAt: string; updatedAt: string };
type Meal = {
  date: string;
  mealType: MealType;
  slotId: string | null;
  attendance: Attendance[];
  suggestions: Suggestion[];
  selection: null | { suggestionId: string; title: string | null; confirmedByMemberId: string; confirmedByName: string; confirmedAt: string; version: number };
  selectionVersion: number;
};
type WeekData = { weekStart: string; weekEnd: string; today: string; timeZone: string; revision: number; currentMemberId: string; currentRole: Role; members: Profile[]; meals: Meal[] };

function dayInFamilyZone(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function addDays(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
function weekMonday(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}
function labelDay(day: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));
}
function labelTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value));
}
function nextStatus(status: AttendanceStatus): AttendanceStatus {
  return status === "unknown" ? "present" : status === "present" ? "absent" : "unknown";
}
function statusLabel(status: AttendanceStatus) {
  return status === "present" ? "En casa" : status === "absent" ? "No está" : "Sin confirmar";
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "No se pudo completar la acción.");
  return body as T;
}

export default function MenuApp() {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => weekMonday(dayInFamilyZone()));
  const [data, setData] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const etagRef = useRef("");
  const lastActivity = useRef(0);
  const admin = data?.currentRole === "administrator";

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/meals?weekStart=${weekStart}`, {
        cache: "no-store",
        headers: !force && etagRef.current ? { "If-None-Match": etagRef.current } : {},
      });
      if (response.status === 304) return;
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "No se pudo cargar la semana.");
      etagRef.current = response.headers.get("ETag") ?? "";
      setData(body as WeekData);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la semana.");
    } finally { setLoading(false); }
  }, [weekStart]);

  useEffect(() => {
    etagRef.current = "";
    const initialRefresh = window.setTimeout(() => void refresh(true), 0);
    return () => window.clearTimeout(initialRefresh);
  }, [refresh]);
  useEffect(() => {
    const markActivity = () => { lastActivity.current = Date.now(); };
    markActivity();
    const resume = () => {
      if (document.visibilityState === "visible") { markActivity(); void refresh(); }
    };
    window.addEventListener("pointerdown", markActivity, { passive: true });
    window.addEventListener("keydown", markActivity);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastActivity.current < 2 * 60_000) void refresh();
    }, 30_000);
    return () => { window.clearInterval(timer); window.removeEventListener("pointerdown", markActivity); window.removeEventListener("keydown", markActivity); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [refresh]);

  const mealsByDate = useMemo(() => {
    const result = new Map<string, Map<MealType, Meal>>();
    for (const meal of data?.meals ?? []) {
      const day = result.get(meal.date) ?? new Map<MealType, Meal>();
      day.set(meal.mealType, meal);
      result.set(meal.date, day);
    }
    return result;
  }, [data?.meals]);

  async function run(key: string, action: () => Promise<unknown>, success?: string): Promise<boolean> {
    setBusyKey(key); setError(""); setNotice("");
    try { await action(); if (success) setNotice(success); await refresh(true); return true; }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : "La comida cambió. Actualizá e intentá otra vez.");
      await refresh(true);
      return false;
    } finally { setBusyKey(""); }
  }

  async function updateAttendance(meal: Meal, personId: string) {
    const record = meal.attendance.find((item) => item.memberId === personId);
    const status = nextStatus(record?.status ?? "unknown");
    await run(`attendance-${meal.date}-${meal.mealType}-${personId}`, () => jsonRequest("/api/meals/attendance", {
      method: "PUT",
      body: JSON.stringify({ date: meal.date, mealType: meal.mealType, memberId: personId, status, expectedVersion: record?.version ?? 0 }),
    }));
  }

  async function addSuggestion(event: React.FormEvent<HTMLFormElement>, meal: Meal) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const title = String(values.get("title") ?? "");
    const note = String(values.get("note") ?? "");
    await run(`suggest-${meal.date}-${meal.mealType}`, async () => {
      await jsonRequest("/api/meals/suggestions", { method: "POST", body: JSON.stringify({ date: meal.date, mealType: meal.mealType, title, note }) });
      form.reset();
    }, "Sugerencia agregada.");
  }

  async function confirmSuggestion(meal: Meal, suggestion: Suggestion) {
    const pending = meal.attendance.filter((person) => person.status === "unknown").length;
    const warning = pending ? ` Hay ${pending} integrante(s) sin confirmar asistencia.` : "";
    if (!window.confirm(`¿Confirmar “${suggestion.title}” para esta comida?${warning}`)) return;
    await run(`confirm-${meal.date}-${meal.mealType}`, () => jsonRequest("/api/meals/selection", {
      method: "PUT",
      body: JSON.stringify({ date: meal.date, mealType: meal.mealType, suggestionId: suggestion.id, expectedVersion: meal.selectionVersion }),
    }), "Menú confirmado.");
  }

  async function confirmDirect(event: React.FormEvent<HTMLFormElement>, meal: Meal) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const title = String(values.get("title") ?? "");
    const note = String(values.get("note") ?? "");
    const pending = meal.attendance.filter((person) => person.status === "unknown").length;
    if (pending && !window.confirm(`Hay ${pending} integrante(s) sin confirmar asistencia. ¿Guardar y confirmar “${title}” igualmente?`)) return;
    const saved = await run(`confirm-${meal.date}-${meal.mealType}`, () => jsonRequest("/api/meals/selection", {
      method: "PUT",
      body: JSON.stringify({ date: meal.date, mealType: meal.mealType, title, note, expectedVersion: meal.selectionVersion }),
    }), "Menú guardado y confirmado.");
    if (saved) form.reset();
  }

  async function clearSelection(meal: Meal) {
    if (!window.confirm("¿Quitar el menú confirmado?")) return;
    await run(`confirm-${meal.date}-${meal.mealType}`, () => jsonRequest("/api/meals/selection", {
      method: "PUT",
      body: JSON.stringify({ date: meal.date, mealType: meal.mealType, suggestionId: null, expectedVersion: meal.selectionVersion }),
    }), "Confirmación quitada.");
  }

  async function editSuggestion(meal: Meal, suggestion: Suggestion) {
    const title = window.prompt("Comida", suggestion.title);
    if (title === null) return;
    const note = window.prompt("Nota opcional", suggestion.note ?? "");
    if (note === null) return;
    await run(`suggestion-${suggestion.id}`, () => jsonRequest(`/api/meals/suggestions/${suggestion.id}`, {
      method: "PATCH", body: JSON.stringify({ expectedVersion: suggestion.version, title, note }),
    }), "Sugerencia actualizada.");
  }

  async function withdrawSuggestion(suggestion: Suggestion) {
    if (!window.confirm(`¿Retirar “${suggestion.title}”?`)) return;
    await run(`suggestion-${suggestion.id}`, () => jsonRequest(`/api/meals/suggestions/${suggestion.id}`, {
      method: "DELETE", body: JSON.stringify({ expectedVersion: suggestion.version }),
    }), "Sugerencia retirada.");
  }

  const isCurrentWeek = data?.today ? weekStart === weekMonday(data.today) : weekStart === weekMonday(dayInFamilyZone());

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Family Utils, inicio"><span className={styles.mark}>f</span>family<span>utils</span></Link>
      <nav className={styles.headerLinks} aria-label="Aplicaciones"><Link href="/tareas">Tareas</Link><Link className={styles.activeLink} href="/menus">Menús</Link><Link href="/familia">Mi familia</Link></nav>
      <button className={styles.exitButton} onClick={() => void authClient.signOut().then(() => router.push("/acceso"))}>Salir</button>
    </header>

    <section className={styles.intro}>
      <p className={styles.eyebrow}>PLANIFICADOR FAMILIAR</p>
      <div className={styles.titleRow}><div><h1>¿Qué comemos?<span>.</span></h1><p>Ideas y planes para compartir la mesa.</p></div>
        <div className={styles.weekControls}>
          <button aria-label="Semana anterior" onClick={() => setWeekStart((week) => addDays(week, -7))}>←</button>
          <button className={styles.todayButton} onClick={() => setWeekStart(weekMonday(data?.today ?? dayInFamilyZone()))} disabled={isCurrentWeek}>Esta semana</button>
          <button aria-label="Semana siguiente" onClick={() => setWeekStart((week) => addDays(week, 7))}>→</button>
        </div>
      </div>
      {data && <p className={styles.range}>{labelDay(data.weekStart)} — {labelDay(data.weekEnd)}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </section>

    <section className={styles.week} aria-label="Comidas de la semana">
      {Array.from({ length: 7 }, (_, offset) => addDays(weekStart, offset)).map((day) => {
        const meals = mealsByDate.get(day);
        const isPast = day < (data?.today ?? dayInFamilyZone());
        return <article className={`${styles.dayCard} ${isPast ? styles.pastDay : ""}`} key={day}>
          <header className={styles.dayHeading}><h2>{labelDay(day)}</h2>{day === data?.today && <span>HOY</span>}</header>
          <div className={styles.mealGrid}>
            {(["lunch", "dinner"] as const).map((mealType) => {
              const meal = meals?.get(mealType);
              if (!meal) return <div className={styles.mealCard} key={mealType}><h3>{mealType === "lunch" ? "Almuerzo" : "Cena"}</h3><p className={styles.loading}>Cargando…</p></div>;
              const unknownCount = meal.attendance.filter((person) => person.status === "unknown").length;
              const absentCount = meal.attendance.length > 0 && meal.attendance.every((person) => person.status === "absent");
              return <section className={styles.mealCard} key={mealType} aria-label={`${mealType === "lunch" ? "Almuerzo" : "Cena"} del ${day}`}>
                <div className={styles.mealHeading}><h3>{mealType === "lunch" ? "Almuerzo" : "Cena"}</h3><span>{meal.selection ? "Confirmado" : "Por planificar"}</span></div>
                {meal.selection && <div className={styles.confirmed}><span className={styles.confirmedLabel}>MENÚ</span><strong>{meal.selection.title ?? "Comida elegida"}</strong><small>Confirmó {meal.selection.confirmedByName} · {labelTime(meal.selection.confirmedAt)}</small>
                  {admin && !isPast && <button className={styles.removeButton} disabled={busyKey.startsWith("confirm-")} onClick={() => void clearSelection(meal)}>Quitar confirmación</button>}
                </div>}

                <div className={styles.attendance}><div className={styles.subheading}><span>¿Quiénes están?</span><small>{unknownCount ? `${unknownCount} sin responder` : `${meal.attendance.filter((person) => person.status === "present").length} en casa`}</small></div>
                  <div className={styles.people}>{meal.attendance.map((record) => {
                    const profile = data?.members.find((person) => person.id === record.memberId);
                    if (!profile) return null;
                    const canEdit = !isPast && (admin || record.memberId === data?.currentMemberId);
                    return <button key={record.memberId} className={`${styles.person} ${styles[`person_${record.status}`]}`} disabled={!canEdit || busyKey.startsWith("attendance-")} onClick={() => void updateAttendance(meal, record.memberId)} title={canEdit ? "Cambiar asistencia" : undefined}>
                      <i>{record.status === "present" ? "✓" : record.status === "absent" ? "−" : "·"}</i><span>{profile.name}</span><small>{statusLabel(record.status)}</small>
                    </button>;
                  })}</div>
                </div>

                <div className={styles.suggestionArea}><div className={styles.subheading}><span>Sugerencias</span><small>{meal.suggestions.length}</small></div>
                {meal.suggestions.length === 0 && <p className={styles.empty}>Todavía no hay ideas. ¡Propongan algo!</p>}
                  <div className={styles.suggestions}>{meal.suggestions.map((suggestion) => {
                    const isSelected = meal.selection?.suggestionId === suggestion.id;
                    const mayEdit = !isPast && (admin || suggestion.authorMemberId === data?.currentMemberId) && !isSelected;
                    return <article className={`${styles.suggestion} ${isSelected ? styles.selectedSuggestion : ""}`} key={suggestion.id}>
                      <div className={styles.suggestionText}><strong>{suggestion.title}</strong>{suggestion.note && <p>{suggestion.note}</p>}<small>Por {suggestion.authorName}</small></div>
                      <div className={styles.suggestionActions}>
                        {admin && !isPast && <button className={styles.chooseButton} disabled={busyKey.startsWith("confirm-") || absentCount || isSelected} onClick={() => void confirmSuggestion(meal, suggestion)}>{isSelected ? "Elegido" : "Confirmar"}</button>}
                        {mayEdit && <><button aria-label="Editar sugerencia" onClick={() => void editSuggestion(meal, suggestion)}>Editar</button><button aria-label="Retirar sugerencia" onClick={() => void withdrawSuggestion(suggestion)}>Retirar</button></>}
                      </div>
                    </article>;
                  })}</div>
                  {admin && !isPast && unknownCount > 0 && <p className={styles.warning}>Hay asistencia sin confirmar; podés confirmar con esta advertencia.</p>}
                  {admin && !isPast && absentCount && <p className={styles.warning}>Todos figuran ausentes; no se puede confirmar.</p>}
                </div>

                {!isPast && <form className={styles.suggestForm} onSubmit={(event) => void addSuggestion(event, meal)}>
                  <label><span className={styles.srOnly}>Proponer una comida</span><input name="title" required maxLength={160} placeholder="Proponer una comida…" /></label>
                  <label><span className={styles.srOnly}>Nota opcional</span><input name="note" maxLength={1000} placeholder="Nota (opcional)" /></label>
                  <button disabled={busyKey === `suggest-${day}-${mealType}`}>{busyKey === `suggest-${day}-${mealType}` ? "…" : "Sugerir"}</button>
                </form>}
                {admin && !isPast && <form className={styles.directForm} onSubmit={(event) => void confirmDirect(event, meal)}>
                  <label><span className={styles.srOnly}>Confirmar una comida nueva</span><input name="title" required maxLength={160} placeholder="O confirmá otra comida directamente…" /></label>
                  <label><span className={styles.srOnly}>Nota opcional para el menú</span><input name="note" maxLength={1000} placeholder="Nota opcional" /></label>
                  <button disabled={absentCount || busyKey === `confirm-${day}-${mealType}`}>{busyKey === `confirm-${day}-${mealType}` ? "Guardando…" : "Guardar y confirmar"}</button>
                </form>}
              </section>;
            })}
          </div>
        </article>;
      })}
    </section>
    <footer className={styles.footer}><Link href="/">Family Utils</Link><span>{loading ? "Actualizando…" : "Sincronizado"} · Se actualiza con la familia</span></footer>
  </main>;
}
