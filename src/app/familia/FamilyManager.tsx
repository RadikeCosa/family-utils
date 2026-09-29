"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import styles from "../platform.module.css";

type Member = {
  id: string; name: string; role: "administrator" | "member";
  accessMethod: "google" | "code"; googleEmail?: string | null;
  version: number; hasAccess: boolean;
};
type CodeCard = { memberName: string; purpose: "invitation" | "recovery"; code: string; expiresAt: string };
const authClient = createAuthClient();

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init, cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "No se pudo completar la acción.");
  return body as T;
}

function expiresLabel(value: string) {
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(value));
}

export default function FamilyManager({ currentMemberId, currentRole }: { currentMemberId: string; currentRole: Member["role"] }) {
  const router = useRouter();
  const [familyName, setFamilyName] = useState("Mi familia");
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [googleEmail, setGoogleEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("member");
  const [codeCard, setCodeCard] = useState<CodeCard | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const isAdmin = currentRole === "administrator";

  const refresh = useCallback(async () => {
    const data = await request<{ family: { name: string }; members: Member[] }>("/api/family");
    setFamilyName(data.family.name);
    setMembers(data.members);
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh).catch((caught) => setError(caught instanceof Error ? caught.message : "No se pudieron cargar los integrantes.")); }, [refresh]);

  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage(""); setCodeCard(null);
    try {
      await request("/api/members", { method: "POST", body: JSON.stringify({ name, role, googleEmail: role === "administrator" ? googleEmail : undefined }) });
      setName(""); setGoogleEmail(""); setRole("member");
      setMessage("Perfil creado. Ahora elegí cuándo darle acceso.");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo crear el perfil."); }
    finally { setBusy(false); }
  }

  async function configureProfile(event: FormEvent<HTMLFormElement>, member: Member) {
    event.preventDefault(); setBusy(true); setError(""); setCodeCard(null);
    const data = new FormData(event.currentTarget);
    try {
      await request(`/api/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "configure", expectedVersion: member.version, name: data.get("name"), role: data.get("role"), googleEmail: data.get("googleEmail") }),
      });
      setMessage("Perfil actualizado.");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo actualizar el perfil."); }
    finally { setBusy(false); }
  }

  async function generateCode(member: Member, purpose: CodeCard["purpose"]) {
    if (purpose === "recovery" && !window.confirm(`Al usar el nuevo código de ${member.name}, sus otros dispositivos perderán el acceso. ¿Querés reemplazarlos?`)) return;
    setBusy(true); setError(""); setMessage(""); setCodeCard(null); setCopied(false);
    try {
      const result = await request<{ code: string; expiresAt: string; purpose: CodeCard["purpose"] }>(`/api/members/${member.id}/codes`, { method: "POST", body: JSON.stringify({ purpose }) });
      setCodeCard({ memberName: member.name, purpose: result.purpose, code: result.code, expiresAt: result.expiresAt });
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo generar el código."); }
    finally { setBusy(false); }
  }

  const sharingText = codeCard
    ? `Para entrar a Family Utils como ${codeCard.memberName}: instalá la app en el teléfono, abrila desde el icono y entrá en ${typeof window === "undefined" ? "Family Utils" : `${window.location.origin}/acceso`}. Usá este código: ${codeCard.code}. Vence ${expiresLabel(codeCard.expiresAt)}. Compartilo solo en privado; puede quedar en el historial del chat y deja de servir después de usarse o vencer.`
    : "";

  async function shareCode() {
    if (!codeCard) return;
    setError(""); setMessage("");
    try {
      if (navigator.share) await navigator.share({ title: `Acceso a Family Utils para ${codeCard.memberName}`, text: sharingText });
      else {
        await navigator.clipboard.writeText(sharingText);
        setCopied(true); setMessage("Mensaje copiado. Elegí el chat de la persona y pegalo.");
      }
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      try { await navigator.clipboard.writeText(sharingText); setCopied(true); setMessage("No se abrió la opción de compartir; copiamos el mensaje para que puedas pegarlo."); }
      catch { setError("No se pudo compartir ni copiar el mensaje en este dispositivo."); }
    }
  }

  async function copyCode() {
    if (!codeCard) return;
    try { await navigator.clipboard.writeText(codeCard.code); setCopied(true); setMessage("Código copiado."); }
    catch { setError("No se pudo copiar el código. Podés seleccionarlo y copiarlo manualmente."); }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}><Link className={styles.brand} href="/"><span className={styles.mark}>f</span>family<span>utils</span></Link><div className={styles.headerActions}><Link className={styles.signIn} href="/">Inicio</Link><button className={styles.plainButton} onClick={() => void authClient.signOut().then(() => router.push("/acceso"))}>Salir</button></div></header>
      <section className={styles.familyWrap}>
        <p className={styles.eyebrow}>ADMINISTRACIÓN FAMILIAR</p>
        <h1 className={styles.accessTitle}>{familyName}</h1>
        <p className={styles.intro}>Cada perfil conserva sus tareas e historial. Los integrantes sin correo entran con un código en su PWA; los adultos usan su cuenta Google.</p>
        <section className={styles.memberPanel} aria-labelledby="members-title">
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>PERFILES Y ACCESO</p><h2 id="members-title">Integrantes</h2></div><span className={styles.memberCount}>{members.length}</span></div>
          <div className={styles.profileList}>
            {members.map((member) => {
              const isGoogle = member.accessMethod === "google";
              return <article className={styles.profileCard} key={member.id}>
                <div className={styles.profileTop}><span className={styles.profileAvatar}>{member.name.slice(0,1).toLocaleUpperCase()}</span><div className={styles.profileIdentity}><strong>{member.name}</strong><span>{member.role === "administrator" ? "Administrador" : "Integrante"} · {member.hasAccess ? "Acceso vinculado" : "Sin acceso"}</span></div>
                  {isAdmin && member.id !== currentMemberId && <div className={styles.profileActions}>{isGoogle
                    ? member.hasAccess ? <span className={styles.statusPill}>Entra con Google</span> : <button className={styles.smallButton} disabled={busy} onClick={() => void generateCode(member, "invitation")}>Generar invitación</button>
                    : <><button className={styles.smallButton} disabled={busy} onClick={() => void generateCode(member, "invitation")}>Dar acceso a otro dispositivo</button><button className={styles.smallButtonSecondary} disabled={busy || !member.hasAccess} onClick={() => void generateCode(member, "recovery")}>Reemplazar accesos anteriores</button></>}
                  </div>}
                </div>
                {isAdmin && member.id !== currentMemberId && <details className={styles.profileEdit}><summary>Editar perfil y acceso</summary><form onSubmit={(event) => void configureProfile(event, member)}>
                  <label>Nombre<input name="name" defaultValue={member.name} maxLength={100} required /></label>
                  <label>Rol<select name="role" defaultValue={member.role} disabled={member.hasAccess}><option value="member">Integrante sin correo</option><option value="administrator">Administrador adulto con Google</option></select>{member.hasAccess && <input type="hidden" name="role" value={member.role} />}</label>
                  <label>Correo Google<input name="googleEmail" type="email" defaultValue={member.googleEmail ?? ""} placeholder="persona@gmail.com" autoComplete="off" disabled={member.hasAccess && member.role === "administrator"} />{member.hasAccess && member.role === "administrator" && <input type="hidden" name="googleEmail" value={member.googleEmail ?? ""} />}</label>
                  <button className={styles.smallButton} disabled={busy}>Guardar cambios</button>
                </form></details>}
              </article>;
            })}
          </div>
          {isAdmin && <details className={styles.addProfile}>
            <summary>Agregar integrante</summary>
            <form className={styles.profileForm} onSubmit={(event) => void createProfile(event)}>
              <label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required placeholder="Nombre" /></label>
              <label>Tipo de perfil<select value={role} onChange={(event) => setRole(event.target.value as Member["role"])}><option value="member">Integrante sin correo</option><option value="administrator">Administrador adulto con Google</option></select></label>
              {role === "administrator" && <label>Correo Google verificado<input type="email" value={googleEmail} onChange={(event) => setGoogleEmail(event.target.value)} maxLength={254} required placeholder="persona@gmail.com" autoComplete="off" /></label>}
              <button className={styles.primaryButton} disabled={busy}>{busy ? "Guardando…" : "Crear perfil"}</button>
              <p>Crear el perfil no genera ni envía códigos. Después elegís cómo darle acceso.</p>
            </form>
          </details>}
        </section>
        {codeCard && <section className={styles.codePanel} aria-live="polite">
          <p className={styles.eyebrow}>{codeCard.purpose === "recovery" ? "REEMPLAZO DE ACCESO" : "INVITACIÓN FAMILIAR"}</p>
          <h2>Código para {codeCard.memberName}</h2>
          <p>{codeCard.purpose === "recovery" ? "Al canjearlo se cerrarán sus accesos anteriores." : "Al canjearlo se agrega un dispositivo y se conservan los accesos existentes."}</p>
          <strong className={styles.inviteCode}>{codeCard.code}</strong>
          <span className={styles.expiry}>Vence el {expiresLabel(codeCard.expiresAt)}. El código puede quedar guardado en el historial del chat; usalo solo con esta persona.</span>
          <div className={styles.codeActions}><button className={styles.smallButton} onClick={() => void copyCode()}>{copied ? "Copiado" : "Copiar código"}</button><button className={styles.primaryButton} onClick={() => void shareCode()}>Compartir instrucciones</button><button className={styles.textButton} onClick={() => setCodeCard(null)}>Cerrar código</button></div>
        </section>}
        {message && <p className={styles.success} role="status">{message}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <Link className={styles.backLink} href="/">← Volver a las aplicaciones</Link>
      </section>
      <footer className={styles.footer}>Family Utils <span>Los códigos se comparten de forma privada.</span></footer>
    </main>
  );
}
