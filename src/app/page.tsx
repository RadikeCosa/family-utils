import { recipesEnabled } from "@/lib/recipes/config";
import Link from "next/link";
import { libraryEnabled } from "@/lib/library/config";
import { trainingEnabled } from "@/lib/training/config";
import { sportsEnabled } from "@/lib/sports/config";
export const dynamic = "force-dynamic";
import styles from "./platform.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Family Utils, inicio"><span className={styles.mark}>f</span>family<span>utils</span></Link>
        <div className={styles.headerActions}><Link className={styles.installLink} href="/acceso#instalar">Instalar</Link><Link className={styles.signIn} href="/acceso">Entrar a mi familia</Link></div>
      </header>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>UN ESPACIO PARA ESTAR EN EQUIPO</p>
        <h1>Lo cotidiano,<br /><em>más simple.</em></h1>
        <p className={styles.intro}>Aplicaciones útiles para organizar la vida familiar, en un solo lugar.</p>
      </section>
      <section className={styles.section} aria-labelledby="apps-heading">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>TU ESPACIO</p><h2 id="apps-heading">Aplicaciones</h2></div></div>
        <div className={styles.cards}>
          <Link className={styles.appCard} href="/tareas" aria-label="Abrir Tareas y rutinas">
            <span className={`${styles.appIcon} ${styles.lavender}`}>✳</span>
            <span className={styles.cardTitle}>Tareas y rutinas</span>
            <span className={styles.cardCopy}>Organicen las cosas de casa entre todos.</span>
            <span className={styles.cardArrow}>Abrir <span aria-hidden="true">→</span></span>
          </Link>
          <Link className={styles.appCard} href="/menus" aria-label="Abrir Planificador de menús">
            <span className={`${styles.appIcon} ${styles.peach}`}>◒</span>
            <span className={styles.cardTitle}>Planificador de menús</span>
            <span className={styles.cardCopy}>Propongan comidas y organicen la semana entre todos.</span>
            <span className={styles.cardArrow}>Planificar <span aria-hidden="true">→</span></span>
          </Link>
          {recipesEnabled() && <Link className={styles.appCard} href="/recetas" aria-label="Abrir Recetas">
            <span className={`${styles.appIcon} ${styles.peach}`} aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4zM7 4v16M10 8h6m-6 4h6" /></svg></span><span className={styles.cardTitle}>Recetas</span><span className={styles.cardCopy}>Los platos de la familia, sus ingredientes y cómo prepararlos.</span><span className={styles.cardArrow}>Cocinar <span aria-hidden="true">→</span></span>
          </Link>}
          <Link className={styles.appCard} href="/compras" aria-label="Abrir Listas de compras">
            <span className={`${styles.appIcon} ${styles.mint}`} aria-hidden="true">☷</span>
            <span className={styles.cardTitle}>Listas de compras</span>
            <span className={styles.cardCopy}>Anoten lo que hace falta y compartan las compras.</span>
            <span className={styles.cardArrow}>Abrir <span aria-hidden="true">→</span></span>
          </Link>
          {libraryEnabled() && <Link className={styles.appCard} href="/cinemateca" aria-label="Abrir Cinemateca familiar">
            <span className={`${styles.appIcon} ${styles.lavender}`} aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/></svg></span>
            <span className={styles.cardTitle}>Cinemateca familiar</span>
            <span className={styles.cardCopy}>Películas para descubrir, valorar y recordar en familia.</span>
            <span className={styles.cardArrow}>Explorar <span aria-hidden="true">→</span></span>
          </Link>}
          {sportsEnabled() && <Link className={styles.appCard} href="/deportes" aria-label="Abrir Deportes">
            <span className={`${styles.appIcon} ${styles.mint}`} aria-hidden="true">⚽</span>
            <span className={styles.cardTitle}>Deportes</span>
            <span className={styles.cardCopy}>Agenda y conversaciones para compartir en familia.</span>
            <span className={styles.cardArrow}>Abrir <span aria-hidden="true">→</span></span>
          </Link>}
          {trainingEnabled() && <Link className={styles.appCard} href="/entrenamiento" aria-label="Abrir Entrenamiento">
            <span className={`${styles.appIcon} ${styles.mint}`} aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 8v8m12-8v8M3 10v4m18-4v4M6 12h12" /></svg></span>
            <span className={styles.cardTitle}>Entrenamiento</span>
            <span className={styles.cardCopy}>Organizá tus rutinas y registrá cómo te fue.</span>
            <span className={styles.cardArrow}>Entrenar <span aria-hidden="true">→</span></span>
          </Link>}
          <Link className={styles.appCard} href="/cocina" aria-label="Abrir Conversor de cocina">
            <span className={`${styles.appIcon} ${styles.peach}`} aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 3h14v18H5zM8 7h8M8 11h2m4 0h2m-8 4h2m4 0h2m-8 3h2m4 0h2" /></svg></span>
            <span className={styles.cardTitle}>Conversor de cocina</span>
            <span className={styles.cardCopy}>Convertí medidas, ingredientes y temperaturas.</span>
            <span className={styles.cardArrow}>Convertir <span aria-hidden="true">→</span></span>
          </Link>
          <Link className={`${styles.appCard} ${styles.familyCard}`} href="/familia">
            <span className={`${styles.appIcon} ${styles.mint}`}>⌂</span>
            <span className={styles.cardTitle}>Mi familia</span>
            <span className={styles.cardCopy}>Integrantes y formas de acceso.</span>
            <span className={styles.cardArrow}>Administrar <span aria-hidden="true">→</span></span>
          </Link>
        </div>
      </section>
      <footer className={styles.footer}>Family Utils <span>Un día a la vez.</span></footer>
    </main>
  );
}
