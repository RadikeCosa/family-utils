"use client";
import { useRef } from "react";
import { MAX_CAST_MEMBERS, MAX_CAST_NAME_LENGTH, movieTextLength, normalizeCastName } from "@/lib/library/movie-metadata";
import LimitCounter from "./LimitCounter";
import styles from "./library.module.css";

export default function CastField({ names, pending, error, notice, onPending, onAdd, onRemove }: {
  names: string[]; pending: string; error?: string; notice: string;
  onPending: (value: string) => void; onAdd: () => void; onRemove: (index: number) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const longest = Math.max(0, ...pending.split(/\r\n?|\n/).map(name => movieTextLength(normalizeCastName(name))));
  return <div className={styles.castField}>
    <h3>Reparto</h3>
    <p className={styles.fieldHelp}>Agregá los nombres en orden de importancia. Podés pegar varios, uno por línea.</p>
    {names.length > 0 && <ol className={styles.castList}>{names.map((name, index) => <li key={name}>
      <span>{name}</span><button type="button" aria-label={`Quitar del reparto: ${name}`} onClick={() => { onRemove(index); input.current?.focus(); }}>Quitar</button>
    </li>)}</ol>}
    <LimitCounter id="work-cast-count" count={names.length} limit={MAX_CAST_MEMBERS} label="Integrantes del reparto" />
    <label>Nombres del reparto<textarea ref={input} name="castPending" rows={2} value={pending} aria-invalid={!!error} aria-describedby={`work-cast-help work-cast-name-count${error ? " work-error-castPending" : ""}`} onChange={event => onPending(event.target.value)} /></label>
    <small id="work-cast-help">Hasta 30 integrantes. Los nombres pendientes también se incorporan al guardar.</small>
    <LimitCounter id="work-cast-name-count" count={longest} limit={MAX_CAST_NAME_LENGTH} label="Nombre más largo" />
    {error && <small className={styles.fieldError} id="work-error-castPending">{error}</small>}
    <button type="button" className={styles.addCast} disabled={!pending.trim()} onClick={onAdd}>Agregar nombres</button>
    <p className={styles.fieldHelp} role="status" aria-atomic="true">{notice}</p>
  </div>;
}
