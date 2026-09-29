"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import styles from "../page.module.css";

const authClient = createAuthClient();
type Member = { id: string; name: string; role: "administrator" | "member" };
type Task = {
  id: string;
  taskId: string;
  title: string;
  description: string | null;
  taskStatus?: string;
  dueDate: string | null;
  scheduledTime: string | null;
  responsibilityMemberId: string | null;
  claimedByMemberId: string | null;
  completedByMemberId?: string | null;
  completedAt?: string | null;
  status: "open" | "completed";
  version: number;
  editedByName?: string;
  updatedAt?: string;
  assignees: { memberId?: string; name: string }[];
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "No se pudo completar la acción.");
  return body as T;
}

function familyDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export default function Home() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [family, setFamily] = useState<{ id: string; name: string; timeZone: string; revision: number } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!session?.user) return;
    setLoadingData(true);
    try {
      const familyData = await requestJson<{ family: NonNullable<typeof family>; members: Member[]; currentMemberId: string }>("/api/family");
      const taskData = await requestJson<{ tasks: Task[] }>("/api/tasks");
      setFamily(familyData.family);
      setMembers(familyData.members);
      setTasks(taskData.tasks);
    } catch (caught) {
      setFamily(null);
      setTasks([]);
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la familia.");
    } finally {
      setLoadingData(false);
    }
  }, [session?.user]);

  useEffect(() => { if (session?.user) void Promise.resolve().then(refresh); }, [refresh, session?.user]);

  const familyDay = familyDate();
  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => task.status === "open" ? !task.dueDate || task.dueDate <= familyDay : true);
  }, [familyDay, tasks]);
  const openCount = visibleTasks.filter((task) => task.status === "open").length;
  const completeCount = visibleTasks.filter((task) => task.status === "completed").length;

  async function performOccurrence(task: Task, action: "claim" | "complete" | "undo") {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/tasks/${task.taskId}/occurrences/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, expectedVersion: task.version }),
      });
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "La tarea cambió. Actualizá y probá otra vez."); await refresh(); }
    finally { setBusy(false); }
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
    try { await requestJson("/api/tasks", { method: "POST", body: JSON.stringify(body) }); setShowCreate(false); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo guardar la tarea."); }
    finally { setBusy(false); }
  }

  const dateLabel = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "long" }).format(new Date()).toLocaleUpperCase("es-AR");

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
        <Link className={styles.appLink} href="/menus"><span className={styles.appIcon}>◒</span><span>Planificador de menús</span></Link>
        <div className={styles.sidebarFooter}><div className={styles.familyAvatar}>⌂</div><div><strong>{family?.name ?? "Mi familia"}</strong><small>{members.length} integrantes</small></div><Link className={styles.moreButton} href="/familia" aria-label="Administrar familia">···</Link></div>
      </aside>

      <section className={styles.content} id="inicio">
        <header className={styles.topbar}>
          <span className={styles.breadcrumb}><Link href="/">Family Utils</Link> <span>/</span> Tareas y rutinas</span>
          <div className={styles.topActions}>
            {session?.user && <span className={styles.signedInName}>{session.user.name}</span>}
            <button className={styles.signOutButton} onClick={() => void authClient.signOut().then(() => router.push("/acceso"))}>Salir</button>
            <div className={styles.avatar} aria-label="Perfil">{session?.user?.name?.slice(0, 1) ?? "·"}</div>
          </div>
        </header>

        <div className={styles.pageBody}>
          {error && <p className={styles.errorMessage} role="alert">{error}</p>}

          <div className={styles.greetingRow}>
            <div><p className={styles.dateLabel}>{dateLabel}</p><h1>Un día a la vez<span>.</span></h1><p className={styles.subtitle}>Esto es lo que tenemos para hoy.</p></div>
            <div className={styles.createActions}><button className={styles.addButton} onClick={() => setShowCreate(true)}><span>＋</span> Nueva tarea</button></div>
          </div>

          <div className={styles.summaryGrid}>
            <div className={`${styles.summaryCard} ${styles.summaryPrimary}`}><div className={styles.summaryIcon}>◷</div><div><span>Para hoy</span><strong>{openCount} <small>tareas</small></strong></div><div className={styles.progressTrack}><div style={{ width: `${openCount + completeCount ? Math.round(completeCount / (openCount + completeCount) * 100) : 0}%` }} /></div><p>Todo a su ritmo, sin apuro.</p></div>
            <div className={styles.summaryCard}><div className={`${styles.summaryIcon} ${styles.iconGreen}`}>✓</div><div><span>Hechas recientemente</span><strong>{completeCount} <small>tareas</small></strong></div><div className={styles.miniAvatars}><i>✓</i><i>✓</i><i>+</i></div><p>Buen trabajo en equipo.</p></div>
            <div className={`${styles.summaryCard} ${styles.summaryQuote}`}><span className={styles.quoteMark}>“</span><p>Las pequeñas cosas<br />también cuentan.</p><span className={styles.quoteBy}>— para hoy</span></div>
          </div>

          <div className={styles.tasksHeader}><div><h2>Hoy en casa</h2><span>Pendientes y completadas recientes</span></div><button className={styles.filterButton} onClick={() => void refresh()}>{loadingData ? "Actualizando…" : "Actualizar"} <span>↻</span></button></div>

          <div className={styles.taskList}>
            {visibleTasks.length === 0 && <div className={styles.emptyState}>No hay tareas pendientes. Podés crear una cuando haga falta.</div>}
            {visibleTasks.map((task, index) => {
              const isComplete = task.status === "completed";
              const available = task.status === "open" && task.assignees.length === 0 && !task.claimedByMemberId;
              const people = task.assignees.map((person) => person.name).join(", ") || (task.claimedByMemberId ? members.find((person) => person.id === task.claimedByMemberId)?.name ?? "Asumida" : "Disponible para asumir");
              const meta = task.dueDate ? `${task.dueDate === familyDay ? "Hoy" : task.dueDate}${task.scheduledTime ? ` · ${task.scheduledTime}` : ""}` : task.scheduledTime ? `Hoy · ${task.scheduledTime}` : "Sin fecha";
              const tone = ["lavender", "mint", "peach"][index % 3];
              return <article className={`${styles.taskCard} ${isComplete ? styles.taskDone : ""}`} key={task.id}>
                <button className={`${styles.checkButton} ${isComplete ? styles.checkedButton : ""}`} aria-label={isComplete ? `Deshacer: ${task.title}` : `Marcar ${task.title} como hecha`} disabled={busy} onClick={() => void performOccurrence(task, isComplete ? "undo" : "complete")}>{isComplete ? "✓" : ""}</button>
                <div className={`${styles.taskIcon} ${styles[tone]}`}>{index % 3 === 0 ? "⌂" : index % 3 === 1 ? "♧" : "✳"}</div>
                <div className={styles.taskInfo}><h3>{task.title}</h3><p>{meta}</p><span className={styles.taskPeople}>{isComplete ? `Hecha por ${members.find((person) => person.id === task.completedByMemberId)?.name ?? "un integrante"}` : people}</span>{task.editedByName && <small className={styles.editedBy}>Editada por {task.editedByName}</small>}</div>
                {available && <button className={styles.claimButton} disabled={busy} onClick={() => void performOccurrence(task, "claim")}>Asumir</button>}
                {isComplete && <span className={styles.taskStatus}>Completada</span>}
                <button className={styles.cardMore} aria-label={`Más opciones: ${task.title}`}>···</button>
              </article>;
            })}
          </div>


          <footer className={styles.footer}><span>Un espacio para estar más en equipo.</span><span>{loadingData ? "Actualizando…" : "Sincronizado"} <i /></span></footer>
        </div>
      </section>

      {showCreate && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="create-title"><button className={styles.modalClose} onClick={() => setShowCreate(false)} aria-label="Cerrar">×</button><p className={styles.modalEyebrow}>TAREAS Y RUTINAS</p><h2 id="create-title">Una cosa a la vez</h2><p className={styles.modalIntro}>Empezá con el nombre. Lo demás es opcional.</p><form className={styles.taskForm} onSubmit={createTask}>
        <label>Nombre<input name="title" required maxLength={160} placeholder="Por ejemplo, poner la mesa" /></label>
        <label>Nota <span>(opcional)</span><textarea name="description" rows={2} maxLength={3000} placeholder="Un detalle útil para quien la haga" /></label>
        <div className={styles.formRow}><label>Fecha <span>(opcional)</span><input name="dueDate" type="date" /></label><label>Horario <span>(opcional)</span><input name="scheduledTime" type="time" /></label></div>
        <label>Responsables <span>(opcional)</span><select name="assignmentMode" defaultValue="shared"><option value="shared">Tarea compartida o disponible</option><option value="individual">Una tarea por persona elegida</option></select></label>
        <div className={styles.assigneeChoices}>{members.map((person) => <label key={person.id}><input type="checkbox" name="assignee" value={person.id} /> {person.name}</label>)}</div>
        <fieldset><legend>Repetición <span>(opcional)</span></legend><div className={styles.weekdayChoices}>{[[0,"Do"],[1,"Lu"],[2,"Ma"],[3,"Mi"],[4,"Ju"],[5,"Vi"],[6,"Sá"]].map(([day,label]) => <label key={day}><input type="checkbox" name="weekday" value={day} />{label}</label>)}</div></fieldset>
        <label>Si queda pendiente<select name="carryPolicy" defaultValue="expires_daily"><option value="expires_daily">Vence al terminar el día</option><option value="carry_forward">Sigue pendiente hasta completarse</option></select></label>
        {error && <p className={styles.errorMessage} role="alert">{error}</p>}<div className={styles.modalActions}><button type="button" className={styles.cancelButton} onClick={() => setShowCreate(false)}>Cancelar</button><button className={styles.submitButton} disabled={busy}>{busy ? "Guardando…" : "Crear tarea"}</button></div>
      </form></section></div>}



    </main>
  );
}
