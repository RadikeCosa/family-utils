"use client";
import type {
  Availability,
  AvailabilitySummary,
  OfferMode,
} from "@/lib/library/availability";
import { MODE_LABELS, reviewStale } from "@/lib/library/availability";
import styles from "./Availability.module.css";
export function AvailabilityBadges({ value }: { value?: Availability }) {
  if (!value?.checks.length) return null;
  const offers = value.checks.flatMap((c) =>
    c.offers.map((o) => ({
      name: c.platform.name,
      mode: o.mode,
      stale: reviewStale(c.checkedOn, [o.mode], value.today),
    })),
  );
  return (
    <div className={styles.badges} aria-label="Última disponibilidad conocida">
      <span>Según la última revisión</span>
      {offers.map((o) => (
        <span className={styles.badge} key={`${o.name}:${o.mode}`}>
          {o.name} · {MODE_LABELS[o.mode]}
        </span>
      ))}
      {value.checks.some((c) => c.stale) && (
        <span className={styles.stale}>Revisar</span>
      )}
      {!offers.length && (
        <span>Sin opciones encontradas en las plataformas revisadas</span>
      )}
    </div>
  );
}
export function AvailabilityDetails({ value }: { value: Availability }) {
  const offers = value.checks.flatMap((check) =>
    check.offers.map((offer) => ({ check, offer })),
  );
  return (
    <div className={styles.content}>
      <p className={styles.muted}>
        Disponibilidad a demanda en Argentina. Las plataformas pueden cambiar su
        catálogo.
      </p>
      {!value.checks.length ? (
        <p>Todavía no revisamos esta película.</p>
      ) : !offers.length ? (
        <p>
          No encontramos opciones gratuitas ni por suscripción en las
          plataformas revisadas.
        </p>
      ) : null}
      {(["subscription", "free"] as const).map((group) => {
        const entries = offers.filter(({ offer }) =>
          group === "subscription"
            ? offer.mode === "subscription"
            : offer.mode !== "subscription",
        );
        return entries.length ? (
          <div key={group}>
            <h3>{group === "subscription" ? "Con suscripción" : "Gratis"}</h3>
            <ul className={styles.offers}>
              {entries.map(({ check, offer }) => {
                const stale = reviewStale(
                  check.checkedOn,
                  [offer.mode],
                  value.today,
                );
                return (
                  <li key={`${check.platformId}:${offer.mode}`}>
                    <strong>{check.platform.name}</strong> ·{" "}
                    {MODE_LABELS[offer.mode]}{" "}
                    {stale && <span className={styles.stale}>Revisar</span>}
                    <p className={styles.muted}>
                      {stale ? "Última disponibilidad conocida. " : ""}Revisada
                      el {check.checkedOn.split("-").reverse().join("/")}.
                      {stale
                        ? ` Conviene revisar: pasaron ${offer.mode === "subscription" ? 30 : 14} días o más.`
                        : ""}
                    </p>
                    {offer.url && (
                      <a
                        href={offer.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {offer.linkKind === "direct"
                          ? `Ver en ${check.platform.name}`
                          : "Consultar disponibilidad"}
                      </a>
                    )}
                    {offer.directVerifiedOn && (
                      <p className={styles.muted}>
                        Enlace directo comprobado el {offer.directVerifiedOn}.
                      </p>
                    )}
                    {offer.channel && (
                      <p>
                        Canal:{" "}
                        <a
                          href={offer.channel.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {offer.channel.name}
                        </a>{" "}
                        ·{" "}
                        <a
                          href={offer.channel.authoritySourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Titularidad del canal
                        </a>
                      </p>
                    )}
                    <details>
                      <summary>Fuentes de esta oferta</summary>
                      {offer.sourceUrls.map((url, i) => (
                        <p key={url}>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Fuente {i + 1}
                          </a>
                        </p>
                      ))}
                    </details>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null;
      })}
      {value.checks.length > 0 && (
        <details>
          <summary>Plataformas revisadas y cobertura parcial</summary>
          <p className={styles.muted}>
            Estas revisiones no cubren necesariamente todos los servicios.
          </p>
          <ul>
            {value.checks.map((c) => (
              <li key={c.platformId}>
                {c.platform.name}: {c.checkedOn} ·{" "}
                {c.offers.length
                  ? `${c.offers.length} opciones`
                  : "Sin opciones gratuitas ni por suscripción"}{" "}
                {c.stale && <span className={styles.stale}>Revisar</span>}
                <ul>
                  {c.sourceUrls.map((url, i) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        Fuente {i + 1}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
export function AvailabilityFilters({
  summary,
  selected,
  free,
  onChange,
}: {
  summary: AvailabilitySummary;
  selected: string[];
  free: boolean;
  onChange: (platforms: string[], free: boolean) => void;
}) {
  const options = summary.platforms.filter(
    (p) => p.hasOffers || selected.includes(p.id),
  );
  const incompatible =
    free &&
    selected.length > 0 &&
    summary.platforms
      .filter((p) => selected.includes(p.id))
      .every((p) => !p.modes.some((m) => m !== "subscription"));
  return (
    <div className={styles.filters}>
      <details>
        <summary>
          Dónde verla
          {selected.length
            ? ` · ${selected.length} ${selected.length === 1 ? "plataforma" : "plataformas"}`
            : ""}
        </summary>
        <div className={styles.options}>
          {options.map((p) => (
            <label className={styles.checkLabel} key={p.id}>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, p.id]
                      : selected.filter((id) => id !== p.id),
                    free,
                  )
                }
              />
              {p.name}
              {!p.hasOffers ? " (sin ofertas actuales registradas)" : ""}
            </label>
          ))}
          {!options.length && (
            <p>Todavía no hay plataformas con ofertas registradas.</p>
          )}
        </div>
        <p className={styles.muted}>
          Mostramos coincidencias en cualquiera de las plataformas
          seleccionadas.
        </p>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={free}
            onChange={(e) => onChange(selected, e.target.checked)}
          />
          Gratis, también con publicidad
        </label>
        <p className={styles.muted}>La cobertura puede ser parcial.</p>
      </details>
      <p className={styles.muted}>
        {summary.reviewed} de {summary.total} películas con alguna revisión.
        {summary.stale > 0 && (
          <>
            {" "}
            {summary.stale} {summary.stale === 1 ? "requiere" : "requieren"}{" "}
            actualización.
          </>
        )}
      </p>
      {incompatible && (
        <p role="status">
          Las plataformas seleccionadas no tienen modalidades gratuitas.{" "}
          <button type="button" onClick={() => onChange(selected, false)}>
            Quitar Gratis
          </button>
        </p>
      )}
    </div>
  );
}
export const modeOptions: OfferMode[] = [
  "subscription",
  "free",
  "free_with_ads",
];
