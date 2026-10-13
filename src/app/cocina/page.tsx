import type { Metadata } from "next";
import Link from "next/link";
import KitchenConverter from "./KitchenConverter";
import platform from "../platform.module.css";
import styles from "./kitchen.module.css";

export const metadata: Metadata = {
  title: "Conversor de cocina — Family Utils",
  description: "Convertí medidas, ingredientes y temperaturas de cocina, sin iniciar sesión.",
};

export default function KitchenPage() {
  return <main className={`${platform.page} ${styles.page}`}>
    <header className={platform.header}>
      <Link className={platform.brand} href="/" aria-label="Family Utils, inicio"><span className={platform.mark}>f</span>family<span>utils</span></Link>
      <Link className={styles.back} href="/">← Aplicaciones</Link>
    </header>
    <div className={styles.content}>
      <div className={styles.intro}>
        <p className={platform.eyebrow}>A MANO EN LA COCINA</p>
        <h1>Conversor de cocina</h1>
        <p>De tazas a gramos, de dudas a cocinar.</p>
      </div>
      <KitchenConverter />
      <p className={styles.footer}>Sin cuenta ni consultas guardadas. Los cálculos funcionan en tu dispositivo con esta página abierta.</p>
    </div>
  </main>;
}
