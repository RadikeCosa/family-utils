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
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/sports/dashboard", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? "No se pudo cargar el dashboard.");
        setData(value);
        if (!initialEvent || initialEvent === "all" || !value.events.some((card: DashboardEvent) => card.id === initialEvent)) {
          setEventId(value.events[0]?.id ?? "");
          if (initialEvent !== "all") setPeriod("event");
        }
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo cargar el dashboard."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialEvent]);
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
    router.replace("/deportes/ufc-dashboard" + (query ? "?event=" + encodeURIComponent(query) : ""), { scroll: false });
  }
  function changeEvent(next: string) {
    setEventId(next); setPeriod("event");
    router.replace("/deportes/ufc-dashboard?event=" + encodeURIComponent(next), { scroll: false });
  }
  function fighterName(fight: Data["fights"][number], id: string | null) {
    return id === fight.firstFighterId ? fight.firstFighter : id === fight.secondFighterId ? fight.secondFighter : "Sin ganador";
  }
  if (loading) return <main className={styles.page}><p role="status">Cargando resultados…</p></main>;
  if (error) return <main className={styles.page}><p role="alert" className={styles.error}>{error}</p></main>;
  if (!data || !data.events.length) return <main className={styles.page}><header className={styles.header}><a href="/deportes?sport=ufc">← UFC</a></header><section className={styles.empty}><h1>Todavía no hay una velada completa</h1><p>El dashboard aparece cuando una cartelera termina y todos sus resultados están cargados.</p></section></main>;
  return <main className={styles.page}>
    <header className={styles.header}><a href="/deportes?sport=ufc">← UFC</a><span>Pronósticos de la familia</span></header>
    <section className={styles.intro}><p className={styles.eyebrow}>UFC · DATOS DE LA FAMILIA</p><h1>Dashboard de pronósticos</h1><p>Aciertos, participación y simulación histórica de apuestas.</p></section>
    <nav className={styles.period} aria-label="Período"><button aria-pressed={period === "event"} onClick={() => changePeriod("event")}>Esta velada</button><button aria-pressed={period === "all"} onClick={() => changePeriod("all")}>Histórico</button></nav>
    {period === "event" && <label className={styles.picker}>Cartelera<select value={eventId} onChange={(event) => changeEvent(event.target.value)}>{source.map((card) => <option key={card.id} value={card.id}>{date(card.eventDate)} · {card.title}</option>)}</select></label>}
    {view && <>
      <section className={styles.metrics} aria-label="Resumen"><article><span>Veladas</span><strong>{view.summary.eventCount}</strong></article><article><span>Peleas válidas</span><strong>{view.summary.validFights}</strong></article><article><span>Participantes</span><strong>{view.summary.participants}</strong></article><article><span>Acierto familiar</span><strong>{percent(view.summary.accuracy)}</strong></article></section>
      <section className={styles.section}><h2>Ranking de aciertos</h2><div className={styles.tableWrap}><table><caption>Un punto por ganador acertado</caption><thead><tr><th>Puesto</th><th>Integrante</th><th>Puntos</th><th>Aciertos</th><th>Errores</th><th>Efectividad</th><th>Participación</th></tr></thead><tbody>{view.ranking.map((row) => <tr key={row.memberId}><td>{row.picks ? row.rank + ".º" : "—"}</td><th scope="row">{row.name}{row.archived ? " · archivado" : ""}</th><td>{row.hits}</td><td>{row.picks ? row.hits : "Sin participación"}</td><td>{row.picks ? row.misses : "—"}</td><td>{row.picks ? percent(row.accuracy) : "—"}</td><td>{percent(row.participation)}</td></tr>)}</tbody></table></div></section>
      {period === "all" && source.length > 1 && <section className={styles.section}><h2>Evolución por velada</h2><div className={styles.trend}>{view.ranking.filter((row) => row.picks > 0).map((row) => <article key={row.memberId}><h3>{row.name}</h3>{[...source].reverse().map((card) => { const item = buildUfcDashboard([card], data.members).ranking.find((rank) => rank.memberId === row.memberId); return <div className={styles.barRow} key={card.id}><span>{date(card.eventDate)}</span><div className={styles.track} role="img" aria-label={row.name + ": " + (item?.hits ?? 0) + " aciertos, " + percent(item?.accuracy ?? null)}><i style={{ width: Math.max(item?.accuracy ?? 0, 0) * 100 + "%" }} /></div><strong>{item?.hits ?? 0} · {percent(item?.accuracy ?? null)}</strong></div>; })}</article>)}</div></section>}
      <Upset title={period === "all" ? "Batacazo histórico" : "Batacazo de la velada"} data={period === "all" ? view.historicalUpset : view.upsetOfNight} fighterName={fighterName} />
      <section className={styles.section}><div className={styles.titleRow}><div><h2>Simulación de USD 10</h2><p>Apuestas individuales por pronóstico. Sin apuestas reales.</p></div>{!financeComplete && <strong className={styles.partial}>Cuotas incompletas</strong>}</div>
        {!financeComplete && <p className={styles.note}>Cobertura completa para {view.ranking.filter((row) => row.picks === row.pricedPicks).length} de {view.ranking.filter((row) => row.picks > 0).length} integrantes con pronósticos. El ranking financiero se habilita al completar las cuotas.</p>}
        <div className={styles.tableWrap}><table><caption>Retornos según cuotas históricas verificadas</caption><thead><tr><th>Integrante</th><th>Apostado</th><th>Devuelto</th><th>Ganancia neta</th><th>ROI</th></tr></thead><tbody>{view.ranking.filter((row) => row.picks > 0).toSorted((a, b) => financeComplete ? b.net - a.net : a.name.localeCompare(b.name, "es")).map((row, i) => <tr key={row.memberId}><th scope="row">{financeComplete ? (i + 1) + ". " : ""}{row.name}</th><td>{usd.format(row.stake)}</td><td>{usd.format(row.returned)}</td><td className={row.net >= 0 ? styles.positive : styles.negative}>{row.net > 0 ? "+" : ""}{usd.format(row.net)}</td><td>{row.roi === null ? "—" : percent(row.roi)}</td></tr>)}</tbody></table></div>
      </section>
      <section className={styles.section}><div className={styles.titleRow}><h2>Detalle de peleas</h2><label>Integrante<select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="all">Toda la familia</option>{view.members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div>
        <div className={styles.fights}>{selectedFights.map((fight) => <article key={fight.id} className={fight.mainEvent ? styles.mainFight : ""}><div><p className={styles.eyebrow}>{fight.eventTitle} · {date(fight.eventDate)}{fight.mainEvent ? " · ESTELAR" : ""}</p><h3>{fight.firstFighter} <small>vs</small> {fight.secondFighter}</h3><p>Resultado: <strong>{fight.result === "winner" ? fighterName(fight, fight.winnerId) : fight.result === "draw" ? "Empate" : fight.result === "cancelled" ? "Cancelada" : "Sin resultado válido"}</strong></p></div>
          <div className={styles.choices}>{fight.choices.filter((pick) => memberId === "all" || pick.memberId === memberId).map((pick) => <span key={pick.memberId} className={pick.winnerId === fight.winnerId && fight.result === "winner" ? styles.hit : styles.miss}>{pick.name}: {fighterName(fight, pick.winnerId)} · {pick.winnerId === fight.winnerId && fight.result === "winner" ? "acertó" : fight.result === "winner" ? "no acertó" : "sin puntaje"}</span>)}{fight.firstOdds !== null && fight.secondOdds !== null ? <small>Cuotas {fight.firstFighter} {fight.firstOdds.toFixed(2)} · {fight.secondFighter} {fight.secondOdds.toFixed(2)} · {fight.bookmaker} · <a href={fight.source ?? "#"} target="_blank" rel="noreferrer">fuente</a></small> : <small>Sin cuota verificada</small>}</div></article>)}</div>
      </section>
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
