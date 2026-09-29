"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import styles from "../platform.module.css";

const authClient = createAuthClient();

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "No se pudo completar el acceso.");
  return result as T;
}

export default function AccessPage() {
  const router = useRouter();
  const { data: session, isPending, refetch } = authClient.useSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [membershipSessionId, setMembershipSessionId] = useState<string | null>(null);
  const [bootstrapSessionId, setBootstrapSessionId] = useState<string | null>(null);
  const sessionUserId = session?.user?.id;
  const hasMembership = !!sessionUserId && membershipSessionId === sessionUserId;
  const canBootstrap = !!sessionUserId && bootstrapSessionId === sessionUserId;

  useEffect(() => {
    let active = true;
    if (!sessionUserId) return () => { active = false; };
    void fetch("/api/family", { cache: "no-store" }).then((response) => {
      if (active) setMembershipSessionId(response.ok ? sessionUserId : null);
    }).catch(() => { if (active) setMembershipSessionId(null); });
    void fetch("/api/family/bootstrap", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      if (active && data.canBootstrap === true) setBootstrapSessionId(sessionUserId);
      else if (active) setBootstrapSessionId(null);
    }).catch(() => { if (active) setBootstrapSessionId(null); });
    return () => { active = false; };
  }, [sessionUserId]);

  async function signIn() {
    setBusy(true); setError("");
    try { await authClient.signIn.social({ provider: "google", callbackURL: `${window.location.origin}/acceso` }); }
    catch { setError("No se pudo iniciar con Google. Comprobá la conexión y volvé a intentarlo."); }
    finally { setBusy(false); }
  }

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (!session?.user) await postJson("/api/access/prepare");
      await postJson("/api/access/redeem", { code });
      setCode("");
      await refetch();
      setMessage("Acceso vinculado. Entrando a tu familia…");
      router.push("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo completar el acceso.");
      await refetch();
    } finally { setBusy(false); }
  }

  async function bootstrap() {
    setBusy(true); setError("");
    try {
      await postJson("/api/family/bootstrap");
      router.push("/");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo iniciar la familia."); }
    finally { setBusy(false); }
  }

  const hasGoogleSession = !!session?.user && !session.user.email.endsWith("@anonymous.family-utils.invalid");
  return (
    <main className={styles.page}>
      <header className={styles.header}><Link className={styles.brand} href="/"><span className={styles.mark}>f</span>family<span>utils</span></Link><Link className={styles.signIn} href="/">Volver al inicio</Link></header>
      <section className={styles.accessWrap}>
        <p className={styles.eyebrow}>TU ESPACIO FAMILIAR</p>
        <h1 className={styles.accessTitle}>Entrá a tu familia.</h1>
        <p className={styles.intro}>Si vas a usar Family Utils desde el teléfono, instalala primero y abrila desde el icono. Iniciá sesión desde esta pantalla, dentro de la app.</p>
        <div className={styles.accessCard}>
          {hasMembership ? <>
            <h2>Ya estás dentro</h2>
            <p>Elegí qué querés abrir.</p>
            <Link className={styles.primaryButton} href="/tareas">Abrir Tareas y rutinas</Link>
            <Link className={styles.textLink} href="/familia">Ver mi familia</Link>
            <button className={styles.logoutLink} onClick={() => void authClient.signOut().then(() => { void refetch(); router.refresh(); })}>Cerrar sesión para usar otro perfil</button>
          </> : <>
            {canBootstrap && <><h2>Primera persona administradora</h2><p>Tu cuenta autorizada puede iniciar la familia y vincular su perfil adulto.</p><button className={styles.primaryButton} onClick={() => void bootstrap()} disabled={busy}>Crear o abrir mi familia</button><div className={styles.separator}><span>o</span></div></>}
            <h2>Adultos</h2>
            <p>Iniciá con la cuenta Google vinculada a tu perfil familiar. Si todavía no está vinculada, usá el código de invitación que te compartió un administrador.</p>
            <button className={styles.googleButton} onClick={() => void signIn()} disabled={busy || isPending}>Continuar con Google</button>
            <div className={styles.separator}><span>o, si ya tenés un código</span></div>
            <h2>{hasGoogleSession ? "Vincular perfil adulto" : "Integrantes sin correo"}</h2>
            <p>{hasGoogleSession ? "Con tu sesión Google abierta, ingresá la invitación destinada a tu perfil adulto." : "Instalá la app, abrila desde el icono y escribí el código que te compartieron."}</p>
            <form className={styles.accessForm} onSubmit={redeem}>
              <label htmlFor="access-code">Código de invitación o recuperación</label>
              <input id="access-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="XXXXX-XXXXX" autoComplete="one-time-code" maxLength={12} required />
              <button className={styles.primaryButton} type="submit" disabled={busy || code.replace(/[\s-]/g, "").length !== 10}>{busy ? "Verificando…" : "Ingresar a la familia"}</button>
            </form>
          </>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {message && <p className={styles.success} role="status">{message}</p>}
        </div>
        {hasGoogleSession && !hasMembership && !canBootstrap && <p className={styles.sessionNotice}>Sesión de Google activa. Escribí el código de invitación asociado a tu perfil para vincularlo.</p>}
        {session?.user && !hasMembership && <button className={styles.logoutLink} onClick={() => void authClient.signOut().then(() => { void refetch(); router.refresh(); })}>Cerrar sesión para cambiar el tipo de acceso</button>}
      </section>
      <section className={styles.installGuide} id="instalar" aria-labelledby="install-heading">
        <p className={styles.eyebrow}>INSTALACIÓN</p>
        <h2 id="install-heading">Primero instalá Family Utils.</h2>
        <p>Después abrí el icono nuevo e iniciá sesión desde esa ventana. Google se vincula así con el lugar donde vas a usar la app.</p>
        <div className={styles.installSteps}>
          <article><strong>iPhone</strong><span>En Safari, tocá Compartir → Agregar a pantalla de inicio, activá “Abrir como app” y tocá Agregar.</span></article>
          <article><strong>Android</strong><span>En Chrome, abrí el menú ⋮ → Instalar y crear acceso directo → Instalar.</span></article>
        </div>
      </section>
      <footer className={styles.footer}>Family Utils <span>Tu información queda en tu familia.</span></footer>
    </main>
  );
}
