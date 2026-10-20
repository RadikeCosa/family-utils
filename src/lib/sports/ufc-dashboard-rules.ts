import { ufcFightPoints, type UfcScoring } from "./prediction-rules.ts";

export type DashboardFight = {
  id: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  firstFighter: string;
  secondFighter: string;
  firstFighterId: string;
  secondFighterId: string;
  mainEvent: boolean;
  coMainEvent: boolean;
  points: number;
  eligible: boolean;
  removed: boolean;
  result: "winner" | "draw" | "no_contest" | "cancelled" | null;
  winnerId: string | null;
  firstOdds: number | null;
  secondOdds: number | null;
  bookmaker: string | null;
  source: string | null;
  referenceAt: string | null;
  choices: Array<{ memberId: string; name: string; winnerId: string }>;
};
export type DashboardEvent = { id: string; title: string; eventDate: string; scoringVersion: number; mainFightId: string | null; coMainFightId: string | null; fights: DashboardFight[] };
export type DashboardMember = { id: string; name: string; archived: boolean };
export type UfcOddsBundle = {
  version: 1;
  source: string;
  events: Array<{
    eventId: string;
    bookmaker: string;
    referenceAt: string;
    fights: Array<{ fightId: string; firstOdds: number; secondOdds: number }>;
  }>;
};

export function parseUfcOddsBundle(value: unknown, now = new Date()): UfcOddsBundle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.source !== "string" || !raw.source.trim() ||
      raw.source.length > 1000 || !Array.isArray(raw.events) || !raw.events.length ||
      raw.events.length > 50) return null;
  const eventIds = new Set<string>();
  const events: UfcOddsBundle["events"] = [];
  for (const item of raw.events) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const event = item as Record<string, unknown>;
    if (typeof event.eventId !== "string" || eventIds.has(event.eventId) ||
        typeof event.bookmaker !== "string" || !event.bookmaker.trim() || event.bookmaker.length > 120 ||
        typeof event.referenceAt !== "string" || !Number.isFinite(Date.parse(event.referenceAt)) ||
        Date.parse(event.referenceAt) > now.getTime() || !Array.isArray(event.fights) ||
        event.fights.length > 80) return null;
    eventIds.add(event.eventId);
    const fightIds = new Set<string>();
    const fights: UfcOddsBundle["events"][number]["fights"] = [];
    for (const row of event.fights) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const fight = row as Record<string, unknown>;
      if (typeof fight.fightId !== "string" || fightIds.has(fight.fightId) ||
          typeof fight.firstOdds !== "number" || !Number.isFinite(fight.firstOdds) ||
          typeof fight.secondOdds !== "number" || !Number.isFinite(fight.secondOdds) ||
          fight.firstOdds <= 1 || fight.secondOdds <= 1 ||
          fight.firstOdds > 1000 || fight.secondOdds > 1000) return null;
      fightIds.add(fight.fightId);
      fights.push({ fightId: fight.fightId, firstOdds: fight.firstOdds, secondOdds: fight.secondOdds });
    }
    events.push({ eventId: event.eventId, bookmaker: event.bookmaker.trim(), referenceAt: event.referenceAt, fights });
  }
  return { version: 1, source: raw.source.trim(), events };
}

const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

function upsetFor(events: DashboardEvent[], allFights: DashboardFight[], names: Map<string, string>) {
  const eventIds = new Set(events.map((event) => event.id));
  const relevant = allFights.filter((fight) => eventIds.has(fight.eventId) && fight.eligible && !fight.removed);
  const candidates = relevant.flatMap((fight) => {
    if (fight.result !== "winner" || !fight.winnerId || fight.firstOdds === null || fight.secondOdds === null || fight.firstOdds === fight.secondOdds) return [];
    const winOdds = fight.winnerId === fight.firstFighterId ? fight.firstOdds : fight.secondOdds;
    const loseOdds = fight.winnerId === fight.firstFighterId ? fight.secondOdds : fight.firstOdds;
    if (winOdds <= loseOdds) return [];
    const correct = fight.choices.filter((choice) => choice.winnerId === fight.winnerId)
      .map((choice) => ({ memberId: choice.memberId, name: names.get(choice.memberId) ?? choice.name }));
    return correct.length ? [{ fight, odds: winOdds, correct }] : [];
  });
  const highest = Math.max(0, ...candidates.map((item) => item.odds));
  const missingOdds = relevant.some((fight) => fight.result === "winner" && (fight.firstOdds === null || fight.secondOdds === null));
  const complete = relevant.filter((fight) => fight.firstOdds !== null && fight.secondOdds !== null).length;
  return {
    winners: candidates.filter((item) => item.odds === highest),
    missingOdds,
    coverage: relevant.length ? complete / relevant.length : 1,
  };
}

export function buildUfcDashboard(events: DashboardEvent[], members: DashboardMember[]) {
  const rows = members.map((member) => ({
    memberId: member.id, name: member.name, archived: member.archived,
    points: 0, hits: 0, misses: 0, picks: 0, eligibleFights: 0,
    stake: 0, returned: 0, pricedPicks: 0, settledPicks: 0,
  }));
  const people = new Map(rows.map((person) => [person.memberId, person]));
  const fights = events.flatMap((event) => event.fights);
  const fightPoints = new Map(events.flatMap((event) => {
    const scoring: UfcScoring = { ufc_scoring_version: event.scoringVersion, ufc_main_fight_id: event.mainFightId, ufc_co_main_fight_id: event.coMainFightId };
    return [...ufcFightPoints(event.fights.map((fight) => ({ id: fight.id, prode_eligible: fight.eligible, removed_at: fight.removed ? "removed" : null })), scoring)];
  }));
  for (const fight of fights) {
    if (!fight.eligible || fight.removed) continue;
    for (const person of rows) person.eligibleFights++;
    for (const pick of fight.choices) {
      const person = people.get(pick.memberId);
      if (!person) continue;
      person.picks++;
      const resolvedWinner = fight.result === "winner" && fight.winnerId;
      const correct = !!resolvedWinner && pick.winnerId === fight.winnerId;
      if (correct) { person.hits++; person.points += fightPoints.get(fight.id) ?? 0; }
      else if (resolvedWinner) person.misses++;
      if (!fight.result) continue;
      const odds = pick.winnerId === fight.firstFighterId ? fight.firstOdds : fight.secondOdds;
      if (odds === null) continue;
      person.pricedPicks++;
      person.stake += 10;
      person.settledPicks++;
      if (fight.result === "draw" || fight.result === "no_contest" || fight.result === "cancelled") person.returned += 10;
      else if (correct) person.returned += cents(10 * odds);
    }
  }
  const ranking = rows.map((person) => {
    const net = cents(person.returned - person.stake);
    return {
      ...person,
      accuracy: person.hits + person.misses ? person.hits / (person.hits + person.misses) : null,
      participation: person.eligibleFights ? person.picks / person.eligibleFights : null,
      oddsCoverage: person.picks ? person.pricedPicks / person.picks : 1,
      financialComplete: person.pricedPicks === person.picks,
      stake: cents(person.stake),
      returned: cents(person.returned),
      net,
      roi: person.stake ? net / person.stake : null,
    };
  }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, "es"));
  let rank = 0;
  const ranked = ranking.map((row, index) => {
    if (!index || row.points !== ranking[index - 1].points) rank = index + 1;
    return { ...row, rank };
  });
  const completeEvents = events.filter((event) => event.fights.length > 0 && event.fights.every((fight) => !fight.eligible || fight.removed || fight.result !== null));
  const validFights = fights.filter((fight) => fight.eligible && !fight.removed);
  const scored = rows.reduce((count, person) => count + person.hits + person.misses, 0);
  const hits = rows.reduce((count, person) => count + person.hits, 0);
  const names = new Map(members.map((member) => [member.id, member.name]));
  return {
    events: completeEvents,
    members,
    ranking: ranked,
    fights,
    summary: {
      eventCount: completeEvents.length,
      validFights: validFights.length,
      participants: rows.filter((person) => person.picks > 0).length,
      hits,
      scoredPicks: scored,
      accuracy: scored ? hits / scored : null,
      oddsCoverage: validFights.length ? validFights.filter((fight) => fight.firstOdds !== null && fight.secondOdds !== null).length / validFights.length : 1,
    },
    upsetOfNight: completeEvents.length ? upsetFor([completeEvents[0]], fights, names) : { winners: [], missingOdds: false, coverage: 1 },
    historicalUpset: upsetFor(completeEvents, fights, names),
  };
}
