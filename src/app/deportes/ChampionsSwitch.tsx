"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./agenda.module.css";

type SwitchState = { enabled: boolean; effective: boolean };

export default function ChampionsSwitch() {
  const router = useRouter();
  const [state, setState] = useState<SwitchState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/sports/champions/switch", { cache: "no-store" })
      .then(async response => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? "No se pudo leer el interruptor.");
        if (active) setState(value);
      })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : "No se pudo leer el interruptor."); });
    return () => { active = false; };
  }, []);
  async function toggle() {
    if (!state || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/sports/champions/switch", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !state.enabled }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "No se pudo cambiar el interruptor.");
      setState(value); setMessage(value.effective ? "Champions habilitado para esta familia." : "Champions apagado para esta familia."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo cambiar el interruptor."); }
    finally { setBusy(false); }
  }
  return <div className={styles.championsSwitch}>
    <button type="button" onClick={toggle} disabled={!state || busy} aria-pressed={state?.enabled ?? false}>
      {busy ? "Guardando…" : state ? `Champions: ${state.enabled ? "encendido" : "apagado"}` : "Leyendo Champions…"}
    </button>
    {message && <span role="status">{message}</span>}
    {state?.enabled && !state.effective && <span role="status">Falta habilitar Deportes, la agenda o la bandera del entorno.</span>}
  </div>;
}
