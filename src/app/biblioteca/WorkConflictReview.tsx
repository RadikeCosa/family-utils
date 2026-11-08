import styles from "./library.module.css";

type Value = string | string[];
function ComparisonValue({ value }: { value: Value }) {
  if (Array.isArray(value)) return value.length ? <ol>{value.map(name => <li key={name}>{name}</li>)}</ol> : <p>Sin dato</p>;
  return value.length > 240 ? <details><summary>Ver texto completo</summary><p className={styles.body}>{value}</p></details> : <p className={styles.body}>{value || "Sin dato"}</p>;
}
export default function WorkConflictReview({ rows, invalidCast, onCurrent, onDraft }: {
  rows: { label: string; draft: Value; current: Value }[]; invalidCast: boolean; onCurrent: () => void; onDraft: () => void;
}) {
  return <section className={styles.versionReview} aria-labelledby="version-review-title">
    <h3 id="version-review-title">El contenido cambió mientras lo editabas</h3>
    <p>Al guardar se reemplazarán todos los datos editables actuales por los de tu borrador, incluidos los campos que no modificaste.</p>
    {invalidCast ? <p role="alert">Revisá los nombres pendientes del reparto antes de comparar y conservar tu borrador.</p> : <div className={styles.fieldComparisons}>
      {rows.length ? rows.map(row => <section key={row.label}><h4>{row.label} · cambió</h4>
        <div><strong>Tu borrador</strong><ComparisonValue value={row.draft} /></div>
        <div><strong>Datos actuales</strong><ComparisonValue value={row.current} /></div>
      </section>) : <p>No hay diferencias en los datos editables. Revisá la versión antes de guardar.</p>}
    </div>}
    <div className={styles.actions}><button type="button" onClick={onCurrent}>Usar datos actuales</button><button type="button" className={styles.primary} disabled={invalidCast} onClick={onDraft}>Conservar mi borrador</button></div>
  </section>;
}
