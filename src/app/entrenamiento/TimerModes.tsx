"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryResponse } from "@/lib/training/diary-client";
import HiitTimer from "./HiitTimer";
import BlockTimer from "./BlockTimer";
import styles from "./training.module.css";

type Props = { active: boolean; timeZone: string; today: string; writable: boolean; activityFormEnabled: boolean; onSaved: (entry: EntryResponse["item"]) => void; onUncertainChange: (uncertain: boolean) => void };
export default function TimerModes(props: Props) {
  const [mode, setMode] = useState<"hiit" | "blocks">("hiit"), [blockBusy, setBlockBusy] = useState(false), [hiitBusy, setHiitBusy] = useState(false);
  const router = useRouter();
  return <section className={styles.hiit} hidden={!props.active} aria-label="Temporizador">
    {!blockBusy && !hiitBusy && <div className={styles.actions} role="group" aria-label="Modo de temporizador"><button type="button" aria-pressed={mode === "hiit"} onClick={() => setMode("hiit")}>HIIT</button><button type="button" aria-pressed={mode === "blocks"} onClick={() => setMode("blocks")}>Por bloques</button></div>}
    <div hidden={mode !== "hiit"}><HiitTimer {...props} active={props.active && mode === "hiit"} onBusyChange={setHiitBusy} /></div>
    <div hidden={mode !== "blocks"}><h2>Temporizador por bloques</h2><BlockTimer {...props} active={props.active && mode === "blocks"} onExit={() => router.push("/entrenamiento")} onBusyChange={setBlockBusy} onSwitchToHiit={() => setMode("hiit")} /></div>
  </section>;
}
