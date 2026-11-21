import type { UfcCardChanges } from "@/lib/sports/import-rules";
import { formatSportsDate } from "@/lib/sports/rules";

export default function UfcImportPreview({ card }: { card: UfcCardChanges }) {
  return <article>
    <h4>{card.title}</h4>
    <p>{formatSportsDate(card.eventDate)} · {card.action === "inserted" ? "Nueva cartelera" : card.action === "protected" ? "Contenido protegido" : "Actualizar cartelera"}</p>
    <p>Esta carga afecta únicamente esta cartelera. Se conservan los pronósticos; no se trasladan a peleas nuevas.</p>
    {([ ["Se conservan", card.retained], ["Se agregan", card.added], ["Se retiran", card.removed] ] as const).map(([label, fights]) => <div key={label}>
      <strong>{label}: {fights.length}</strong>
      {fights.length > 0 && <ul>{fights.map(fight => <li key={fight}>{fight}</li>)}</ul>}
    </div>)}
  </article>;
}
