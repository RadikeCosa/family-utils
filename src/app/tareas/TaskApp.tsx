"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import { addTaskDays, getFamilyDay, isTaskDateInRange, labelTaskDay, taskDateBounds } from "@/lib/tasks/family-day";
import styles from "../page.module.css";

const authClient = createAuthClient();
type Member = { id: string; name: string; role: "administrator" | "member" };
type Task = {
  id: string | null;
  key: string;
  kind: "occurrence" | "forecast";
  generationDate: string | null;
  skipped?: boolean;
  taskId: string;
  title: string;
  description: string | null;
  taskStatus?: string;
  taskVersion: number;
  taskTitle: string;
  taskDescription: string | null;
  taskScheduledDate: string | null;
  taskScheduledTime: string | null;
  taskAssignmentMode: "shared" | "individual";
  assignmentMode: "shared" | "individual";
  repeatWeekdays: number[] | null;
  carryPolicy: "expires_daily" | "carry_forward";
  dueDate: string | null;
  scheduledTime: string | null;
  responsibilityMemberId: string | null;
  claimedByMemberId: string | null;
  completedByMemberId?: string | null;
  completedAt?: string | null;
  status: "open" | "completed" | "missed" | "archived";
  version: number | null;
  editedByName?: string;
  updatedAt?: string;
  assignees: { memberId?: string; name: string }[];
  taskAssignees: { memberId: string; name: string }[];
};
type HistoryItem = {
  id: string;
  taskId: string;
  title: string;
  taskStatus: "active" | "finalized" | "archived";
  taskVersion: number;
  status: "completed" | "archived" | "missed";
  dueDate: string | null;
  activityAt: string;
  completedByName: string | null;
  responsibleName: string | null;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new Error("No se pudo conectar. Revisá tu conexión e intentá otra vez.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof body.error === "string" ? body.error : "No se pudo completar la acción."), { status: response.status });
  return body as T;
}

export default function Home() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [family, setFamily] = useState<{ id: string; name: string; timeZone: string; revision: number } | null>(null);
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [familyDay, setFamilyDay] = useState(() => getFamilyDay());
  const [selectedDate, setSelectedDate] = useState(() => getFamilyDay());
  const [dateInitialized, setDateInitialized] = useState(false);
  const followsToday = useRef(true);
  const dateRef = useRef(selectedDate);
  useEffect(() => { dateRef.current = selectedDate; }, [selectedDate]);
  const requestSequence = useRef(0);
  const loadedCount = useRef(50);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [possibleTasks, setPossibleTasks] = useState<Task[]>([]);
  const [possibleTotal, setPossibleTotal] = useState(0);
  const [possibleCursor, setPossibleCursor] = useState<string | null>(null);
  const [possibleOpen, setPossibleOpen] = useState(false);
  const [possibleLoading, setPossibleLoading] = useState(false);
  const possibleSequence = useRef(0);
  const possibleLoadedCount = useRef(50);
  const possibleOpenRef = useRef(false);
  const refreshPossible = useRef<(() => Promise<void>) | null>(null);
  const [syncNotice, setSyncNotice] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [manualRetryUsed, setManualRetryUsed] = useState(false);
  const lastRead = useRef<{ date: string; familyId: string; mode: "explicit_sync" | "legacy_today" } | null>(null);
  const generationModeRef = useRef<"explicit_sync" | "legacy_today">("explicit_sync");
  const lastSync = useRef(new Map<string, number>());
  const syncInFlight = useRef(false);
  const refreshLatest = useRef<((force?: boolean, cursor?: string, readOnly?: boolean) => Promise<void>) | null>(null);
  const [counts, setCounts] = useState({ open: 0, completed: 0 });
  const [notice, setNotice] = useState("");
  const [syncState, setSyncState] = useState<"idle" | "loading" | "synced" | "error">("idle");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editScope, setEditScope] = useState<"occurrence" | "future">("future");
  const [editAssignmentMode, setEditAssignmentMode] = useState<"shared" | "individual">("shared");
  const [editAssigneeIds, setEditAssigneeIds] = useState<string[]>([]);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editScheduledTime, setEditScheduledTime] = useState("");
  const [editWeekdays, setEditWeekdays] = useState<number[]>([]);
  const [editCarryPolicy, setEditCarryPolicy] = useState<"expires_daily" | "carry_forward">("expires_daily");
  const [taskOptions, setTaskOptions] = useState<Task | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "completed" | "archived">("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const etagRef = useRef<string | null>(null);
  const lastActivityAt = useRef(0);
  const occurrenceBusy = useRef(false);

  const synchronize = useCallback(async (familyId: string, mode: "explicit_sync" | "legacy_today", manual = false) => {
    if (syncInFlight.current || (!manual && Date.now() - (lastSync.current.get(familyId) ?? 0) < 30_000)) return;
    syncInFlight.current = true;
    lastSync.current.set(familyId, Date.now());
    if (manual) setManualRetryUsed(true);
    const controller = new AbortController();
    const delayedNotice = window.setTimeout(() => setSyncNotice(true), 800);
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(mode === "legacy_today" ? "/api/tasks" : "/api/tasks/sync", { method: mode === "legacy_today" ? "GET" : "POST", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("No se pudo actualizar el día.");
      setSyncNotice(false); setSyncFailed(false); setManualRetryUsed(false);
      void refreshLatest.current?.(true, undefined, true);
    } catch {
      setSyncNotice(true); setSyncFailed(true);
    } finally {
      window.clearTimeout(delayedNotice); window.clearTimeout(timeout);
      syncInFlight.current = false;
    }
  }, []);

  const refresh = useCallback(async (force = false, cursor?: string, readOnly = false) => {
    if (!session?.user?.id || !dateInitialized) return;
    const sequence = ++requestSequence.current;
    const requestedDate = selectedDate;
    if (force) setSyncState("loading");
    const anchors = [...document.querySelectorAll<HTMLElement>("[data-task-key]")].map((element) => ({ key: element.dataset.taskKey, top: element.getBoundingClientRect().top })).filter((item) => item.top >= 0);
    try {
      if (!force && !cursor && etagRef.current && lastRead.current?.date === requestedDate) {
        const response = await fetch(`/api/tasks/revision?date=${requestedDate}`, { cache: "no-store", headers: { "If-None-Match": etagRef.current } });
        if (sequence !== requestSequence.current) return;
        if (response.status === 304) {
          setSyncState("synced"); setLastUpdated(new Date());
          if (requestedDate === getFamilyDay() && !readOnly) void synchronize(lastRead.current.familyId, lastRead.current.mode);
          return;
        }
      }
      const all: Task[] = [];
      let append = !!cursor;
      let restarted = false;
      let pageCursor = cursor;
      let body;
      let response;
      let firstEtag: string | null = null;
      do {
        const params = new URLSearchParams({ date: requestedDate });
        if (pageCursor) params.set("cursor", pageCursor);
        response = await fetch(`/api/tasks?${params}`, { cache: "no-store" });
        body = await response.json();
        if (sequence !== requestSequence.current || requestedDate !== dateRef.current) return;
        if (response.status === 409 && !restarted) { restarted = true; append = false; all.length = 0; pageCursor = undefined; continue; }
        if (!response.ok) throw new Error(body.error ?? "No se pudieron cargar las tareas.");
        if (!pageCursor) firstEtag = response.headers.get("ETag");
        all.push(...body.tasks);
        pageCursor = body.nextCursor ?? undefined;
      } while ((!append && pageCursor && all.length < loadedCount.current) || (restarted && !body.tasks));
      if (firstEtag) etagRef.current = firstEtag;
      lastRead.current = { date: requestedDate, familyId: body.familyId, mode: body.generationMode };
      generationModeRef.current = body.generationMode ?? "explicit_sync";
      setFamilyDay(body.familyDay);
      if (!isTaskDateInRange(requestedDate, body.familyDay) || (followsToday.current && requestedDate !== body.familyDay)) {
        dateRef.current = body.familyDay; setSelectedDate(body.familyDay); setTasks([]); return;
      }
      setTasks((current) => append ? [...current, ...all] : all);
      loadedCount.current = append ? loadedCount.current + all.length : Math.max(50, all.length);
      setNextCursor(body.nextCursor);
      setCounts(body.counts);
      setPossibleTotal(body.possibleTotal ?? 0);
      if (!cursor && possibleOpenRef.current) void refreshPossible.current?.();
      if (requestedDate === body.familyDay && !cursor && !readOnly) void synchronize(body.familyId, body.generationMode);
      if (requestedDate > body.familyDay) {
        try {
          const storageKey = `task-future-use:${body.familyId}`;
          const usage = JSON.parse(localStorage.getItem(storageKey) ?? "null") ?? { firstVisit: Date.now(), visits: 0, opens: 0 };
          if (Date.now() - usage.firstVisit <= 14 * 86400_000) { usage.visits += 1; localStorage.setItem(storageKey, JSON.stringify(usage)); }
        } catch { /* Private browsing may disable local storage. */ }
      }
      setSyncState("synced"); setLastUpdated(new Date()); setError("");
      requestAnimationFrame(() => {
        if (sequence !== requestSequence.current) return;
        const elements = [...document.querySelectorAll<HTMLElement>("[data-task-key]")];
        for (const anchor of anchors) {
          const element = elements.find((item) => item.dataset.taskKey === anchor.key);
          if (element) { window.scrollBy(0, element.getBoundingClientRect().top - anchor.top); break; }
        }
      });
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setSyncState("error"); setError(caught instanceof Error ? caught.message : "No se pudieron cargar las tareas.");
    }
  }, [session?.user?.id, selectedDate, dateInitialized, synchronize]);

  useEffect(() => { refreshLatest.current = refresh; return () => { refreshLatest.current = null; }; }, [refresh]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("fecha");
    queueMicrotask(() => {
      if (requested !== null) {
        followsToday.current = false;
        if (isTaskDateInRange(requested, getFamilyDay())) setSelectedDate(requested);
        else setNotice("La fecha no es válida o queda fuera del período permitido. Mostramos hoy.");
      }
      setDateInitialized(true);
    });
  }, []);

  useEffect(() => {
    if (!dateInitialized) return;
    const url = new URL(window.location.href);
    if (followsToday.current) url.searchParams.delete("fecha"); else url.searchParams.set("fecha", selectedDate);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    queueMicrotask(() => void refresh(true));
  }, [dateInitialized, selectedDate, refresh]);

  const loadPossible = useCallback(async (cursor?: string) => {
    const sequence = ++possibleSequence.current;
    const anchors = [...document.querySelectorAll<HTMLElement>("[data-task-key]")].map((element) => ({ key: element.dataset.taskKey, top: element.getBoundingClientRect().top })).filter((item) => item.top >= 0);
    setPossibleLoading(true);
    try {
      let append = !!cursor;
      let restarted = false;
      let pageCursor = cursor;
      const items: Task[] = [];
      let data;
      do {
        const params = new URLSearchParams({ date: selectedDate, section: "possible" });
        if (pageCursor) params.set("cursor", pageCursor);
        const response = await fetch(`/api/tasks?${params}`, { cache: "no-store" });
        data = await response.json();
        if (sequence !== possibleSequence.current || selectedDate !== dateRef.current) return;
        if (response.status === 409 && !restarted) { restarted = true; append = false; items.length = 0; pageCursor = undefined; continue; }
        if (!response.ok) throw new Error(data.error ?? "No se pudieron cargar los pendientes.");
        items.push(...data.tasks);
        pageCursor = data.nextCursor ?? undefined;
      } while ((!append && pageCursor && items.length < possibleLoadedCount.current) || (restarted && !data.tasks));
      setPossibleTasks((current) => append ? [...current, ...items] : items);
      possibleLoadedCount.current = append ? possibleLoadedCount.current + items.length : Math.max(50, items.length);
      setPossibleCursor(data.nextCursor); setPossibleTotal(data.possibleTotal);
      requestAnimationFrame(() => {
        if (sequence !== possibleSequence.current) return;
        const elements = [...document.querySelectorAll<HTMLElement>("[data-task-key]")];
        for (const anchor of anchors) {
          const element = elements.find((item) => item.dataset.taskKey === anchor.key);
          if (element) { window.scrollBy(0, element.getBoundingClientRect().top - anchor.top); break; }
        }
      });
    } catch (caught) { if (sequence === possibleSequence.current) setError(caught instanceof Error ? caught.message : "No se pudieron cargar los pendientes."); }
    finally { if (sequence === possibleSequence.current) setPossibleLoading(false); }
  }, [selectedDate]);

  useEffect(() => { refreshPossible.current = loadPossible; return () => { refreshPossible.current = null; }; }, [loadPossible]);

  useEffect(() => {
    if (!editingTask || busy || syncState !== "synced" || tasks.some((task) => task.key === editingTask.key)) return;
    queueMicrotask(() => { setEditingTask(null); setNotice("La programación cambió y esta ocasión ya no está disponible."); });
  }, [tasks, editingTask, busy, syncState]);

  function navigateDate(day: string, follow = false) {
    if (!isTaskDateInRange(day, familyDay)) return;
    followsToday.current = follow;
    requestSequence.current += 1;
    dateRef.current = day;
    loadedCount.current = 50;
    etagRef.current = null; lastRead.current = null;
    possibleOpenRef.current = false; possibleLoadedCount.current = 50;
    setPossibleOpen(false); setPossibleTasks([]); setPossibleCursor(null); possibleSequence.current += 1;
    setTasks([]); setCounts({ open: 0, completed: 0 }); setNextCursor(null);
    setSelectedDate(day); setError("");
    const url = new URL(window.location.href);
    if (follow) url.searchParams.delete("fecha"); else url.searchParams.set("fecha", day);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (day === selectedDate) void refresh(true);
  }

  useEffect(() => {
    if (!session?.user?.id) return;
    lastActivityAt.current = Date.now();
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      void Promise.all([
        requestJson<{ family: NonNullable<typeof family>; members: Member[]; currentMemberId: string }>("/api/family")
          .then((data) => { if (active) { setFamily(data.family); setMembers(data.members); setCurrentMemberId(data.currentMemberId); } })
          .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "No se pudo cargar la familia."); }),
      ]);
    });
    return () => { active = false; };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const visibleAndActive = () => document.visibilityState === "visible" && Date.now() - lastActivityAt.current < 2 * 60 * 1000;
    const poll = () => { if (visibleAndActive()) void refresh(); };
    const markActivity = () => {
      const wasIdle = Date.now() - lastActivityAt.current >= 2 * 60 * 1000;
      lastActivityAt.current = Date.now();
      if (wasIdle && document.visibilityState === "visible") void refresh();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") { lastActivityAt.current = Date.now(); void refresh(); } };
    const timer = window.setInterval(poll, 30_000);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("online", onVisibility);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", markActivity, { passive: true });
    window.addEventListener("keydown", markActivity, { passive: true });
    window.addEventListener("touchstart", markActivity, { passive: true });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("online", onVisibility);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("touchstart", markActivity);
    };
  }, [refresh, session?.user?.id]);

  const visibleTasks = tasks;
  const openCount = counts.open;
  const completeCount = counts.completed;
  const isToday = selectedDate === familyDay;
  const past = selectedDate < familyDay;
  const bounds = taskDateBounds(familyDay);

  async function performOccurrence(task: Task, action: "claim" | "complete" | "undo" | "skip") {
    if (occurrenceBusy.current || !task.id || task.kind === "forecast") return;
    occurrenceBusy.current = true;
    setBusy(true); setError("");
    try {
      await requestJson(`/api/tasks/${task.taskId}/occurrences/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, expectedVersion: task.version }),
      });
      await refresh(true);
    } catch (caught) {
      await refresh(true);
      setError(caught instanceof Error ? caught.message : "La tarea cambió. Actualizá y probá otra vez.");
    } finally { occurrenceBusy.current = false; setBusy(false); }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const formData = new FormData(event.currentTarget);
    const repeat = formData.getAll("weekday").map(Number);
    const assigneeIds = formData.getAll("assignee").map(String);
    const body = {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      dueDate: String(formData.get("dueDate") ?? "") || null,
      scheduledTime: String(formData.get("scheduledTime") ?? "") || null,
      repeatWeekdays: repeat,
      assignmentMode: String(formData.get("assignmentMode") ?? "shared"),
      assigneeIds,
      carryPolicy: String(formData.get("carryPolicy") ?? "expires_daily"),
    };
    try { await requestJson("/api/tasks", { method: "POST", body: JSON.stringify(body) }); setShowCreate(false); await refresh(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo guardar la tarea."); }
    finally { setBusy(false); }
  }

  async function saveTaskEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTask) return;
    setBusy(true); setError("");
    const scope = editingTask.repeatWeekdays?.length ? editScope : "future";
    const assigneeIds = editAssigneeIds;
    const body = {
      scope,
      expectedTaskVersion: editingTask.taskVersion,
      occurrenceId: editingTask.id,
      forecast: editingTask.kind === "forecast" && scope === "occurrence" ? { generationDate: editingTask.generationDate, responsibilityMemberId: editingTask.responsibilityMemberId } : undefined,
      expectedOccurrenceVersion: editingTask.version,
      title: editTitle,
      description: editDescription,
      dueDate: editDueDate || null,
      scheduledTime: editScheduledTime || null,
      assignmentMode: editAssignmentMode,
      assigneeIds,
      repeatWeekdays: editWeekdays,
      carryPolicy: editCarryPolicy,
    };
    try {
      await requestJson(`/api/tasks/${editingTask.taskId}`, { method: "PATCH", body: JSON.stringify(body) });
      setEditingTask(null);
      await refresh(true);
    } catch (caught) {
      if (caught instanceof Error && "status" in caught && caught.status === 409) {
        setEditingTask(null);
        setNotice("La tarea cambió mientras la editabas. Actualizamos la lista; abrila de nuevo para revisar los cambios.");
        await refresh(true, undefined, true);
      } else setError(caught instanceof Error ? caught.message : "No se pudo guardar la edición.");
    }
    finally { setBusy(false); }
  }

  async function updateTaskStatus(task: Pick<Task, "taskId" | "taskVersion">, action: "finalize" | "archive" | "restore") {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/tasks/${task.taskId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ action, expectedVersion: task.taskVersion }),
      });
      setTaskOptions(null);
      await refresh(true);
      if (showHistory) await loadHistory(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo actualizar la tarea."); }
    finally { setBusy(false); }
  }

  async function loadHistory(reset = false, filter = historyFilter) {
    setHistoryLoading(true);
    try {
      const query = new URLSearchParams({ limit: "30" });
      if (filter !== "all") query.set("status", filter);
      if (!reset && historyCursor) query.set("cursor", historyCursor);
      const page = await requestJson<{ items: HistoryItem[]; nextCursor: string | null }>(`/api/tasks/history?${query}`);
      setHistoryItems((current) => reset ? page.items : [...current, ...page.items]);
      setHistoryCursor(page.nextCursor);
      setHistoryHasMore(!!page.nextCursor);
      setShowHistory(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo cargar el historial."); }
    finally { setHistoryLoading(false); }
  }

  function openTaskEditor(task: Task) {
    setError("");
    const scope = task.repeatWeekdays?.length && !(task.kind === "forecast" && task.carryPolicy === "carry_forward") ? "occurrence" : "future";
    setEditScope(scope);
    setEditAssignmentMode(scope === "occurrence" ? task.assignmentMode : task.taskAssignmentMode);
    setEditAssigneeIds(scope === "occurrence"
      ? task.assignmentMode === "individual" && task.responsibilityMemberId ? [task.responsibilityMemberId] : task.assignees.map(({ memberId }) => memberId).filter((id): id is string => !!id)
      : task.taskAssignees.map(({ memberId }) => memberId));
    setEditTitle(scope === "occurrence" ? task.title : task.taskTitle);
    setEditDescription((scope === "occurrence" ? task.description : task.taskDescription) ?? "");
    setEditDueDate((scope === "occurrence" ? task.dueDate : task.taskScheduledDate) ?? "");
    setEditScheduledTime((scope === "occurrence" ? task.scheduledTime : task.taskScheduledTime) ?? "");
    setEditWeekdays(task.repeatWeekdays ?? []);
    setEditCarryPolicy(task.carryPolicy);
    setEditingTask(task);
  }

  function changeEditScope(value: "occurrence" | "future") {
    if (!editingTask) return;
    setEditScope(value);
    setEditAssignmentMode(value === "occurrence" ? editingTask.assignmentMode : editingTask.taskAssignmentMode);
    setEditAssigneeIds(value === "occurrence"
      ? editingTask.assignmentMode === "individual" && editingTask.responsibilityMemberId ? [editingTask.responsibilityMemberId] : editingTask.assignees.map(({ memberId }) => memberId).filter((id): id is string => !!id)
      : editingTask.taskAssignees.map(({ memberId }) => memberId));
    setEditTitle(value === "occurrence" ? editingTask.title : editingTask.taskTitle);
    setEditDescription((value === "occurrence" ? editingTask.description : editingTask.taskDescription) ?? "");
    setEditDueDate((value === "occurrence" ? editingTask.dueDate : editingTask.taskScheduledDate) ?? "");
    setEditScheduledTime((value === "occurrence" ? editingTask.scheduledTime : editingTask.taskScheduledTime) ?? "");
    setEditWeekdays(editingTask.repeatWeekdays ?? []);
    setEditCarryPolicy(editingTask.carryPolicy);
  }

  function toggleEditAssignee(memberId: string) {
    setEditAssigneeIds((current) => {
      if (editScope === "occurrence" && editAssignmentMode === "individual") return current.includes(memberId) ? [] : [memberId];
      return current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId];
    });
  }

  const dateLabel = labelTaskDay(selectedDate).toLocaleUpperCase("es-AR");
  const currentMemberName = members.find((person) => person.id === currentMemberId)?.name ?? "Integrante";
  const currentRole = members.find((person) => person.id === currentMemberId)?.role ?? "member";
  const weekdayOptions = [[0, "Do"], [1, "Lu"], [2, "Ma"], [3, "Mi"], [4, "Ju"], [5, "Vi"], [6, "Sá"]] as const;

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Navegación principal">
        <Link className={styles.brand} href="/" aria-label="Family Utils, inicio"><span className={styles.brandMark}>f</span><span>family<span className={styles.brandLight}>utils</span></span></Link>
        <div className={styles.sidebarLabel}>TU ESPACIO</div>
        <nav className={styles.nav}>
          <a className={`${styles.navItem} ${styles.navActive}`} href="/tareas"><span>◷</span> Tareas <span className={styles.navCount}>{openCount}</span></a>
          <a className={styles.navItem} href="/familia"><span>⌂</span> Mi familia</a>
        </nav>
        <div className={styles.sideDivider} />
        <div className={styles.sidebarLabel}>APLICACIONES</div>
        <Link className={styles.appLink} href="/tareas"><span className={styles.appIcon}>✳</span><span>Tareas y rutinas</span><span className={styles.appDot} /></Link>
        <Link className={styles.appLink} href="/compras"><span className={styles.appIcon}>☷</span><span>Listas de compras</span></Link>
        <Link className={styles.appLink} href="/menus"><span className={styles.appIcon}>◒</span><span>Planificador de menús</span></Link>
        <div className={styles.sidebarFooter}><div className={styles.familyAvatar}>⌂</div><div><strong>{family?.name ?? "Mi familia"}</strong><small>{members.length} integrantes</small></div><Link className={styles.moreButton} href="/familia" aria-label="Administrar familia">···</Link></div>
      </aside>

      <section className={styles.content} id="inicio">
        <header className={styles.topbar}>
          <span className={styles.breadcrumb}><Link href="/">Family Utils</Link> <span>/</span> Tareas y rutinas</span>
          <div className={styles.topActions}>
            {session?.user && <span className={styles.signedInName}>{currentMemberName}</span>}
            <button className={styles.signOutButton} onClick={() => void authClient.signOut().then(() => router.push("/acceso"))}>Salir</button>
            <div className={styles.avatar} aria-label="Perfil">{currentMemberName.slice(0, 1)}</div>
          </div>
        </header>

        <div className={styles.pageBody}>
          {error && <p className={styles.errorMessage} role="alert">{error}</p>}

          <div className={styles.greetingRow}>
            <div><p className={styles.dateLabel}>{dateLabel}</p><h1>Un día a la vez<span>.</span></h1><p className={styles.subtitle}>{isToday ? "Esto es lo que tenemos para hoy." : past ? "Consultá las tareas y la actividad de esta fecha." : "Un vistazo a lo que viene."}</p></div>
            <div className={styles.createActions}>{!past && <button className={styles.addButton} onClick={() => setShowCreate(true)}><span>＋</span> Nueva tarea</button>}</div>
          </div>

          <div className={styles.dateNav} aria-label="Navegar por fecha">
            <button aria-label="Día anterior" disabled={selectedDate === bounds.earliest} onClick={() => navigateDate(addTaskDays(selectedDate, -1))}>←</button>
            <label><span className={styles.srOnly}>Ir a una fecha</span><input type="date" value={selectedDate} min={bounds.earliest} max={bounds.latest} onChange={(event) => navigateDate(event.target.value)} /></label>
            <button aria-label="Día siguiente" disabled={selectedDate >= bounds.latest} onClick={() => navigateDate(addTaskDays(selectedDate, 1))}>→</button>
            <button onClick={() => navigateDate(familyDay, true)}>Hoy</button>
            {past && <span>Solo lectura</span>}
          </div>
          {isToday && syncNotice && <p role="status">Puede faltar actualizar las tareas de hoy. {syncFailed && !manualRetryUsed && <button className={styles.filterButton} onClick={() => { if (family) void synchronize(family.id, generationModeRef.current, true); }}>Reintentar actualización</button>}</p>}
          {notice && <p role="status">{notice}</p>}
          <div className={styles.summaryGrid}>
            <div className={`${styles.summaryCard} ${styles.summaryPrimary}`}><div className={styles.summaryIcon}>◷</div><div><span>{isToday ? "Para hoy" : "Pendientes"}</span><strong>{openCount} <small>tareas</small></strong></div><div className={styles.progressTrack}><div style={{ width: `${openCount + completeCount ? Math.round(completeCount / (openCount + completeCount) * 100) : 0}%` }} /></div><p>Todo a su ritmo, sin apuro.</p></div>
            <div className={styles.summaryCard}><div className={`${styles.summaryIcon} ${styles.iconGreen}`}>✓</div><div><span>Completadas</span><strong>{completeCount} <small>tareas</small></strong></div><div className={styles.miniAvatars}><i>✓</i><i>✓</i><i>+</i></div><p>Buen trabajo en equipo.</p></div>
            <div className={`${styles.summaryCard} ${styles.summaryQuote}`}><span className={styles.quoteMark}>“</span><p>Las pequeñas cosas<br />también cuentan.</p><span className={styles.quoteBy}>— para hoy</span></div>
          </div>

          <div className={styles.tasksHeader}><div><h2>{showHistory ? "Historial" : isToday ? "Hoy en casa" : "Tareas de la fecha"}</h2><span>{showHistory ? "Completadas y ocasiones omitidas" : labelTaskDay(selectedDate)}</span></div><div className={styles.topActions}><button className={styles.filterButton} onClick={() => showHistory ? void loadHistory(true) : void refresh(true)}>{showHistory ? historyLoading ? "Cargando…" : "Actualizar historial" : syncState === "loading" ? "Actualizando…" : "Actualizar"} <span>↻</span></button><button className={styles.filterButton} onClick={() => showHistory ? (setShowHistory(false), void refresh(true)) : void loadHistory(true)}>{showHistory ? "Volver a tareas" : "Historial"}</button></div></div>

          {showHistory ? <><div className={styles.topActions} aria-label="Filtrar historial"><button className={styles.filterButton} aria-pressed={historyFilter === "all"} onClick={() => { setHistoryFilter("all"); void loadHistory(true, "all"); }}>Todo</button><button className={styles.filterButton} aria-pressed={historyFilter === "completed"} onClick={() => { setHistoryFilter("completed"); void loadHistory(true, "completed"); }}>Completadas</button><button className={styles.filterButton} aria-pressed={historyFilter === "archived"} onClick={() => { setHistoryFilter("archived"); void loadHistory(true, "archived"); }}>Omitidas y archivadas</button></div><div className={styles.taskList}>
            {historyItems.length === 0 && !historyLoading && <div className={styles.emptyState}>Todavía no hay actividad en el historial.</div>}
            {historyItems.map((item) => <article className={styles.taskCard} key={item.id}>
              <div className={`${styles.taskIcon} ${styles.lavender}`}>{item.status === "completed" ? "✓" : "—"}</div>
              <div className={styles.taskInfo}><h3>{item.title}</h3><p>{item.dueDate ? `${item.dueDate} · ` : ""}{new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.activityAt))}</p><span className={styles.taskPeople}>{item.status === "completed" ? `Completada por ${item.completedByName ?? "un integrante"}` : item.taskStatus === "archived" ? "Tarea archivada" : "Ocasión omitida"}</span>{item.responsibleName && <small className={styles.editedBy}>Responsable: {item.responsibleName}</small>}</div>
              {currentRole === "administrator" && item.taskStatus === "archived" && <button className={styles.smallAction} disabled={busy} onClick={() => void updateTaskStatus(item, "restore")}>Restaurar</button>}
            </article>)}
            {historyHasMore && <button className={styles.filterButton} disabled={historyLoading} onClick={() => void loadHistory()}>{historyLoading ? "Cargando…" : "Cargar más"}</button>}
          </div></> : <div className={styles.taskList}>
            {visibleTasks.length === 0 && <div className={styles.emptyState}>{syncState === "loading" ? "Cargando tareas…" : "No hay tareas para esta fecha."}</div>}
            {visibleTasks.map((task, index) => {
              const isComplete = task.status === "completed";
              const canUndo = isToday && isComplete && (currentRole === "administrator" || task.completedByMemberId === currentMemberId);
              const available = isToday && task.kind !== "forecast" && task.status === "open" && task.assignmentMode === "shared" && task.assignees.length === 0 && !task.claimedByMemberId;
              const individualOwner = task.responsibilityMemberId ? members.find((person) => person.id === task.responsibilityMemberId)?.name : null;
              const people = task.assignmentMode === "individual"
                ? individualOwner ?? "Responsable archivado"
                : task.assignees.map((person) => person.name).join(", ") || (task.claimedByMemberId ? members.find((person) => person.id === task.claimedByMemberId)?.name ?? "Asumida" : isToday ? "Disponible para asumir" : "Sin responsables asignados");
              const meta = task.dueDate ? `${task.dueDate === familyDay ? "Hoy" : task.dueDate}${task.scheduledTime ? ` · ${task.scheduledTime}` : ""}` : task.scheduledTime ? `Hoy · ${task.scheduledTime}` : "Sin fecha";
              const tone = ["lavender", "mint", "peach"][index % 3];
              return <article className={`${styles.taskCard} ${isComplete ? styles.taskDone : ""}`} key={task.key ?? task.id} data-task-key={task.key ?? task.id}>
                {!isToday || task.kind === "forecast" || task.status === "missed" || task.status === "archived" ? <span className={styles.doneBadge} aria-disabled={task.kind === "forecast" && isToday ? true : undefined}>{task.status === "completed" ? "Hecha" : task.status === "missed" ? "Vencida" : task.status === "archived" ? task.skipped ? "Omitida" : "Archivada" : task.kind === "forecast" && isToday ? "Pendiente de actualizar" : "Programada"}</span> : isComplete ? canUndo
                  ? <button className={`${styles.completeAction} ${styles.undoAction}`} aria-label={`Deshacer finalización de ${task.title}`} disabled={busy} onClick={() => void performOccurrence(task, "undo")}>Deshacer</button>
                  : <span className={styles.doneBadge} aria-label={`${task.title}, completada`}>✓ Hecha</span>
                  : <button className={styles.completeAction} aria-label={`Marcar ${task.title} como hecha`} disabled={busy} onClick={() => void performOccurrence(task, "complete")}>{busy ? "Guardando…" : "Marcar hecha"}</button>}
                <div className={`${styles.taskIcon} ${styles[tone]}`}>{index % 3 === 0 ? "⌂" : index % 3 === 1 ? "♧" : "✳"}</div>
                <div className={styles.taskInfo}><h3>{task.title}</h3><p>{meta}{isComplete && task.completedAt ? ` · Completada el ${getFamilyDay(new Date(task.completedAt))}` : ""}</p><span className={styles.taskPeople}>{isComplete ? `Hecha por ${members.find((person) => person.id === task.completedByMemberId)?.name ?? "un integrante"}` : people}</span>{task.editedByName && <small className={styles.editedBy}>Editada por {task.editedByName}</small>}</div>
                {available && <button className={styles.claimButton} disabled={busy} onClick={() => void performOccurrence(task, "claim")}>Asumir</button>}
                {isComplete && <span className={styles.taskStatus}>Completada</span>}
                {!past && !(isToday && task.kind === "forecast") && !isComplete && task.status === "open" && task.taskStatus === "active" && <button className={styles.cardMore} aria-label={`Editar: ${task.title}`} onClick={() => openTaskEditor(task)}>Editar</button>}
                {isToday && task.kind !== "forecast" && <button className={styles.cardMore} aria-label={`Más opciones: ${task.title}`} onClick={() => setTaskOptions(task)}>···</button>}
              </article>;
            })}
          </div>}
          {!showHistory && selectedDate > familyDay && possibleTotal > 0 && <section className={styles.possibleSection}>
            <button className={styles.filterButton} aria-expanded={possibleOpen} onClick={() => {
              possibleOpenRef.current = !possibleOpen;
              setPossibleOpen(!possibleOpen);
              if (!possibleOpen) {
                void loadPossible();
                try {
                  const key = `task-future-use:${family?.id}`;
                  const usage = JSON.parse(localStorage.getItem(key) ?? "null");
                  if (usage && Date.now() - usage.firstVisit <= 14 * 86400_000) { usage.opens += 1; localStorage.setItem(key, JSON.stringify(usage)); }
                } catch { /* Local-only measurement is optional. */ }
              }
            }}>Podrían seguir pendientes ({possibleTotal})</button>
            {possibleOpen && <div><p>Se muestran si siguen pendientes al llegar esta fecha. Podés gestionarlas desde Hoy.</p>
              {possibleTasks.map((task) => <article className={styles.taskCard} key={task.key} data-task-key={task.key}><div className={styles.taskInfo}><h3>{task.title}</h3><p>{task.dueDate ?? "Sin fecha"} · Pendiente potencial</p><span className={styles.taskPeople}>{task.assignees.map((person) => person.name).join(", ")}</span></div></article>)}
              {possibleLoading && <p role="status">Cargando pendientes…</p>}
              {possibleCursor && <button className={styles.filterButton} disabled={possibleLoading} onClick={() => void loadPossible(possibleCursor)}>Cargar más pendientes</button>}
            </div>}
          </section>}
          {!showHistory && nextCursor && <button className={styles.filterButton} disabled={syncState === "loading"} onClick={() => void refresh(true, nextCursor)}>Cargar más</button>}

          <footer className={styles.footer}><span>Un espacio para estar más en equipo.</span><span>{syncState === "loading" ? "Actualizando…" : syncState === "error" ? "Error de sincronización" : syncState === "synced" ? `Actualizado${lastUpdated ? ` ${new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(lastUpdated)}` : ""}` : "Sin sincronizar"} <i /></span></footer>
        </div>
      </section>

      {showCreate && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="create-title"><button className={styles.modalClose} onClick={() => setShowCreate(false)} aria-label="Cerrar">×</button><p className={styles.modalEyebrow}>TAREAS Y RUTINAS</p><h2 id="create-title">Una cosa a la vez</h2><p className={styles.modalIntro}>Empezá con el nombre. Lo demás es opcional.</p><form className={styles.taskForm} onSubmit={createTask}>
        <label>Nombre<input name="title" required maxLength={160} placeholder="Por ejemplo, poner la mesa" /></label>
        <label>Nota <span>(opcional)</span><textarea name="description" rows={2} maxLength={3000} placeholder="Un detalle útil para quien la haga" /></label>
        <div className={styles.formRow}><label>Fecha <span>(opcional)</span><input name="dueDate" type="date" defaultValue={selectedDate > familyDay ? selectedDate : ""} min={familyDay} max={bounds.latest} /></label><label>Horario <span>(opcional)</span><input name="scheduledTime" type="time" /></label></div>
        <label>Responsables <span>(opcional)</span><select name="assignmentMode" defaultValue="shared"><option value="shared">Tarea compartida o disponible</option><option value="individual">Una tarea por persona elegida</option></select></label>
        <div className={styles.assigneeChoices}>{members.map((person) => <label key={person.id}><input type="checkbox" name="assignee" value={person.id} /> {person.name}</label>)}</div>
        <fieldset><legend>Repetición <span>(opcional)</span></legend><div className={styles.weekdayChoices}>{weekdayOptions.map(([day,label]) => <label key={day}><input type="checkbox" name="weekday" value={day} />{label}</label>)}</div></fieldset>
        <label>Si queda pendiente<select name="carryPolicy" defaultValue="expires_daily"><option value="expires_daily">Vence al terminar el día</option><option value="carry_forward">Sigue pendiente hasta completarse</option></select></label>
        {error && <p className={styles.errorMessage} role="alert">{error}</p>}<div className={styles.modalActions}><button type="button" className={styles.cancelButton} onClick={() => setShowCreate(false)}>Cancelar</button><button className={styles.submitButton} disabled={busy}>{busy ? "Guardando…" : "Crear tarea"}</button></div>
      </form></section></div>}

      {editingTask && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingTask(null); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="edit-title"><button className={styles.modalClose} onClick={() => setEditingTask(null)} aria-label="Cerrar">×</button><p className={styles.modalEyebrow}>EDITAR TAREA O RUTINA</p><h2 id="edit-title">{editingTask.title}</h2><p className={styles.modalIntro}>Los cambios quedan registrados con quién los hizo y cuándo.</p><form className={styles.taskForm} onSubmit={saveTaskEdit}>
        {editingTask.repeatWeekdays?.length && !(editingTask.kind === "forecast" && editingTask.carryPolicy === "carry_forward") ? <label>Aplicar cambios<select value={editScope} onChange={(event) => changeEditScope(event.target.value as "occurrence" | "future")}><option value="occurrence">Solo esta ocasión</option><option value="future">Programación desde hoy</option></select></label> : <p className={styles.modalIntro}>Se actualizará la programación desde hoy.</p>}
        {editScope === "future" && <p className={styles.modalIntro}>Los cambios aplican desde hoy, {labelTaskDay(familyDay)}{selectedDate > familyDay ? `, no desde ${labelTaskDay(selectedDate)}` : ""}.</p>}
        <label>Nombre<input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required maxLength={160} /></label>
        <label>Nota <span>(opcional)</span><textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} rows={2} maxLength={3000} /></label>
        <div className={styles.formRow}><label>Fecha <span>(opcional)</span><input value={editDueDate} onChange={(event) => setEditDueDate(event.target.value)} type="date" max={bounds.latest} /></label><label>Horario <span>(opcional)</span><input value={editScheduledTime} onChange={(event) => setEditScheduledTime(event.target.value)} type="time" /></label></div>
        <label>Responsables<select value={editAssignmentMode} onChange={(event) => { const value = event.target.value as "shared" | "individual"; setEditAssignmentMode(value); if (value === "individual" && editScope === "occurrence" && editAssigneeIds.length > 1) setEditAssigneeIds((current) => current.slice(0, 1)); }}><option value="shared">Compartida o disponible</option><option value="individual">Una ocasión por persona</option></select></label>
        <div className={styles.assigneeChoices}>{members.map((person) => <label key={person.id}><input type="checkbox" checked={editAssigneeIds.includes(person.id)} onChange={() => toggleEditAssignee(person.id)} /> {person.name}</label>)}</div>
        {editAssignmentMode === "individual" && editScope === "occurrence" && <p className={styles.modalIntro}>Para esta ocasión elegí una sola persona.</p>}
        {editScope === "future" && <><fieldset><legend>Repetición <span>(opcional)</span></legend><div className={styles.weekdayChoices}>{weekdayOptions.map(([day,label]) => <label key={day}><input type="checkbox" checked={editWeekdays.includes(day)} onChange={() => setEditWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day])} />{label}</label>)}</div></fieldset><label>Si queda pendiente<select value={editCarryPolicy} onChange={(event) => setEditCarryPolicy(event.target.value as "expires_daily" | "carry_forward")}><option value="expires_daily">Vence al terminar el día</option><option value="carry_forward">Sigue pendiente hasta completarse</option></select></label></>}
        {error && <p className={styles.errorMessage} role="alert">{error}</p>}<div className={styles.modalActions}><button type="button" className={styles.cancelButton} onClick={() => setEditingTask(null)}>Cancelar</button><button className={styles.submitButton} disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button></div>
      </form></section></div>}

      {taskOptions && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTaskOptions(null); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="options-title"><button className={styles.modalClose} onClick={() => setTaskOptions(null)} aria-label="Cerrar">×</button><p className={styles.modalEyebrow}>OPCIONES DE TAREA</p><h2 id="options-title">{taskOptions.title}</h2><p className={styles.modalIntro}>{taskOptions.taskStatus === "finalized" ? "La tarea está finalizada. Al restaurarla, la programación se reanuda desde hoy." : "El historial de ocasiones completadas se conserva."}</p><div className={styles.modalActions}>
        {taskOptions.status === "open" && taskOptions.taskStatus === "active" && <button className={styles.smallAction} disabled={busy} onClick={() => { const selected = taskOptions; setTaskOptions(null); void performOccurrence(selected, "skip"); }}>Omitir esta ocasión</button>}
        {taskOptions.status === "open" && taskOptions.taskStatus === "active" && <button className={styles.smallAction} onClick={() => { setTaskOptions(null); openTaskEditor(taskOptions); }}>Editar</button>}
        {currentRole === "administrator" && taskOptions.taskStatus === "active" && <button className={styles.smallAction} disabled={busy} onClick={() => void updateTaskStatus(taskOptions, "finalize")}>Finalizar</button>}
        {currentRole === "administrator" && taskOptions.taskStatus === "finalized" && <button className={styles.smallAction} disabled={busy} onClick={() => void updateTaskStatus(taskOptions, "restore")}>Reanudar</button>}
        {currentRole === "administrator" && taskOptions.taskStatus !== "archived" && <button className={styles.smallAction} disabled={busy} onClick={() => void updateTaskStatus(taskOptions, "archive")}>Archivar</button>}
        <button type="button" className={styles.cancelButton} onClick={() => setTaskOptions(null)}>Cerrar</button>
      </div></section></div>}



    </main>
  );
}
