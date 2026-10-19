"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { SportsEvent, SportsPageData } from "@/lib/sports/types";
import { sportsNowDay, isRiverMatch } from "@/lib/sports/rules";
import UfcPredictions from "./UfcPredictions";
import Comments from "./Comments";
import { RiverLineup, RiverLineupImporter } from "./RiverLineup";
import { RiverInsights, RiverInsightsImporter } from "./RiverInsights";
import CuratedImporter from "./CuratedImporter";
import ChampionsAgenda, { type ChampionsThreadDraft } from "./ChampionsAgenda";
import styles from "./agenda.module.css";
const dateLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("es-AR", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "America/Argentina/Buenos_Aires",
      }).format(new Date(`${value}T12:00:00Z`))
    : "Fecha a confirmar";
const timeLabel = (value: string | Date | null) =>
  value
    ? new Intl.DateTimeFormat("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: "America/Argentina/Buenos_Aires",
      }).format(new Date(value))
    : "Hora a confirmar";
const blocks = [
  { key: "main", label: "Cartelera principal", field: "mainCardStartsAt" },
  { key: "preliminaries", label: "Preliminares", field: "preliminaryStartsAt" },
  {
    key: "early_preliminaries",
    label: "Preliminares tempranas",
    field: "earlyPreliminariesStartsAt",
  },
] as const;
export default function AgendaApp({ initial }: { initial: SportsPageData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);
  const sport = initial.championsEnabled && params.get("sport") === "champions" ? "champions" : params.get("sport") === "ufc" ? "ufc" : "river";
  const selectedSnapshot = initial.agenda?.find(item => item.id === initial.selectedEventId);
  const historyKey = `${initial.selectedEventId}:${selectedSnapshot?.status}:${selectedSnapshot?.eventDate}:${selectedSnapshot?.sourceAbsentAt}:${initial.day}`;
  const [historyChoice, setHistoryChoice] = useState<{key:string;value:boolean} | null>(null);
  const history = historyChoice?.key === historyKey ? historyChoice.value : !!selectedSnapshot && (
    !!selectedSnapshot.sourceAbsentAt || selectedSnapshot.status === "completed" || selectedSnapshot.status === "cancelled" || (!!selectedSnapshot.eventDate && selectedSnapshot.eventDate < initial.day)
  );
  const setHistory = (value: boolean) => setHistoryChoice({key:historyKey,value});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const championsRoundFocusRef=useRef(false);
  const [championsDrafts,setChampionsDrafts]=useState<Record<string,ChampionsThreadDraft>>({});
  function updateChampionsDraft(key:string,patch:Partial<ChampionsThreadDraft>,expected?:Partial<ChampionsThreadDraft>){
    setChampionsDrafts(previous=>{
      const current=previous[key]??{body:"",edit:null};
      // A response from a previous view must not clear newer text typed after navigating back.
      if(expected?.body!==undefined&&expected.body!==current.body)return previous;
      if(expected?.edit&&(!current.edit||expected.edit.id!==current.edit.id||expected.edit.version!==current.edit.version||expected.edit.body!==current.edit.body))return previous;
      return {...previous,[key]:{...current,...patch}};
    });
  }
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const events = (initial.agenda ?? [])
    .filter(
      (event) =>
        event.kind === (sport === "river" ? "football_match" : "ufc_card") &&
        (sport !== "river" ||
          isRiverMatch(event.firstParticipant, event.secondParticipant)) &&
        !(
          sport === "ufc" &&
          initial.noUfcEvent &&
          event.eventDate! >= initial.week.start &&
          event.eventDate! <= initial.week.end
        ),
    )
    .sort(
      (a, b) =>
        (a.eventDate ?? "9999").localeCompare(b.eventDate ?? "9999") ||
        a.id.localeCompare(b.id),
    );
  const upcoming = events.filter(
    (event) =>
      !event.sourceAbsentAt &&
      event.status !== "completed" &&
      event.status !== "cancelled" &&
      (!event.eventDate || event.eventDate >= initial.day),
  );
  const past = events.filter((event) => !upcoming.includes(event)).reverse();
  const selected =
    events.find((event) => event.id === initial.selectedEventId) ??
    upcoming[0] ??
    past[0] ??
    null;
  function navigate(nextSport: string, event?: SportsEvent) {
    setHistory(
      !!event &&
        (!!event.sourceAbsentAt ||
          event.status === "completed" ||
          event.status === "cancelled" ||
          (!!event.eventDate && event.eventDate < initial.day)),
    );
    const query = new URLSearchParams({ sport: nextSport });
    if (event) query.set("event", event.id);
    router.replace(`/deportes?${query}`, { scroll: false });
    setMessage("");
  }
  async function adminAction(event: SportsEvent) {
    if (
      !window.confirm(
        "¿Ocultar este evento? Conservaremos sus comentarios y formaciones.",
      )
    )
      return;
    const response = await fetch(`/api/sports/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "hide" }),
    });
    if (response.ok) router.refresh();
    else setMessage("No se pudo ocultar.");
  }
  async function markWeek() {
    setBusy(true);
    try {
      const response = await fetch("/api/sports/week", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noUfcEvent: !initial.noUfcEvent }),
      });
      if (!response.ok) throw new Error("No se pudo actualizar la semana.");
      router.refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "No se pudo actualizar.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function formation(event: SportsEvent, remove = false) {
    setBusy(true);
    try {
      const response = await fetch(`/api/sports/events/${event.id}/formation`, {
        method: remove ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        ...(remove
          ? {}
          : {
              body: JSON.stringify({
                body:
                  drafts[event.id] ??
                  initial.formations.find(
                    (item) => item.memberId === initial.currentMemberId,
                  )?.body ??
                  "",
              }),
            }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (remove) setDrafts((value) => ({ ...value, [event.id]: "" }));
      setMessage(remove ? "Formación eliminada." : "Formación guardada.");
      router.refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "No se pudo guardar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/">‹ Inicio</Link>
        <span>Family Utils / Deportes</span>
      </header>
      <div className={styles.intro}>
        <p>EN EQUIPO</p>
        <h1>Deportes</h1>
        <span>El partido, la cartelera y la charla de casa.</span>
      </div>
      <nav className={styles.tabs} aria-label="Deportes">
        <button
          aria-pressed={sport === "river"}
          onClick={() => navigate("river")}
        >
          River
        </button>
        <button aria-pressed={sport === "ufc"} onClick={() => navigate("ufc")}>
          UFC
        </button>
        <button aria-pressed={sport === "champions"} onClick={() => navigate("champions")}>Champions</button>
      </nav>
      {sport === "ufc" && initial.features?.ufc && (
        <nav className={styles.dashboardEntry} aria-label="Estadísticas UFC">
          <a href="/deportes/ufc-dashboard"><span className={styles.dashboardMark} aria-hidden="true">UFC</span><span><strong>Ranking y estadísticas</strong><small>Resultados de la familia · última velada e histórico</small></span><b aria-hidden="true">↗</b></a>
        </nav>
      )}
      {sport === "champions" && initial.champions ? <ChampionsAgenda key={initial.champions.revision} initial={initial.champions} admin={initial.role === "administrator"} familyId={initial.familyId} currentMemberId={initial.currentMemberId} members={initial.members} drafts={championsDrafts} onDraftChange={updateChampionsDraft} navigationFocusRef={championsRoundFocusRef}/> : <>
      {sport === "ufc" && initial.noUfcEvent && (
        <p>No hay UFC esta semana. Podés consultar las próximas carteleras.</p>
      )}
      <section className={styles.agenda} aria-label="Agenda deportiva">
        <div className={styles.actions}>
          <button aria-pressed={!history} onClick={() => setHistory(false)}>
            Próximos ({upcoming.length})
          </button>
          <button aria-pressed={history} onClick={() => setHistory(true)}>
            Anteriores ({past.length})
          </button>
        </div>
        <div className={styles.eventSelector}>
          {(history ? past : upcoming).map((event) => (
            <button
              key={event.id}
              aria-pressed={selected?.id === event.id}
              onClick={() => navigate(sport, event)}
            >
              <strong>{dateLabel(event.eventDate)}</strong>
              <span>{event.title}</span>
              {event.city && (
                <small>
                  {[event.city, event.country].filter(Boolean).join(", ")}
                </small>
              )}
            </button>
          ))}
        </div>
        {(history ? past : upcoming).length === 0 && (
          <p>No hay eventos en esta sección.</p>
        )}
      </section>
      <button type="button" disabled={refreshing} onClick={refresh}>{refreshing ? "Actualizando…" : "Actualizar"}</button>
      {selected ? (
        <>
          <article
            className={`${styles.hero} ${sport === "river" ? styles.river : ""}`}
          >
            <p className={styles.eyebrow}>
              {sport === "river"
                ? selected.competition
                : {
                    numerado: "UFC numerado",
                    fight_night: "Fight Night",
                    otro: "UFC",
                  }[selected.eventType ?? "otro"]}
            </p>
            <h2>{selected.title}</h2>
            <p className={styles.kickoff}>
              {dateLabel(selected.eventDate)} ·{" "}
              {timeLabel(
                sport === "river"
                  ? selected.startsAt
                  : selected.mainCardStartsAt,
              )}
            </p>
            <p>
              {[selected.venue, selected.city, selected.country]
                .filter(Boolean)
                .join(" · ") || "Lugar a confirmar"}
            </p>
            {selected.channel && <p>Dónde verlo: {selected.channel}</p>}
            <p>
              {selected.sourceAbsentAt
                ? "Retirado de la agenda"
                : selected.status === "completed"
                  ? `Finalizado${selected.result ? ` · ${selected.result}` : ""}`
                  : selected.status === "postponed"
                    ? "Postergado"
                    : selected.status === "cancelled"
                      ? "Cancelado"
                      : "Programado"}
            </p>
            {typeof selected.automaticData?.checkedAt === "string" && (
              <details>
                <summary>
                  Datos revisados el{" "}
                  {dateLabel(
                    sportsNowDay(new Date(selected.automaticData.checkedAt)),
                  )}
                </summary>
                <p>
                  Información curada desde el chat ·{" "}
                  {selected.sourceProvider === "ufc_official"
                    ? "UFC oficial"
                    : "Liga Profesional / ESPN"}
                </p>
              </details>
            )}
          </article>
          <nav className={styles.shortcuts} aria-label="Participar">
            {sport === "river" && (
              <a href="#formations">El once que queremos</a>
            )}
            {sport === "ufc" && initial.features?.ufc && (
              <>
                <a href="#predictions">Tus pronósticos</a>
                <a href="#ranking">Ver tabla</a>
              </>
            )}
            <a href="#conversation">Ir a la conversación</a>
          </nav>
          {sport === "ufc" && initial.features?.ufc && (
            <UfcPredictions key={selected.id} eventId={selected.id} />
          )}
          {sport === "ufc" && !initial.features?.ufc && (
            <section aria-label="Cartelera">
              {blocks.map((block) => {
                const fights = initial.fights.filter(
                  (fight) => fight.boutBlock === block.key,
                );
                if (!fights.length) return null;
                return (
                  <section className={styles.block} key={block.key}>
                    <h3>{block.label}</h3>
                    <p>
                      {selected[block.field]
                        ? `${dateLabel(sportsNowDay(new Date(selected[block.field]!)))} · ${timeLabel(selected[block.field])}`
                        : "Horario a confirmar"}
                    </p>
                    <ol className={styles.fights}>
                      {fights.map((fight) => (
                        <li
                          key={fight.id}
                          className={
                            fight.isMainEvent ? styles.mainFight : undefined
                          }
                        >
                          {fight.isMainEvent && (
                            <strong className={styles.badge}>ESTELAR</strong>
                          )}
                          <span>
                            {fight.firstFighter} <small>vs</small>{" "}
                            {fight.secondFighter}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </section>
                );
              })}
            </section>
          )}
          {sport === "river" && <RiverLineup lineup={initial.officialLineup?.eventId === selected.id ? initial.officialLineup : null} />}
          {sport === "river" && (
            <section id="formations" className={styles.panel}>
              <h3>El once que queremos</h3>
              {initial.formations.map((item) => (
                <article key={item.id}>
                  <strong>
                    {initial.members.find(
                      (member) => member.id === item.memberId,
                    )?.name ?? "Integrante"}
                  </strong>
                  <p className={styles.body}>{item.body}</p>
                </article>
              ))}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void formation(selected);
                }}
              >
                <label>
                  Mi formación deseada
                  <textarea
                    maxLength={500}
                    rows={3}
                    value={
                      drafts[selected.id] ??
                      initial.formations.find(
                        (item) => item.memberId === initial.currentMemberId,
                      )?.body ??
                      ""
                    }
                    onChange={(event) =>
                      setDrafts((value) => ({
                        ...value,
                        [selected.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className={styles.actions}>
                  <button disabled={busy}>Guardar formación</button>
                  {initial.formations.some(
                    (item) => item.memberId === initial.currentMemberId,
                  ) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void formation(selected, true)}
                    >
                      Eliminar mi formación
                    </button>
                  )}
                </div>
              </form>
            </section>
          )}
          {sport === "river" && <RiverInsights insights={initial.riverInsights?.eventId===selected.id?initial.riverInsights:null} homeTeam={selected.firstParticipant??"Local"} awayTeam={selected.secondParticipant??"Visitante"}/>}
          <div id="conversation">
            <Comments
              key={selected.id}
              contextKind={sport === "river" ? "river_match" : "ufc_card"}
              eventId={selected.id}
              members={initial.members}
              currentMemberId={initial.currentMemberId}
              isAdmin={initial.role === "administrator"}
              draft={drafts[`comment:${selected.id}`] ?? ""}
              onDraftChange={(text) =>
                setDrafts((value) => ({
                  ...value,
                  [`comment:${selected.id}`]: text,
                }))
              }
            />
          </div>
        </>
      ) : (
        <div className={styles.panel}>
          <h2>No hay eventos cargados</h2>
          <p>La próxima carga aparecerá acá.</p>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {initial.role === "administrator" && (
        <details className={styles.admin}>
          <summary>Administrar</summary>
          {sport === "river" && selected && <RiverLineupImporter key={`lineup:${selected.id}`} eventId={selected.id} />}
          {sport === "river" && selected && <RiverInsightsImporter key={`insights:${selected.id}`} eventId={selected.id}/>}
          <CuratedImporter />
          <button type="button" disabled={busy} onClick={() => void markWeek()}>
            {initial.noUfcEvent
              ? "Quitar marca de semana sin evento"
              : "Marcar semana actual sin UFC"}
          </button>
          {initial.features?.results && <CuratedImporter kind="results" />}
          {selected && (
            <button
              type="button"
              className={styles.danger}
              onClick={() => void adminAction(selected)}
            >
              Ocultar {sport === "river" ? "partido" : "cartelera"}
            </button>
          )}
        </details>
      )}
      </>}
      <footer className={styles.footer}>
        Todos los horarios son de Argentina · Datos curados.
      </footer>
    </main>
  );
}
