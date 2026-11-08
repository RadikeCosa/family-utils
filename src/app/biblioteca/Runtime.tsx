import { formatRuntime } from "@/lib/library/movie-metadata";
import styles from "./library.module.css";

export default function Runtime({ minutes }: { minutes: number }) {
  const duration = formatRuntime(minutes);
  return <span><span aria-hidden="true">{duration.text}</span><span className={styles.srStatus}>{duration.label}</span></span>;
}
