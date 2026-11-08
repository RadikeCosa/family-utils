"use client";
import { useEffect, useId, useRef, useState } from "react";
import { familyDay } from "@/lib/library/rules";
import {
  MODE_LABELS,
  OFFER_MODES,
  type Availability,
  type AvailabilityProposal,
  type CommitResult,
  type CompletedCheck,
  type Platform,
  type StreamingOffer,
} from "@/lib/library/availability";
import styles from "./Availability.module.css";
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/library/${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "No pudimos completar la operación.");
  return data;
}
const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
const emptyOffer = (mode: StreamingOffer["mode"]): StreamingOffer => ({
  mode,
  sourceUrls: [],
  linkKind: "aggregator",
  url: "",
  directVerifiedOn: null,
  channel: null,
});
function OfferFields({
  offer,
  onChange,
  platform,
}: {
  offer: StreamingOffer;
  onChange: (value: StreamingOffer) => void;
  platform: Platform;
}) {
  return (
    <fieldset>
      <legend>{MODE_LABELS[offer.mode]}</legend>
      <label>
        Tipo de enlace
        <select
          value={offer.linkKind}
          onChange={(e) =>
            onChange({
              ...offer,
              linkKind: e.target.value as StreamingOffer["linkKind"],
              url: e.target.value === "none" ? null : (offer.url ?? ""),
              directVerifiedOn:
                e.target.value === "direct"
                  ? (offer.directVerifiedOn ?? familyDay())
                  : null,
            })
          }
        >
          <option value="aggregator">Consultar en un agregador</option>
          <option value="direct">Acceso directo comprobado</option>
          <option value="none">Sin enlace</option>
        </select>
      </label>
      {offer.linkKind !== "none" && (
        <label>
          Enlace de la película
          <input
            type="url"
            required
            value={offer.url ?? ""}
            onChange={(e) => onChange({ ...offer, url: e.target.value })}
          />
        </label>
      )}
      {offer.linkKind === "direct" && (
        <label>
          Fecha de comprobación del enlace
          <input
            type="date"
            required
            max={familyDay()}
            value={offer.directVerifiedOn ?? ""}
            onChange={(e) =>
              onChange({ ...offer, directVerifiedOn: e.target.value })
            }
          />
        </label>
      )}
      <label>
        Fuentes de la oferta, una dirección por línea
        <textarea
          required
          value={offer.sourceUrls.join("\n")}
          onChange={(e) =>
            onChange({ ...offer, sourceUrls: e.target.value.split("\n") })
          }
        />
      </label>
      {platform.requiresChannel && (
        <>
          <label>
            Nombre del canal oficial
            <input
              required
              value={offer.channel?.name ?? ""}
              onChange={(e) =>
                onChange({
                  ...offer,
                  channel: {
                    name: e.target.value,
                    url: offer.channel?.url ?? "",
                    authoritySourceUrl: offer.channel?.authoritySourceUrl ?? "",
                  },
                })
              }
            />
          </label>
          <label>
            Dirección del canal
            <input
              type="url"
              required
              value={offer.channel?.url ?? ""}
              onChange={(e) =>
                onChange({
                  ...offer,
                  channel: {
                    name: offer.channel?.name ?? "",
                    url: e.target.value,
                    authoritySourceUrl: offer.channel?.authoritySourceUrl ?? "",
                  },
                })
              }
            />
          </label>
          <label>
            Fuente que acredita la titularidad del canal
            <input
              type="url"
              required
              value={offer.channel?.authoritySourceUrl ?? ""}
              onChange={(e) =>
                onChange({
                  ...offer,
                  channel: {
                    name: offer.channel?.name ?? "",
                    url: offer.channel?.url ?? "",
                    authoritySourceUrl: e.target.value,
                  },
                })
              }
            />
          </label>
        </>
      )}
    </fieldset>
  );
}
function Snapshot({ value }: { value: CompletedCheck | null }) {
  if (!value) return <p>Sin revisión anterior.</p>;
  return (
    <div>
      <p>Revisión: {value.checkedOn}</p>
      {value.offers.length ? (
        <ul>
          {value.offers.map((o) => (
            <li key={o.mode}>
              <strong>{MODE_LABELS[o.mode]}</strong>
              {o.url && (
                <a href={o.url} target="_blank" rel="noopener noreferrer">
                  {o.linkKind === "direct"
                    ? "Enlace directo"
                    : "Consultar disponibilidad"}
                </a>
              )}
              {o.directVerifiedOn && (
                <p>Enlace comprobado: {o.directVerifiedOn}</p>
              )}
              {o.channel && (
                <p>
                  Canal: {o.channel.name} ·{" "}
                  <a
                    href={o.channel.authoritySourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Titularidad
                  </a>
                </p>
              )}
              <ul>
                {o.sourceUrls.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p>Sin opciones gratuitas ni por suscripción encontradas.</p>
      )}
      <p>Fuentes de la revisión:</p>
      <ul>
        {value.sourceUrls.map((url) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
export default function AvailabilityTools({
  workId,
  value,
  canManage,
  onSaved,
}: {
  workId?: string;
  value?: Availability;
  canManage: boolean;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [platforms, setPlatforms] = useState<Platform[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [text, setText] = useState(""),
    [preview, setPreview] = useState<AvailabilityProposal | null>(null),
    [results, setResults] = useState<CommitResult[] | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const commitKey = useRef<string | null>(null),
    errorBox = useRef<HTMLParagraphElement>(null),
    proposalHeading = useRef<HTMLHeadingElement>(null);
  const errorId = useId(),
    jsonId = useId();
  const [platformId, setPlatformId] = useState(""),
    [checkedOn, setCheckedOn] = useState(familyDay()),
    [sources, setSources] = useState(""),
    [offers, setOffers] = useState<StreamingOffer[]>([]);
  const selected = platforms.find((p) => p.id === platformId);
  const [catalog, setCatalog] = useState(false),
    [editingPlatform, setEditingPlatform] = useState("");
  const [pName, setPName] = useState(""),
    [pAliases, setPAliases] = useState(""),
    [pModes, setPModes] = useState<StreamingOffer["mode"][]>(["subscription"]),
    [pCoverage, setPCoverage] = useState<Platform["coverage"]>("pending"),
    [pSources, setPSources] = useState(""),
    [pChannel, setPChannel] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    api("platforms")
      .then((data) => {
        if (active) setPlatforms(data.platforms);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [open]);
  function invalidate() {
    setPreview(null);
    setResults(null);
    setConfirmed(false);
    commitKey.current = null;
  }
  function selectPlatform(id: string) {
    invalidate();
    setPlatformId(id);
    const previous = value?.checks.find((c) => c.platformId === id);
    setCheckedOn(familyDay());
    setSources(previous?.sourceUrls.join("\n") ?? "");
    setOffers(previous?.offers ?? []);
  }
  function editCatalog(id: string) {
    setEditingPlatform(id);
    const p = platforms.find((p) => p.id === id);
    setPName(p?.name ?? "");
    setPAliases(p?.aliases.join("\n") ?? "");
    setPModes(p?.modes ?? ["subscription"]);
    setPCoverage(p?.coverage ?? "pending");
    setPSources(p?.coverageSources.join("\n") ?? "");
    setPChannel(p?.requiresChannel ?? false);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos completar la operación.",
      );
      requestAnimationFrame(() => errorBox.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  async function prepare(raw: unknown) {
    const data = await api("availability/preview", "POST", raw);
    setPreview(data);
    setResults(null);
    setConfirmed(false);
    commitKey.current = crypto.randomUUID();
    requestAnimationFrame(() => proposalHeading.current?.focus());
  }
  return (
    <section className={open ? styles.section : styles.closed}>
      <div className={styles.actions}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open
            ? "Cerrar revisión"
            : workId
              ? "Revisar dónde verla"
              : "Importar revisión"}
        </button>
      </div>
      {open && (
        <>
          <h2>
            {workId
              ? "Revisión de disponibilidad"
              : "Importar revisión de disponibilidad"}
          </h2>
          <p className={styles.muted}>
            Argentina · suscripción y gratis. Primero verás los cambios; se
            guardan únicamente al confirmar.
          </p>
          {error && (
            <p
              id={errorId}
              ref={errorBox}
              tabIndex={-1}
              className={styles.error}
              role="alert"
            >
              {error}
            </p>
          )}
          {workId && (
            <form
              className={styles.form}
              aria-describedby={error ? errorId : undefined}
              onSubmit={(e) => {
                e.preventDefault();
                void run(() =>
                  prepare({
                    schemaVersion: 1,
                    country: "AR",
                    movies: [
                      {
                        workId,
                        checks: [
                          {
                            platformId,
                            outcome: "completed",
                            checkedOn,
                            sourceUrls: lines(sources),
                            offers: offers.map((o) => ({
                              ...o,
                              sourceUrls: lines(o.sourceUrls.join("\n")),
                            })),
                          },
                        ],
                      },
                    ],
                  }),
                );
              }}
            >
              <fieldset disabled={busy}>
                <legend>Una plataforma</legend>
                <label>
                  Plataforma
                  <select
                    required
                    value={platformId}
                    onChange={(e) => selectPlatform(e.target.value)}
                  >
                    <option value="">Elegí una plataforma</option>
                    {platforms.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.coverage !== "verified"
                          ? " · cobertura sin comprobar"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Fecha de revisión en Argentina
                  <input
                    type="date"
                    required
                    max={familyDay()}
                    value={checkedOn}
                    onChange={(e) => {
                      invalidate();
                      setCheckedOn(e.target.value);
                    }}
                  />
                </label>
                <label>
                  Fuentes de la revisión, una dirección por línea
                  <textarea
                    required
                    value={sources}
                    onChange={(e) => {
                      invalidate();
                      setSources(e.target.value);
                    }}
                  />
                </label>
                {selected && (
                  <>
                    <p>
                      Registrá todas las opciones encontradas en esta
                      plataforma. Sin opciones seleccionadas, se guardará una
                      revisión sin ofertas.
                    </p>
                    {selected.coverage !== "verified" && (
                      <p className={styles.muted}>
                        Para agregar ofertas, un administrador debe comprobar
                        primero la cobertura en Argentina.
                      </p>
                    )}
                    {selected.modes.map((mode) => (
                      <label className={styles.checkLabel} key={mode}>
                        <input
                          type="checkbox"
                          disabled={selected.coverage !== "verified"}
                          checked={offers.some((o) => o.mode === mode)}
                          onChange={(e) => {
                            invalidate();
                            setOffers(
                              e.target.checked
                                ? [...offers, emptyOffer(mode)]
                                : offers.filter((o) => o.mode !== mode),
                            );
                          }}
                        />
                        {MODE_LABELS[mode]}
                      </label>
                    ))}
                    {offers.map((o) => (
                      <OfferFields
                        key={o.mode}
                        offer={o}
                        platform={selected}
                        onChange={(next) => {
                          invalidate();
                          setOffers(
                            offers.map((old) =>
                              old.mode === next.mode ? next : old,
                            ),
                          );
                        }}
                      />
                    ))}
                  </>
                )}
                <button disabled={busy || !selected} type="submit">
                  Ver cambios antes de guardar
                </button>
              </fieldset>
            </form>
          )}
          <details>
            <summary>
              {workId
                ? "Importar un archivo de revisión"
                : "Archivo o texto de revisión"}
            </summary>
            <p className={styles.muted}>
              Formato JSON, versión 1, hasta 100 películas y 1 MB. Los
              identificadores deben pertenecer a esta familia.
            </p>
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  let raw: unknown;
                  try {
                    raw = JSON.parse(text);
                  } catch {
                    throw new Error(
                      "El texto de la revisión no es un JSON válido.",
                    );
                  }
                  await prepare(raw);
                });
              }}
            >
              <label>
                Seleccionar archivo
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      void run(async () => {
                        if (f.size > 1048576)
                          throw new Error("El archivo supera 1 MB.");
                        invalidate();
                        setText(await f.text());
                      });
                  }}
                />
              </label>
              <label htmlFor={jsonId}>Texto de la revisión</label>
              <textarea
                id={jsonId}
                required
                disabled={busy}
                value={text}
                onChange={(e) => {
                  invalidate();
                  setText(e.target.value);
                }}
              />
              <button disabled={busy} type="submit">
                Preparar vista previa
              </button>
            </form>
            <details>
              <summary>Identificadores de plataformas de esta familia</summary>
              <ul>
                {platforms.map((p) => (
                  <li key={p.id}>
                    {p.name}: <code>{p.id}</code>
                  </li>
                ))}
              </ul>
            </details>
          </details>
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setCatalog(!catalog)}
                aria-expanded={catalog}
              >
                Administrar plataformas
              </button>
              {catalog && (
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const p = platforms.find((p) => p.id === editingPlatform);
                      await api("platforms", p ? "PATCH" : "POST", {
                        ...(p ? { id: p.id, expectedVersion: p.version } : {}),
                        name: pName,
                        aliases: lines(pAliases),
                        modes: pModes,
                        coverage: pCoverage,
                        coverageSources: lines(pSources),
                        requiresChannel: pChannel,
                      });
                      setPlatforms((await api("platforms")).platforms);
                      editCatalog("");
                      invalidate();
                      await onSaved();
                    });
                  }}
                >
                  <fieldset disabled={busy}>
                    <legend>Catálogo de la familia</legend>
                    <label>
                      Crear o editar
                      <select
                        value={editingPlatform}
                        onChange={(e) => editCatalog(e.target.value)}
                      >
                        <option value="">Nueva plataforma</option>
                        {platforms.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Nombre
                      <input
                        required
                        maxLength={100}
                        value={pName}
                        onChange={(e) => setPName(e.target.value)}
                      />
                    </label>
                    <label>
                      Otros nombres, uno por línea
                      <textarea
                        value={pAliases}
                        onChange={(e) => setPAliases(e.target.value)}
                      />
                    </label>
                    <p className={styles.muted}>
                      Al renombrar, conservamos los alias anteriores para evitar
                      duplicados.
                    </p>
                    <fieldset>
                      <legend>Modalidades admitidas</legend>
                      {OFFER_MODES.map((mode) => (
                        <label className={styles.checkLabel} key={mode}>
                          <input
                            type="checkbox"
                            checked={pModes.includes(mode)}
                            onChange={(e) =>
                              setPModes(
                                e.target.checked
                                  ? [...pModes, mode]
                                  : pModes.filter((m) => m !== mode),
                              )
                            }
                          />
                          {MODE_LABELS[mode]}
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      Cobertura en Argentina
                      <select
                        value={pCoverage}
                        onChange={(e) =>
                          setPCoverage(e.target.value as Platform["coverage"])
                        }
                      >
                        <option value="pending">Pendiente</option>
                        <option value="verified">Comprobada</option>
                        <option value="unavailable">No disponible</option>
                      </select>
                    </label>
                    <label>
                      Fuentes de cobertura, una dirección por línea
                      <textarea
                        required={pCoverage === "verified"}
                        value={pSources}
                        onChange={(e) => setPSources(e.target.value)}
                      />
                    </label>
                    <label className={styles.checkLabel}>
                      <input
                        type="checkbox"
                        checked={pChannel}
                        onChange={(e) => setPChannel(e.target.checked)}
                      />
                      Exigir canal oficial y fuente de titularidad
                    </label>
                    <button type="submit">Guardar plataforma</button>
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          await api("platforms", "POST", {
                            action: "initialize",
                          });
                          setPlatforms((await api("platforms")).platforms);
                          invalidate();
                          await onSaved();
                        })
                      }
                    >
                      Agregar plataformas iniciales que falten
                    </button>
                  </fieldset>
                </form>
              )}
            </>
          )}
          {preview && (
            <section className={styles.preview}>
              <h3 ref={proposalHeading} tabIndex={-1}>
                Vista previa de los cambios
              </h3>
              <p className={styles.muted}>
                Válida por 24 horas. Cada película se guarda de forma
                independiente.
              </p>
              {preview.movies.map((movie, index) => (
                <article key={`${movie.workId}:${index}`}>
                  <h4>{movie.title}</h4>
                  {movie.errors.map((message, i) => (
                    <p className={styles.error} key={i}>
                      Rechazada: {message}
                    </p>
                  ))}
                  {movie.checks
                    .filter((c) => c.outcome === "failed")
                    .map((c) => (
                      <p key={c.platformId}>
                        Consulta fallida: {c.reason}. {c.findings} Conservaremos
                        la revisión anterior.
                      </p>
                    ))}
                  {movie.changes.map((change) => (
                    <details key={change.after.platformId} open>
                      <summary>
                        {change.platform}:{" "}
                        {change.before
                          ? "modificar revisión"
                          : "primera revisión"}
                      </summary>
                      <div className={styles.diff}>
                        <article>
                          <h4>Antes</h4>
                          <Snapshot value={change.before} />
                        </article>
                        <article>
                          <h4>Después</h4>
                          <Snapshot value={change.after} />
                        </article>
                      </div>
                    </details>
                  ))}
                  {!movie.errors.length && !movie.changes.length && (
                    <p>Sin cambios para guardar.</p>
                  )}
                </article>
              ))}
              {!results && (
                <>
                  <label className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    Revisé esta propuesta y confirmo sus cambios
                  </label>
                  <button
                    disabled={!confirmed || busy}
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        const data = await api("availability/commit", "POST", {
                          previewId: preview.previewId,
                          proposalHash: preview.proposalHash,
                          idempotencyKey: commitKey.current,
                        });
                        setResults(data.results);
                        await onSaved();
                      })
                    }
                  >
                    {busy ? "Guardando…" : "Confirmar esta propuesta"}
                  </button>
                </>
              )}
              {results && (
                <div role="status">
                  <h4>Resultado de la carga</h4>
                  <ul>
                    {results.map((r, i) => (
                      <li key={`${r.workId}:${i}`}>
                        {preview.movies[i]?.title}:{" "}
                        {
                          {
                            applied: "Aplicada",
                            unchanged: "Sin cambios",
                            conflict: "Conflicto",
                            rejected: "Rechazada",
                          }[r.status]
                        }
                        . {r.message}
                      </li>
                    ))}
                  </ul>
                  {results.some((r) => r.status === "conflict") && (
                    <p>
                      Prepará una nueva vista previa para las películas en
                      conflicto.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
