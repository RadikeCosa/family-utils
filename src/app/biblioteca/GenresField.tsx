"use client";
import { GENRES, genreLabels, normalizeGenres, type Genre } from "@/lib/library/genres";
import styles from "./library.module.css";
export default function GenresField({ value, onChange }: { value: Genre[]; onChange: (genres: Genre[]) => void }) {
  const labels = genreLabels(value);
  const summary = labels.length ? `${labels.slice(0, 2).join(", ")}${labels.length > 2 ? ` +${labels.length - 2}` : ""}` : "Opcional";
  return <details className={styles.genreField}>
    <summary>Géneros <span className={styles.companionSummary}>{summary}</span></summary>
    <fieldset><legend className={styles.srStatus}>Géneros de la película (opcional)</legend><div className={styles.genreChoices}>{GENRES.map(genre => <label className={styles.genreChoice} key={genre.id}>
      <input type="checkbox" checked={value.includes(genre.id)} onChange={(event) => onChange(normalizeGenres(event.target.checked ? [...value, genre.id] : value.filter(id => id !== genre.id)))} /><span>{genre.label}</span>
    </label>)}</div></fieldset>
  </details>;
}
