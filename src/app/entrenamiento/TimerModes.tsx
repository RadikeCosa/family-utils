"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryResponse } from "@/lib/training/diary-client";
import HiitTimer from "./HiitTimer";
import StrengthTimer from "./StrengthTimer";
import BlockTimer from "./BlockTimer";
import styles from "./training.module.css";

type Props = { active: boolean; timeZone: string; today: string; writable: boolean; activityFormEnabled: boolean; onSaved: (entry: EntryResponse["item"]) => void; onUncertainChange: (uncertain: boolean) => void };
export default function TimerModes(props: Props) {
  const [mode, setMode] = useState<"hiit" | "blocks" | "strength">("hiit");
  const router = useRouter();
  return <section className={styles.hiit} hidden={!props.active} aria-label="Temporizador">
    <div hidden={mode !== "hiit"}><HiitTimer {...props} active={props.active && mode === "hiit"} onSelectBlocks={() => setMode("blocks")} onSelectStrength={() => setMode("strength")} /></div>
    <div hidden={mode !== "blocks"}><h2>Temporizador por bloques</h2><BlockTimer {...props} active={props.active && mode === "blocks"} onExit={() => router.push("/entrenamiento")} onSwitchToHiit={() => setMode("hiit")} /></div>
    <div hidden={mode !== "strength"}><StrengthTimer {...props} active={props.active && mode === "strength"} onExit={() => router.push("/entrenamiento")} onSwitchToHiit={() => setMode("hiit")} /></div>
  </section>;
}
