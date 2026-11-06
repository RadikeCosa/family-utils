"use client";
import { libraryIssueMessage, type OperationIssue } from "@/lib/library/form-errors";
import styles from "./library.module.css";
export default function FormIssue({ issue, onRetry, disabled = false }: { issue: OperationIssue | null; onRetry?: () => void; disabled?: boolean }) {
  if (!issue) return null;
  return <div className={styles.error} role="alert"><p>{libraryIssueMessage(issue.code)}</p>{onRetry && <button type="button" disabled={disabled} onClick={onRetry}>Reintentar</button>}</div>;
}
