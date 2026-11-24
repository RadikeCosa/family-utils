"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EntryResponse } from "@/lib/training/diary-client";
import { finishBlockRun, pauseBlockRun, resumeBlockRun, tickBlockRun, type BlockRun, type BlockSnapshot } from "@/lib/training/block-timer";
import { createStrengthRun, generateStrengthPhases, INITIAL_STRENGTH_CONFIG, STRENGTH_FIELDS, strengthBreakdown, strengthDiaryText, strengthDurations, validateStrengthConfig, type StrengthConfig } from "@/lib/training/strength-timer";
import { hiitCivilDate } from "@/lib/training/hiit";
import { formatActivityDuration } from "@/lib/training/timing";
import DiaryEditor, { type DiaryEditorTarget } from "./DiaryEditor";
import styles from "./training.module.css";

type Props = { active: boolean; timeZone: string; today: string; writable: boolean; activityFormEnabled: boolean; onSaved: (entry: EntryResponse["item"]) => void; onUncertainChange: (uncertain: boolean) => void; onExit: () => void; onSwitchToHiit: () => void };
function formatClock(ms: number) { const seconds = Math.ceil(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function tone(context: AudioContext | null, kind: string) {
  if (!context || context.state !== "running") return;
  const oscillator = context.createOscillator(), gain = context.createGain(); oscillator.connect(gain); gain.connect(context.destination);
  oscillator.frequency.value = kind === "finish" ? 880 : kind === "rest" ? 440 : 660; gain.gain.value = .08;
  oscillator.start(); oscillator.stop(context.currentTime + (kind === "finish" ? .32 : .12));
}
export default function StrengthTimer({ active, timeZone, today, writable, activityFormEnabled, onSaved, onUncertainChange, onExit, onSwitchToHiit }: Props) {
  const [config, setConfig] = useState<StrengthConfig>(() => structuredClone(INITIAL_STRENGTH_CONFIG));
  const [view, setView] = useState<"setup" | "run" | "summary">("setup"), [display, setDisplay] = useState<BlockSnapshot | null>(null);
  const [sound, setSound] = useState(true), [capability, setCapability] = useState(""), [editor, setEditor] = useState<DiaryEditorTarget | null>(null), [registered, setRegistered] = useState<{ id: string; date: string } | null>(null), [editorError, setEditorError] = useState("");
  const control = useRef<HTMLButtonElement>(null);
  const run = useRef<BlockRun | null>(null), timer = useRef<number | null>(null), audio = useRef<AudioContext | null>(null), wake = useRef<WakeLockSentinel | null>(null), soundRef = useRef(sound), summaryKey = useRef<string | null>(null), sessionDate = useRef<string | null>(null), opener = useRef<HTMLElement | null>(null), uncertain = useRef(false), title = useRef<HTMLHeadingElement>(null), latestPause = useRef<() => void>(() => {}), activeHref = useRef("");
  const errors = validateStrengthConfig(config), phases = useMemo(() => generateStrengthPhases(config), [config]), durations = strengthDurations(config), totalMs = durations.total * 1000, inProgress = view === "run", unsavedSummary = view === "summary" && !registered;
  const breakdown = display && run.current ? strengthBreakdown(run.current.phases, display.elapsedMs) : { warmupMs: 0, exerciseMs: 0 };
  useEffect(() => { soundRef.current = sound; }, [sound]);
  useEffect(() => { if (view === "run") control.current?.focus(); }, [view, display?.paused]);
  useEffect(() => { if (view === "summary") title.current?.focus(); }, [view]);
  useEffect(() => { if (active) activeHref.current = location.href; }, [active]);
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
    const normalized = structuredClone(config);
    setConfig(normalized);
    sessionDate.current = null; summaryKey.current = null;
    try { run.current = createStrengthRun(normalized, performance.now()); }
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
    const text = strengthDiaryText(config, run.current.phases, display, seconds => formatActivityDuration(seconds));
    setEditor({ mode: "create", date: sessionDate.current, destination: "result", initialContent: { title: "Entrenamiento de fuerza", text, durationSeconds: Math.floor((display.workMs + display.restMs) / 1000) }, operationKey: summaryKey.current });
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
  if (!active) return null;
  const completed = display?.phase ? `${display.phase.kind === "change" ? "Cambio" : display.phase.name} · ${display.phase.round === 0 ? "Entrada en calor" : `vuelta ${display.phase.round} de ${config.rounds}`}` : "Sesión finalizada";

  return <div className={`${styles.blockTimer} ${styles.strengthTimer} ${view === "run" ? styles.hiit : ""}`} data-testid="strength-timer-screen" data-focus-mode={view === "run" ? "true" : undefined}>
    {editorError && <p role="alert" className={styles.error}>{editorError}</p>}
    {editor ? <DiaryEditor key={`strength-${editor.operationKey}`} target={editor} today={today} activityFormEnabled={activityFormEnabled} onClose={() => { setEditor(null); requestAnimationFrame(() => opener.current?.focus()); }} onSaved={saved} onUncertainChange={uncertainChange} /> : view === "setup" ? <form aria-label="Configuración de Fuerza"  onSubmit={event => { event.preventDefault(); start(); }}>
      <h3>Fuerza</h3>
      <div className={styles.actions}><button type="button" onClick={onSwitchToHiit}>Volver a temporizadores</button></div>
      <p className={styles.notice}>Entrada en calor una vez. Cada movimiento: derecho y luego izquierdo. Abdominales usa la duración por lado una sola vez por vuelta.</p>
      <div className={styles.hiitGrid}>{STRENGTH_FIELDS.map(field => {
        const error = errors.find(item => item.field === field.key);
        return <label key={field.key}>{field.label}<input type="number" aria-label={field.label} inputMode="numeric" min={field.min} max={field.max} step={1} value={Number.isNaN(config[field.key]) ? "" : config[field.key]} aria-invalid={!!error} aria-describedby={error ? `strength-${field.key}-error` : undefined} onChange={event => setConfig(value => ({ ...value, [field.key]: event.target.value === "" ? NaN : Number(event.target.value) }))} />
          {error && <span id={`strength-${field.key}-error`} className={styles.fieldError}>{error.message}</span>}</label>;
      })}</div>
      {errors.some(error => error.field === "total") && <p role="alert" className={styles.error}>{errors.find(error => error.field === "total")?.message}</p>}
      <section aria-label="Vista previa de Fuerza">
        <p className={styles.notice}>Duración prevista: {Number.isFinite(totalMs) ? formatClock(totalMs) : "Revisá los tiempos"}</p>
        {phases.length > 0 && <>
          <p>Calentamiento y transición al circuito: {formatClock(durations.warmup * 1000)}</p>
          <ul>{Array.from({ length: config.rounds }, (_, index) => <li key={index}>Vuelta {index + 1}: {formatClock(durations.round * 1000)}{index < config.rounds - 1 && config.restSeconds > 0 ? ` · descanso posterior: ${formatClock(config.restSeconds * 1000)}` : ""}</li>)}</ul>
          <details><summary>Ver circuito de una vuelta</summary><ol>{phases.filter(phase => phase.round === 1 && phase.kind !== "rest").map((phase, index) => <li key={index}>{phase.kind === "change" ? `Cambio → ${phase.nextName}` : phase.name}: {formatClock(phase.durationMs)}</li>)}</ol></details>
        </>}
      </section>
      <label className={styles.nextDay}><input type="checkbox" checked={sound} onChange={event => setSound(event.target.checked)} /> Avisos sonoros</label>
      {sound && <button type="button" onClick={() => { const Audio = window.AudioContext; if (Audio) { audio.current ??= new Audio(); void audio.current.resume().then(() => tone(audio.current, "start")); } }}>Probar sonido</button>}
      <button type="submit" className={styles.primary} disabled={errors.length > 0}>Iniciar fuerza</button>
    </form> : view === "run" && display ? <div className={`${styles.hiitRun} ${display.phase?.kind === "work" ? styles["hiit-work"] : display.phase?.kind === "rest" ? styles["hiit-rest"] : styles["hiit-preparation"]}`}>
      <p className={styles.hiitStage}>{display.phase?.kind === "change" ? "CAMBIO" : display.phase?.kind === "rest" ? "Descanso" : display.phase?.name ?? "Finalizado"}</p>
      {display.phase?.kind === "change" && <p className={styles.hiitStage}>Preparate: {display.phase.nextName}</p>}
      {display.phase?.kind !== "change" && <p className={styles.hiitClock} aria-live="off">{formatClock(display.remainingMs)}</p>}
      <p className={styles.hiitRound}>{display.phase?.round === 0 ? "Entrada en calor" : display.phase?.kind === "rest" ? `Descanso · sigue vuelta ${display.phase.round + 1} de ${config.rounds}` : display.phase ? `Vuelta ${display.phase.round} de ${config.rounds}` : "Finalizado"}</p>
      <p className={styles.hiitAnnouncement} role="status" aria-live="polite" aria-atomic="true">{display.paused ? "Pausado · " : ""}{completed}{display.phase?.kind === "change" ? ` · sigue ${display.phase.nextName}` : display.phase?.nextName ? ` · después: ${display.phase.nextName}` : " · fin de sesión"}</p>
      <progress max={display.totalMs} value={display.elapsedMs} aria-label="Progreso del circuito" />
      <p>Trabajo: {formatActivityDuration(Math.floor(display.workMs / 1000))} · descanso: {formatActivityDuration(Math.floor(display.restMs / 1000))}</p>
      {capability && <p className={styles.muted}>{capability}</p>}
      <div className={styles.hiitControls}>{display.paused ? <><button ref={control} type="button" className={styles.primary} onClick={() => void resume()}>Reanudar</button><button type="button" onClick={finishPartial}>Terminar y revisar</button></> : <><button ref={control} type="button" className={styles.primary} onClick={pause}>Pausar</button><button type="button" onClick={finishPartial}>Terminar y revisar</button></>}<button type="button" aria-pressed={sound} onClick={() => setSound(value => !value)}>{sound ? "Silenciar avisos" : "Activar avisos"}</button><button type="button" onClick={discard}>Descartar</button><button type="button" onClick={switchToHiit} disabled={uncertain.current}>Descartar y volver a temporizadores</button></div>
    </div> : display ? <div className={styles.card}>
      <h3 tabIndex={-1} ref={title}>{display.complete ? "Fuerza completa" : "Fuerza parcial"}</h3>
      <p>{display.complete ? `${config.rounds} de ${config.rounds} vueltas completadas.` : `${Math.max(0, (display.phase?.round ?? 1) - (display.phase?.kind === "rest" ? 0 : 1))} de ${config.rounds} vueltas completadas. ${display.phase?.kind === "change" ? "Cambio" : display.phase?.name ?? "Sesión finalizada"}.`}</p>
      <p>Tiempo para el diario: {formatActivityDuration(Math.floor((display.workMs + display.restMs) / 1000))}</p>
      <p>Calentamiento: {formatActivityDuration(Math.floor(breakdown.warmupMs / 1000))} · ejercicios: {formatActivityDuration(Math.floor(breakdown.exerciseMs / 1000))} · descansos: {formatActivityDuration(Math.floor(display.restMs / 1000))}</p>
      <p>El tiempo registrado incluye calentamiento, ejercicios y descansos entre vueltas. Excluye cambios y pausas; también las transiciones del calentamiento.</p>
      <p>Cambios: {formatActivityDuration(Math.floor(display.changeMs / 1000))} · pausas: {formatActivityDuration(Math.floor(display.pausedMs / 1000))}</p>
      {!writable && <p className={styles.notice}>Modo de consulta: podés revisar el resumen, pero no registrar en el diario.</p>}
      {display.workMs < 1000 && <p className={styles.muted}>Completá al menos un segundo de trabajo para registrar la sesión.</p>}
      {registered ? <><p role="status">Sesión registrada en el diario. <a href={`/entrenamiento?${new URLSearchParams({ fecha: registered.date, detalle: registered.id })}`}>Ver en mi diario</a> <button type="button" onClick={() => { setView("setup"); setRegistered(null); setDisplay(null); run.current = null; }}>Cerrar</button></p><button type="button" onClick={switchToHiit}>Volver a temporizadores</button></> : <div className={styles.actions}><button type="button" className={styles.primary} disabled={!writable || display.workMs < 1000} onClick={openDiary}>Registrar en mi diario</button><button type="button" onClick={start}>Repetir</button><button type="button" onClick={() => { if (!uncertain.current && window.confirm("¿Cerrar el resumen? La sesión sin registrar se descartará.")) { setView("setup"); setDisplay(null); run.current = null; summaryKey.current = null; sessionDate.current = null; } }}>Cerrar</button><button type="button" onClick={switchToHiit} disabled={uncertain.current}>Descartar y volver a temporizadores</button></div>}
    </div> : null}
  </div>;
}
