"use client";
import { GENRES, genreLabels, normalizeGenres, type Genre } from "@/lib/library/genres";
import styles from "./library.module.css";
export default function GenresField({ value, onChange }: { value: Genre[]; onChange: (genres: Genre[]) => void }) {
  const labels = genreLabels(value);
  return <section className={styles.genrePicker} aria-label="Géneros">
    <h3>Géneros</h3>
    {labels.length > 0 && <div className={styles.genreBadges}>{labels.map(label => <span className={styles.genreBadge} key={label}>{label}</span>)}</div>}
    <details className={styles.genreField}>
      <summary>Elegir géneros <svg className={styles.disclosureArrow} aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></summary>
      <fieldset><legend className={styles.srStatus}>Géneros de la película (opcional)</legend><div className={styles.genreChoices}>{GENRES.map(genre => <label className={styles.genreChoice} key={genre.id}>
        <input type="checkbox" checked={value.includes(genre.id)} onChange={event => onChange(normalizeGenres(event.target.checked ? [...value, genre.id] : value.filter(id => id !== genre.id)))} /><span>{genre.label}</span>
      </label>)}</div></fieldset>
    </details>
  </section>;
}
