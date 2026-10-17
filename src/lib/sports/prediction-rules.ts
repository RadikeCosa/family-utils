export type Outcome = "winner" | "draw" | "no_contest" | "cancelled";
export type UfcFightView = {
  isMainEvent:boolean;
  isCoMainEvent: boolean;
  points: number;
  id: string;
  firstFighter: string;
  secondFighter: string;
  firstFighterId: string;
  secondFighterId: string;
  block: string;
  startsAt: string | null;
  prodeEligible: boolean;
  removed: boolean;
  cancelled: boolean;
  closed: boolean;
  closesAt: string | null;
  ownWinnerId: string | null;
  result: { outcome: Outcome; winnerId: string | null } | null;
  choices: Array<{ memberId: string; name: string; winnerId: string }>;
};
export type RankingRow = {
  memberId: string;
  name: string;
  points: number;
  rank: number;
};
export type UfcView = {
  closesAt: string | null;
  closed: boolean;
  transition: boolean;
  fights: UfcFightView[];
  ranking: RankingRow[];
  final: boolean;
  chosen: number;
  total: number;
};
export function ranked(
  rows: Array<{ memberId: string; name: string; points: number }>,
): RankingRow[] {
  const sorted = rows.toSorted(
    (a, b) => b.points - a.points || a.name.localeCompare(b.name, "es"),
  );
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || row.points !== sorted[index - 1].points)
      rank = index + 1;
    return { ...row, rank };
  });
}
export function closedAt(value: Date | string | null | undefined, now: Date) {
  return !!value && new Date(value).getTime() <= now.getTime();
}

type ScoringFight = {
  id: string;
  bout_order: number;
  bout_block: string;
  is_main_event: boolean;
  prode_eligible: boolean;
  removed_at: Date | string | null;
};

// Cards are stored in display order, with the main event first. Keep a removed
// co-main's slot reserved: cancelling it must not upgrade another fight to 3.
// At the same slot, prefer its active replacement if it was added before closing.
export function ufcFightPoints(fights: readonly ScoringFight[]): Map<string, number> {
  const coMain = fights
    .filter((fight) => fight.bout_block === "main" && !fight.is_main_event && fight.prode_eligible)
    .toSorted((a, b) => a.bout_order - b.bout_order || Number(!!a.removed_at) - Number(!!b.removed_at) || a.id.localeCompare(b.id))[0];
  return new Map(fights.map((fight) => [fight.id,
    !fight.prode_eligible || fight.removed_at ? 0 : fight.is_main_event ? 5 : fight.id === coMain?.id ? 3 : 1,
  ]));
}
