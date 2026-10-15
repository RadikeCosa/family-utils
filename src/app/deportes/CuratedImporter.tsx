"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./agenda.module.css";
const MAX_BYTES = 900_000;
function resultLabel(value: unknown): string {
  if (value === null) return "Pendiente";
  if (
    value &&
    typeof value === "object" &&
    "homeGoals" in value &&
    "awayGoals" in value
  )
    return `${value.homeGoals}–${value.awayGoals}`;
  return "Sin resultado";
}
export default function CuratedImporter({
  kind = "agenda",
}: {
  kind?: "agenda" | "results";
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [example, setExample] = useState("");
  async function template(action: "view" | "copy" | "download") {
    try {
      const response = await fetch(
        `/api/sports/templates?kind=${kind}${action !== "download" ? "&example=true" : ""}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const content = JSON.stringify(data, null, 2);
      if (action === "view") setExample(content);
      if (action === "copy") {
        await navigator.clipboard.writeText(content);
        setMessage("Ejemplo copiado.");
      }
      if (action === "download") {
        const url = URL.createObjectURL(
          new Blob([content], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `deportes-${kind}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo obtener el ejemplo.",
      );
    }
  }
  async function submit(mode: "preview" | "import") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (new TextEncoder().encode(text).length > MAX_BYTES)
        throw new Error("El archivo supera 900 KB.");
      const bundle: unknown = JSON.parse(text);
      const response = await fetch(
        kind === "agenda" ? "/api/sports/import" : "/api/sports/results/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            bundle,
            ...(preview?.token ? { token: preview.token } : {}),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Revisá el archivo.");
      if (mode === "preview") setPreview(data);
      else {
        setPreview(null);
        setMessage(
          data.errors?.length
            ? `Importación parcial: ${data.errors.map((item: { error: string }) => item.error).join(" · ")}`
            : "Importación completada.",
        );
        router.refresh();
      }
    } catch (reason) {
      setPreview(null);
      setError(
        reason instanceof Error ? reason.message : "No se pudo importar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.importer}>
      <h3>{kind === "agenda" ? "Actualizar agenda" : "Cargar resultados"}</h3>
      <p>
        Pedile al chat que complete el formato con datos verificados y sus
        fuentes. Revisá la vista previa antes de confirmar. Los ejemplos de
        agenda contienen datos ficticios.
      </p>
      <div className={styles.actions}>
        <button type="button" onClick={() => void template("view")}>
          Ver ejemplo
        </button>
        <button type="button" onClick={() => void template("copy")}>
          Copiar ejemplo
        </button>
        <button type="button" onClick={() => void template("download")}>
          Descargar plantilla
        </button>
      </div>
      {example && (
        <details open>
          <summary>Formato de referencia</summary>
          <pre tabIndex={0} className={styles.example}>
            {example}
          </pre>
        </details>
      )}
      <label>
        Archivo JSON
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > MAX_BYTES) {
              setError("El archivo supera 900 KB.");
              return;
            }
            setText(await file.text());
            setPreview(null);
            setError("");
          }}
        />
      </label>
      <label>
        Contenido JSON
        <textarea
          rows={6}
          value={text}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(null);
          }}
        />
      </label>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => void submit("preview")}
        >
          {busy ? "Procesando…" : "Validar y revisar"}
        </button>
        {preview && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit("import")}
          >
            Confirmar importación
          </button>
        )}
      </div>
      {preview && (
        <div role="status">
          <strong>Vista previa · todavía no se guardó</strong>
          {kind === "agenda" ? (
            <p>
              {String(
                (preview.summary as Record<string, unknown>)?.riverMatches ?? 0,
              )}{" "}
              partidos ·{" "}
              {String(
                (preview.summary as Record<string, unknown>)?.ufcCards ?? 0,
              )}{" "}
              carteleras ·{" "}
              {String(
                (preview.summary as Record<string, unknown>)?.ufcFights ?? 0,
              )}{" "}
              peleas
            </p>
          ) : (
            Array.isArray(preview.events) &&
            preview.events.map(
              (item: {
                eventId: string;
                title: string;
                before: unknown;
                after: unknown;
                changed: boolean;
                fights?: Array<{
                  fightId: string;
                  title: string;
                  before: string;
                  after: string;
                }>;
                points?: Array<{ name: string; before: number; after: number }>;
              }) => (
                <article key={item.eventId}>
                  <h4>{item.title}</h4>
                  {item.fights ? (
                    <>
                      {item.fights.map((fight) => (
                        <p key={fight.fightId}>
                          {fight.title}: {fight.before} → {fight.after}
                        </p>
                      ))}
                      {item.points?.map((row) => (
                        <p key={row.name}>
                          {row.name}: {row.before} → {row.after} puntos
                        </p>
                      ))}
                    </>
                  ) : (
                    <p>
                      {resultLabel(item.before)} → {resultLabel(item.after)} ·{" "}
                      {item.changed ? "Se actualizará" : "Sin cambios"}
                    </p>
                  )}
                </article>
              ),
            )
          )}
          {Array.isArray(preview.warnings) &&
            preview.warnings.map((warning, index) => (
              <p key={index}>{String(warning)}</p>
            ))}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
