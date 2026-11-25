"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "../gallery.module.css";
import { useViewerScrollLock } from "../useViewerScrollLock";

type GuestDrawing = { id: string; width: number; height: number; version: number; thumbnailUrl: string; displayUrl: string };
type GuestData = { collection: { title: string; description: string }; drawings: GuestDrawing[] };

export default function GuestGallery() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const selectionGeneration = useRef(0);
  const tokenRef = useRef<string | null>(null);
  const objectUrls = useRef(new Map<string, string>());
  const requestQueue = useRef(Promise.resolve());
  const [needsEntry, setNeedsEntry] = useState(true);
  const [data, setData] = useState<GuestData | null>(null);
  const [selected, setSelected] = useState<GuestDrawing | null>(null);
  const [selectedFailed, setSelectedFailed] = useState(false);
  const [displayAttempt, setDisplayAttempt] = useState(0);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loadedCount, setLoadedCount] = useState(0);
  const [message, setMessage] = useState("");
  const [manualCopyLink, setManualCopyLink] = useState("");
  useViewerScrollLock(selected !== null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    if (!selected && dialog.open) {
      dialog.close();
      if (dialogOpener.current?.isConnected) dialogOpener.current.focus();
      else document.querySelector<HTMLElement>("[data-gallery-focus-fallback]")?.focus();
      dialogOpener.current = null;
    }
  }, [selected]);

  const loadCollection = useCallback(async () => {
    const response = await fetch("/api/gallery/guest/collection", { cache: "no-store" });
    if (!response.ok) throw new Error("El acceso venció o fue revocado.");
    const nextData = await response.json() as GuestData;
    const visible = new Set(nextData.drawings.map(drawing => `${drawing.id}:${drawing.version}`));
    const retained: Record<string, string> = {};
    for (const [key, url] of objectUrls.current) {
      if (visible.has(key.split(":").slice(0, 2).join(":"))) retained[key] = url;
      else { URL.revokeObjectURL(url); objectUrls.current.delete(key); }
    }
    setImageUrls(retained);
    setSelected(current => current && !visible.has(`${current.id}:${current.version}`) ? null : current);
    setLoadedCount(0);
    setData(nextData);
  }, []);

  const clearObjectUrls = useCallback(() => {
    for (const url of objectUrls.current.values()) URL.revokeObjectURL(url);
    objectUrls.current.clear();
    setImageUrls({});
  }, []);

  const getBlobUrl = useCallback(async (url: string, key: string) => {
    const existing = objectUrls.current.get(key);
    if (existing) return existing;
    const task = requestQueue.current.then(async () => {
      const cached = objectUrls.current.get(key);
      if (cached) return cached;
      let response: Response;
      while (true) {
        response = await fetch(url, { cache: "no-store" });
        if (response.status !== 429) break;
        await new Promise(resolve => setTimeout(resolve, Math.max(1000, Number(response.headers.get("Retry-After") ?? 1) * 1000)));
      }
      if (!response.ok) throw new Error("El acceso venció o fue revocado.");
      const objectUrl = URL.createObjectURL(await response.blob());
      objectUrls.current.set(key, objectUrl);
      setImageUrls(current => ({ ...current, [key]: objectUrl }));
      await new Promise(resolve => setTimeout(resolve, 220));
      return objectUrl;
    });
    requestQueue.current = task.then(() => undefined, () => undefined);
    return task;
  }, []);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    tokenRef.current = hash.get("token");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!tokenRef.current) {
      void loadCollection().then(() => setNeedsEntry(false)).catch(() => setMessage("Este enlace ya no está disponible."));
    }
  }, [loadCollection]);

  useEffect(() => {
    let active = true;
    const drawings = data?.drawings ?? [];
    void (async () => {
      try {
        for (const drawing of drawings) {
          await getBlobUrl(drawing.thumbnailUrl, `${drawing.id}:${drawing.version}:thumbnail`);
          if (active) setLoadedCount(count => count + 1);
        }
      } catch {
        if (active) { clearObjectUrls(); setData(null); setSelected(null); setMessage("El acceso venció o fue revocado."); }
      }
    })();
    return () => { active = false; };
  }, [clearObjectUrls, data, getBlobUrl]);

  async function enter() {
    const token = tokenRef.current;
    if (!token) return;
    setMessage("");
    const response = await fetch("/api/gallery/guest/redeem", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store",
    });
    tokenRef.current = null;
    if (!response.ok) { setMessage("El enlace venció, ya fue usado o necesita abrirse en un navegador habitual."); return; }
    try { await loadCollection(); setNeedsEntry(false); }
    catch { setMessage("No se pudo cargar la colección. Volvé a abrir el enlace en el navegador habitual."); }
  }

  async function copyLink() {
    if (!tokenRef.current) return;
    const link = `${window.location.origin}${window.location.pathname}${window.location.search}#token=${encodeURIComponent(tokenRef.current)}`;
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Enlace copiado. Abrilo en Safari, Chrome u otro navegador habitual.");
    } catch {
      setManualCopyLink(link);
      setMessage("Mantené presionado el enlace para copiarlo y abrirlo en el navegador habitual.");
    }
  }

  async function showDrawing(drawing: GuestDrawing, opener?: HTMLElement) {
    if (opener) dialogOpener.current = opener;
    const generation = ++selectionGeneration.current;
    setSelected(drawing);
    setSelectedFailed(false);
    setDisplayAttempt(0);
    try {
      await getBlobUrl(drawing.displayUrl, `${drawing.id}:${drawing.version}:display`);
      if (generation !== selectionGeneration.current) return;
    } catch {
      if (generation === selectionGeneration.current) setSelectedFailed(true);
    }
  }

  async function moveSelection(direction: -1 | 1) {
    if (!selected || !data) return;
    const index = data.drawings.findIndex(drawing => drawing.id === selected.id);
    const next = data.drawings[index + direction];
    if (next) await showDrawing(next);
  }

  async function retrySelectedDrawing() {
    if (!selected) return;
    const generation = selectionGeneration.current;
    const key = `${selected.id}:${selected.version}:display`;
    const cached = objectUrls.current.get(key);
    if (cached) { URL.revokeObjectURL(cached); objectUrls.current.delete(key); }
    setImageUrls(current => { const next = { ...current }; delete next[key]; return next; });
    setDisplayAttempt(attempt => attempt + 1);
    setSelectedFailed(false);
    try { await getBlobUrl(selected.displayUrl, key); }
    catch { if (generation === selectionGeneration.current) setSelectedFailed(true); }
  }

  const revalidate = useCallback(async () => {
    try { await loadCollection(); } catch { clearObjectUrls(); setData(null); setSelected(null); setMessage("El acceso fue revocado o venció."); }
  }, [clearObjectUrls, loadCollection]);

  useEffect(() => {
    const onFocus = () => { if (!needsEntry) void revalidate(); };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearObjectUrls();
    };
  }, [clearObjectUrls, needsEntry, revalidate]);

  if (needsEntry) return <main className={styles.page}>
    <section className={styles.intro}><p className={styles.eyebrow}>INVITACIÓN PRIVADA</p><h1>Galería compartida</h1>
      <p>Si abriste este enlace desde WhatsApp u otra aplicación, copiá el enlace y abrilo en tu navegador habitual antes de entrar.</p>
      <button className={styles.archive} type="button" onClick={() => void copyLink()}>Copiar enlace privado</button>
      <button className={styles.uploadButton} type="button" onClick={() => void enter()}>Entrar a la galería</button>
      {manualCopyLink && <label className={styles.shareField}>Enlace privado<input readOnly value={manualCopyLink} onFocus={event => event.currentTarget.select()} /></label>}
      {message && <p role="status">{message}</p>}
    </section>
  </main>;

  return <main className={styles.page}>
    <section className={styles.intro}><p className={styles.eyebrow}>INVITACIÓN PRIVADA</p><h1 tabIndex={-1} data-gallery-focus-fallback>{data?.collection.title ?? "Galería"}</h1>
      {data?.collection.description && <p>{data.collection.description}</p>}
      <p>Las imágenes compartidas son visibles durante esta visita. No hay botón de descarga.</p>
    </section>
    {message && <p className={styles.status} role="status">{message}</p>}
    {data && <p className={styles.status} role="status">Cargando miniaturas: {loadedCount} de {data.drawings.length}</p>}
    <section className={styles.grid} aria-label="Dibujos compartidos">
      {data?.drawings.map((drawing, index) => <button key={drawing.id} className={styles.card} type="button" onClick={event => void showDrawing(drawing, event.currentTarget)} aria-label={`Abrir dibujo ${index + 1}`}>
        {imageUrls[`${drawing.id}:${drawing.version}:thumbnail`] ? <Image src={imageUrls[`${drawing.id}:${drawing.version}:thumbnail`]} alt="" loading="lazy" decoding="async" width={384} height={384} unoptimized /> : <span className={styles.skeleton} aria-hidden="true" />}
      </button>)}
    </section>
    <dialog ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Dibujo compartido" onCancel={event => { event.preventDefault(); selectionGeneration.current++; setSelected(null); }} onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']"))) return;
      event.preventDefault(); void moveSelection(event.key === "ArrowLeft" ? -1 : 1);
    }} onClick={event => { if (event.target === dialogRef.current) { selectionGeneration.current++; setSelected(null); } }}>
      {selected && data && <div className={styles.detail}>
        <div className={styles.viewerHeader}><button className={styles.close} type="button" onClick={() => { selectionGeneration.current++; setSelected(null); }} aria-label="Cerrar dibujo">×</button></div>
        <div className={styles.viewerStage} data-testid="gallery-viewer-stage">
          {selectedFailed ? <div><p className={styles.viewerError} role="status">No se pudo cargar el dibujo.</p><button type="button" className={styles.archive} onClick={() => void retrySelectedDrawing()}>Reintentar carga</button></div> : imageUrls[`${selected.id}:${selected.version}:display`] ? <Image key={`${selected.id}:${selected.version}:${displayAttempt}`} src={imageUrls[`${selected.id}:${selected.version}:display`]} alt={`Dibujo ${data.drawings.findIndex(drawing => drawing.id === selected.id) + 1} de ${data.drawings.length}`} width={selected.width} height={selected.height} unoptimized onError={() => setSelectedFailed(true)} /> : <span className={styles.skeleton} role="status" aria-label="Cargando dibujo" />}
        </div>
        <div className={styles.viewerControls} data-testid="gallery-viewer-controls">
          <button type="button" className={styles.viewerPrev} aria-disabled={data.drawings.findIndex(drawing => drawing.id === selected.id) <= 0} onClick={() => void moveSelection(-1)} aria-label="Dibujo anterior">‹</button>
          <p aria-live="polite">Dibujo {data.drawings.findIndex(drawing => drawing.id === selected.id) + 1} de {data.drawings.length}</p>
          <button type="button" className={styles.viewerNext} aria-disabled={data.drawings.findIndex(drawing => drawing.id === selected.id) >= data.drawings.length - 1} onClick={() => void moveSelection(1)} aria-label="Dibujo siguiente">›</button>
        </div>
        <div className={styles.viewerActions} />
      </div>}
    </dialog>
  </main>;
}
