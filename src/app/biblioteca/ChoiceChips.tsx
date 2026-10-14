"use client";
import styles from "./library.module.css";
export type ChoiceOption = { value: string; label: string };
export default function ChoiceChips({ name, legend, value, options, onChange, disabled = false }: { name: string; legend: string; value: string; options: readonly ChoiceOption[]; onChange: (value: string) => void; disabled?: boolean }) {
  return <fieldset className={styles.chipGroup}>
    <legend>{legend}</legend>
    <div className={styles.chips}>{options.map((option) => <label className={styles.chip} key={option.value}>
      <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} />
      <span>{option.label}</span>
    </label>)}</div>
  </fieldset>;
}
