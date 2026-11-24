"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EntryResponse } from "@/lib/training/diary-client";
import { createHiitRun, finishHiit, HIIT_PRESETS, hiitCanRegister, hiitCivilDate, hiitTotalMs, pauseHiit, resumeHiit, tickHiit, validateHiitConfig, type HiitConfig, type HiitRun, type HiitSnapshot } from "@/lib/training/hiit";
import { formatActivityDuration } from "@/lib/training/timing";
import DiaryEditor, { type DiaryEditorTarget } from "./DiaryEditor";
import styles from "./training.module.css";

const INITIAL: HiitConfig = { preparationSeconds: 10, workSeconds: 20, restSeconds: 10, rounds: 8 };
type Props = { active: boolean; timeZone: string; today: string; writable: boolean; activityFormEnabled: boolean; onSaved: (entry: EntryResponse["item"]) => void; onUncertainChange: (uncertain: boolean) => void; onSelectBlocks: () => void };
function formatClock(ms: number) { const seconds = Math.ceil(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function tone(context: AudioContext | null, kind: string) {
  if (!context || context.state !== "running") return;
  const oscillator = context.createOscillator(), gain = context.createGain(); oscillator.connect(gain); gain.connect(context.destination);
  oscillator.frequency.value = kind === "finish" ? 880 : kind === "rest" ? 440 : 660; gain.gain.value = .08;
  oscillator.start(); oscillator.stop(context.currentTime + (kind === "finish" ? .32 : .12));
}
export default function HiitTimer({ active, timeZone, today, writable, activityFormEnabled, onSaved, onUncertainChange, onSelectBlocks }: Props) {
  const [config, setConfig] = useState<HiitConfig>(INITIAL), [view, setView] = useState<"setup" | "run" | "summary">("setup");
  const [display, setDisplay] = useState<HiitSnapshot | null>(null), [sound, setSound] = useState(true), [capability, setCapability] = useState(""), [error, setError] = useState(""), [editor, setEditor] = useState<DiaryEditorTarget | null>(null), [registered, setRegistered] = useState<{ id: string; date: string } | null>(null), [focusMode, setFocusMode] = useState(true);
  const run = useRef<HiitRun | null>(null), audio = useRef<AudioContext | null>(null), wake = useRef<WakeLockSentinel | null>(null), timer = useRef<number | null>(null), summaryKey = useRef<string | null>(null), sessionDate = useRef<string | null>(null), editorOpener = useRef<HTMLElement | null>(null), titleRef = useRef<HTMLHeadingElement>(null), startRef = useRef<HTMLButtonElement>(null), pauseControl = useRef<HTMLButtonElement>(null), focusControl = useRef<HTMLButtonElement>(null), pauseRef = useRef<() => void>(() => {}), activeHref = useRef(""), soundRef = useRef(sound), uncertainRef = useRef(false);
  const inProgress = view === "run", unsavedSummary = view === "summary" && !registered;
  const configError = validateHiitConfig(config), duration = hiitTotalMs(config);
  const timerPaused = display?.paused ?? null;
  useEffect(() => { if (view === "summary") titleRef.current?.focus(); }, [view]);
  useEffect(() => { if (view === "run" && timerPaused !== null) requestAnimationFrame(() => pauseControl.current?.focus()); }, [view, timerPaused]);
  useEffect(() => { soundRef.current = sound; }, [sound]);
  useEffect(() => { if (!active && run.current && !registered) { stopTicker(); releaseWake(); run.current = null; setDisplay(null); setEditor(null); setView("setup"); summaryKey.current = null; } }, [active, registered]);
  useEffect(() => { if (active) activeHref.current = location.href; }, [active]);
  async function acquireWake() {
    try { if (!("wakeLock" in navigator)) throw new Error(); wake.current = await navigator.wakeLock.request("screen"); setCapability(""); wake.current.addEventListener("release", () => { if (run.current && !run.current.paused) setCapability("La pantalla puede apagarse; el temporizador sigue visible."); }); }
    catch { setCapability("No se pudo mantener la pantalla encendida."); }
  }
  function releaseWake() { void wake.current?.release().catch(() => {}); wake.current = null; }
  function play(kind: string) { if (soundRef.current) tone(audio.current, kind); }
  function stopTicker() { if (timer.current !== null) window.clearInterval(timer.current); timer.current = null; }
  function finishSummary() { stopTicker(); releaseWake(); setDisplay(run.current ? { ...tickHiit(run.current, run.current.lastTick) } : null); setFocusMode(false); setView("summary"); summaryKey.current = crypto.randomUUID(); }
  function start() {
    const now = Date.now();
    try { run.current = createHiitRun(config, now); } catch (failure) { setError((failure as Error).message); return; }
    setError(""); setRegistered(null); sessionDate.current = null; summaryKey.current = null; setDisplay(null); setFocusMode(true); setView("run");
    requestAnimationFrame(() => pauseControl.current?.focus());
    const Audio = window.AudioContext;
    if (Audio) { audio.current ??= new Audio(); void audio.current.resume().then(() => play("start")).catch(() => setCapability("El sonido no está disponible; podés seguir con la pantalla.")); }
    else setCapability("Este navegador no ofrece avisos sonoros.");
    void acquireWake();
    timer.current = window.setInterval(() => {
      if (!run.current || run.current.paused) return;
      const next = tickHiit(run.current, Date.now()); setDisplay(next);
      if (run.current.firstWorkAt !== null && !sessionDate.current) sessionDate.current = hiitCivilDate(run.current.firstWorkAt, timeZone);
      next.sounds.forEach(play);
      if (next.complete) finishSummary();
    }, 100);
  }
  function pause() { if (!run.current) return; const next = pauseHiit(run.current, Date.now()); setDisplay(next); stopTicker(); releaseWake(); }
  useEffect(() => { pauseRef.current = pause; });
  async function resume() {
    if (!run.current) return;
    try { if (audio.current?.state === "suspended") await audio.current.resume(); } catch { setCapability("El sonido no está disponible; podés seguir con la pantalla."); }
    resumeHiit(run.current, Date.now()); setDisplay(tickHiit(run.current, Date.now())); void acquireWake();
    timer.current = window.setInterval(() => { if (!run.current || run.current.paused) return; const next = tickHiit(run.current, Date.now()); setDisplay(next); next.sounds.forEach(play); if (next.complete) finishSummary(); }, 100);
  }
  function discard() { if (!window.confirm("¿Descartar esta sesión? No se guardará en el diario.")) return; stopTicker(); releaseWake(); run.current = null; setDisplay(null); setEditor(null); setRegistered(null); setFocusMode(false); setView("setup"); requestAnimationFrame(() => startRef.current?.focus()); }
  function finishPartial() { if (!run.current) return; setDisplay(finishHiit(run.current, Date.now())); setFocusMode(false); setView("summary"); summaryKey.current = crypto.randomUUID(); stopTicker(); releaseWake(); }
  function leaveFocusMode() { setFocusMode(false); requestAnimationFrame(() => focusControl.current?.focus()); }
  function enterFocusMode() { setFocusMode(true); requestAnimationFrame(() => pauseControl.current?.focus()); }
  function openDiary() {
    const current = run.current, shown = display;
    if (!current || !shown || !hiitCanRegister(current) || !sessionDate.current || !summaryKey.current) return;
    const durationSeconds = Math.floor((current.workMs + current.restMs) / 1000);
    if (!durationSeconds) return;
    editorOpener.current = document.activeElement as HTMLElement;
    const text = `HIIT · ${current.config.rounds} rondas previstas. Trabajo: ${formatActivityDuration(Math.floor(current.workMs / 1000))}; descansos: ${formatActivityDuration(Math.floor(current.restMs / 1000))}; preparación: ${formatActivityDuration(Math.floor(current.preparationMs / 1000))}; pausas: ${formatActivityDuration(Math.floor(shown.pausedMs / 1000))}.`;
    setEditor({ mode: "create", date: sessionDate.current, destination: "result", initialContent: { title: "Entrenamiento HIIT", text, durationSeconds }, operationKey: summaryKey.current });
  }
  function saved(entry: EntryResponse["item"]) { setRegistered({ id: entry.id, date: entry.date }); setEditor(null); onSaved(entry); }
  const handleUncertainChange = useCallback((value: boolean) => {
    uncertainRef.current = value;
    onUncertainChange(value);
    setError(value ? "El guardado no se confirmó. Reintentá la misma operación antes de salir del formulario." : "");
  }, [onUncertainChange]);
  useEffect(() => () => { stopTicker(); releaseWake(); void audio.current?.close().catch(() => {}); }, []);
  useEffect(() => {
    if (!active || (!inProgress && !unsavedSummary)) return;
    const hidden = () => { if (document.visibilityState !== "visible" && run.current && !run.current.paused) pauseRef.current(); };
    const back = (event: PopStateEvent) => {
      if (!run.current || registered) return;
      const destination = `${location.pathname}${location.search}${location.hash}`;
      event.stopImmediatePropagation(); history.pushState(history.state, "", activeHref.current || location.href); window.dispatchEvent(new Event("family-navigation"));
      if (uncertainRef.current) { setError("El guardado no se confirmó. Reintentá la misma operación antes de salir del formulario."); return; }
      if (window.confirm("La sesión o su resumen todavía no se guardaron. ¿Salir y descartar el temporizador?")) { run.current = null; stopTicker(); releaseWake(); setDisplay(null); setEditor(null); setRegistered(null); summaryKey.current = null; sessionDate.current = null; uncertainRef.current = false; onUncertainChange(false); setView("setup"); history.pushState(history.state, "", destination); window.dispatchEvent(new Event("family-navigation")); }
    };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("popstate", back, true);
    const unload = (event: BeforeUnloadEvent) => { if (run.current && (!run.current.complete || unsavedSummary)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("popstate", back, true); window.removeEventListener("beforeunload", unload); };
  }, [active, inProgress, unsavedSummary, registered, onUncertainChange]);
  const stage = display?.stage === "work" ? "Trabajo" : display?.stage === "rest" ? "Descanso" : display?.stage === "preparation" ? "Preparación" : "Finalizado";
  const nextLabel = display?.nextStage === "work" ? "Trabajo" : display?.nextStage === "rest" ? "Descanso" : display?.nextStage === "preparation" ? "Preparación" : "Final";
  const currentPreset = HIIT_PRESETS.find(preset => Object.keys(preset.config).every(key => preset.config[key as keyof HiitConfig] === config[key as keyof HiitConfig]));
  const focusActive = inProgress && focusMode;
  return <section className={styles.hiit} hidden={!active} aria-labelledby="hiit-title" data-focus-mode={focusActive ? "true" : undefined}>
    <h2 id="hiit-title" ref={titleRef} tabIndex={view === "summary" ? -1 : undefined}>Temporizador</h2>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {editor ? <DiaryEditor key={`hiit-${editor.operationKey ?? "new"}`} target={editor} today={today} activityFormEnabled={activityFormEnabled} onClose={() => { setEditor(null); requestAnimationFrame(() => editorOpener.current?.focus()); }} onSaved={saved} onUncertainChange={handleUncertainChange} /> : view === "setup" ? <>
      <div className={styles.hiitSetup}>
        <section className={styles.hiitPrograms} aria-label="Programas de intervalos">
          {HIIT_PRESETS.map((preset, index) => <button type="button" key={preset.name} aria-pressed={!!currentPreset && currentPreset.name === preset.name} className={`${styles.hiitPreset} ${currentPreset?.name === preset.name ? styles.hiitPresetSelected : ""}`} onClick={() => setConfig({ ...preset.config })}>
            <strong>{index === 0 ? "Intervalos 20/10" : "Intervalos 40/20"}</strong>
            <span>{preset.config.workSeconds} s de trabajo · {preset.config.restSeconds} s de descanso</span>
            <span>8 rondas · {formatClock(hiitTotalMs(preset.config))} en total</span>
          </button>)}
          <button type="button" className={styles.hiitPreset} onClick={onSelectBlocks}>
            <strong>Por bloques</strong>
            <span>Circuito editable · 6 vueltas</span>
            <span>63:30 iniciales</span>
          </button>
        </section>
        <button ref={startRef} type="button" className={styles.primary} disabled={!!configError} onClick={start}>Iniciar entrenamiento</button>
        <div className={styles.hiitPreview} aria-label={`Duración prevista ${formatClock(duration)}`}>
          <span>{currentPreset ? "Programa seleccionado" : "Programa personalizado"}</span>
          <strong aria-hidden="true">{formatClock(duration)}</strong>
          <span>duración total</span>
        </div>
        <p className={styles.hiitHelp}>{config.preparationSeconds ? `Incluye ${formatClock(config.preparationSeconds * 1000)} de preparación.` : "Sin preparación."} Sin descanso al terminar.</p>
        <details className={styles.hiitCustomize} open={!currentPreset}>
          <summary>Personalizar tiempos</summary>
          <div className={styles.hiitGrid}>{([ ["Preparación (segundos)", "preparationSeconds", 0, 3600], ["Trabajo (segundos)", "workSeconds", 1, 3600], ["Descanso (segundos)", "restSeconds", 0, 3600], ["Rondas", "rounds", 1, 100] ] as const).map(([label, key, min, max]) => <label key={key}>{label}<input type="number" inputMode="numeric" min={min} max={max} step="1" value={config[key]} aria-invalid={!!configError} aria-describedby={configError ? "hiit-config-error" : undefined} onChange={event => setConfig(value => ({ ...value, [key]: event.target.value === "" ? min : Number(event.target.value) }))} /></label>)}</div>
          {configError && <p id="hiit-config-error" role="alert" className={styles.error}>{configError}</p>}
        </details>
        <details className={styles.hiitCustomize}>
          <summary>Avisos sonoros</summary>
          <label className={styles.hiitSound}><input type="checkbox" checked={sound} onChange={event => setSound(event.target.checked)} /> Activar avisos sonoros</label>
          {sound && <button type="button" onClick={() => { const Audio = window.AudioContext; if (Audio) { audio.current ??= new Audio(); void audio.current.resume().then(() => tone(audio.current, "start")); } }}>Probar sonido</button>}
        </details>
      </div>
    </> : view === "run" && display ? <div className={`${styles.hiitRun} ${styles[`hiit-${display.stage}`]}`}>
      {!focusMode && <div className={styles.hiitSessionBar}><span role="status">{display.paused ? "Sesión pausada" : "Sesión en curso"} · {stage}{display.stage !== "preparation" ? ` · ronda ${display.round} de ${config.rounds}` : ""}</span><button ref={focusControl} type="button" onClick={enterFocusMode}>Volver al modo foco</button></div>}
      <p className={styles.hiitStage}>{stage}</p><p className={styles.hiitClock} aria-live="off">{formatClock(display.remainingMs)}</p><p className={styles.hiitRound}>{display.stage === "preparation" ? "Preparáte" : `Ronda ${display.round} de ${config.rounds}`}</p>
      <p className={styles.hiitAnnouncement} role="status" aria-live="polite" aria-atomic="true">{display.paused ? "Pausado · " : ""}{stage}{display.stage !== "preparation" ? ` · ronda ${display.round} de ${config.rounds}` : ""}{display.nextStage ? ` · después: ${nextLabel}` : " · última etapa"}</p>
      <progress max={duration} value={display.elapsedMs} aria-label="Progreso del entrenamiento" />
      {capability && <p className={styles.muted}>{capability}</p>}
      <div className={styles.hiitControls}>{display.paused ? <><button ref={pauseControl} className={styles.primary} onClick={() => void resume()}>Reanudar</button><button onClick={finishPartial}>Terminar y revisar</button></> : <button ref={pauseControl} className={styles.primary} onClick={pause}>Pausar</button>}<button aria-pressed={sound} onClick={() => setSound(value => !value)}>{sound ? "Silenciar avisos" : "Activar avisos"}</button><button onClick={leaveFocusMode}>Salir del modo foco</button><button onClick={discard}>Descartar sesión</button></div>
    </div> : display ? <div className={styles.card}>
      <h3 tabIndex={-1} ref={titleRef}>{display.completedRounds === config.rounds ? "Entrenamiento completo" : "Entrenamiento parcial"}</h3>
      <p>{display.completedRounds} de {config.rounds} rondas completadas.</p>
      {!display.complete && display.stage !== "complete" && <p>{stage} de ronda {display.round}: {Math.floor(display.stageElapsedMs / 1000)} de {Math.ceil(display.stageDurationMs / 1000)} segundos.</p>}
      <p>Tiempo de entrenamiento: {formatActivityDuration(Math.floor((display.workMs + display.restMs) / 1000))}</p><p>Preparación: {formatActivityDuration(Math.floor(display.preparationMs / 1000))}</p>
      <p>Trabajo ejecutado: {formatActivityDuration(Math.floor(display.workMs / 1000))} · descansos: {formatActivityDuration(Math.floor(display.restMs / 1000))}</p>
      <p>Tiempo en pausa: {formatActivityDuration(Math.floor(display.pausedMs / 1000))}</p>
      {!writable && <p className={styles.notice}>Modo de consulta: no se puede registrar en el diario.</p>}
      {display.workMs < 1000 && <p className={styles.muted}>Completá al menos un segundo de trabajo para registrar la sesión.</p>}
      {registered && <p role="status">Sesión registrada en el diario. <a href={`/entrenamiento?${new URLSearchParams({ fecha: registered.date, detalle: registered.id })}`}>Ver en mi diario</a> <button onClick={() => { setView("setup"); setRegistered(null); }}>Cerrar</button></p>}
      {!registered && <div className={styles.actions}><button className={styles.primary} disabled={!writable || display.workMs < 1000} onClick={openDiary}>Registrar en mi diario</button><button onClick={start}>Repetir</button><button onClick={() => { if (!window.confirm("¿Cerrar el resumen? La sesión sin registrar se descartará.")) return; setView("setup"); setDisplay(null); setEditor(null); run.current = null; summaryKey.current = null; sessionDate.current = null; }}>Cerrar</button></div>}
    </div> : null}
  </section>;
}
