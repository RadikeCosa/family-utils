import snapshots from "@/lib/sports/ufc-insights.json";
import styles from "./agenda.module.css";

export default function UfcInsights({ reference }: { reference: string | null }) {
  const data = reference && Object.hasOwn(snapshots, reference)
    ? snapshots[reference as keyof typeof snapshots]
    : null;
  if (!data) return null;

  const reviewed = new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(data.checkedAt));

  return (
    <section className={styles.panel} aria-label="Datos y bonos de la velada">
      <h3>Datos y bonos de la velada</h3>
      <h4>Bonos oficiales</h4>
      <ul>
        {data.bonuses.map((bonus) => (
          <li key={bonus.recipients} className={styles.body}>
            <strong>{bonus.award}:</strong> {bonus.recipients}
          </li>
        ))}
      </ul>
      <h4>Estadísticas</h4>
      <table className={styles.riverStats}>
        <caption>Balance de la cartelera completa</caption>
        <thead><tr><th scope="col">Dato</th><th scope="col">Total</th></tr></thead>
        <tbody>{data.statistics.map((item) => (
          <tr key={item.label}><th scope="row">{item.label}</th><td>{item.value}</td></tr>
        ))}</tbody>
      </table>
      <h4>Datos destacados</h4>
      <ul>{data.curiosities.map((item) => <li className={styles.body} key={item}>{item}</li>)}</ul>
      <p>Revisado el {reviewed}. Las estadísticas resumen los resultados oficiales.</p>
      <ul>{data.sources.map((source) => (
        <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a></li>
      ))}</ul>
    </section>
  );
}
