import Link from "next/link";
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
