"use client";
import { useEffect, useState } from "react";
import type { UfcView, UfcFightView } from "@/lib/sports/prediction-rules";
import styles from "./agenda.module.css";
const blocks = [
  { key: "main", label: "Cartelera principal" },
  { key: "preliminaries", label: "Preliminares" },
  { key: "early_preliminaries", label: "Preliminares tempranas" },
];
const time = (value: string) =>
  new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value));
function winnerName(fight: UfcFightView, id: string | null) {
  return id === fight.firstFighterId
    ? fight.firstFighter
    : id === fight.secondFighterId
      ? fight.secondFighter
      : "";
}
function outcomeLabel(fight: UfcFightView) {
  if (!fight.prodeEligible) return "Agregada después del cierre · no puntúa";
  if (fight.removed || fight.cancelled) return "Pelea anulada · no puntúa";
  if (!fight.result) return "Resultado pendiente";
  return fight.result.outcome === "winner"
    ? `Ganador: ${winnerName(fight, fight.result.winnerId)}`
    : fight.result.outcome === "draw"
      ? "Empate · no puntúa"
      : "Sin resultado válido · no puntúa";
}
export default function UfcPredictions({ eventId }: { eventId: string }) {
  const [data, setData] = useState<UfcView | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    fightId: string;
    winnerId: string | null;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const response = await fetch(
          `/api/sports/events/${eventId}/predictions`,
          { cache: "no-store", signal: controller.signal },
        );
        const value = await response.json();
        if (!response.ok) throw new Error(value.error);
        setData(value);
        setLoadError("");
      } catch (reason) {
        if (!controller.signal.aborted)
          setLoadError(
            reason instanceof Error
              ? reason.message
              : "No se pudieron cargar los pronósticos.",
          );
      }
    }
    void read();
    const timer = setInterval(() => void read(), 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [eventId]);
  async function choose(fightId: string, winnerId: string | null) {
    setBusy(true);
    setMessage("Guardando…");
    setError("");
    setPending({ fightId, winnerId });
    try {
      const response = await fetch(
        `/api/sports/events/${eventId}/predictions`,
        {
          method: winnerId ? "PUT" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fightId, winnerId }),
        },
      );
      const value = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          setPending(null);
          const refreshed = await fetch(`/api/sports/events/${eventId}/predictions`, { cache: "no-store" });
          if (refreshed.ok) { setData(await refreshed.json()); setLoadError(""); }
          else setLoadError("No se pudo actualizar la cartelera. Recargá la página.");
        }
        throw new Error(value.error);
      }
      setData(value);
      setMessage(winnerId ? "Pronóstico guardado." : "Pronóstico retirado.");
      setPending(null);
    } catch (reason) {
      setMessage("");
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo guardar. Reintentá.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section id="predictions" className={styles.panel}>
        <h3>Tus pronósticos</h3>
        {loadError ? (
          <p role="alert">{loadError}</p>
        ) : (
          <p role="status">Cargando pronósticos…</p>
        )}
      </section>
    );
  return (
    <section id="predictions" aria-label="Pronósticos UFC">
      <div className={styles.panel}>
        <h3>Tus pronósticos</h3>
        <nav className={styles.shortcuts} aria-label="Resultados UFC">
          <a href={"/deportes/ufc-dashboard?event=" + encodeURIComponent(eventId)}>Ver dashboard de esta velada</a>
        </nav>
        <p>
          Elegiste {data.chosen} de {data.total} peleas. Un punto por acierto.
        </p>
        <p>
          Los pronósticos de toda la cartelera cierran al comenzar el primer bloque de peleas, incluidas las preliminares.
          Esto incluye la cartelera principal. Las elecciones de la familia se revelan todas juntas.
        </p>
        <p>{data.closesAt ? `${data.closed ? "La cartelera cerró" : "Toda la cartelera cierra"} ${time(data.closesAt)} · Argentina` : "Horario del primer bloque a confirmar · pronósticos no habilitados"}</p>
        {data.transition && <p role="status">Actualizamos la regla: se cerraron todos los pronósticos y se revelaron también las elecciones de la cartelera principal. Conservamos las elecciones ya guardadas.</p>}
        {loadError && <p role="alert">{loadError}</p>}
        {message && <p role="status">{message}</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            {pending && (
              <button
                disabled={busy}
                onClick={() => void choose(pending.fightId, pending.winnerId)}
              >
                Reintentar
              </button>
            )}
          </div>
        )}
      </div>
      {blocks.map((block) => {
        const fights = data.fights.filter(
          (f) => f.block === block.key && !f.removed,
        );
        if (!fights.length) return null;
        return (
          <section className={styles.block} key={block.key}>
            <h3>{block.label}</h3>
            <p>
              {fights[0].startsAt
                ? `Inicio del bloque: ${time(fights[0].startsAt)} · Argentina`
                : "Horario del bloque a confirmar"}
            </p>
            <ol className={styles.fights}>
              {fights.map((fight) => (
                <li
                  key={fight.id}
                  className={fight.isMainEvent ? styles.mainFight : undefined}
                >
                  {fight.isMainEvent && (
                    <strong className={styles.badge}>ESTELAR</strong>
                  )}
                  <strong>
                    {fight.firstFighter} <small>vs</small> {fight.secondFighter}
                  </strong>
                  <div className={styles.choices}>
                    {[
                      [fight.firstFighterId, fight.firstFighter],
                      [fight.secondFighterId, fight.secondFighter],
                    ].map(([id, name]) => (
                      <button
                        key={id}
                        disabled={
                          busy ||
                          fight.closed ||
                          !fight.prodeEligible ||
                          !fight.closesAt ||
                          fight.cancelled ||
                          !!fight.result
                        }
                        aria-pressed={fight.ownWinnerId === id}
                        aria-label={`Elegir a ${name}`}
                        onClick={() => void choose(fight.id, id)}
                      >
                        {name}
                        {fight.ownWinnerId === id ? " · Tu elección" : ""}
                      </button>
                    ))}
                  </div>
                  {fight.ownWinnerId &&
                    !fight.closed &&
                    fight.prodeEligible &&
                    !fight.cancelled &&
                    !fight.result && (
                      <button
                        disabled={busy}
                        onClick={() => void choose(fight.id, null)}
                      >
                        Retirar elección
                      </button>
                    )}
                  {fight.ownWinnerId && (
                    <p>Tu pronóstico: {winnerName(fight, fight.ownWinnerId)}</p>
                  )}
                  <p>{outcomeLabel(fight)}</p>
                  {fight.closed && (
                    <details>
                      <summary>Elecciones de la familia</summary>
                      {fight.choices.length ? (
                        fight.choices.map((choice) => (
                          <p key={choice.memberId}>
                            {choice.name}: {winnerName(fight, choice.winnerId)}
                          </p>
                        ))
                      ) : (
                        <p>No hubo elecciones para esta pelea.</p>
                      )}
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      {data.fights.some((f) => f.removed) && (
        <details className={styles.panel}>
          <summary>Peleas retiradas · elecciones anuladas</summary>
          {data.fights
            .filter((f) => f.removed)
            .map((f) => (
              <p key={f.id}>
                {f.firstFighter} vs {f.secondFighter}
                {f.ownWinnerId
                  ? ` · Elegiste a ${winnerName(f, f.ownWinnerId)}`
                  : ""}{" "}
                · No puntúa
              </p>
            ))}
        </details>
      )}
      <section id="ranking" className={styles.panel}>
        <h3>Tabla de la cartelera · {data.final ? "Final" : "Parcial"}</h3>
        <table className={styles.ranking}>
          <caption>Un punto por ganador acertado</caption>
          <thead>
            <tr>
              <th scope="col">Puesto</th>
              <th scope="col">Integrante</th>
              <th scope="col">Puntos</th>
            </tr>
          </thead>
          <tbody>
            {data.ranking.map((row) => (
              <tr key={row.memberId}>
                <td>{row.rank}.º</td>
                <th scope="row">{row.name}</th>
                <td>{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}
