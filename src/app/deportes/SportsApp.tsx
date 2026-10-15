"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SportsEvent, SportsFight, SportsPageData } from "@/lib/sports/types";
import { formatSportsDate, formatSportsTime, sportsNowDay } from "@/lib/sports/rules";
import Comments from "./Comments";
import styles from "./sports.module.css";

type FightDraft = { firstFighter: string; secondFighter: string; boutBlock: "preliminaries" | "main"; isMainEvent: boolean };
const today = () => sportsNowDay();
const localTime = (value: string | Date | null) => value ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value)) : "";
const localDate = (value: string | Date | null, fallback: string) => value ? sportsNowDay(new Date(value)) : fallback;
const blockTime = (value: string | Date | null) => value ? `${formatSportsDate(sportsNowDay(new Date(value)))} · ${formatSportsTime(value)}` : "A confirmar";

export default function SportsApp({ initial }: { initial: SportsPageData }) {
  const router = useRouter();
  const [tab, setTab] = useState<"football" | "ufc">("football");
  const [footballForm, setFootballForm] = useState<SportsEvent | null | false>(false);
  const [cardForm, setCardForm] = useState<SportsEvent | null | false>(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const admin = initial.role === "administrator";
  const match = initial.football[0] ?? null;

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
  const hide = (event: SportsEvent) => {
    if (window.confirm("¿Ocultar este evento? Conservaremos sus comentarios y formaciones.")) {
      void save(`/api/sports/events/${event.id}`, "PATCH", { action: "hide" });
    }
  };

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.back}>‹ Inicio</Link><span className={styles.brand}>Deportes</span><span className={styles.role}>{admin ? "Administración" : "Familia"}</span></header>
    <section className={styles.intro}><p className={styles.eyebrow}>EN EQUIPO</p><h1>Deportes</h1><p>River, UFC y las conversaciones de casa.</p></section>
    <nav className={styles.tabs} aria-label="Deportes">
      <button type="button" aria-pressed={tab === "football"} className={tab === "football" ? styles.activeTab : ""} onClick={() => setTab("football")}>River</button>
      <button type="button" aria-pressed={tab === "ufc"} className={tab === "ufc" ? styles.activeTab : ""} onClick={() => setTab("ufc")}>UFC</button>
    </nav>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {tab === "football" ? <>
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>EL MILLONARIO</p><h2>Próximo partido de River</h2></div>{admin && <button disabled={busy} className={styles.primary} onClick={() => setFootballForm(null)}>Cargar partido</button>}</div>
      {footballForm !== false && admin && <FootballForm key={footballForm?.id ?? "new"} event={footballForm} busy={busy} onCancel={() => setFootballForm(false)} onSave={(payload) => void save(footballForm?.id ? `/api/sports/events/${footballForm.id}` : "/api/sports", footballForm?.id ? "PATCH" : "POST", footballForm?.id ? payload : { ...payload, kind: "football_match" })} />}
      {match ? <>
        <article className={`${styles.eventCard} ${styles.riverCard}`}>
          <div className={styles.eventTime}>{formatSportsTime(match.startsAt)}</div>
          <div className={styles.eventDetails}><p className={styles.competition}>{match.competition}</p><h3>{match.firstParticipant} <span>vs</span> {match.secondParticipant}</h3><p>{formatSportsDate(match.eventDate)}</p><p className={styles.eventMeta}>Cancha: {match.venue ?? "A confirmar"}</p><p className={styles.eventMeta}>{match.status === "postponed" ? "Postergado" : match.status === "completed" ? "Finalizado" : "Programado"}{match.result ? ` · ${match.result}` : ""}{match.channel ? ` · ${match.channel}` : ""}</p><p className={styles.muted}>Carga manual · Editado {formatSportsDate(match.updatedAt)}</p></div>
          {admin && <div className={styles.actions}><button disabled={busy} className={styles.editButton} onClick={() => setFootballForm(match)}>Editar partido</button><button disabled={busy} className={styles.dangerText} onClick={() => hide(match)}>Ocultar partido</button></div>}
        </article>
        <Formations key={match.id} initial={initial} eventId={match.id} />
        <Comments key={match.id} contextKind="river_match" eventId={match.id} members={initial.members} currentMemberId={initial.currentMemberId} isAdmin={admin} />
      </> : <div className={styles.empty}><strong>No hay un próximo partido de River cargado.</strong><span>{admin ? "Podés cargarlo aunque la fecha todavía esté a confirmar." : "Un adulto puede cargar el próximo encuentro."}</span></div>}
    </> : <>
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>SEMANA DEL {formatSportsDate(initial.week.start)}</p><h2>UFC de esta semana</h2></div>{admin && <button disabled={busy} className={styles.primary} onClick={() => setCardForm(null)}>Cargar cartelera</button>}</div>
      {admin && <div className={styles.actions}><button disabled={busy} className={styles.secondary} onClick={() => void save("/api/sports/week", "PUT", { noUfcEvent: !initial.noUfcEvent })}>{initial.noUfcEvent ? "Quitar marca sin evento" : "Sin evento esta semana"}</button></div>}
      {cardForm !== false && admin && <UfcForm key={cardForm?.id ?? "new"} card={cardForm} fights={cardForm ? initial.fights : []} busy={busy} onCancel={() => setCardForm(false)} onSave={(payload) => void save(cardForm?.id ? `/api/sports/events/${cardForm.id}` : "/api/sports", cardForm?.id ? "PATCH" : "POST", cardForm?.id ? payload : { ...payload, kind: "ufc_card" })} />}
      {initial.card ? <>
        <article className={styles.cardPanel}><p className={styles.competition}>FECHA OFICIAL · {formatSportsDate(initial.card.eventDate)}</p><h3>{initial.card.title}</h3><div className={styles.schedule}><p><strong>Preliminares</strong><span>{blockTime(initial.card.preliminaryStartsAt)}</span></p><p><strong>Cartelera principal</strong><span>{blockTime(initial.card.mainCardStartsAt)}</span></p></div>
          <h4>Peleas</h4><ol className={styles.fights}>{initial.fights.map((fight) => <li key={fight.id} className={fight.isMainEvent ? styles.mainFight : ""}><span>{fight.firstFighter} <small>vs</small> {fight.secondFighter}</span><b>{fight.isMainEvent ? "Estelar · " : ""}{fight.boutBlock === "main" ? "Principal" : "Preliminares"}</b></li>)}</ol>
          <p className={styles.muted}>Carga manual · Editado {formatSportsDate(initial.card.updatedAt)}</p>
          {admin && <div className={styles.actions}><button disabled={busy} className={styles.editButton} onClick={() => setCardForm(initial.card)}>Editar cartelera</button><button disabled={busy} className={styles.dangerText} onClick={() => hide(initial.card!)}>Ocultar cartelera</button></div>}
        </article><Comments key={initial.card.id} contextKind="ufc_card" eventId={initial.card.id} members={initial.members} currentMemberId={initial.currentMemberId} isAdmin={admin} />
      </> : <div className={styles.empty}><strong>{initial.noUfcEvent ? "No hay evento esta semana" : "No pudimos confirmar la cartelera"}</strong><span>{initial.noUfcEvent ? "Marcado por un adulto de la familia." : admin ? "Podés cargarla a mano cuando tengas los datos." : "Un adulto puede cargarla a mano."}</span></div>}
    </>}
    <p className={styles.timeNote}>Horarios en Argentina (UTC−3). Los datos se cargan a mano.</p>
  </main>;
}

function Formations({ initial, eventId }: { initial: SportsPageData; eventId: string }) {
  const router = useRouter();
  const mine = initial.formations.find(item => item.memberId === initial.currentMemberId);
  const [body, setBody] = useState(mine?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(method: "PUT" | "DELETE") {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/sports/events/${eventId}/formation`, { method, headers: { "Content-Type": "application/json" }, ...(method === "PUT" ? { body: JSON.stringify({ body }) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo guardar la formación.");
      if (method === "DELETE") setBody("");
      setMessage(method === "DELETE" ? "Formación eliminada." : "Formación guardada.");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return <section className={styles.comments} aria-label="Formaciones deseadas"><h3>El once que queremos</h3>
    {initial.formations.length === 0 && <p className={styles.muted}>Todavía no hay formaciones. Compartí la tuya.</p>}
    <ul className={styles.commentList}>{initial.formations.map(item => <li className={styles.comment} key={item.id}><strong>{initial.members.find(member => member.id === item.memberId)?.name ?? "Integrante"}</strong><p className={styles.commentBody}>{item.body}</p></li>)}</ul>
    <form onSubmit={event => { event.preventDefault(); void submit("PUT"); }}><label>Mi formación deseada<textarea rows={4} value={body} maxLength={500} onChange={event => setBody(event.target.value)} required /></label><div className={styles.formFooter}><small>{Array.from(body).length}/500</small><div className={styles.actions}>{mine && <button type="button" className={styles.dangerText} disabled={busy} onClick={() => void submit("DELETE")}>Eliminar mi formación</button>}<button className={styles.primary} disabled={busy || !body.trim()}>{busy ? "Guardando…" : "Guardar formación"}</button></div></div></form>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}

function FootballForm({ event, busy, onCancel, onSave }: { event: SportsEvent | null; busy: boolean; onCancel: () => void; onSave: (payload: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ eventDate: event ? event.eventDate ?? "" : today(), startTime: localTime(event?.startsAt ?? null), firstParticipant: event?.firstParticipant ?? "River Plate", secondParticipant: event?.secondParticipant ?? "", competition: event?.competition ?? "", venue: event?.venue ?? "", channel: event?.channel ?? "", result: event?.result ?? "", status: event?.status ?? "scheduled" });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <form className={styles.form} onSubmit={(e) => { e.preventDefault(); onSave({ ...form, title: `${form.firstParticipant} vs ${form.secondParticipant}`, startTime: form.startTime || null, channel: form.channel || null, result: form.result || null }); }}>
    <div className={styles.formTitle}><h3>{event ? "Editar partido" : "Nuevo partido"}</h3><button type="button" className={styles.editButton} onClick={onCancel}>Cerrar</button></div>
    <div className={styles.formGrid}><label>Fecha (opcional)<input type="date" value={form.eventDate} onChange={(e) => { set("eventDate", e.target.value); if (!e.target.value) set("startTime", ""); }} /></label><label>Hora (opcional)<input type="time" value={form.startTime} disabled={!form.eventDate} onChange={(e) => set("startTime", e.target.value)} /></label><label>Equipo local<input value={form.firstParticipant} onChange={(e) => set("firstParticipant", e.target.value)} required /></label><label>Rival<input value={form.secondParticipant} onChange={(e) => set("secondParticipant", e.target.value)} required /></label><label>Competencia<input value={form.competition} onChange={(e) => set("competition", e.target.value)} placeholder="Liga Profesional" required /></label><label>Cancha<input value={form.venue} maxLength={200} onChange={(e) => set("venue", e.target.value)} placeholder="A confirmar" /></label><label>Canal o plataforma<input value={form.channel} onChange={(e) => set("channel", e.target.value)} placeholder="Opcional" /></label><label>Resultado<input value={form.result} onChange={(e) => set("result", e.target.value)} placeholder="Opcional" /></label><label>Estado<select value={form.status} onChange={(e) => set("status", e.target.value)}><option value="scheduled">Programado</option><option value="postponed">Postergado</option><option value="completed">Finalizado</option><option value="cancelled">Cancelado</option></select></label></div>
    <div className={styles.formFooter}><button type="button" className={styles.secondary} onClick={onCancel}>Cancelar</button><button className={styles.primary} disabled={busy}>{busy ? "Guardando…" : "Guardar partido"}</button></div>
  </form>;
}

function UfcForm({ card, fights, busy, onCancel, onSave }: { card: SportsEvent | null; fights: SportsFight[]; busy: boolean; onCancel: () => void; onSave: (payload: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState(card?.title ?? ""); const [eventDate, setEventDate] = useState(card?.eventDate ?? today());
  const [preliminaryTime, setPreliminaryTime] = useState(localTime(card?.preliminaryStartsAt ?? null)); const [mainCardTime, setMainCardTime] = useState(localTime(card?.mainCardStartsAt ?? null));
  const [preliminaryDate, setPreliminaryDate] = useState(localDate(card?.preliminaryStartsAt ?? null, card?.eventDate ?? today()));
  const [mainCardDate, setMainCardDate] = useState(localDate(card?.mainCardStartsAt ?? null, card?.eventDate ?? today()));
  const [rows, setRows] = useState<FightDraft[]>(fights.length ? fights.map(({ firstFighter, secondFighter, boutBlock, isMainEvent }) => ({ firstFighter, secondFighter, boutBlock: boutBlock === "preliminaries" ? "preliminaries" : "main", isMainEvent })) : [{ firstFighter: "", secondFighter: "", boutBlock: "main", isMainEvent: true }]);
  function change(index: number, key: keyof FightDraft, value: string | boolean) { setRows((list) => list.map((row, position) => position === index ? { ...row, [key]: value } : row)); }
  return <form className={styles.form} onSubmit={(e) => { e.preventDefault(); onSave({ title, eventDate, preliminaryDate, mainCardDate, preliminaryTime: preliminaryTime || null, mainCardTime: mainCardTime || null, fights: rows.map((row) => ({ ...row, boutBlock: row.boutBlock })) }); }}>
    <div className={styles.formTitle}><h3>{card ? "Editar cartelera vigente" : "Nueva cartelera"}</h3><button type="button" className={styles.editButton} onClick={onCancel}>Cerrar</button></div>
    <div className={styles.formGrid}><label>Evento<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="UFC Fight Night" required /></label><label>Fecha oficial<input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required /></label><label>Fecha argentina de preliminares<input type="date" value={preliminaryDate} onChange={(e) => setPreliminaryDate(e.target.value)} required={!!preliminaryTime} /></label><label>Hora de preliminares<input type="time" value={preliminaryTime} onChange={(e) => setPreliminaryTime(e.target.value)} /></label><label>Fecha argentina de cartelera principal<input type="date" value={mainCardDate} onChange={(e) => setMainCardDate(e.target.value)} required={!!mainCardTime} /></label><label>Hora de cartelera principal<input type="time" value={mainCardTime} onChange={(e) => setMainCardTime(e.target.value)} /></label></div>
    <p className={styles.muted}>La fecha oficial es la del evento en su sede. Cada bloque lleva su fecha y hora de Argentina, aunque acá empiece al día siguiente.</p>
    <div className={styles.formTitle}><h4>Peleas</h4><button type="button" className={styles.secondary} onClick={() => setRows((list) => [...list, { firstFighter: "", secondFighter: "", boutBlock: "main", isMainEvent: false }])}>＋ Agregar pelea</button></div>
    {rows.map((row, index) => <div className={styles.fightEditor} key={index}><span className={styles.fightNumber}>Pelea {index + 1}</span><label>Primer peleador<input value={row.firstFighter} onChange={(e) => change(index, "firstFighter", e.target.value)} required /></label><label>Segundo peleador<input value={row.secondFighter} onChange={(e) => change(index, "secondFighter", e.target.value)} required /></label><label>Bloque<select value={row.boutBlock} onChange={(e) => change(index, "boutBlock", e.target.value)}><option value="preliminaries">Preliminares</option><option value="main">Principal</option></select></label><label className={styles.checkLabel}><input type="checkbox" checked={row.isMainEvent} onChange={(e) => change(index, "isMainEvent", e.target.checked)} /> Pelea estelar</label>{rows.length > 1 && <button type="button" className={styles.dangerText} onClick={() => setRows((list) => list.filter((_, position) => position !== index))}>Quitar pelea</button>}</div>)}
    <p className={styles.muted}>Marcá una sola pelea como estelar. Los horarios que no conozcas pueden quedar vacíos.</p>
    <div className={styles.formFooter}><button type="button" className={styles.secondary} onClick={onCancel}>Cancelar</button><button className={styles.primary} disabled={busy}>{busy ? "Guardando…" : card ? "Guardar cartelera" : "Publicar cartelera"}</button></div>
  </form>;
}
