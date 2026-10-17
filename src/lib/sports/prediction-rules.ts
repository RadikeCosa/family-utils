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
  scoringVersion: number;
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

export type UfcScoring = {
  ufc_scoring_version: number | null;
  ufc_main_fight_id: string | null;
  ufc_co_main_fight_id: string | null;
};
type ScoringFight = {
  id: string;
  prode_eligible: boolean;
  removed_at: Date | string | null;
};

// The database stores the rule and reserves both fight identities at card close.
// Never infer bonuses from the current order, block or cancellation state.
export function ufcFightPoints(
  fights: readonly ScoringFight[],
  scoring: UfcScoring,
): Map<string, number> {
  return new Map(fights.map((fight) => [fight.id,
    !fight.prode_eligible || fight.removed_at ? 0
      : scoring.ufc_scoring_version !== 2 ? 1
      : fight.id === scoring.ufc_main_fight_id ? 5
      : fight.id === scoring.ufc_co_main_fight_id ? 3 : 1,
  ]));
}
