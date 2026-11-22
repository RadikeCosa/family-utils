"use client";
import { useEffect, useRef, useState } from "react";
import type { EntryResponse } from "@/lib/training/diary-client";
import { blockDiaryText, createBlockRun, finishBlockRun, generateBlockPhases, INITIAL_BLOCK_CONFIG, pauseBlockRun, resumeBlockRun, tickBlockRun, validateBlockTimer, type BlockRun, type BlockSnapshot, type BlockTimerConfig } from "@/lib/training/block-timer";
import { hiitCivilDate } from "@/lib/training/hiit";
import { formatActivityDuration } from "@/lib/training/timing";
import DiaryEditor, { type DiaryEditorTarget } from "./DiaryEditor";
import styles from "./training.module.css";

type Props = { active: boolean; timeZone: string; today: string; writable: boolean; activityFormEnabled: boolean; onSaved: (entry: EntryResponse["item"]) => void; onUncertainChange: (uncertain: boolean) => void; onExit: () => void; onBusyChange: (busy: boolean) => void; onSwitchToHiit: () => void };
function formatClock(ms: number) { const seconds = Math.ceil(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function tone(context: AudioContext | null, kind: string) {
  if (!context || context.state !== "running") return;
  const oscillator = context.createOscillator(), gain = context.createGain(); oscillator.connect(gain); gain.connect(context.destination);
  oscillator.frequency.value = kind === "finish" ? 880 : kind === "rest" ? 440 : 660; gain.gain.value = .08;
  oscillator.start(); oscillator.stop(context.currentTime + (kind === "finish" ? .32 : .12));
}
export default function BlockTimer({ active, timeZone, today, writable, activityFormEnabled, onSaved, onUncertainChange, onExit, onBusyChange, onSwitchToHiit }: Props) {
  const [config, setConfig] = useState<BlockTimerConfig>(() => structuredClone(INITIAL_BLOCK_CONFIG));
  const [view, setView] = useState<"setup" | "run" | "summary">("setup"), [display, setDisplay] = useState<BlockSnapshot | null>(null);
  const [sound, setSound] = useState(true), [capability, setCapability] = useState(""), [editor, setEditor] = useState<DiaryEditorTarget | null>(null), [registered, setRegistered] = useState<{ id: string; date: string } | null>(null), [editorError, setEditorError] = useState("");
  const run = useRef<BlockRun | null>(null), timer = useRef<number | null>(null), audio = useRef<AudioContext | null>(null), wake = useRef<WakeLockSentinel | null>(null), soundRef = useRef(sound), summaryKey = useRef<string | null>(null), sessionDate = useRef<string | null>(null), opener = useRef<HTMLElement | null>(null), uncertain = useRef(false), title = useRef<HTMLHeadingElement>(null), latestPause = useRef<() => void>(() => {}), activeHref = useRef("");
  const errors = validateBlockTimer(config), globalErrors = errors.filter(error => error.field === "blocks" || (error.field === "rounds" && error.message.includes("cuatro horas"))), phases = generateBlockPhases(config), totalMs = phases.reduce((sum, phase) => sum + phase.durationMs, 0), inProgress = view === "run", unsavedSummary = view === "summary" && !registered;
  useEffect(() => { soundRef.current = sound; }, [sound]);
  useEffect(() => { if (view === "summary") title.current?.focus(); }, [view]);
  useEffect(() => { if (active) activeHref.current = location.href; }, [active]);
  useEffect(() => { onBusyChange(view !== "setup" || !!editor); }, [view, editor, onBusyChange]);
  useEffect(() => { if (!active && run.current && !registered) { stopTicker(); releaseWake(); run.current = null; setDisplay(null); setEditor(null); setView("setup"); summaryKey.current = null; sessionDate.current = null; } }, [active, registered]);
  function stopTicker() { if (timer.current !== null) window.clearInterval(timer.current); timer.current = null; }
  function releaseWake() { void wake.current?.release().catch(() => {}); wake.current = null; }
  function play(kind: string) { if (soundRef.current) tone(audio.current, kind); }
  async function acquireWake() {
    try { if (!("wakeLock" in navigator)) throw new Error(); wake.current = await navigator.wakeLock.request("screen"); setCapability(""); wake.current.addEventListener("release", () => { if (run.current && !run.current.paused) setCapability("La pantalla puede apagarse; el temporizador sigue visible."); }); }
    catch { setCapability("No se pudo mantener la pantalla encendida."); }
  }
  function complete(next: BlockSnapshot) { stopTicker(); releaseWake(); setDisplay(next); setView("summary"); summaryKey.current = crypto.randomUUID(); }
  function sample() {
    if (!run.current || run.current.paused) return;
    const next = tickBlockRun(run.current, performance.now(), Date.now());
    setDisplay(next);
    if (sessionDate.current === null && next.firstWorkAt !== null) sessionDate.current = hiitCivilDate(next.firstWorkAt, timeZone);
    next.sounds.forEach(play);
    if (next.complete) complete(next);
  }
  function start() {
    if (errors.length) return;
    const normalized = { ...config, blocks: config.blocks.map(block => ({ ...block, name: block.name.trim() })) };
    setConfig(normalized);
    sessionDate.current = null; summaryKey.current = null;
    try { run.current = createBlockRun(normalized, performance.now()); }
    catch (failure) { setEditorError((failure as Error).message); return; }
    setEditorError(""); setRegistered(null);
    const initial = tickBlockRun(run.current, performance.now(), Date.now()); setDisplay(initial); setView("run");
    const Audio = window.AudioContext;
    if (Audio) { audio.current ??= new Audio(); void audio.current.resume().then(() => initial.sounds.forEach(play)).catch(() => setCapability("El sonido no está disponible; podés seguir con la pantalla.")); }
    else setCapability("Este navegador no ofrece avisos sonoros.");
    void acquireWake(); timer.current = window.setInterval(sample, 100);
  }
  function pause() { if (!run.current) return; const next = pauseBlockRun(run.current, performance.now(), Date.now()); setDisplay(next); stopTicker(); releaseWake(); }
  latestPause.current = pause;
  async function resume() {
    if (!run.current) return;
    try { if (audio.current?.state === "suspended") await audio.current.resume(); } catch { setCapability("El sonido no está disponible; podés seguir con la pantalla."); }
    const next = resumeBlockRun(run.current, performance.now()); setDisplay(next); void acquireWake(); timer.current = window.setInterval(sample, 100);
  }
  function finishPartial() { if (!run.current) return; complete(finishBlockRun(run.current, performance.now(), Date.now())); }
  function discard() {
    if (!window.confirm("¿Descartar esta sesión? No se guardará en el diario.")) return;
    stopTicker(); releaseWake(); run.current = null; setDisplay(null); setEditor(null); setRegistered(null); summaryKey.current = null; sessionDate.current = null; setView("setup");
  }
  function switchToHiit() {
    if (uncertain.current) return;
    if (registered) { stopTicker(); releaseWake(); run.current = null; setDisplay(null); setEditor(null); setRegistered(null); summaryKey.current = null; sessionDate.current = null; setView("setup"); onSwitchToHiit(); return; }
    if ((run.current || editor || display) && !window.confirm("¿Descartar esta sesión y cambiar a HIIT? No se guardará en el diario.")) return;
    stopTicker(); releaseWake(); run.current = null; setDisplay(null); setEditor(null); setRegistered(null); summaryKey.current = null; sessionDate.current = null; setView("setup"); onSwitchToHiit();
  }
  function openDiary() {
    if (!run.current || !display || display.workMs < 1000 || !sessionDate.current || !summaryKey.current || !writable) return;
    opener.current = document.activeElement as HTMLElement;
    const text = blockDiaryText(run.current.config, display, seconds => formatActivityDuration(seconds));
    setEditor({ mode: "create", date: sessionDate.current, destination: "result", initialContent: { title: "Entrenamiento por bloques", text, durationSeconds: Math.floor((display.workMs + display.restMs) / 1000) }, operationKey: summaryKey.current });
  }
  function saved(entry: EntryResponse["item"]) { setRegistered({ id: entry.id, date: entry.date }); setEditor(null); setEditorError(""); onSaved(entry); }
  function uncertainChange(value: boolean) { uncertain.current = value; onUncertainChange(value); setEditorError(value ? "El guardado no se confirmó. Reintentá la misma operación antes de salir del formulario." : ""); }
  useEffect(() => () => { stopTicker(); releaseWake(); void audio.current?.close().catch(() => {}); }, []);
  useEffect(() => {
    if (!active || (!inProgress && !unsavedSummary)) return;
    const visibility = () => { if (document.visibilityState !== "visible" && run.current && !run.current.paused) latestPause.current(); };
    const back = (event: PopStateEvent) => {
      if (!run.current || registered) return;
      const destination = `${location.pathname}${location.search}${location.hash}`;
      event.stopImmediatePropagation(); history.pushState(history.state, "", activeHref.current || location.href); window.dispatchEvent(new Event("family-navigation"));
      if (uncertain.current) { setEditorError("El guardado no se confirmó. Reintentá la misma operación antes de salir."); return; }
      if (window.confirm("La sesión o su resumen todavía no se guardaron. ¿Salir y descartar el temporizador?")) { stopTicker(); releaseWake(); run.current = null; setDisplay(null); setEditor(null); setView("setup"); summaryKey.current = null; sessionDate.current = null; history.pushState(history.state, "", destination); window.dispatchEvent(new Event("family-navigation")); onExit(); }
    };
    const unload = (event: BeforeUnloadEvent) => { if (run.current && (!run.current.complete || unsavedSummary)) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("popstate", back, true); window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("popstate", back, true); window.removeEventListener("beforeunload", unload); };
  }, [active, inProgress, unsavedSummary, registered, onExit]);
  const completed = display?.phase ? `${display.phase.kind === "change" ? "Cambio" : display.phase.name} · vuelta ${display.phase.round} de ${config.rounds}` : "Sesión finalizada";

  return <div className={styles.blockTimer} data-testid="block-timer-screen">
    {editorError && <p role="alert" className={styles.error}>{editorError}</p>}
    {editor ? <DiaryEditor key={`blocks-${editor.operationKey}`} target={editor} today={today} activityFormEnabled={activityFormEnabled} onClose={() => { setEditor(null); requestAnimationFrame(() => opener.current?.focus()); }} onSaved={saved} onUncertainChange={uncertainChange} /> : view === "setup" ? <form aria-label="Configuración del circuito" aria-describedby={globalErrors.length ? "block-global-errors" : undefined} onSubmit={event => { event.preventDefault(); start(); }}>
      <h3>Por bloques</h3>
      <p className={styles.notice}>Armá tu circuito. Los nombres pueden repetirse; el cambio se inserta entre los bloques que se ejecuten.</p>
      <div className={styles.actions}><button type="button" onClick={() => setConfig(value => ({ ...value, blocks: [...value.blocks, { name: `Ejercicio ${value.blocks.length + 1}`, kind: "work", durationSeconds: 60 }] }))} disabled={config.blocks.length >= 50}>Agregar bloque</button></div>
      <div className={styles.blockList}>
        {config.blocks.map((block, index) => {
          const nameError = errors.find(error => error.field === `block-${index}-name`), durationError = errors.find(error => error.field === `block-${index}-duration`);
          const minutes = Math.floor(block.durationSeconds / 60), seconds = block.durationSeconds % 60;
          return <fieldset className={styles.blockTimerItem} key={index}><legend>Bloque {index + 1}</legend>
            <label>Nombre<input id={`block-name-${index}`} maxLength={80} value={block.name} aria-invalid={!!nameError} aria-describedby={nameError ? `block-name-error-${index}` : undefined} onChange={event => setConfig(value => ({ ...value, blocks: value.blocks.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} /></label>
            {nameError && <p className={styles.fieldError} id={`block-name-error-${index}`}>{nameError.message}</p>}
            <div className={styles.row}>
              <label>Tipo<select value={block.kind} onChange={event => setConfig(value => ({ ...value, blocks: value.blocks.map((item, itemIndex) => itemIndex === index ? { ...item, kind: event.target.value as "work" | "rest" } : item) }))}><option value="work">Trabajo</option><option value="rest">Descanso</option></select></label>
              <label>Minutos<input type="number" min={0} max={60} step={1} value={minutes} aria-label={`Minutos del bloque ${index + 1}`} aria-invalid={!!durationError} aria-describedby={durationError ? `block-duration-error-${index}` : undefined} onChange={event => { const newMinutes = event.target.value === "" ? 0 : Number(event.target.value); setConfig(value => ({ ...value, blocks: value.blocks.map((item, itemIndex) => itemIndex === index ? { ...item, durationSeconds: newMinutes * 60 + seconds } : item) })); }} /></label>
              <label>Segundos<input type="number" min={0} max={59} step={1} value={seconds} aria-label={`Segundos del bloque ${index + 1}`} aria-invalid={!!durationError} aria-describedby={durationError ? `block-duration-error-${index}` : undefined} onChange={event => { const newSeconds = event.target.value === "" ? 0 : Number(event.target.value); setConfig(value => ({ ...value, blocks: value.blocks.map((item, itemIndex) => itemIndex === index ? { ...item, durationSeconds: minutes * 60 + newSeconds } : item) })); }} /></label>
            </div>
            {durationError && <p className={styles.fieldError} id={`block-duration-error-${index}`}>{durationError.message}</p>}
            <div className={styles.actions}><button type="button" aria-label={`Subir bloque ${index + 1}`} disabled={index === 0} onClick={() => setConfig(value => { const blocks = [...value.blocks]; [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]]; return { ...value, blocks }; })}>Subir</button><button type="button" aria-label={`Bajar bloque ${index + 1}`} disabled={index === config.blocks.length - 1} onClick={() => setConfig(value => { const blocks = [...value.blocks]; [blocks[index + 1], blocks[index]] = [blocks[index], blocks[index + 1]]; return { ...value, blocks }; })}>Bajar</button><button type="button" disabled={config.blocks.length <= 1} onClick={() => setConfig(value => ({ ...value, blocks: value.blocks.filter((_, itemIndex) => itemIndex !== index) }))}>Eliminar</button></div>
          </fieldset>;
        })}
      </div>
      {globalErrors.length > 0 && <div className={styles.error} id="block-global-errors" role="alert"><p>Revisá la configuración del circuito:</p><ul>{globalErrors.map(error => <li key={error.message}>{error.message}</li>)}</ul></div>}
      <div className={styles.row}>
        <label>Vueltas<input type="number" min={1} max={100} step={1} value={config.rounds} aria-invalid={errors.some(error => error.field === "rounds")} aria-describedby={errors.some(error => error.field === "rounds") ? "rounds-error" : undefined} onChange={event => setConfig(value => ({ ...value, rounds: event.target.value === "" ? 0 : Number(event.target.value) }))} /></label>
        <label>Cambio (segundos)<input type="number" min={0} max={60} step={1} value={config.changeSeconds} aria-invalid={errors.some(error => error.field === "changeSeconds")} aria-describedby={errors.some(error => error.field === "changeSeconds") ? "change-error" : undefined} onChange={event => setConfig(value => ({ ...value, changeSeconds: event.target.value === "" ? -1 : Number(event.target.value) }))} /></label>
      </div>
      {errors.find(error => error.field === "rounds") && <p className={styles.fieldError} id="rounds-error">{errors.find(error => error.field === "rounds")?.message}</p>}
      {errors.find(error => error.field === "changeSeconds") && <p className={styles.fieldError} id="change-error">{errors.find(error => error.field === "changeSeconds")?.message}</p>}
      {config.blocks.at(-1)?.kind === "rest" ? <label className={styles.nextDay}><input type="checkbox" checked={config.omitFinalRest} onChange={event => setConfig(value => ({ ...value, omitFinalRest: event.target.checked }))} /> Omitir el último descanso al finalizar el circuito</label> : <p className={styles.muted}>La opción de omitir el último descanso no aplica porque el circuito termina con trabajo.</p>}
      {errors.filter(error => !error.field.startsWith("block-") && error.field !== "rounds" && error.field !== "changeSeconds").map(error => <p className={styles.error} role="alert" key={error.message}>{error.message}</p>)}
      <p className={styles.notice}>Duración prevista: {formatClock(totalMs)}</p>
      <label className={styles.nextDay}><input type="checkbox" checked={sound} onChange={event => setSound(event.target.checked)} /> Avisos sonoros</label>
      {sound && <button type="button" onClick={() => { const Audio = window.AudioContext; if (Audio) { audio.current ??= new Audio(); void audio.current.resume().then(() => tone(audio.current, "start")); } }}>Probar sonido</button>}
      <button type="submit" className={styles.primary} disabled={errors.length > 0}>Iniciar circuito</button>
    </form> : view === "run" && display ? <div className={`${styles.hiitRun} ${display.phase?.kind === "work" ? styles["hiit-work"] : display.phase?.kind === "rest" ? styles["hiit-rest"] : styles["hiit-preparation"]}`}>
      <p className={styles.eyebrow}>{display.phase?.kind === "change" ? "Cambio" : display.phase?.kind === "rest" ? "Descanso" : display.phase?.name ?? "Finalizado"}</p>
      <p className={styles.hiitClock} aria-live="off">{formatClock(display.remainingMs)}</p>
      <p className={styles.hiitRound}>{display.phase ? `Vuelta ${display.phase.round} de ${config.rounds}` : "Finalizado"}</p>
      <p role="status" aria-live="polite">{display.paused ? "Pausado · " : ""}{completed}{display.phase?.kind === "change" ? ` · sigue ${display.phase.nextName}` : display.phase?.nextName ? ` · después: ${display.phase.nextName}` : " · fin de sesión"}</p>
      <progress max={display.totalMs} value={display.elapsedMs} aria-label="Progreso del circuito" />
      <p>Trabajo: {formatActivityDuration(Math.floor(display.workMs / 1000))} · descanso: {formatActivityDuration(Math.floor(display.restMs / 1000))}</p>
      {capability && <p className={styles.muted}>{capability}</p>}
      <div className={styles.actions}>{display.paused ? <><button type="button" className={styles.primary} onClick={() => void resume()}>Reanudar</button><button type="button" onClick={finishPartial}>Terminar y revisar</button></> : <><button type="button" className={styles.primary} onClick={pause}>Pausar</button><button type="button" onClick={finishPartial}>Terminar y revisar</button></>}<button type="button" aria-pressed={sound} onClick={() => setSound(value => !value)}>{sound ? "Silenciar avisos" : "Activar avisos"}</button><button type="button" onClick={discard}>Descartar</button><button type="button" onClick={switchToHiit} disabled={uncertain.current}>Descartar y cambiar a HIIT</button></div>
    </div> : display ? <div className={styles.card}>
      <h3 tabIndex={-1} ref={title}>{display.complete ? "Circuito completo" : "Circuito parcial"}</h3>
      <p>{display.complete ? `${config.rounds} de ${config.rounds} vueltas completadas.` : `${Math.max(0, (display.phase?.round ?? 1) - 1)} de ${config.rounds} vueltas completadas. ${display.phase?.kind === "change" ? "Cambio" : display.phase?.name ?? "Sesión finalizada"}.`}</p>
      <p>Tiempo para el diario: {formatActivityDuration(Math.floor((display.workMs + display.restMs) / 1000))}</p>
      <p>Trabajo ejecutado: {formatActivityDuration(Math.floor(display.workMs / 1000))} · descansos: {formatActivityDuration(Math.floor(display.restMs / 1000))}</p>
      <p>Cambios: {formatActivityDuration(Math.floor(display.changeMs / 1000))} · pausas: {formatActivityDuration(Math.floor(display.pausedMs / 1000))}</p>
      {!writable && <p className={styles.notice}>Modo de consulta: podés revisar el resumen, pero no registrar en el diario.</p>}
      {display.workMs < 1000 && <p className={styles.muted}>Completá al menos un segundo de trabajo para registrar la sesión.</p>}
      {registered ? <><p role="status">Sesión registrada en el diario. <a href={`/entrenamiento?${new URLSearchParams({ fecha: registered.date, detalle: registered.id })}`}>Ver en mi diario</a> <button type="button" onClick={() => { setView("setup"); setRegistered(null); setDisplay(null); run.current = null; }}>Cerrar</button></p><button type="button" onClick={switchToHiit}>Cambiar a HIIT</button></> : <div className={styles.actions}><button type="button" className={styles.primary} disabled={!writable || display.workMs < 1000} onClick={openDiary}>Registrar en mi diario</button><button type="button" onClick={start}>Repetir</button><button type="button" onClick={() => { if (!uncertain.current && window.confirm("¿Cerrar el resumen? La sesión sin registrar se descartará.")) { setView("setup"); setDisplay(null); run.current = null; summaryKey.current = null; sessionDate.current = null; } }}>Cerrar</button><button type="button" onClick={switchToHiit} disabled={uncertain.current}>Descartar y cambiar a HIIT</button></div>}
    </div> : null}
  </div>;
}
