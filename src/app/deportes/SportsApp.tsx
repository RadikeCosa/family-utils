"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SportsEvent, SportsPageData } from "@/lib/sports/types";
import { formatSportsDate, formatSportsTime, sportsNowDay } from "@/lib/sports/rules";
import Comments from "./Comments";
import styles from "./sports.module.css";

function provenance(event:SportsEvent|null){if(!event?.sourceProvider)return "Carga anterior";const source=event.sourceProvider==="ufc_official"?"UFC oficial":"Liga Profesional / ESPN";const checkedAt=event.automaticData?.checkedAt;const checkedLabel=typeof checkedAt==="string"?new Intl.DateTimeFormat("es-AR",{dateStyle:"medium",timeZone:"America/Argentina/Buenos_Aires"}).format(new Date(checkedAt)):"fecha no disponible";return `Curado en chat · ${source} · revisado ${checkedLabel}${event.manualOverrides?.length||event.manualFights?" · conserva correcciones":""}`;}
const blockTime = (value: string | Date | null) => value ? `${formatSportsDate(sportsNowDay(new Date(value)))} · ${formatSportsTime(value)}` : "A confirmar";

export default function SportsApp({ initial }: { initial: SportsPageData }) {
  const router = useRouter();
  const [tab, setTab] = useState<"football" | "ufc">("football");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bundleText, setBundleText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importPreview, setImportPreview] = useState<{ summary: { riverMatches: number; ufcCards: number; ufcFights: number; through: { river: string; ufc: string } }; warnings: string[] } | null>(null);
  const admin = initial.role === "administrator";
  const match = initial.football[0] ?? null;

  async function save(path: string, method: string, payload: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo guardar.");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  const hide = (event: SportsEvent) => {
    if (window.confirm("¿Ocultar este evento? Conservaremos sus comentarios y formaciones.")) {
      void save(`/api/sports/events/${event.id}`, "PATCH", { action: "hide" });
    }
  };

  async function importBundle(mode: "preview" | "import") {
    setImportBusy(true); setImportError(""); setImportMessage("");
    try {
      const bundle = JSON.parse(bundleText) as unknown;
      const response = await fetch("/api/sports/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, bundle }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo validar el archivo.");
      if (mode === "preview") setImportPreview({ summary: data.summary, warnings: data.warnings ?? [] });
      else { setImportPreview(null); setBundleText(""); setImportMessage(`Importación lista: ${data.summary.riverMatches} partidos, ${data.summary.ufcCards} carteleras y ${data.summary.ufcFights} peleas.`); router.refresh(); }
    } catch (reason) {
      setImportPreview(null);
      setImportError(reason instanceof Error ? reason.message : "No se pudo validar el archivo.");
    } finally { setImportBusy(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.back}>‹ Inicio</Link><span className={styles.brand}>Deportes</span><span className={styles.role}>{admin ? "Administración" : "Familia"}</span></header>
    <section className={styles.intro}><p className={styles.eyebrow}>EN EQUIPO</p><h1>Deportes</h1><p>River, UFC y las conversaciones de casa.</p></section>
    {admin && <details className={styles.importPanel}><summary>Importar datos curados desde el chat</summary><p>Pegá el JSON revisado que te entregue el chat. Primero se valida sin escribir datos; la importación conserva comentarios, formaciones y eventos ocultos.</p><label>Archivo JSON<input type="file" accept="application/json,.json" onChange={async event => { const file = event.currentTarget.files?.[0]; if (file) { setBundleText(await file.text()); setImportPreview(null); setImportError(""); } }} /></label><label>Contenido JSON<textarea rows={8} value={bundleText} onChange={event => { setBundleText(event.target.value); setImportPreview(null); setImportError(""); }} placeholder="Pegá acá el JSON curado" /></label><div className={styles.actions}><button type="button" className={styles.secondary} disabled={importBusy || !bundleText.trim()} onClick={() => void importBundle("preview")}>{importBusy ? "Validando…" : "Validar JSON"}</button>{importPreview && <button type="button" className={styles.primary} disabled={importBusy} onClick={() => void importBundle("import")}>{importBusy ? "Importando…" : "Confirmar importación"}</button>}</div>{importPreview && <div className={styles.importPreview} role="status"><strong>{importPreview.summary.riverMatches} partidos · {importPreview.summary.ufcCards} carteleras · {importPreview.summary.ufcFights} peleas</strong><span>Horizonte: River hasta {formatSportsDate(importPreview.summary.through.river)}; UFC hasta {formatSportsDate(importPreview.summary.through.ufc)}.</span>{importPreview.warnings.map(warning => <small key={warning}>{warning}</small>)}</div>}{importMessage && <p role="status">{importMessage}</p>}{importError && <p role="alert" className={styles.error}>{importError}</p>}</details>}
    <nav className={styles.tabs} aria-label="Deportes">
      <button type="button" aria-pressed={tab === "football"} className={tab === "football" ? styles.activeTab : ""} onClick={() => setTab("football")}>River</button>
      <button type="button" aria-pressed={tab === "ufc"} className={tab === "ufc" ? styles.activeTab : ""} onClick={() => setTab("ufc")}>UFC</button>
    </nav>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {tab === "football" ? <>
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>EL MILLONARIO</p><h2>Próximo partido de River</h2></div></div>
      {match ? <>
        <article className={`${styles.eventCard} ${styles.riverCard}`}>
          <div className={styles.eventTime}>{formatSportsTime(match.startsAt)}</div>
          <div className={styles.eventDetails}><p className={styles.competition}>{match.competition}</p><h3>{match.firstParticipant} <span>vs</span> {match.secondParticipant}</h3><p>{formatSportsDate(match.eventDate)}</p><p className={styles.eventMeta}>Cancha: {match.venue ?? "A confirmar"}</p><p className={styles.eventMeta}>{match.status === "postponed" ? "Postergado" : match.status === "completed" ? "Finalizado" : "Programado"}{match.result ? ` · ${match.result}` : ""}{match.channel ? ` · ${match.channel}` : ""}</p><p className={styles.muted}>{provenance(match)}</p></div>
          {admin && <div className={styles.actions}><button disabled={busy} className={styles.dangerText} onClick={() => hide(match)}>Ocultar partido</button></div>}
        </article>
        <Formations key={match.id} initial={initial} eventId={match.id} />
        <Comments key={match.id} contextKind="river_match" eventId={match.id} members={initial.members} currentMemberId={initial.currentMemberId} isAdmin={admin} />
      </> : <div className={styles.empty}><strong>No hay un próximo partido de River importado.</strong><span>{admin ? "Pegá el JSON curado en el importador para incorporarlo." : "Todavía no hay un próximo encuentro cargado."}</span></div>}
    </> : <>
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>SEMANA DEL {formatSportsDate(initial.week.start)}</p><h2>UFC de esta semana</h2></div></div>
      {admin && <div className={styles.actions}><button type="button" disabled={busy} className={styles.secondary} onClick={() => void save("/api/sports/week", "PUT", { noUfcEvent: !initial.noUfcEvent })}>{initial.noUfcEvent ? "Quitar marca de semana sin evento" : "Sin evento esta semana"}</button></div>}
      {initial.card ? <>
        <article className={styles.cardPanel}><p className={styles.competition}>FECHA OFICIAL · {formatSportsDate(initial.card.eventDate)}</p><h3>{initial.card.title}</h3><div className={styles.schedule}>{initial.card.earlyPreliminariesStartsAt && <p><strong>Preliminares tempranas</strong><span>{blockTime(initial.card.earlyPreliminariesStartsAt)}</span></p>}<p><strong>Preliminares</strong><span>{blockTime(initial.card.preliminaryStartsAt)}</span></p><p><strong>Cartelera principal</strong><span>{blockTime(initial.card.mainCardStartsAt)}</span></p></div><p className={styles.muted}>{provenance(initial.card)}</p>
          <h4>Peleas</h4><ol className={styles.fights}>{initial.fights.map((fight) => <li key={fight.id} className={fight.isMainEvent ? styles.mainFight : ""}><span>{fight.firstFighter} <small>vs</small> {fight.secondFighter}</span><b>{fight.isMainEvent ? "Estelar · " : ""}{fight.boutBlock === "main" ? "Principal" : fight.boutBlock === "early_preliminaries" ? "Preliminares tempranas" : "Preliminares"}</b></li>)}</ol>
          {admin && <div className={styles.actions}><button disabled={busy} className={styles.dangerText} onClick={() => hide(initial.card!)}>Ocultar cartelera</button></div>}
        </article><Comments key={initial.card.id} contextKind="ufc_card" eventId={initial.card.id} members={initial.members} currentMemberId={initial.currentMemberId} isAdmin={admin} />
      </> : <div className={styles.empty}><strong>{initial.noUfcEvent ? "No hay evento esta semana" : "No hay una cartelera importada para esta semana"}</strong><span>{admin ? "Pegá el JSON curado en el importador para incorporarla." : "Los datos se actualizan desde un archivo curado."}</span></div>}
    </>}
    <p className={styles.timeNote}>Horarios en Argentina (UTC−3). Los datos se renuevan mediante archivos JSON curados.</p>
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
