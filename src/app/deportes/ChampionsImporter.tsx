"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgendaIssue } from "@/lib/sports/champions-rules";
import styles from "./agenda.module.css";
type Preview = { token: string; summary: { round: string; matches: number }; matches: Array<{ reference: string; title: string; before: { startsAt: string | null } | null; after: { startsAt: string | null } }> };
const time = (x: string | null) => x ? new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(x)) : "Horario a confirmar";
export default function ChampionsImporter({ roundId }: { roundId: string | null }) {
  const router = useRouter(), errorsRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [errors, setErrors] = useState<AgendaIssue[]>([]), [message, setMessage] = useState(""), [preview, setPreview] = useState<Preview | null>(null);
  function fail(items: AgendaIssue[]) { setErrors(items); requestAnimationFrame(() => errorsRef.current?.focus()); }
  async function template(example: boolean) {
    setErrors([]);
    try {
      const r = await fetch(`/api/sports/champions/templates?${example ? "example=true" : roundId ? `round=${roundId}` : "example=true"}`, { cache: "no-store" });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      const content = JSON.stringify(data, null, 2);
      if (example) { setText(content); setPreview(null); setMessage("Ejemplo ficticio: se puede validar, pero no importar."); }
      else { const url = URL.createObjectURL(new Blob([content], { type: "application/json" })); const a = document.createElement("a"); a.href=url; a.download="champions-agenda.json"; a.click(); URL.revokeObjectURL(url); }
    } catch(e) { fail([{ path:"bundle",message:e instanceof Error ? e.message : "No se pudo obtener la plantilla." }]); }
  }
  async function submit(mode: "preview" | "import") {
    setBusy(true); setErrors([]); setMessage("");
    try {
      if (new TextEncoder().encode(text).length > 900000) throw new Error("El archivo supera 900 KB.");
      const bundle: unknown = JSON.parse(text);
      const r = await fetch("/api/sports/champions/import", { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,bundle,...(preview ? {token:preview.token}:{})}) });
      const data = await r.json();
      if (!r.ok) { setPreview(null); fail(data.errors ?? [{ path:"bundle",message:data.error ?? "No se pudo importar." }]); return; }
      if (mode === "preview") setPreview(data);
      else { setPreview(null); setMessage(data.changed ? "Jornada importada." : "La jornada ya estaba al día."); router.refresh(); }
    } catch(e) { setPreview(null); fail([{path:"bundle",message:e instanceof SyntaxError ? "El JSON no es válido." : e instanceof Error ? e.message : "No se pudo importar."}]); }
    finally { setBusy(false); }
  }
  return <details className={styles.admin}><summary>Administrar Champions</summary>
    <h3>Importar agenda de una jornada</h3><p>Revisá los datos y las fuentes. Primero se valida; la confirmación guarda toda la jornada o conserva lo anterior.</p>
    <div ref={errorsRef} tabIndex={-1} role={errors.length ? "alert" : undefined}>{errors.length > 0 && <><h4>Revisá la carga</h4><ul>{errors.map((e,i)=><li key={`${e.path}:${i}`}><a href="#champions-json">{e.path}: {e.message}</a></li>)}</ul></>}</div>
    <div className={styles.actions}><button disabled={busy} onClick={()=>void template(true)}>Ver ejemplo Champions</button><button disabled={busy} onClick={()=>void template(false)}>Descargar plantilla Champions</button></div>
    <label>Archivo de agenda Champions<input type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const f=e.target.files?.[0]; if(!f)return; setPreview(null);setErrors([]);if(f.size>900000){fail([{path:"bundle",message:"El archivo supera 900 KB."}]);return;}setText(await f.text());}} /></label>
    <label htmlFor="champions-json">Contenido JSON de Champions</label><textarea id="champions-json" rows={8} disabled={busy} value={text} onChange={e=>{setText(e.target.value);setPreview(null);setErrors([]);}} />
    <div className={styles.actions}><button disabled={busy||!text.trim()} onClick={()=>void submit("preview")}>{busy ? "Procesando…":"Validar agenda Champions"}</button>{preview && <button disabled={busy} onClick={()=>void submit("import")}>Confirmar agenda Champions</button>}</div>
    {preview && <section className={styles.panel} aria-label="Vista previa de Champions"><h4>Vista previa · todavía no se guardó</h4><p>{preview.summary.round} · {preview.summary.matches} partidos</p><ul>{preview.matches.map(m=><li key={m.reference}><strong>{m.title}</strong><p>{m.before ? time(m.before.startsAt) : "Partido nuevo"} → {time(m.after.startsAt)}</p></li>)}</ul><p>Actualizar un horario no reabre pronósticos cerrados.</p></section>}
    {message && <p role="status">{message}</p>}
  </details>;
}
