"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SportsEvent, SportsFight, SportsPageData } from "@/lib/sports/types";
import { formatSportsDate, formatSportsTime, isRiverMatch } from "@/lib/sports/rules";
import Comments from "./Comments";
import styles from "./sports.module.css";

type FightDraft = { firstFighter: string; secondFighter: string; boutBlock: "preliminaries" | "main"; isMainEvent: boolean };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const localTime = (value: string | Date | null) => value ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value)) : "";

export default function SportsApp({ initial }: { initial: SportsPageData }) {
  const router = useRouter();
  const [tab, setTab] = useState<"football" | "ufc">("football");
  const [riverOnly, setRiverOnly] = useState(false);
  const [footballForm, setFootballForm] = useState<SportsEvent | null | false>(false);
  const [cardForm, setCardForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const admin = initial.role === "administrator";
  const events = useMemo(() => initial.football.filter((event) => !riverOnly || isRiverMatch(event.firstParticipant, event.secondParticipant)), [initial.football, riverOnly]);

  async function save(path: string, method: string, payload: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo guardar.");
      setFootballForm(false); setCardForm(false); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.back}>‹ Inicio</Link><span className={styles.brand}>Deportes</span><span className={styles.role}>{admin ? "Administración" : "Familia"}</span></header>
    <section className={styles.intro}><p className={styles.eyebrow}>EN EQUIPO</p><h1>Deportes</h1><p>Agenda y conversaciones de la familia.</p></section>
    <nav className={styles.tabs} aria-label="Deportes">
      <button type="button" className={tab === "football" ? styles.activeTab : ""} onClick={() => setTab("football")}>Fútbol</button>
      <button type="button" className={tab === "ufc" ? styles.activeTab : ""} onClick={() => setTab("ufc")}>UFC</button>
    </nav>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {tab === "football" ? <>
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>{formatSportsDate(initial.day)}</p><h2>Agenda de hoy</h2></div>{admin && <button className={styles.primary} onClick={() => setFootballForm(null)}>＋ Partido</button>}</div>
      <label className={styles.filter}><input type="checkbox" checked={riverOnly} onChange={(event) => setRiverOnly(event.target.checked)} /> Solo River</label>
      {footballForm !== false && admin && <FootballForm event={footballForm} busy={busy} onCancel={() => setFootballForm(false)} onSave={(payload) => void save(footballForm?.id ? `/api/sports/events/${footballForm.id}` : "/api/sports", footballForm?.id ? "PATCH" : "POST", footballForm?.id ? payload : { ...payload, kind: "football_match" })} />}
      <div className={styles.eventList}>{events.map((event) => {
        const river = isRiverMatch(event.firstParticipant, event.secondParticipant);
        const time = event.startsAt ? formatSportsTime(event.startsAt) : "A confirmar";
        return <article className={`${styles.eventCard} ${river ? styles.riverCard : ""}`} key={event.id}>
          <div className={styles.eventTime}>{time}</div><div className={styles.eventDetails}><p className={styles.competition}>{event.competition}</p><h3>{event.firstParticipant} <span>vs</span> {event.secondParticipant}</h3><p className={styles.eventMeta}>{event.status === "postponed" ? "Postergado" : event.status === "completed" ? "Finalizado" : event.status === "cancelled" ? "Cancelado" : "Programado"}{event.channel ? ` · ${event.channel}` : ""}{event.result ? ` · ${event.result}` : ""}{river && initial.riverThreadDates[event.id] !== event.eventDate ? " · La conversación sigue en su fecha original." : ""}</p>{river && initial.riverThreadDates[event.id] !== event.eventDate && <a className={styles.previousLink} href={`#river-thread-${event.id}-${initial.riverThreadDates[event.id]}`}>Abrir hilo original del {formatSportsDate(initial.riverThreadDates[event.id])} ↗</a>}{river && initial.priorRiverThreadDates[event.id]?.map((day) => <a className={styles.previousLink} key={day} href={`#river-thread-${event.id}-${day}`}>Ver hilo anterior del {formatSportsDate(day)} ↗</a>)}</div>
          {admin && <button className={styles.editButton} onClick={() => setFootballForm(event)}>Editar</button>}
          {river && <details className={styles.thread} open={!!initial.priorRiverThreadDates[event.id]?.length || initial.riverThreadDates[event.id] !== event.eventDate}><summary>Conversación del partido</summary><Comments contextKind="river_match" contextDate={initial.riverThreadDates[event.id] ?? event.eventDate} eventId={event.id} previousDates={initial.priorRiverThreadDates[event.id]} members={initial.members} currentMemberId={initial.currentMemberId} isAdmin={admin} /></details>}
        </article>;
      })}</div>
      {events.length === 0 && <div className={styles.empty}><strong>{riverOnly ? "No hay partidos de River hoy." : "Todavía no hay partidos para hoy."}</strong><span>{admin ? "Podés cargar el primero en unos toques." : "Cuando se cargue un partido, va a aparecer acá."}</span></div>}
      <Comments contextKind="football_day" contextDate={initial.day} members={initial.members} currentMemberId={initial.currentMemberId} isAdmin={admin} />
    </> : <>
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>CARTELERA VIGENTE</p><h2>UFC</h2></div>{admin && <button className={styles.primary} onClick={() => setCardForm(true)}>{initial.card ? "Editar cartelera" : "＋ Cartelera"}</button>}</div>
      {cardForm && admin && <UfcForm card={initial.card} fights={initial.fights} busy={busy} onCancel={() => setCardForm(false)} onSave={(payload) => void save(initial.card ? `/api/sports/events/${initial.card.id}` : "/api/sports", initial.card ? "PATCH" : "POST", initial.card ? payload : { ...payload, kind: "ufc_card" })} />}
      {initial.card ? <>
        <article className={styles.cardPanel}><p className={styles.competition}>PRÓXIMO EVENTO · {formatSportsDate(initial.card.eventDate)}</p><h3>{initial.card.title}</h3><div className={styles.schedule}><p><strong>Preliminares</strong><span>{formatSportsTime(initial.card.preliminaryStartsAt)}</span></p><p><strong>Cartelera principal</strong><span>{formatSportsTime(initial.card.mainCardStartsAt)}</span></p></div>
          <h4>Peleas</h4><ol className={styles.fights}>{initial.fights.map((fight) => <li key={fight.id} className={fight.isMainEvent ? styles.mainFight : ""}><span>{fight.firstFighter} <small>vs</small> {fight.secondFighter}</span>{fight.isMainEvent && <b>Estelar</b>}</li>)}</ol>
        </article><Comments contextKind="ufc_card" eventId={initial.card.id} members={initial.members} currentMemberId={initial.currentMemberId} isAdmin={admin} />
      </> : <div className={styles.empty}><strong>No hay una cartelera cargada.</strong><span>{admin ? "Cargala en una sola operación." : "El administrador puede cargar la próxima cartelera."}</span></div>}
    </>}
    <p className={styles.timeNote}>Horarios en Argentina (UTC−3).</p>
  </main>;
}

function FootballForm({ event, busy, onCancel, onSave }: { event: SportsEvent | null; busy: boolean; onCancel: () => void; onSave: (payload: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ eventDate: event?.eventDate ?? today(), startTime: localTime(event?.startsAt ?? null), firstParticipant: event?.firstParticipant ?? "River Plate", secondParticipant: event?.secondParticipant ?? "", competition: event?.competition ?? "", channel: event?.channel ?? "", result: event?.result ?? "", status: event?.status ?? "scheduled" });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <form className={styles.form} onSubmit={(e) => { e.preventDefault(); onSave({ ...form, title: `${form.firstParticipant} vs ${form.secondParticipant}`, startTime: form.startTime || null, channel: form.channel || null, result: form.result || null }); }}>
    <div className={styles.formTitle}><h3>{event ? "Editar partido" : "Nuevo partido"}</h3><button type="button" className={styles.editButton} onClick={onCancel}>Cerrar</button></div>
    <div className={styles.formGrid}><label>Fecha<input type="date" value={form.eventDate} onChange={(e) => set("eventDate", e.target.value)} required /></label><label>Hora (opcional)<input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} /></label><label>Equipo local<input value={form.firstParticipant} onChange={(e) => set("firstParticipant", e.target.value)} required /></label><label>Rival<input value={form.secondParticipant} onChange={(e) => set("secondParticipant", e.target.value)} required /></label><label>Competencia<input value={form.competition} onChange={(e) => set("competition", e.target.value)} placeholder="Liga Profesional" required /></label><label>Canal o plataforma<input value={form.channel} onChange={(e) => set("channel", e.target.value)} placeholder="Opcional" /></label><label>Resultado<input value={form.result} onChange={(e) => set("result", e.target.value)} placeholder="Opcional" /></label><label>Estado<select value={form.status} onChange={(e) => set("status", e.target.value)}><option value="scheduled">Programado</option><option value="postponed">Postergado</option><option value="completed">Finalizado</option><option value="cancelled">Cancelado</option></select></label></div>
    <div className={styles.formFooter}><button type="button" className={styles.secondary} onClick={onCancel}>Cancelar</button><button className={styles.primary} disabled={busy}>{busy ? "Guardando…" : "Guardar partido"}</button></div>
  </form>;
}

function UfcForm({ card, fights, busy, onCancel, onSave }: { card: SportsEvent | null; fights: SportsFight[]; busy: boolean; onCancel: () => void; onSave: (payload: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState(card?.title ?? ""); const [eventDate, setEventDate] = useState(card?.eventDate ?? today());
  const [preliminaryTime, setPreliminaryTime] = useState(localTime(card?.preliminaryStartsAt ?? null)); const [mainCardTime, setMainCardTime] = useState(localTime(card?.mainCardStartsAt ?? null));
  const [rows, setRows] = useState<FightDraft[]>(fights.length ? fights.map(({ firstFighter, secondFighter, boutBlock, isMainEvent }) => ({ firstFighter, secondFighter, boutBlock: boutBlock === "preliminaries" ? "preliminaries" : "main", isMainEvent })) : [{ firstFighter: "", secondFighter: "", boutBlock: "main", isMainEvent: true }]);
  function change(index: number, key: keyof FightDraft, value: string | boolean) { setRows((list) => list.map((row, position) => position === index ? { ...row, [key]: value } : row)); }
  return <form className={styles.form} onSubmit={(e) => { e.preventDefault(); onSave({ title, eventDate, preliminaryTime: preliminaryTime || null, mainCardTime: mainCardTime || null, fights: rows.map((row) => ({ ...row, boutBlock: row.boutBlock })) }); }}>
    <div className={styles.formTitle}><h3>{card ? "Editar cartelera vigente" : "Nueva cartelera"}</h3><button type="button" className={styles.editButton} onClick={onCancel}>Cerrar</button></div>
    <div className={styles.formGrid}><label>Evento<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="UFC Fight Night" required /></label><label>Fecha<input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required /></label><label>Hora de preliminares<input type="time" value={preliminaryTime} onChange={(e) => setPreliminaryTime(e.target.value)} /></label><label>Hora de cartelera principal<input type="time" value={mainCardTime} onChange={(e) => setMainCardTime(e.target.value)} /></label></div>
    <div className={styles.formTitle}><h4>Peleas</h4><button type="button" className={styles.secondary} onClick={() => setRows((list) => [...list, { firstFighter: "", secondFighter: "", boutBlock: "main", isMainEvent: false }])}>＋ Agregar pelea</button></div>
    {rows.map((row, index) => <div className={styles.fightEditor} key={index}><span className={styles.fightNumber}>Pelea {index + 1}</span><label>Primer peleador<input value={row.firstFighter} onChange={(e) => change(index, "firstFighter", e.target.value)} required /></label><label>Segundo peleador<input value={row.secondFighter} onChange={(e) => change(index, "secondFighter", e.target.value)} required /></label><label>Bloque<select value={row.boutBlock} onChange={(e) => change(index, "boutBlock", e.target.value)}><option value="preliminaries">Preliminares</option><option value="main">Principal</option></select></label><label className={styles.checkLabel}><input type="checkbox" checked={row.isMainEvent} onChange={(e) => change(index, "isMainEvent", e.target.checked)} /> Pelea estelar</label>{rows.length > 1 && <button type="button" className={styles.dangerText} onClick={() => setRows((list) => list.filter((_, position) => position !== index))}>Quitar pelea</button>}</div>)}
    <p className={styles.muted}>Marcá una sola pelea como estelar. Los horarios que no conozcas pueden quedar vacíos.</p>
    <div className={styles.formFooter}><button type="button" className={styles.secondary} onClick={onCancel}>Cancelar</button><button className={styles.primary} disabled={busy}>{busy ? "Guardando…" : card ? "Guardar cartelera" : "Publicar cartelera"}</button></div>
  </form>;
}
