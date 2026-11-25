"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../gallery.module.css";

type SharedDrawing = { id: string; width: number; height: number; version: number; position: number; thumbnailUrl: string; displayUrl: string };
type SharedPage = { share: { title: string; expiresAt: string; serverNow: string }; drawings: SharedDrawing[]; total: number; nextCursor: string | null };

function SharedDrawingCard({ drawing, load, onOpen }: {
  drawing: SharedDrawing;
  load: (url: string, signal: AbortSignal) => Promise<string | null>;
  onOpen: (button: HTMLButtonElement) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const start = () => {
      void load(drawing.thumbnailUrl, controller.signal).then(value => {
        if (controller.signal.aborted) { if (value) URL.revokeObjectURL(value); return; }
        if (value) { objectUrl = value; setUrl(value); }
        else setFailed(true);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    };
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); start(); }
      }, { rootMargin: "180px" });
      observer.observe(node);
      return () => { observer.disconnect(); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }
    start();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [drawing.thumbnailUrl, load]);

  return <button ref={ref} className={styles.card} type="button" onClick={event => onOpen(event.currentTarget)} aria-label={`Abrir dibujo ${drawing.position + 1}`}>
    {url ? <Image src={url} alt="" width={drawing.width} height={drawing.height} unoptimized /> : <span className={failed ? styles.skeletonFailed : styles.skeleton} aria-hidden="true" />}
    {failed && <span className={styles.cardError} role="status">No se pudo cargar</span>}
  </button>;
}

export default function SharedGallery() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tokenRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const activeRequests = useRef(new Set<AbortController>());
  const previousImageRequest = useRef(Promise.resolve());
  const lastImageRequestAt = useRef(0);
  const selectedOpener = useRef<HTMLElement | null>(null);
  const selectedImageController = useRef<AbortController | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [shareInfo, setShareInfo] = useState<SharedPage["share"] | null>(null);
  const [drawings, setDrawings] = useState<SharedDrawing[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<SharedDrawing | null>(null);
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsEntry, setNeedsEntry] = useState(true);
  const [expired, setExpired] = useState(false);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState("");
  const [manualLink, setManualLink] = useState("");

  useEffect(() => () => { if (displayUrl) URL.revokeObjectURL(displayUrl); }, [displayUrl]);

  const stopSession = useCallback((notice: string) => {
    generationRef.current++;
    for (const controller of activeRequests.current) controller.abort();
    activeRequests.current.clear();
    selectedImageController.current?.abort();
    selectedImageController.current = null;
    tokenRef.current = null;
    setDrawings([]);
    setShareInfo(null);
    setShareId(null);
    setSelected(null);
    setDisplayUrl(null);
    setNextCursor(null);
    setNeedsEntry(true);
    setExpired(true);
    setPaused(false);
    setMessage(notice);
  }, []);

  const fetchWithRetries = useCallback(async (url: string, signal?: AbortSignal, init: RequestInit = {}) => {
    const waits = [0, 2_000, 5_000, 15_000];
    let lastError: unknown;
    for (let attempt = 0; attempt < waits.length; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (waits[attempt]) await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, waits[attempt]);
        signal?.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
      try {
        const response = await fetch(url, { ...init, cache: "no-store", credentials: "include", signal });
        if (response.status === 410) { stopSession("Este enlace venció o fue revocado."); return null; }
        if (response.status === 404) { stopSession("Este enlace ya no está disponible."); return null; }
        if (response.status >= 500) throw new Error("La conexión está ocupada. Reintentando…");
        return response;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        lastError = error;
      }
    }
    setPaused(true);
    setMessage(lastError instanceof Error ? `${lastError.message} Podés reintentar cuando quieras.` : "No se pudo conectar. Podés reintentar cuando quieras.");
    selectedImageController.current?.abort();
    selectedImageController.current = null;
    setSelected(null);
    setDisplayUrl(null);
    throw lastError instanceof Error ? lastError : new Error("No se pudo conectar.");
  }, [stopSession]);

  const loadPage = useCallback(async (id: string, cursor: string | null, append = false) => {
    const generation = generationRef.current;
    const controller = new AbortController();
    activeRequests.current.add(controller);
    setLoading(true);
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const response = await fetchWithRetries(`/api/gallery/public/shares/${id}${query}`, controller.signal);
      if (!response?.ok) {
        if (response?.status === 429) { setPaused(true); throw new Error("Se alcanzó el límite de solicitudes. Esperá un momento y reintentá."); }
        if (response && response.status !== 410) throw new Error("No se pudo cargar la galería compartida.");
        return;
      }
      const page = await response.json() as SharedPage;
      if (generation !== generationRef.current || controller.signal.aborted) return;
      setShareInfo(page.share);
      setDrawings(current => append ? [...current, ...page.drawings] : page.drawings);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
      setShareId(id);
      setNeedsEntry(false);
      setExpired(false);
      setPaused(false);
      setMessage("");
      return page;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") && generation === generationRef.current) setMessage(error instanceof Error ? error.message : "No se pudo cargar la galería. Revisá tu conexión y reintentá.");
      return null;
    } finally {
      activeRequests.current.delete(controller);
      if (generation === generationRef.current) setLoading(false);
    }
  }, [fetchWithRetries]);

  const revalidate = useCallback(async () => {
    const generation = generationRef.current;
    try {
      const response = await fetchWithRetries("/api/gallery/public/session");
      if (!response?.ok) {
        if (response && response.status !== 410) throw new Error("La visita está pausada por un problema de conexión.");
        return;
      }
      const current = await response.json() as { shareId: string; expiresAt: string; serverNow: string };
      if (generation !== generationRef.current) return;
      const expiryDelay = new Date(current.expiresAt).getTime() - new Date(current.serverNow).getTime();
      if (expiryDelay <= 0) { stopSession("Este enlace venció."); return; }
      setShareInfo(previous => previous ? { ...previous, expiresAt: current.expiresAt, serverNow: current.serverNow } : previous);
      setPaused(false);
      if (shareId && current.shareId !== shareId) { setDrawings([]); setNextCursor(null); await loadPage(current.shareId, null); }
    } catch {
      if (generation === generationRef.current) {
        selectedImageController.current?.abort();
        selectedImageController.current = null;
        setSelected(null);
        setDisplayUrl(null);
        setPaused(true);
      }
    }
  }, [fetchWithRetries, loadPage, shareId, stopSession]);

  const loadImage = useCallback(async (url: string, signal: AbortSignal) => {
    const task = previousImageRequest.current.catch(() => undefined).then(async () => {
      const wait = Math.max(0, lastImageRequestAt.current + 220 - Date.now());
      if (wait) await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, wait);
        signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const response = await fetchWithRetries(url, signal);
      // Pace from completion so request processing time cannot squeeze the
      // server's global 200 ms interval below its limit.
      lastImageRequestAt.current = Date.now();
      if (response?.status === 429) { setPaused(true); throw new Error("Se alcanzó el límite de solicitudes. Esperá un momento y reintentá."); }
      if (!response?.ok) return null;
      return URL.createObjectURL(await response.blob());
    });
    previousImageRequest.current = task.then(() => undefined, () => undefined);
    return task;
  }, [fetchWithRetries]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    tokenRef.current = token;
    if (!token) {
      void (async () => {
        const response = await fetch("/api/gallery/public/session", { cache: "no-store", credentials: "include" });
        if (response.status === 410) { setExpired(true); setMessage("Este enlace venció o fue revocado."); return; }
        if (!response.ok) { setMessage("No se pudo comprobar el acceso. Probá de nuevo."); return; }
        const session = await response.json() as { shareId: string };
        await loadPage(session.shareId, null);
      })().catch(() => setMessage("No se pudo comprobar el acceso. Probá de nuevo."));
    }
  }, [loadPage]);

  useEffect(() => {
    if (!shareId || needsEntry) return;
    const interval = window.setInterval(() => void revalidate(), 30_000);
    const onFocus = () => void revalidate();
    window.addEventListener("focus", onFocus);
    const remaining = shareInfo ? Math.max(0, new Date(shareInfo.expiresAt).getTime() - new Date(shareInfo.serverNow).getTime()) : 0;
    const expiryTimer = window.setTimeout(() => void revalidate(), remaining);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", onFocus); window.clearTimeout(expiryTimer); };
  }, [shareId, needsEntry, shareInfo, revalidate, stopSession]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    if (!selected && dialog.open) {
      dialog.close();
      selectedOpener.current?.focus();
      selectedOpener.current = null;
    }
  }, [selected]);

  async function enter() {
    const token = tokenRef.current;
    if (!token) { setMessage("Este enlace no incluye una credencial válida. Abrilo desde el vínculo original."); return; }
    setMessage("");
    try {
      const response = await fetchWithRetries("/api/gallery/public/enter", undefined, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      if (!response) return;
      if (!response.ok) { setMessage(response.status === 429 ? "Se alcanzó el límite de intentos. Esperá un momento y reintentá." : "No se pudo abrir el enlace. Revisá tu conexión y reintentá."); return; }
      const session = await response.json() as { shareId: string };
      tokenRef.current = null;
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setExpired(false);
      await loadPage(session.shareId, null);
    } catch { setMessage("No se pudo abrir el enlace. Revisá tu conexión y reintentá."); }
  }

  async function copyOriginalLink() {
    if (!tokenRef.current) return;
    const link = `${window.location.origin}${window.location.pathname}${window.location.search}#token=${encodeURIComponent(tokenRef.current)}`;
    try { await navigator.clipboard.writeText(link); setMessage("Enlace copiado. Abrilo en el navegador habitual para continuar."); }
    catch { setManualLink(link); setMessage("Mantené presionado el enlace para copiarlo y abrilo en el navegador habitual."); }
  }

  async function openDrawing(drawing: SharedDrawing, button: HTMLButtonElement) {
    const generation = generationRef.current;
    selectedOpener.current = button;
    selectedImageController.current?.abort();
    if (displayUrl) URL.revokeObjectURL(displayUrl);
    setSelected(drawing);
    const controller = new AbortController();
    selectedImageController.current = controller;
    activeRequests.current.add(controller);
    try {
      const url = await loadImage(drawing.displayUrl, controller.signal);
      if (url && !controller.signal.aborted && generation === generationRef.current) setDisplayUrl(url);
      else if (url) URL.revokeObjectURL(url);
    } catch { if (!controller.signal.aborted) setMessage("No se pudo cargar el dibujo. Podés volver a intentarlo."); }
    finally { activeRequests.current.delete(controller); }
  }

  function closeDrawing() {
    selectedImageController.current?.abort();
    selectedImageController.current = null;
    setSelected(null);
    if (displayUrl) URL.revokeObjectURL(displayUrl);
    setDisplayUrl(null);
  }

  const moveSelection = async (direction: -1 | 1) => {
    if (!selected) return;
    const index = drawings.findIndex(drawing => drawing.id === selected.id);
    let next: SharedDrawing | undefined = drawings[index + direction] ?? undefined;
    if (!next && direction > 0 && nextCursor && shareId) {
      const page = await loadPage(shareId, nextCursor, true);
      next = page?.drawings[0] ?? undefined;
    }
    if (next) {
      const generation = generationRef.current;
      selectedImageController.current?.abort();
      if (displayUrl) URL.revokeObjectURL(displayUrl);
      setSelected(next); setDisplayUrl(null);
      const controller = new AbortController(); selectedImageController.current = controller;
      void loadImage(next.displayUrl, controller.signal).then(url => {
        if (!url) return;
        if (!controller.signal.aborted && generation === generationRef.current) setDisplayUrl(url);
        else URL.revokeObjectURL(url);
      }).catch(() => undefined);
    }
  };

  const expireNotice = expired;
  if (needsEntry) return <main className={`${styles.page} ${styles.publicPage}`}>
    <section className={styles.publicWelcome}>
      <p className={styles.eyebrow}>INVITACIÓN PRIVADA</p>
      <h1>Una galería para mirar</h1>
      <p>Las personas con este enlace pueden ver los dibujos seleccionados hasta que venza o se revoque. Las imágenes podrían guardarse o capturarse durante la visita.</p>
      {expired ? <p role="status">{message || "Este enlace ya no está disponible."}</p> : <button className={styles.uploadButton} type="button" onClick={() => void enter()}>Entrar a la galería</button>}
      {!expired && <button className={styles.archive} type="button" onClick={() => void copyOriginalLink()}>Copiar enlace</button>}
      {manualLink && <label className={styles.shareField}>Enlace privado<input readOnly value={manualLink} onFocus={event => event.currentTarget.select()} /></label>}
      {message && <p role="status">{message}</p>}
    </section>
  </main>;

  return <main className={`${styles.page} ${styles.publicPage}`}>
    <div inert={selected ? true : undefined}>
      <section className={styles.intro}>
        <p className={styles.eyebrow}>GALERÍA COMPARTIDA</p>
        <h1>{shareInfo?.title ?? "Dibujos para mirar"}</h1>
        <p>Este enlace vence {shareInfo ? new Date(shareInfo.expiresAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "pronto"}. Los dibujos pueden guardarse o capturarse durante la visita.</p>
      </section>
      {message && <p className={styles.status} role="status">{message}</p>}
      {paused && <section className={styles.pausedNotice} role="status"><p>La galería está pausada mientras comprobamos la conexión.</p><button type="button" className={styles.archive} onClick={() => void revalidate()}>Reintentar</button></section>}
      {expireNotice ? <p className={styles.empty}>Este enlace venció o fue revocado.</p> : <>
        {loading && <p className={styles.status} role="status">Cargando dibujos…</p>}
        {!paused && <section className={styles.publicGrid} aria-label="Dibujos compartidos">
          {drawings.map(drawing => <SharedDrawingCard key={drawing.id} drawing={drawing} load={loadImage} onOpen={button => void openDrawing(drawing, button)} />)}
        </section>}
        {nextCursor && <button type="button" className={styles.moreButton} disabled={loading || paused} onClick={() => shareId && void loadPage(shareId, nextCursor, true)}>Ver los siguientes dibujos</button>}
        {!loading && drawings.length === 0 && <p className={styles.empty}>No hay dibujos disponibles en este enlace.</p>}
      </>}
    </div>
    <dialog ref={dialogRef} className={styles.dialog} aria-label="Dibujo compartido" onCancel={event => { event.preventDefault(); closeDrawing(); }} onKeyDown={event => {
      if (event.key === "ArrowLeft") { event.preventDefault(); void moveSelection(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); void moveSelection(1); }
    }} onClick={event => { if (event.target === dialogRef.current) closeDrawing(); }}>
      {selected && <div className={styles.detail}>
        <button className={styles.close} type="button" onClick={closeDrawing} aria-label="Cerrar dibujo">×</button>
        <button type="button" className={styles.viewerPrev} disabled={selected.position === drawings[0]?.position} onClick={() => moveSelection(-1)} aria-label="Dibujo anterior">‹</button>
        {displayUrl ? <Image src={displayUrl} alt={`Dibujo ${selected.position + 1} de ${total}`} width={selected.width} height={selected.height} unoptimized /> : <span className={styles.skeleton} role="status" aria-label="Cargando dibujo" />}
        <button type="button" className={styles.viewerNext} disabled={!nextCursor && selected.position === drawings.at(-1)?.position} onClick={() => moveSelection(1)} aria-label="Dibujo siguiente">›</button>
        <p aria-live="polite">Dibujo {selected.position + 1} de {total}</p>
      </div>}
    </dialog>
  </main>;
}
