"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createAuthClient } from "better-auth/react";
import styles from "./page.module.css";

const authClient = createAuthClient();
const sampleTasks = [
  { id: "sample-1", taskId: "sample-1", title: "Poner la mesa", dueDate: "", scheduledTime: "20:00", responsibilityMemberId: null, claimedByMemberId: null, status: "open", version: 1, assignees: [{ name: "2 responsables" }], tone: "lavender" },
  { id: "sample-2", taskId: "sample-2", title: "Sacar la basura", dueDate: "", scheduledTime: "", responsibilityMemberId: null, claimedByMemberId: null, status: "open", version: 1, assignees: [], tone: "mint" },
  { id: "sample-3", taskId: "sample-3", title: "Ordenar mi habitación", dueDate: "", scheduledTime: "", responsibilityMemberId: null, claimedByMemberId: null, status: "open", version: 1, assignees: [{ name: "Personal" }], tone: "peach" },
];

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
  const { data: session, isPending, refetch } = authClient.useSession();
  const [family, setFamily] = useState<{ id: string; name: string; timeZone: string; revision: number } | null>(null);
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [code, setCode] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");
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
      setCurrentMemberId(familyData.currentMemberId);
      setTasks(taskData.tasks);
    } catch (caught) {
      setFamily(null);
      setCurrentMemberId(null);
      setTasks([]);
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la familia.");
    } finally {
      setLoadingData(false);
    }
  }, [session?.user]);

  useEffect(() => { if (session?.user) void Promise.resolve().then(refresh); }, [refresh, session?.user]);

  const sampleMode = !family;
  const familyDay = familyDate();
  const visibleTasks = useMemo(() => {
    if (sampleMode) return sampleTasks as unknown as Task[];
    return tasks.filter((task) => task.status === "open" ? !task.dueDate || task.dueDate <= familyDay : true);
  }, [familyDay, sampleMode, tasks]);
  const openCount = visibleTasks.filter((task) => task.status === "open").length;
  const completeCount = visibleTasks.filter((task) => task.status === "completed").length;
  const isAdmin = members.find((member) => member.id === currentMemberId)?.role === "administrator";

  async function signIn() {
    setBusy(true); setError("");
    try { await authClient.signIn.social({ provider: "google", callbackURL: window.location.origin }); }
    catch { setError("No se pudo iniciar con Google. Revisá la configuración de acceso."); }
    finally { setBusy(false); }
  }

  async function bootstrap() {
    setBusy(true); setError("");
    try { await requestJson("/api/family/bootstrap", { method: "POST", body: "{}" }); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo crear la familia."); }
    finally { setBusy(false); }
  }

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await requestJson("/api/access/redeem", { method: "POST", body: JSON.stringify({ code }) });
      setCode("");
      await refetch();
      setMessage("Acceso vinculado. Ya podés entrar a la familia.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Código inválido o vencido."); }
    finally { setBusy(false); }
  }

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

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setInviteCode("");
    try {
      const member = await requestJson<{ id: string }>("/api/members", { method: "POST", body: JSON.stringify({ name: newMemberName }) });
      const codeData = await requestJson<{ code: string }>(`/api/members/${member.id}/codes`, { method: "POST", body: JSON.stringify({ purpose: "invitation" }) });
      setInviteCode(codeData.code); setNewMemberName(""); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo crear el perfil."); }
    finally { setBusy(false); }
  }

  async function makeRecoveryCode(memberId: string) {
    setBusy(true); setError("");
    try {
      const codeData = await requestJson<{ code: string }>(`/api/members/${memberId}/codes`, { method: "POST", body: JSON.stringify({ purpose: "recovery" }) });
      setInviteCode(codeData.code);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo generar el código."); }
    finally { setBusy(false); }
  }

  const dateLabel = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "long" }).format(new Date()).toLocaleUpperCase("es-AR");

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Navegación principal">
        <a className={styles.brand} href="#inicio" aria-label="Family Utils, inicio"><span className={styles.brandMark}>f</span><span>family<span className={styles.brandLight}>utils</span></span></a>
        <div className={styles.sidebarLabel}>TU ESPACIO</div>
        <nav className={styles.nav}>
          <a className={`${styles.navItem} ${styles.navActive}`} href="#hoy"><span>◷</span> Hoy <span className={styles.navCount}>{openCount}</span></a>
          <a className={styles.navItem} href="#semana"><span>▦</span> Mi semana</a>
          <a className={styles.navItem} href="#familia"><span>⌂</span> Toda la familia</a>
          <a className={styles.navItem} href="#completadas"><span>✓</span> Completadas</a>
        </nav>
        <div className={styles.sideDivider} />
        <div className={styles.sidebarLabel}>APLICACIONES</div>
        <a className={styles.appLink} href="#tareas"><span className={styles.appIcon}>✳</span><span>Tareas y rutinas</span><span className={styles.appDot} /></a>
        <div className={styles.sidebarFooter}><div className={styles.familyAvatar}>⌂</div><div><strong>{family?.name ?? "Mi familia"}</strong><small>{members.length || 4} integrantes</small></div><button className={styles.moreButton} onClick={() => setShowManage(true)} aria-label="Opciones de familia">···</button></div>
      </aside>

      <section className={styles.content} id="inicio">
        <header className={styles.topbar}>
          <span className={styles.breadcrumb}>Tareas y rutinas <span>/</span> Hoy</span>
          <div className={styles.topActions}>
            {session?.user && <span className={styles.signedInName}>{session.user.name}</span>}
            {session?.user ? <button className={styles.signOutButton} onClick={() => void authClient.signOut()}>Salir</button> : <button className={styles.signInButton} onClick={() => void signIn()} disabled={busy || isPending}>Entrar con Google</button>}
            <div className={styles.avatar} aria-label="Perfil">{session?.user?.name?.slice(0, 1) ?? "·"}</div>
          </div>
        </header>

        <div className={styles.pageBody}>
          {(!family || error || message) && <section className={styles.accessPanel}>
            <div className={styles.accessPanelText}>
              <strong>{family ? "Acceso a la familia" : session?.user ? "Ya casi estás" : "Entrá a tu espacio familiar"}</strong>
              <p>{family ? "Los códigos de recuperación se escriben dentro de esta app." : session?.user ? "Si sos administrador, podés iniciar la familia. Si ya tenés un código, ingresalo acá." : "Usá Google como adulto o escribí el código que te compartió un administrador."}</p>
            </div>
            {session?.user && !family && <button className={styles.bootstrapButton} onClick={() => void bootstrap()} disabled={busy}>Crear o abrir mi familia</button>}
            <form className={styles.codeForm} onSubmit={redeem}>
              <label className={styles.srOnly} htmlFor="access-code">Código de invitación o recuperación</label>
              <input id="access-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="XXXXX-XXXXX" autoComplete="one-time-code" maxLength={12} />
              <button type="submit" disabled={busy || code.length < 10}>Ingresar código</button>
            </form>
            {message && <p className={styles.successMessage}>{message}</p>}
            {error && <p className={styles.errorMessage} role="alert">{error}</p>}
          </section>}

          <div className={styles.greetingRow}>
            <div><p className={styles.dateLabel}>{dateLabel}</p><h1>Un día a la vez<span>.</span></h1><p className={styles.subtitle}>{family ? "Esto es lo que tenemos para hoy." : "Una forma simple de organizar las cosas de casa."}</p></div>
            {family && <div className={styles.createActions}><button className={styles.addButton} onClick={() => setShowCreate(true)}><span>＋</span> Nueva tarea</button>{isAdmin && <button className={styles.settingsButton} onClick={() => setShowManage(true)} aria-label="Administrar integrantes">⚙</button>}</div>}
          </div>

          <div className={styles.summaryGrid}>
            <div className={`${styles.summaryCard} ${styles.summaryPrimary}`}><div className={styles.summaryIcon}>◷</div><div><span>Para hoy</span><strong>{sampleMode ? 3 : openCount} <small>tareas</small></strong></div><div className={styles.progressTrack}><div style={{ width: `${sampleMode ? 41 : openCount + completeCount ? Math.round(completeCount / (openCount + completeCount) * 100) : 0}%` }} /></div><p>Todo a su ritmo, sin apuro.</p></div>
            <div className={styles.summaryCard}><div className={`${styles.summaryIcon} ${styles.iconGreen}`}>✓</div><div><span>Hechas recientemente</span><strong>{sampleMode ? 2 : completeCount} <small>{sampleMode ? "de 5" : "tareas"}</small></strong></div><div className={styles.miniAvatars}><i>✓</i><i>✓</i><i>+</i></div><p>Buen trabajo en equipo.</p></div>
            <div className={`${styles.summaryCard} ${styles.summaryQuote}`}><span className={styles.quoteMark}>“</span><p>Las pequeñas cosas<br />también cuentan.</p><span className={styles.quoteBy}>— para hoy</span></div>
          </div>

          <div className={styles.tasksHeader}><div><h2>{family ? "Hoy en casa" : "Un vistazo a la app"}</h2><span>{family ? "Pendientes y completadas recientes" : "Ejemplos de tareas configurables"}</span></div><button className={styles.filterButton} onClick={() => void refresh()}>{loadingData ? "Actualizando…" : "Actualizar"} <span>↻</span></button></div>

          <div className={styles.taskList}>
            {visibleTasks.length === 0 && family && <div className={styles.emptyState}>No hay tareas pendientes. Podés crear una cuando haga falta.</div>}
            {visibleTasks.map((task, index) => {
              const isComplete = task.status === "completed";
              const available = task.status === "open" && task.assignees.length === 0 && !task.claimedByMemberId;
              const people = task.assignees.map((person) => person.name).join(", ") || (task.claimedByMemberId ? members.find((person) => person.id === task.claimedByMemberId)?.name ?? "Asumida" : "Disponible para asumir");
              const meta = task.dueDate ? `${task.dueDate === familyDay ? "Hoy" : task.dueDate}${task.scheduledTime ? ` · ${task.scheduledTime}` : ""}` : task.scheduledTime ? `Hoy · ${task.scheduledTime}` : "Sin fecha";
              const tone = ["lavender", "mint", "peach"][index % 3];
              return <article className={`${styles.taskCard} ${isComplete ? styles.taskDone : ""}`} key={task.id}>
                <button className={`${styles.checkButton} ${isComplete ? styles.checkedButton : ""}`} aria-label={isComplete ? `Deshacer: ${task.title}` : `Marcar ${task.title} como hecha`} disabled={busy || sampleMode} onClick={() => void performOccurrence(task, isComplete ? "undo" : "complete")}>{isComplete ? "✓" : ""}</button>
                <div className={`${styles.taskIcon} ${styles[tone]}`}>{index % 3 === 0 ? "⌂" : index % 3 === 1 ? "♧" : "✳"}</div>
                <div className={styles.taskInfo}><h3>{task.title}</h3><p>{meta}</p><span className={styles.taskPeople}>{isComplete ? `Hecha por ${members.find((person) => person.id === task.completedByMemberId)?.name ?? "un integrante"}` : people}</span>{task.editedByName && <small className={styles.editedBy}>Editada por {task.editedByName}</small>}</div>
                {available && family && <button className={styles.claimButton} disabled={busy} onClick={() => void performOccurrence(task, "claim")}>Asumir</button>}
                {isComplete && <span className={styles.taskStatus}>Completada</span>}
                <button className={styles.cardMore} aria-label={`Más opciones: ${task.title}`} disabled={sampleMode}>···</button>
              </article>;
            })}
          </div>

          <div className={styles.weekCallout} id="semana"><div className={styles.weekIcon}>▦</div><div><strong>¿Qué hay para el resto de la semana?</strong><p>Revisá tus tareas recientes y organizate con tiempo.</p></div><a href="#semana">Ver mi semana <span>→</span></a></div>
          <footer className={styles.footer}><span>Un espacio para estar más en equipo.</span><span>{loadingData ? "Actualizando…" : family ? "Sincronizado" : "Vista de muestra"} <i /></span></footer>
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

      {showManage && family && isAdmin && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowManage(false); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="manage-title"><button className={styles.modalClose} onClick={() => setShowManage(false)} aria-label="Cerrar">×</button><p className={styles.modalEyebrow}>ADMINISTRACIÓN FAMILIAR</p><h2 id="manage-title">Integrantes</h2><p className={styles.modalIntro}>Cada integrante usa su propio dispositivo.</p><div className={styles.memberList}>{members.map((person) => <div className={styles.memberRow} key={person.id}><span className={styles.memberAvatar}>{person.name.slice(0,1)}</span><span><strong>{person.name}</strong><small>{person.role === "administrator" ? "Administrador" : "Integrante"}</small></span>{person.role === "member" && <button className={styles.smallAction} onClick={() => void makeRecoveryCode(person.id)} disabled={busy}>Recuperar</button>}</div>)}</div>
        <form className={styles.inlineMemberForm} onSubmit={createMember}><label htmlFor="new-member">Agregar integrante</label><div><input id="new-member" value={newMemberName} onChange={(event) => setNewMemberName(event.target.value)} maxLength={100} placeholder="Nombre" required /><button className={styles.submitButton} disabled={busy}>Crear perfil</button></div></form>
        {inviteCode && <div className={styles.generatedCode}><span>Código para compartir dentro de la familia</span><strong>{inviteCode}</strong><button onClick={() => void navigator.clipboard?.writeText(inviteCode)}>Copiar código</button></div>}
        {error && <p className={styles.errorMessage} role="alert">{error}</p>}
      </section></div>}
      <div className={styles.previewFlag}>{sampleMode ? "Vista de muestra · los ejemplos no se guardan" : "Datos de tu familia"}</div>
    </main>
  );
}
