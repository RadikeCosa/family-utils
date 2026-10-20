import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { sportsFeatures } from "@/lib/sports/config";
import { loadRiverChampionship } from "@/lib/sports/river-championship-server";
import { RIVER_METRICS, rankedRiverPlayers } from "@/lib/sports/river-championship-rules";
import styles from "./championship.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const titles = { goals: "Goleadores", assists: "Asistidores", yellowCards: "Tarjetas amarillas", redCards: "Tarjetas rojas" };
const columns = { goals: "Goles", assists: "Asistencias", yellowCards: "Amarillas", redCards: "Rojas" };

export default async function RiverChampionshipPage() {
  if (!sportsFeatures().agenda) notFound();
  if (!await getMemberContext(await headers())) redirect("/acceso");
  const data = loadRiverChampionship(), s = data.standing;
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/deportes?sport=river">‹ River</Link><span>Family Utils / Deportes</span></header>
    <div className={styles.intro}><p>TORNEO CLAUSURA · {data.year}</p><h1>River en el campeonato</h1><span>La posición del equipo y los números de sus jugadores.</span></div>
    <section className={styles.standing} aria-labelledby="river-position">
      <p className={styles.eyebrow}>ZONA {s.zone}</p>
      <h2 id="river-position"><strong>{s.position}.º</strong> de {s.teams} equipos</h2>
      <dl className={styles.summary}>
        <div><dt>Puntos</dt><dd>{s.points}</dd></div><div><dt>Partidos</dt><dd>{s.played}</dd></div>
        <div><dt>Ganados</dt><dd>{s.won}</dd></div><div><dt>Empatados</dt><dd>{s.drawn}</dd></div><div><dt>Perdidos</dt><dd>{s.lost}</dd></div>
        <div><dt>Goles a favor</dt><dd>{s.goalsFor}</dd></div><div><dt>Goles en contra</dt><dd>{s.goalsAgainst}</dd></div>
      </dl>
      <a href={s.sourceUrl} target="_blank" rel="noreferrer">Ver tabla oficial de la zona ↗</a>
    </section>
    <section className={styles.review} aria-label="Alcance y revisión de los datos">
      <p>Solo Clausura {data.year}. No incluye Apertura, copas ni amistosos.</p>
      <p>Datos revisados el <time dateTime={data.checkedAt}>{new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(new Date(data.checkedAt))}</time> · hora argentina. Actualización manual; puede haber cambios posteriores.</p>
      <p>Las tarjetas son registros del torneo; no indican si un jugador está suspendido para el próximo partido.</p>
    </section>
    <nav className={styles.jumpLinks} aria-label="Estadísticas de River">{RIVER_METRICS.map(key => <a key={key} href={`#${key}`}>{titles[key]}</a>)}</nav>
    <div className={styles.rankings}>{RIVER_METRICS.map(key => {
      const list = data.rankings[key], rows = rankedRiverPlayers(list.items);
      return <section key={key} id={key} className={styles.panel} aria-labelledby={`${key}-heading`}>
        <h2 id={`${key}-heading`}>{titles[key]}</h2>
        {rows.length ? <table className={styles.table}>
          <caption className={styles.srOnly}>{titles[key]} de River en el Clausura {data.year}</caption>
          <thead><tr><th scope="col"><abbr title="Posición">Pos.</abbr></th><th scope="col">Jugador</th><th scope="col">{columns[key]}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}><td>{row.position}.º</td><th scope="row">{row.name}</th><td><strong>{row.count}</strong></td></tr>)}</tbody>
        </table> : <p className={styles.empty}>No hay {key === "redCards" ? "rojas" : columns[key].toLowerCase()} {key === "goals" ? "informados" : "informadas"} en la fuente consultada.</p>}
        {list.note && <p className={styles.note}>{list.note}</p>}
        <a className={styles.source} href={list.sourceUrl} target="_blank" rel="noreferrer">Ver fuente ↗</a>
      </section>;
    })}</div>
  </main>;
}
