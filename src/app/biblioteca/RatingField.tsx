"use client";
import { useId, useRef, useState } from "react";
import styles from "./library.module.css";
export default function RatingField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const name = useId();
  const first = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState("");
  return <fieldset className={styles.ratingField}>
    <legend>Mi valoración</legend>
    <div className={styles.stars}>{[1, 2, 3, 4, 5].map((rating) => <label className={styles.starChoice} key={rating}>
      <input ref={rating === 1 ? first : undefined} className={styles.starInput} type="radio" name={name} value={rating} checked={value === String(rating)} aria-label={`${rating} de 5 estrellas`} onChange={() => { setAnnouncement(""); onChange(String(rating)); }} />
      <span className={styles.starFace}><svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill={Number(value) >= rating ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5"><path d="m12 2 3.1 6.3 7 .9-5.1 4.9 1.2 7L12 17.8l-6.2 3.3 1.2-7L1.9 9.2l7-.9Z" /></svg></span>
    </label>)}</div>
    <div className={styles.ratingActions}><span>{value ? `${value} de 5 estrellas` : "Sin valorar"}</span><button type="button" disabled={!value} onClick={() => { onChange(""); setAnnouncement("Sin valorar"); first.current?.focus(); }}>Quitar valoración</button></div>
    <span className={styles.srStatus} role="status">{announcement}</span>
  </fieldset>;
}
