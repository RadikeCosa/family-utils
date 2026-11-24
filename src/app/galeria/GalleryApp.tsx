"use client";

import { upload } from "@vercel/blob/client";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./gallery.module.css";

type GalleryItem = {
  id: string;
  authorMemberId: string;
  width: number;
  height: number;
  version: number;
  displayUrl: string;
  thumbnailUrl: string;
};
type CollectionItem = { id: string; ownerMemberId: string; title: string; description: string; version: number; drawingCount: number; activeInvitationCount: number };
type InviteItem = { id: string; createdAt: string; expiresAt: string; redeemedAt: string | null; revokedAt: string | null };

export default function GalleryApp({ currentMemberId, canManageAll }: { currentMemberId: string; canManageAll: boolean }) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [openCollection, setOpenCollection] = useState<{ collection: CollectionItem; drawings: GalleryItem[] } | null>(null);
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [collectionTitle, setCollectionTitle] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");
  const [editingCollection, setEditingCollection] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [invitationView, setInvitationView] = useState<{ collectionId: string; items: InviteItem[] } | null>(null);
  const [sharePreview, setSharePreview] = useState<{ collection: CollectionItem; drawings: GalleryItem[] } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const refresh = useCallback(async () => {
    const [response, collectionResponse] = await Promise.all([
      fetch("/api/gallery", { cache: "no-cache" }), fetch("/api/gallery/collections", { cache: "no-store" }),
    ]);
    if (!response.ok || !collectionResponse.ok) throw new Error("No se pudo cargar la galería.");
    const data = await response.json() as { items: GalleryItem[] };
    const collectionData = await collectionResponse.json() as { collections: CollectionItem[] };
    setItems(data.items); setCollections(collectionData.collections);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([fetch("/api/gallery", { cache: "no-cache" }), fetch("/api/gallery/collections", { cache: "no-store" })])
      .then(async ([response, collectionResponse]) => {
        if (!response.ok || !collectionResponse.ok) throw new Error("No se pudo cargar la galería.");
        return Promise.all([response.json() as Promise<{ items: GalleryItem[] }>, collectionResponse.json() as Promise<{ collections: CollectionItem[] }>]);
      })
      .then(([data, collectionData]) => { if (active) { setItems(data.items); setCollections(collectionData.collections); } })
      .catch(() => { if (active) setMessage("No se pudo cargar la galería. Probá de nuevo."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    if (!selected && dialog.open) dialog.close();
  }, [selected]);

  async function startUpload(file: File) {
    const start = await fetch("/api/gallery/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, bytes: file.size, type: file.type }),
    });
    const reservation = await start.json() as { drawingId?: string; pathname?: string; error?: string };
    if (!start.ok || !reservation.drawingId || !reservation.pathname) {
      throw new Error(reservation.error === "QUOTA_EXCEEDED" ? "La galería alcanzó su espacio disponible." : "El archivo no se pudo aceptar.");
    }
    await upload(reservation.pathname, file, {
      access: "private",
      handleUploadUrl: "/api/gallery/upload-token",
      clientPayload: JSON.stringify({ drawingId: reservation.drawingId }),
    });
    const finalize = await fetch(`/api/gallery/uploads/${reservation.drawingId}/finalize`, { method: "POST" });
    if (!finalize.ok) {
      const result = await finalize.json().catch(() => ({})) as { error?: string };
      throw new Error(result.error === "QUOTA_EXCEEDED" ? "No hay espacio suficiente para guardar este dibujo." : "No se pudo procesar un dibujo.");
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length || uploading) return;
    const selectedFiles = Array.from(files);
    setUploading(true);
    setMessage("");
    try {
      for (const [index, file] of selectedFiles.entries()) {
        setProgress(`Subiendo ${index + 1} de ${selectedFiles.length}`);
        await startUpload(file);
      }
      await refresh();
      setMessage(selectedFiles.length === 1 ? "Dibujo agregado." : `${selectedFiles.length} dibujos agregados.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo completar la carga.");
      await refresh().catch(() => undefined);
    } finally {
      setUploading(false);
      setProgress("");
    }
  }

  async function archive(item: GalleryItem) {
    const response = await fetch(`/api/gallery/drawings/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    if (!response.ok) { setMessage("No se pudo archivar el dibujo."); return; }
    setSelected(null);
    await refresh();
    setMessage("Dibujo archivado.");
  }

  async function createCollection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/gallery/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: collectionTitle, description: collectionDescription }) });
    if (!response.ok) { setMessage("No se pudo crear la colección."); return; }
    setCollectionTitle(""); setCollectionDescription(""); await refresh(); setMessage("Colección creada.");
  }

  async function showCollection(collection: CollectionItem) {
    const response = await fetch(`/api/gallery/collections/${collection.id}`, { cache: "no-store" });
    if (!response.ok) { setMessage("No se pudo abrir la colección."); return; }
    const data = await response.json() as { collection: CollectionItem; drawings: GalleryItem[] };
    setOpenCollection(data);
    setEditingTitle(data.collection.title);
    setEditingDescription(data.collection.description);
    setEditingCollection(false);
  }

  async function saveCollection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openCollection) return;
    const save = (confirmExposure = false) => fetch(`/api/gallery/collections/${openCollection.collection.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editingTitle, description: editingDescription, confirmExposure }), cache: "no-store",
    });
    let response = await save();
    if (response.status === 409) {
      if (!window.confirm("Las personas invitadas verán el nuevo nombre y descripción al instante. ¿Guardar?")) return;
      response = await save(true);
    }
    if (!response.ok) { setMessage("No se pudieron guardar los cambios."); return; }
    setEditingCollection(false);
    await refresh(); await showCollection(openCollection.collection); setMessage("Colección actualizada.");
  }

  async function showSharePreview(collection: CollectionItem) {
    const response = await fetch(`/api/gallery/collections/${collection.id}`, { cache: "no-store" });
    if (!response.ok) { setMessage("No se pudo preparar la vista previa."); return; }
    setSharePreview(await response.json() as { collection: CollectionItem; drawings: GalleryItem[] });
  }

  async function invite(collection: CollectionItem) {
    const send = (confirmReissue = false) => fetch(`/api/gallery/collections/${collection.id}/invitations`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmReissue }), cache: "no-store",
    });
    let response = await send();
    if (response.status === 409) {
      if (!window.confirm("Crear un enlace nuevo revocará el enlace anterior y cualquier visita activa. ¿Continuar?")) return;
      response = await send(true);
    }
    if (!response.ok) { setMessage("No se pudo crear el enlace privado."); return; }
    const result = await response.json() as { url: string };
    setShareLink(result.url);
    setSharePreview(null);
    try { await navigator.clipboard.writeText(result.url); setMessage("Enlace privado copiado. Vence en 24 horas y solo puede usarse una vez."); }
    catch { setMessage("Enlace creado. Copialo desde el campo de invitación."); }
  }

  async function addDrawingToCollection(item: GalleryItem, collectionId: string) {
    const response = await fetch(`/api/gallery/collections/${collectionId}/drawings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", drawingIds: [item.id] }) });
    if (response.status === 409 && window.confirm("Las personas invitadas verán este dibujo. ¿Confirmás que querés compartirlo?")) {
      await fetch(`/api/gallery/collections/${collectionId}/drawings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", drawingIds: [item.id], confirmExposure: true }) });
    }
    await refresh();
    if (openCollection) await showCollection(openCollection.collection);
    setMessage("Colección actualizada.");
  }

  async function removeDrawingFromCollection(item: GalleryItem) {
    if (!openCollection) return;
    const response = await fetch(`/api/gallery/collections/${openCollection.collection.id}/drawings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", drawingIds: [item.id] }),
    });
    if (!response.ok) { setMessage("No se pudo quitar el dibujo de la colección."); return; }
    setSelected(null); await refresh(); await showCollection(openCollection.collection); setMessage("Dibujo quitado de la colección.");
  }

  async function archiveCollection(collection: CollectionItem) {
    if (!window.confirm("Archivar la colección revocará sus enlaces y visitas activas. ¿Continuar?")) return;
    const response = await fetch(`/api/gallery/collections/${collection.id}`, { method: "DELETE" });
    if (!response.ok) { setMessage("No se pudo archivar la colección."); return; }
    setOpenCollection(null); setShareLink(""); await refresh(); setMessage("Colección archivada.");
  }

  async function showInvitations(collection: CollectionItem) {
    const response = await fetch(`/api/gallery/collections/${collection.id}/invitations`, { cache: "no-store" });
    if (!response.ok) { setMessage("No se pudieron consultar las invitaciones."); return; }
    const data = await response.json() as { invitations: InviteItem[] };
    setInvitationView({ collectionId: collection.id, items: data.invitations });
  }

  async function revokeInvitation(collectionId: string, invitationId: string) {
    const response = await fetch(`/api/gallery/collections/${collectionId}/invitations/${invitationId}`, { method: "DELETE" });
    if (!response.ok) { setMessage("No se pudo revocar la invitación."); return; }
    const collection = collections.find(item => item.id === collectionId);
    if (collection) await showInvitations(collection);
    await refresh(); setMessage("Invitación revocada; el acceso quedó cerrado.");
  }

  return (
    <main className={styles.page}>
      <header className={styles.header} data-legacy-chrome>
        <Link href="/" className={styles.brand}>family<span>utils</span></Link>
        <nav aria-label="Aplicaciones"><Link href="/tareas">Tareas</Link><Link href="/cinemateca">Cinemateca</Link><Link href="/familia">Mi familia</Link></nav>
      </header>
      <section className={styles.intro}>
        <p className={styles.eyebrow}>CREATIVIDAD EN FAMILIA</p>
        <div className={styles.titleRow}>
          <div><h1>Galería</h1><p>Tus dibujos y los que comparten en familia.</p></div>
          <label className={styles.uploadButton}>
            <span>{uploading ? progress : "Agregar dibujos"}</span>
            <input type="file" accept="image/png,image/jpeg" multiple disabled={uploading} onChange={event => { void handleFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
          </label>
        </div>
      </section>
      {message && <p className={styles.status} role="status">{message}</p>}
      <section className={styles.collections} aria-labelledby="collections-title">
        <div className={styles.collectionHeading}><h2 id="collections-title">Colecciones</h2><button type="button" className={styles.archive} onClick={() => setShareLink("new")}>Crear colección</button></div>
        {shareLink === "new" && <form className={styles.collectionForm} onSubmit={event => void createCollection(event)}>
          <label>Nombre <input value={collectionTitle} onChange={event => setCollectionTitle(event.target.value)} maxLength={120} required /></label>
          <label>Descripción <input value={collectionDescription} onChange={event => setCollectionDescription(event.target.value)} maxLength={500} /></label>
          <button type="submit" className={styles.uploadButton}>Guardar colección</button><button type="button" className={styles.archive} onClick={() => setShareLink("")}>Cancelar</button>
        </form>}
        {shareLink && shareLink !== "new" && <label className={styles.shareField}>Enlace privado<input readOnly value={shareLink} onFocus={event => event.currentTarget.select()} /></label>}
        <div className={styles.collectionList}>{collections.map(collection => <article className={styles.collectionCard} key={collection.id}>
          <button type="button" className={styles.collectionOpen} onClick={() => void showCollection(collection)}><strong>{collection.title}</strong><span>{collection.drawingCount} dibujos · {collection.activeInvitationCount} invitaciones activas</span></button>
          <button type="button" className={styles.archive} onClick={() => void showInvitations(collection)}>Invitaciones</button>
          <button type="button" className={styles.archive} onClick={() => void showSharePreview(collection)}>Invitar</button>
        </article>)}</div>
        {sharePreview && <section className={styles.sharePreview} aria-labelledby="share-preview-title">
          <p className={styles.eyebrow}>VISTA PREVIA PARA LA PERSONA INVITADA</p>
          <h3 id="share-preview-title">{sharePreview.collection.title}</h3>
          {sharePreview.collection.description && <p>{sharePreview.collection.description}</p>}
          <div className={styles.previewGrid}>{sharePreview.drawings.slice(0, 6).map(drawing => <Image key={drawing.id} src={drawing.thumbnailUrl} alt="" width={384} height={384} unoptimized />)}</div>
          <p>{sharePreview.drawings.length} dibujos · enlace de un solo uso · acceso durante siete días</p>
          <button type="button" className={styles.uploadButton} onClick={() => void invite(sharePreview.collection)}>Crear invitación</button>
          <button type="button" className={styles.archive} onClick={() => setSharePreview(null)}>Cancelar</button>
        </section>}
        {invitationView && <section className={styles.invitationList} aria-label="Invitaciones activas">
          <h3>Invitaciones activas</h3>
          {invitationView.items.length === 0 ? <p>No hay invitaciones activas.</p> : invitationView.items.map((invitation, index) => <div className={styles.invitationRow} key={invitation.id}>
            <span>Invitación {index + 1} · {invitation.redeemedAt ? "canjeada" : "pendiente"} · vence {new Date(invitation.expiresAt).toLocaleString()}</span>
            <button type="button" className={styles.archive} onClick={() => void revokeInvitation(invitationView.collectionId, invitation.id)}>Revocar</button>
          </div>)}
        </section>}
      </section>
      {openCollection && <section className={styles.collectionDetail} aria-label={`Colección ${openCollection.collection.title}`}>
        <div className={styles.collectionHeading}><div><h2>{openCollection.collection.title}</h2><p>{openCollection.collection.description}</p></div>
          <button type="button" className={styles.archive} onClick={() => setEditingCollection(value => !value)}>{editingCollection ? "Cancelar edición" : "Editar colección"}</button>
          <button type="button" className={styles.archive} onClick={() => void archiveCollection(openCollection.collection)}>Archivar colección</button>
          <button type="button" className={styles.archive} onClick={() => setOpenCollection(null)}>Cerrar colección</button>
        </div>
        {editingCollection && <form className={styles.collectionForm} onSubmit={event => void saveCollection(event)}>
          <label>Nombre <input value={editingTitle} onChange={event => setEditingTitle(event.target.value)} maxLength={120} required /></label>
          <label>Descripción <input value={editingDescription} onChange={event => setEditingDescription(event.target.value)} maxLength={500} /></label>
          <button type="submit" className={styles.uploadButton}>Guardar cambios</button>
        </form>}
        <div className={styles.grid}>{openCollection.drawings.map((item, index) => <button className={styles.card} type="button" key={item.id} onClick={() => setSelected(item)} aria-label={`Abrir dibujo ${index + 1}`}><Image src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" width={384} height={384} unoptimized /></button>)}</div>
      </section>}
      {loading ? <p className={styles.empty}>Cargando dibujos…</p> : items.length === 0 ? (
        <section className={styles.emptyState}>
          <div className={styles.emptyArt} aria-hidden="true">✳</div>
          <h2>La galería empieza acá</h2>
          <p>Agregá dibujos PNG o JPG para verlos y compartirlos en familia.</p>
        </section>
      ) : (
        <section className={styles.grid} aria-label="Dibujos de la familia">
          {items.map((item, index) => <button className={styles.card} type="button" key={item.id} onClick={() => setSelected(item)} aria-label={`Abrir dibujo ${index + 1}`}>
            <Image src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" width={384} height={384} unoptimized />
          </button>)}
        </section>
      )}
      <dialog ref={dialogRef} className={styles.dialog} aria-label="Detalle del dibujo" onCancel={event => { event.preventDefault(); setSelected(null); }} onClick={event => { if (event.target === dialogRef.current) setSelected(null); }}>
        {selected && <div className={styles.detail}>
          <button className={styles.close} type="button" onClick={() => setSelected(null)} aria-label="Cerrar dibujo">×</button>
          <Image src={selected.displayUrl} alt="Dibujo familiar ampliado" width={selected.width} height={selected.height} unoptimized />
          {(canManageAll || selected.authorMemberId === currentMemberId) && <button className={styles.archive} type="button" onClick={() => void archive(selected)}>Archivar dibujo</button>}
          {collections.filter(collection => collection.ownerMemberId === selected.authorMemberId).length > 0 && <label className={styles.collectionPicker}>Agregar a colección
            <select defaultValue="" onChange={event => { if (event.currentTarget.value) void addDrawingToCollection(selected, event.currentTarget.value); }}><option value="">Elegir colección…</option>
              {collections.filter(collection => collection.ownerMemberId === selected.authorMemberId).map(collection => <option key={collection.id} value={collection.id}>{collection.title}</option>)}
            </select>
          </label>}
          {openCollection?.drawings.some(item => item.id === selected.id) && <button className={styles.archive} type="button" onClick={() => void removeDrawingFromCollection(selected)}>Quitar de esta colección</button>}
        </div>}
      </dialog>
    </main>
  );
}
