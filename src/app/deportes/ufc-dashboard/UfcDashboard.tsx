"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildUfcDashboard, type DashboardEvent } from "@/lib/sports/ufc-dashboard-rules";
import styles from "./dashboard.module.css";
type Data = ReturnType<typeof buildUfcDashboard>;
const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD" });
const percent = (value: number | null) => value === null ? "—" : Math.round(value * 100) + "%";
const date = (value: string) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value + "T12:00:00Z"));
export default function UfcDashboard({ initialEvent, isAdmin }: { initialEvent: string | null; isAdmin: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [eventId, setEventId] = useState(initialEvent ?? "");
  const [period, setPeriod] = useState(initialEvent === "all" ? "all" : "event");
  const [memberId, setMemberId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [unavailableEvent, setUnavailableEvent] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/sports/dashboard", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? "No se pudo cargar el dashboard.");
        setData(value);
        const requestedEventExists = value.events.some((card: DashboardEvent) => card.id === initialEvent);
        setUnavailableEvent(!!initialEvent && initialEvent !== "all" && !requestedEventExists);
        if (!initialEvent || initialEvent === "all" || !requestedEventExists) {
          setEventId(value.events[0]?.id ?? "");
          if (initialEvent !== "all") setPeriod("event");
        }
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo cargar el dashboard."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialEvent, reloadKey]);
  const source = data?.events ?? [];
  const selectedEvents = period === "all" ? source : source.filter((card) => card.id === eventId);
  const view = useMemo(() => data && buildUfcDashboard(selectedEvents, data.members), [data, selectedEvents]);
  const selectedFights = (view?.fights ?? []).filter((fight) => memberId === "all" || fight.choices.some((pick) => pick.memberId === memberId));
  const financeComplete = !!view && view.ranking.filter((row) => row.picks > 0).every((row) => row.financialComplete);
  async function refreshDashboard() {
    const response = await fetch("/api/sports/dashboard", { cache: "no-store" });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "No se pudieron actualizar las cuotas.");
    setData(value);
  }
  function changePeriod(next: "event" | "all") {
    setPeriod(next);
    const query = next === "all" ? "all" : eventId;
    router.push("/deportes/ufc-dashboard" + (query ? "?event=" + encodeURIComponent(query) : ""), { scroll: false });
  }
  function changeEvent(next: string) {
    setEventId(next); setPeriod("event");
    router.push("/deportes/ufc-dashboard?event=" + encodeURIComponent(next), { scroll: false });
  }
  function fighterName(fight: Data["fights"][number], id: string | null) {
    return id === fight.firstFighterId ? fight.firstFighter : id === fight.secondFighterId ? fight.secondFighter : "Sin ganador";
  }
  if (loading) return <main className={styles.page}><header className={styles.header}><a href="/deportes?sport=ufc">← UFC</a><span>Ranking y estadísticas</span></header><p className={styles.status} role="status">Cargando resultados…</p></main>;
  if (error) return <main className={styles.page}><header className={styles.header}><a href="/deportes?sport=ufc">← UFC</a><span>Ranking y estadísticas</span></header><section className={styles.error} role="alert"><p>{error}</p><button onClick={() => { setLoading(true); setError(""); setReloadKey((value) => value + 1); }}>Reintentar</button></section></main>;
  if (!data || !data.events.length) return <main className={styles.page}><header className={styles.header}><a href="/deportes?sport=ufc">← UFC</a><span>Pronósticos de la familia</span></header><section className={styles.empty}><p className={styles.eyebrow}>UFC · RESULTADOS</p><h1>Todavía no hay una velada completa</h1><p>El ranking aparece cuando termina una cartelera y se cargan todos sus resultados.</p></section></main>;
  const activeEvent = source.find((card) => card.id === eventId) ?? source[0];
  return <main className={styles.page}>
    <header className={styles.header}><a href={"/deportes?sport=ufc&event=" + encodeURIComponent(eventId)}>← UFC</a><span>Pronósticos de la familia</span></header>
    <section className={styles.intro}><p className={styles.eyebrow}>UFC · COMPETENCIA FAMILIAR</p><h1>Ranking y estadísticas</h1><p>Aciertos, participación y evolución de cada integrante.</p></section>
    <section className={styles.viewBar} aria-label="Vista del ranking">
      <nav className={styles.period} aria-label="Período"><button aria-pressed={period === "event"} onClick={() => changePeriod("event")}>Por velada</button><button aria-pressed={period === "all"} onClick={() => changePeriod("all")}>Histórico</button></nav>
      {period === "event" && <label className={styles.picker}>Velada<select value={eventId} onChange={(event) => changeEvent(event.target.value)}>{source.map((card) => <option key={card.id} value={card.id}>{date(card.eventDate)} · {card.title}</option>)}</select></label>}
      <h2>{period === "all" ? "Todas las veladas" : activeEvent.title}<span>{period === "event" ? date(activeEvent.eventDate) : `${source.length} velada${source.length === 1 ? "" : "s"} completa${source.length === 1 ? "" : "s"}`}</span></h2>
    </section>
    {unavailableEvent && <p className={styles.notice} role="status">Esa velada todavía no tiene resultados completos. Estás viendo la última velada disponible.</p>}
    {view && <>
      <section className={styles.metrics} aria-label="Resumen"><article><span>Participantes</span><strong>{view.summary.participants}</strong></article><article><span>Peleas válidas</span><strong>{view.summary.validFights}</strong></article><article><span>Acierto familiar</span><strong>{percent(view.summary.accuracy)}</strong></article>{period === "all" && <article><span>Veladas</span><strong>{view.summary.eventCount}</strong></article>}</section>
      <section className={`${styles.section} ${styles.rankingSection}`}><div className={styles.rankingHeading}><div><p className={styles.eyebrow}>LA FAMILIA</p><h2>Tabla de posiciones</h2></div><span>1 punto por ganador acertado</span></div><ol className={styles.leaderboard}>{view.ranking.map((row) => <li key={row.memberId} className={row.rank === 1 && row.picks ? styles.leader : ""}><details><summary><span className={styles.rankNumber}>{row.picks ? `${row.rank}.º` : "—"}</span><span className={styles.memberName}>{row.name}{row.archived ? <small>Archivado</small> : null}</span><strong className={styles.points}>{row.picks ? row.hits : "—"}<small>{row.picks ? row.hits === 1 ? "punto" : "puntos" : "sin participación"}</small></strong>{row.picks > 0 && row.rank === 1 && <span className={styles.leaderBadge}>Líder{view.ranking.filter((candidate) => candidate.rank === 1 && candidate.picks > 0).length > 1 ? " · empate" : ""}</span>}</summary><div className={styles.rowDetails}><span>Aciertos <b>{row.hits}</b></span><span>Errores <b>{row.picks ? row.misses : "—"}</b></span><span>Efectividad <b>{row.picks ? percent(row.accuracy) : "—"}</b></span><span>Participación <b>{percent(row.participation)}</b></span></div></details></li>)}</ol></section>
      {period === "all" && source.length > 1 && <section className={styles.section}><h2>Evolución por velada</h2><div className={styles.trend}>{view.ranking.filter((row) => row.picks > 0).map((row) => <article key={row.memberId}><h3>{row.name}</h3>{[...source].reverse().map((card) => { const item = buildUfcDashboard([card], data.members).ranking.find((rank) => rank.memberId === row.memberId); return <div className={styles.barRow} key={card.id}><span>{date(card.eventDate)}</span><div className={styles.track} role="img" aria-label={row.name + ": " + (item?.hits ?? 0) + " aciertos, " + percent(item?.accuracy ?? null)}><i style={{ width: Math.max(item?.accuracy ?? 0, 0) * 100 + "%" }} /></div><strong>{item?.hits ?? 0} · {percent(item?.accuracy ?? null)}</strong></div>; })}</article>)}</div></section>}
      <Upset title={period === "all" ? "Batacazo histórico" : "Batacazo de la velada"} data={period === "all" ? view.historicalUpset : view.upsetOfNight} fighterName={fighterName} />
      <section className={styles.section}><div className={styles.titleRow}><h2>Detalle de peleas</h2><label>Integrante<select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="all">Toda la familia</option>{view.members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div>
        <div className={styles.fights}>{selectedFights.length ? selectedFights.map((fight) => <article key={fight.id} className={fight.mainEvent ? styles.mainFight : ""}><div><p className={styles.eyebrow}>{fight.eventTitle} · {date(fight.eventDate)}{fight.mainEvent ? " · ESTELAR" : ""}</p><h3>{fight.firstFighter} <small>vs</small> {fight.secondFighter}</h3><p>Resultado: <strong>{fight.result === "winner" ? fighterName(fight, fight.winnerId) : fight.result === "draw" ? "Empate" : fight.result === "cancelled" ? "Cancelada" : "Sin resultado válido"}</strong></p></div>
          <div className={styles.choices}>{fight.choices.filter((pick) => memberId === "all" || pick.memberId === memberId).map((pick) => <span key={pick.memberId} className={pick.winnerId === fight.winnerId && fight.result === "winner" ? styles.hit : styles.miss}>{pick.name}: {fighterName(fight, pick.winnerId)} · {pick.winnerId === fight.winnerId && fight.result === "winner" ? "acertó" : fight.result === "winner" ? "no acertó" : "sin puntaje"}</span>)}{fight.firstOdds !== null && fight.secondOdds !== null ? <small>Cuotas {fight.firstFighter} {fight.firstOdds.toFixed(2)} · {fight.secondFighter} {fight.secondOdds.toFixed(2)} · {fight.bookmaker} · <a href={fight.source ?? "#"} target="_blank" rel="noreferrer">fuente</a></small> : <small>Sin cuota verificada</small>}</div></article>) : <p className={styles.note}>No hay peleas para este filtro.</p>}</div>
      </section>
      <details className={`${styles.section} ${styles.financeDetails}`}><summary><span><strong>Simulación de USD 10</strong><small>Apuestas individuales por pronóstico. Sin apuestas reales.</small></span>{!financeComplete && <strong className={styles.partial}>Cuotas incompletas</strong>}</summary>
        {!financeComplete && <p className={styles.note}>Cobertura completa para {view.ranking.filter((row) => row.picks === row.pricedPicks).length} de {view.ranking.filter((row) => row.picks > 0).length} integrantes con pronósticos. El ranking financiero se habilita al completar las cuotas.</p>}
        <div className={styles.tableWrap}><table><caption>Retornos según cuotas históricas verificadas</caption><thead><tr><th>Integrante</th><th>Apostado</th><th>Devuelto</th><th>Ganancia neta</th><th>ROI</th></tr></thead><tbody>{view.ranking.filter((row) => row.picks > 0).toSorted((a, b) => financeComplete ? b.net - a.net : a.name.localeCompare(b.name, "es")).map((row, i) => <tr key={row.memberId}><th scope="row">{financeComplete ? (i + 1) + ". " : ""}{row.name}</th><td>{usd.format(row.stake)}</td><td>{usd.format(row.returned)}</td><td className={row.net >= 0 ? styles.positive : styles.negative}>{row.net > 0 ? "+" : ""}{usd.format(row.net)}</td><td>{row.roi === null ? "—" : percent(row.roi)}</td></tr>)}</tbody></table></div>
      </details>
      {isAdmin && <OddsImporter onImported={refreshDashboard} />}
    </>}
  </main>;
}
function Upset({ title, data, fighterName }: { title: string; data: Data["historicalUpset"]; fighterName: (fight: Data["fights"][number], id: string | null) => string }) {
  return <section className={styles.section}><div className={styles.titleRow}><h2>{title}</h2><span>{percent(data.coverage)} de peleas con cuotas completas</span></div>
    {data.winners.length ? <div className={styles.upsets}>{data.winners.map(({ fight, odds, correct }) => <article key={fight.id}><p className={styles.eyebrow}>{fight.eventTitle} · {date(fight.eventDate)}</p><h3>{fighterName(fight, fight.winnerId)} venció a {fighterName(fight, fight.winnerId === fight.firstFighterId ? fight.secondFighterId : fight.firstFighterId)}</h3><p>Cuota decimal {odds.toFixed(2)} · {fight.bookmaker}</p><p>Lo acertaron: {correct.map((person) => person.name).join(", ")}</p><a href={"/deportes/ufc-dashboard?event=" + encodeURIComponent(fight.eventId)}>Ver esta velada</a></article>)}</div> : <p className={styles.note}>{data.missingOdds ? "No hay batacazo acertado entre las cuotas verificadas. Faltan cuotas para evaluar todas las peleas con ganador." : "Todavía no hubo un batacazo acertado con cuotas verificadas."}</p>}
  </section>;
}
function OddsImporter({ onImported }: { onImported: () => Promise<void> }) {
  const [raw, setRaw] = useState(""); const [token, setToken] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  async function send(mode: "template" | "preview" | "import") {
    setBusy(true); setStatus("");
    try {
      const response = await fetch(mode === "template" ? "/api/sports/templates?kind=odds" : "/api/sports/templates", { method: mode === "template" ? "GET" : "POST", ...(mode === "template" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, bundle: JSON.parse(raw), ...(mode === "import" ? { token } : {}) }) }), cache: "no-store" });
      const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "No se pudo completar la operación.");
      if (mode === "template") setRaw(JSON.stringify(value, null, 2));
      if (mode === "preview") { setToken(value.token); setStatus(value.events.length + " cartelera(s) validadas. Revisá antes de guardar."); }
      if (mode === "import") { await onImported(); setToken(""); setStatus(value.imported + " cartelera(s) con cuotas guardadas."); }
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "No se pudo procesar el archivo."); }
    finally { setBusy(false); }
  }
  return <details className={styles.importer}><summary>Cargar cuotas históricas</summary><p>Reemplazá casa, fuente y fecha con los datos verificados. Completá las cuotas decimales y quitá la propiedad status antes de validar. La referencia debe ser previa al primer bloque.</p><label>Datos JSON de cuotas<textarea rows={12} value={raw} onChange={(event) => { setRaw(event.target.value); setToken(""); }} /></label><div className={styles.importActions}><button disabled={busy} onClick={() => void send("template")}>Descargar plantilla</button><button disabled={busy || !raw.trim()} onClick={() => void send("preview")}>Validar cuotas</button>{token && <button disabled={busy} onClick={() => void send("import")}>Confirmar carga</button>}</div><p role="status">{status}</p></details>;
}
