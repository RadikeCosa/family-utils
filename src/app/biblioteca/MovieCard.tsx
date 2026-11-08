import Link from "next/link";
import { genreLabels } from "@/lib/library/genres";
import { familyRating } from "@/lib/library/presentation";
import { STATUS_LABELS, type LibraryWork } from "@/lib/library/types";
import Runtime from "./Runtime";
import styles from "./library.module.css";

const starPath = "m12 2 3.1 6.3 7 .9-5.1 4.9 1.2 7L12 17.8l-6.2 3.3 1.2-7L1.9 9.2l7-.9Z";

function RatingDisplay({ label, rating, description, count }: { label: string; rating: number | null; description: string; count?: number }) {
  return <div className={styles.ratingRow}>
    <span className={styles.ratingLabel}>{label}</span>
    {rating === null ? <span className={styles.ratingEmpty}>{label === "Familia" ? "Sin valoraciones" : "Sin valorar"}</span> : <span className={styles.ratingValue} role="img" aria-label={description}>
      <span className={styles.ratingStars} aria-hidden="true">{[0, 1, 2, 3, 4].map(index => <span className={styles.ratingStar} key={index}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={starPath} /></svg>
        <span className={styles.starFill} style={{ width: `${Math.max(0, Math.min(1, rating - index)) * 100}%` }}><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5"><path d={starPath} /></svg></span>
      </span>)}</span>
      {count !== undefined && <span className={styles.ratingCount} aria-hidden="true">{count} {count === 1 ? "valoración" : "valoraciones"}</span>}
    </span>}
  </div>;
}

export default function MovieCard({ work, memberId }: { work: LibraryWork; memberId: string }) {
  const mine = work.personal.find(entry => entry.memberId === memberId);
  const ratings = work.personal.flatMap(entry => entry.rating === null ? [] : [entry.rating]);
  const average = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null;
  return <Link className={styles.workCard} href={`/cinemateca/${work.id}`}>
    <div className={styles.workContent}>
      <div className={styles.movieHeading}>
        <h2>{work.title}</h2>
        <p>{[work.creator, work.year].filter(Boolean).join(" · ") || "Por descubrir"}{work.runtimeMinutes != null && <> · <Runtime minutes={work.runtimeMinutes} /></>}</p>
      </div>
      {work.genres.length > 0 && <div className={styles.genreBadges} aria-label="Géneros">{genreLabels(work.genres).map(label => <span className={styles.genreBadge} key={label}>{label}</span>)}</div>}
      <div className={styles.movieBadges}>
        <span className={styles.statusBadge} data-status={mine?.status ?? "none"}>{mine?.status ? STATUS_LABELS[mine.status] : "Sin estado"}</span>
        {work.archivedAt && <span className={styles.archiveBadge}>Archivada</span>}
      </div>
      <div className={styles.movieRatings}>
        <RatingDisplay label="Mi valoración" rating={mine?.rating ?? null} description={`Mi valoración: ${mine?.rating} de 5 estrellas`} />
        <RatingDisplay label="Familia" rating={average} description={familyRating(work.personal)} count={ratings.length} />
      </div>
    </div>
  </Link>;
}
