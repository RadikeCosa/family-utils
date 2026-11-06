"use client";
import type { LibraryProfile } from "@/lib/library/types";
import { orderCompanions, selectedCompanionsSummary } from "@/lib/library/presentation";
import styles from "./library.module.css";
export default function CompanionsField({ members, selected, onChange }: { members: LibraryProfile[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const ordered = orderCompanions(members);
  return <details className={styles.companions}>
    <summary className={styles.companionToggle}>¿Con quién la viste? <span className={styles.companionSummary}>{selectedCompanionsSummary(ordered, selected)}</span></summary>
    <fieldset><legend className={styles.srStatus}>Acompañantes (opcional)</legend><div className={styles.companionChoices}>{ordered.map((member) => <label className={styles.companionChoice} key={member.id}>
      <input type="checkbox" checked={selected.includes(member.id)} onChange={(event) => onChange(event.target.checked ? [...selected, member.id] : selected.filter((id) => id !== member.id))} />
      <span>{member.name}{member.archivedAt ? " (perfil archivado)" : ""}</span>
    </label>)}</div></fieldset>
  </details>;
}
