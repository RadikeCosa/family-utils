"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./library.module.css";

export default function LimitCounter({ count, limit, label, id }: { count: number; limit: number; label: string; id: string }) {
  const threshold = Math.ceil(limit * .8);
  const previous = useRef(count);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const before = previous.current;
    previous.current = count;
    const crossed = (before < threshold && count >= threshold) || (before < limit && count >= limit);
    const timer = setTimeout(() => setAnnouncement(crossed ? `${label}: ${count} de ${limit}.` : ""), 0);
    return () => clearTimeout(timer);
  }, [count, limit, threshold, label]);
  return <>
    <small id={id} className={count < threshold ? styles.srStatus : undefined}>{count >= threshold ? `${count}/${limit}` : `Máximo: ${limit}`}</small>
    <span className={styles.srStatus} role="status" aria-atomic="true">{announcement}</span>
  </>;
}
