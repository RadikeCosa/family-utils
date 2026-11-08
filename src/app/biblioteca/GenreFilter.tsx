"use client";
import { useId, useRef } from "react";
import { GENRES } from "@/lib/library/genres";
import styles from "./library.module.css";

const options = [{ id: "", label: "Todos los géneros" }, ...GENRES, { id: "none", label: "Sin género" }];

export default function GenreFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const label = options.find(option => option.id === value)?.label ?? "Todos los géneros";

  return <>
    <button type="button" className={styles.genreTrigger} aria-haspopup="dialog" aria-label={`Género: ${label}`} data-active={Boolean(value)} onClick={() => dialog.current?.showModal()}>
      <span>{value ? label : "Género"}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m7 10 5 5 5-5" /></svg>
    </button>
    <dialog ref={dialog} className={styles.genreDialog} aria-labelledby={titleId}>
      <div className={styles.genreDialogHeader}>
        <h2 id={titleId} tabIndex={-1} autoFocus>Elegí un género</h2>
        <button type="button" aria-label="Cerrar géneros" onClick={() => dialog.current?.close()}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </div>
      <div className={styles.genreFilterOptions} role="group" aria-label="Género">
        {options.map(option => <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => { onChange(option.id); dialog.current?.close(); }}>
          <span>{option.label}</span>
          {value === option.id && <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6" /></svg>}
        </button>)}
      </div>
    </dialog>
  </>;
}
