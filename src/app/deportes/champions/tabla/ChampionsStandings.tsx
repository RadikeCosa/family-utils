"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ChampionsStandingsData } from "@/lib/sports/champions-standings-server";
import styles from "../../agenda.module.css";

export default function ChampionsStandings({ data }: { data: ChampionsStandingsData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return <>
    <section className={styles.panel} aria-label="Estado de la clasificación">
      <div className={styles.agendaHeading}><h2>Fase liga</h2><button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Actualizando…" : "Actualizar tabla"}</button></div>
      <p>Consultada el <time dateTime={data.checkedAt}>{new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }).format(new Date(data.checkedAt))}</time> · hora argentina. <a href={data.sourceUrl} target="_blank" rel="noreferrer">Ver en UEFA ↗</a></p>
      {data.fallback ? <p role="status" className={styles.notice}>No pudimos consultar UEFA. Mostramos la última copia verificada de la fecha indicada; puede haber cambios posteriores.</p> : <p>Se consulta UEFA cada minuto mientras esta pantalla está abierta. Las filas con “En juego” incluyen marcadores en vivo.</p>}
      <div className={styles.standingsLegend} aria-label="Referencias de clasificación"><span className={styles.standingsDirect}>1–8 · Pase directo a octavos</span><span className={styles.standingsPlayoff}>9–24 · Play-offs (16 equipos)</span><span className={styles.standingsOutside}>25–36 · Fuera de clasificación</span></div>
    </section>
    <section className={styles.panel} aria-label="Clasificación de equipos de Champions" aria-busy={pending}>
      <div className={styles.standingsScroll} role="region" aria-label="Tabla de posiciones, desplazable horizontalmente" tabIndex={0}>
        <table className={`${styles.ranking} ${styles.teamStandings}`}>
          <caption>Champions {data.season} · clasificación provisional de UEFA</caption>
          <thead><tr><th scope="col"><abbr title="Posición">Pos.</abbr></th><th scope="col">Equipo</th><th scope="col"><abbr title="Puntos">Pts</abbr></th><th scope="col"><abbr title="Partidos jugados">PJ</abbr></th><th scope="col"><abbr title="Partidos ganados">PG</abbr></th><th scope="col"><abbr title="Partidos empatados">PE</abbr></th><th scope="col"><abbr title="Partidos perdidos">PP</abbr></th><th scope="col"><abbr title="Goles a favor">GF</abbr></th><th scope="col"><abbr title="Goles en contra">GC</abbr></th><th scope="col"><abbr title="Diferencia de gol">DG</abbr></th></tr></thead>
          <tbody>{data.rows.map((row, index) => <tr key={row.teamId} className={`${row.position <= 8 ? styles.standingsDirect : row.position <= 24 ? styles.standingsPlayoff : styles.standingsOutside} ${index === 8 || index === 24 ? styles.standingsCut : ""}`}>
            <td><span className={styles.standingsPosition} title={row.position <= 8 ? "Pase directo a octavos" : row.position <= 24 ? "Play-offs" : "Fuera de clasificación"}>{row.position}</span></td><th scope="row">{row.name}{row.live && <small className={styles.standingsLive}>{data.fallback ? "En juego al consultar" : "En juego"}</small>}</th><td><strong>{row.points}</strong></td><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference > 0 ? "+" : ""}{row.goalDifference}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p>3 puntos por victoria y 1 por empate. Los puestos y desempates siguen el orden publicado por UEFA; pueden cambiar durante la jornada. La clasificación se confirma al terminar la fase liga.</p>
    </section>
  </>;
}
