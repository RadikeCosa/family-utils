export type Outcome = "winner" | "draw" | "no_contest" | "cancelled";
export type UfcFightView = {
  isMainEvent:boolean;
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
