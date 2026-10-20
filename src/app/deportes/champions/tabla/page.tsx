import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { championsEnabled } from "@/lib/sports/config";
import { loadChampionsStandings } from "@/lib/sports/champions-standings-server";
import ChampionsStandings from "./ChampionsStandings";
import styles from "../../agenda.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ChampionsStandingsPage() {
  if (!championsEnabled()) notFound();
  if (!await getMemberContext(await headers())) redirect("/acceso");
  const data = await loadChampionsStandings();
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/deportes?sport=champions">‹ Champions</Link><span>Family Utils / Deportes</span></header>
    <div className={styles.intro}><p>UEFA CHAMPIONS LEAGUE · {data.season}</p><h1>Tabla de posiciones</h1><span>Los 36 equipos de la fase liga.</span></div>
    <ChampionsStandings data={data} />
  </main>;
}
