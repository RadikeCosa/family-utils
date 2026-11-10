"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import {
  activeSection,
  findApp,
  type AppDefinition,
} from "@/lib/navigation/catalog";
import {
  clearNavigation,
  navigationKey,
  originKey,
  readRecents,
  rememberOrigin,
  rememberRecent,
  validDestination,
  type Recent,
} from "@/lib/navigation/storage";
import { normalizeNavigationSearch } from "@/lib/navigation/query";
import {
  PlatformContext,
  NavigationObserver,
  useNavigationQuery,
} from "./navigation";
import AppIcon from "./AppIcon";
import styles from "./platform.module.css";
type Member = {
  familyId: string;
  memberId: string;
  name: string;
  familyName: string;
};
export default function PlatformShell({
  apps,
  member,
  children,
  home,
}: {
  apps: AppDefinition[];
  member: Member;
  children: ReactNode;
  home: boolean;
}) {
  const path = usePathname(),
    search = useNavigationQuery(),
    router = useRouter();
  const href = `${path}${search.size ? `?${search}` : ""}`;
  const app = findApp(path, apps) ?? apps[0];
  const sectionIndex = activeSection(
    app,
    path,
    new URLSearchParams(search.toString()),
  );
  const section = app.sections[sectionIndex];
  const [open, setOpen] = useState(false),
    [expanded, setExpanded] = useState(true);
  const [detail, setDetail] = useState(""),
    [origin, setOrigin] = useState<string | null>(null),
    [recents, setRecents] = useState<Recent[]>([]);
  const [logoutError, setLogoutError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLElement | null>(null);
  const activeNav = useRef<HTMLAnchorElement | null>(null);
  const key = navigationKey(member.familyId, member.memberId);
  const setDetailTitle = useCallback((title: string) => setDetail(title), []);
  const recordOrigin = useCallback(
    (destination: string) => {
      try {
        rememberOrigin(
          sessionStorage,
          key,
          apps,
          destination,
          `${location.pathname}${location.search}`,
        );
      } catch {
        /* Optional storage. */
      }
    },
    [key, apps],
  );
  useEffect(() => {
    const normalized = normalizeNavigationSearch(
      path,
      new URLSearchParams(search.toString()),
      apps,
    );
    if (normalized !== search.toString()) {
      window.history.replaceState(
        window.history.state,
        "",
        `${path}${normalized ? `?${normalized}` : ""}${location.hash}`,
      );
      window.dispatchEvent(new Event("family-navigation"));
      return;
    }
    queueMicrotask(() => {
      setOpen(false);
      setExpanded(true);
      try {
        setRecents(readRecents(localStorage, key, apps));
        const from = sessionStorage.getItem(originKey(key, href));
        setOrigin(from && from !== href ? validDestination(from, apps) : null);
        if (app.id !== "home" && app.id !== "family")
          rememberRecent(localStorage, key, apps, { appId: app.id, href });
      } catch {
        setOrigin(null);
      }
    });
  }, [href, key, apps, app.id, path, search]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      element.showModal();
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      activeNav.current?.scrollIntoView({ block: "nearest" });
      return () => {
        element.close();
        document.body.style.overflow = previous;
        opener.current?.focus();
      };
    }
  }, [open]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const close = () => {
      if (media.matches) setOpen(false);
    };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  function showMenu(event: MouseEvent<HTMLButtonElement>) {
    opener.current = event.currentTarget;
    setExpanded(true);
    setOpen(true);
  }
  function captureOrigin(event: MouseEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[href]",
    );
    if (
      !link ||
      (link.target && link.target !== "_self") ||
      link.hasAttribute("download")
    )
      return;
    const target = new URL(link.href, window.location.href);
    if (target.origin !== location.origin) return;
    const destination = `${target.pathname}${target.search}${target.hash}`;
    const targetApp = findApp(target.pathname, apps);
    if (!targetApp || targetApp.id === "home" || targetApp.id === "family")
      return;
    if (
      targetApp.id !== app.id ||
      (target.pathname !== app.href && target.pathname !== path)
    ) {
      try {
        rememberOrigin(
          sessionStorage,
          key,
          apps,
          destination,
          `${location.pathname}${location.search}`,
        );
      } catch {
        /* Optional storage. */
      }
    }
  }
  async function signOut() {
    setLogoutError("");
    try {
      const { createAuthClient } = await import("@/lib/family-auth-client");
      const result = await createAuthClient().signOut();
      if (result.error)
        throw new Error("No se pudo cerrar la sesión. Probá nuevamente.");
      try {
        clearNavigation(localStorage, sessionStorage, key);
      } catch {
        /* Optional storage. */
      }
      const { clearLibraryDrafts } = await import("@/lib/library/drafts");
      clearLibraryDrafts();
      router.push("/acceso");
      router.refresh();
    } catch {
      setLogoutError("No se pudo cerrar la sesión. Probá nuevamente.");
    }
  }
  function sectionDestination(destination: string) {
    if (app.id !== "menus") return destination;
    const next = new URL(destination, "https://family.invalid");
    const date = search.get("fecha");
    if (date) next.searchParams.set("fecha", date);
    return `${next.pathname}${next.search}`;
  }
  function navigation(mobile: boolean) {
    return (
      <>
        <Link className={styles.brand} href="/" onClick={() => setOpen(false)}>
          <span className={styles.mark}>f</span>family<span>utils</span>
        </Link>
        <p className={styles.caption}>TU ESPACIO</p>
        <nav aria-label={mobile ? "Aplicaciones en celular" : "Aplicaciones"}>
          {apps.map((item) => (
            <div
              key={item.id}
              className={item.id === "family" ? styles.family : undefined}
            >
              <div className={styles.navRow}>
                <Link
                  ref={mobile && item.id === app.id ? activeNav : undefined}
                  href={item.href}
                  className={`${styles.navLink} ${item.id === app.id ? styles.selected : ""}`}
                  aria-current={item.id === app.id ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span className={`${styles.icon} ${styles[item.accent]}`}>
                    <AppIcon id={item.id} />
                  </span>
                  {item.name}
                </Link>
                {item.id === app.id && !!item.sections.length && (
                  <button
                    className={styles.expand}
                    aria-label={`${expanded ? "Contraer" : "Expandir"} secciones de ${item.name}`}
                    aria-expanded={expanded}
                    aria-controls={`${mobile ? "mobile" : "desktop"}-sections`}
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded ? "−" : "+"}
                  </button>
                )}
              </div>
              {item.id === app.id && !!item.sections.length && expanded && (
                <div
                  id={`${mobile ? "mobile" : "desktop"}-sections`}
                  className={styles.sections}
                >
                  {item.sections.map((entry, index) => (
                    <Link
                      key={entry.href}
                      href={sectionDestination(entry.href)}
                      aria-current={sectionIndex === index ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      {entry.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className={styles.sidebarFoot}>
          <AppIcon id="family" />
          <span>{member.familyName}</span>
        </div>
      </>
    );
  }
  const isDetail =
    path !== app.href || (app.id === "training" && search.has("detalle"));
  const staticTitle = path.includes("river/campeonato")
    ? "River en el campeonato"
    : path.includes("ufc-dashboard")
      ? "Ranking y estadísticas"
      : path.includes("champions/tabla")
        ? "Tabla de posiciones"
        : "Detalle";
  const parent = isDetail ? app.href : "/";
  return (
    <PlatformContext.Provider
      value={{ enabled: true, setDetailTitle, recordOrigin }}
    >
      <Suspense fallback={null}>
        <NavigationObserver />
      </Suspense>
      <div className={styles.shell} data-unified-ui="true">
        <a className={styles.skip} href="#platform-content">
          Saltar al contenido
        </a>
        <aside className={styles.sidebar} aria-label="Navegación principal">
          {navigation(false)}
        </aside>
        <dialog
          ref={dialog}
          className={styles.drawer}
          aria-label="Menú de aplicaciones"
          onCancel={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              const rect = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom
              )
                setOpen(false);
            }
          }}
        >
          <button
            className={styles.close}
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
          {navigation(true)}
        </dialog>
        <div className={styles.workspace}>
          <header className={styles.header}>
            <button
              className={styles.mobileMenu}
              aria-label="Abrir menú de aplicaciones"
              aria-expanded={open}
              onClick={showMenu}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
            <nav className={styles.breadcrumbs} aria-label="Ubicación">
              <Link href="/">Inicio</Link>
              {app.id !== "home" && (
                <>
                  <span aria-hidden="true">/</span>
                  {isDetail ? (
                    <Link href={app.href}>{app.name}</Link>
                  ) : (
                    <span aria-current="page">{app.name}</span>
                  )}
                </>
              )}
              {isDetail && (
                <>
                  <span aria-hidden="true">/</span>
                  <span aria-current="page" title={detail || staticTitle}>
                    {detail || staticTitle}
                  </span>
                </>
              )}
            </nav>
            <span className={styles.mobileTitle}>{app.name}</span>
            <details className={styles.profile}>
              <summary aria-label={`Perfil de ${member.name}`}>
                <span className={styles.avatar}>{member.name.slice(0, 1)}</span>
                <span className={styles.profileName}>{member.name}</span>
              </summary>
              <div>
                <strong>{member.name}</strong>
                <span>{member.familyName}</span>
                <Link href="/familia">Mi familia</Link>
                <button onClick={() => void signOut()}>Salir</button>
                {logoutError && <p role="alert">{logoutError}</p>}
              </div>
            </details>
          </header>
          <div className={styles.body} id="platform-content" tabIndex={-1}>
            {app.id !== "home" && (
              <nav
                className={styles.mobileLocation}
                aria-label="Navegación de la página"
              >
                <Link href={parent}>‹ {isDetail ? app.name : "Inicio"}</Link>
                {section && (
                  <button
                    onClick={showMenu}
                    aria-expanded={open}
                    aria-label={section.label}
                  >
                    {section.label} ▾
                  </button>
                )}
              </nav>
            )}
            {origin && (
              <nav aria-label="Regreso contextual">
                <Link
                  className={styles.origin}
                  href={origin}
                  data-navigation-origin
                >
                  <span aria-hidden="true">‹</span> Volver a la vista anterior
                  de{" "}
                  {findApp(
                    new URL(origin, "https://family.invalid").pathname,
                    apps,
                  )?.name ?? "la vista anterior"}
                </Link>
              </nav>
            )}
            {home ? (
              <main className={styles.home}>
                <p className={styles.caption}>{member.familyName}</p>
                <h1>Tu espacio, en familia.</h1>
                <p>Elegí una aplicación o retomá donde estabas.</p>
                <section aria-labelledby="recents-heading">
                  <h2 id="recents-heading">Retomar</h2>
                  <div className={styles.recentGrid}>
                    {!recents.length && (
                      <p className={styles.recentEmpty}>
                        Tus últimas aplicaciones aparecerán acá para que puedas
                        retomarlas.
                      </p>
                    )}
                    {recents.map((item) => {
                      const recentApp = apps.find(
                        (value) => value.id === item.appId,
                      )!;
                      return (
                        <Link key={item.appId} href={item.href}>
                          <AppIcon id={recentApp.id} />
                          <span>{recentApp.name}</span>
                          <span aria-hidden="true">→</span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
                <section aria-labelledby="catalog-heading">
                  <h2 id="catalog-heading">Aplicaciones</h2>
                  <div className={styles.appGrid}>
                    {apps
                      .filter(
                        (item) => item.id !== "home" && item.id !== "family",
                      )
                      .map((item) => (
                        <Link href={item.href} key={item.id}>
                          <span
                            className={`${styles.icon} ${styles[item.accent]}`}
                          >
                            <AppIcon id={item.id} />
                          </span>
                          <h3>{item.name}</h3>
                          <span>
                            Abrir <span aria-hidden="true">→</span>
                          </span>
                        </Link>
                      ))}
                  </div>
                </section>
              </main>
            ) : (
              <div className={styles.content} onClickCapture={captureOrigin}>
                {children}
              </div>
            )}
          </div>
        </div>
      </div>
    </PlatformContext.Provider>
  );
}
