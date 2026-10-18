import { footballEventInput, isSportsDate, sportsNowDay, ufcCardInput, type FootballEventInput, type UfcCardInput } from "./rules.ts";

export type CuratedProvider = "espn" | "ufc_official";
export type CuratedSource = {
  primary: string;
  checkedAt: string;
  [key: string]: unknown;
};
export type CuratedFootballEvent = { kind: "football_match"; sourceProvider: "espn"; externalReference: string; source: CuratedSource; payload: FootballEventInput };
export type CuratedUfcEvent = { kind: "ufc_card"; sourceProvider: "ufc_official"; externalReference: string; source: CuratedSource; payload: UfcCardInput; location: Record<string, string | null> };
export type CuratedEvent = CuratedFootballEvent | CuratedUfcEvent;
export type SportsCuratedBundle = {
  schemaVersion: 1;
  status: string;
  checkedAt: string;
  timezone: "America/Argentina/Buenos_Aires";
  curation: {
    completeHorizon: {
      river: { from: string; through: string; complete: boolean };
      ufc: { from: string; through: string; complete: boolean };
    };
  };
  events: CuratedEvent[];
};

const allowedHosts = new Set(["www.ligaprofesional.ar", "ligaprofesional.ar", "belgrano.com.ar", "www.belgrano.com.ar", "www.ufc.com", "ufc.com", "site.api.espn.com", "www.espn.com"]);

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeSourceUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedHosts.has(url.hostname);
  } catch {
    return false;
  }
}

function validInstant(value: unknown, now: Date) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now.getTime() + 10 * 60_000 && parsed >= now.getTime() - 30 * 86400_000;
}

function validCoverage(value: unknown, today: string): value is { from: string; through: string; complete: boolean } {
  if (!record(value) || typeof value.from !== "string" || typeof value.through !== "string" || value.complete !== true) return false;
  return isSportsDate(value.from) && isSportsDate(value.through) && value.from <= today && value.through >= today && value.from <= value.through;
}

function pairKey(first: string, second: string) {
  return [first, second].map(name => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "")).sort().join("|");
}

export function parseSportsCuratedBundle(value: unknown, now = new Date()): { ok: true; bundle: SportsCuratedBundle } | { ok: false; error: string } {
  const invalid = (): { ok: false; error: string } => ({ ok: false, error: "El archivo no tiene un formato válido para importar." });
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.events) || value.events.length < 2 || value.events.length > 20) return invalid();
  if (typeof value.checkedAt !== "string" || !validInstant(value.checkedAt, now) || value.timezone !== "America/Argentina/Buenos_Aires") return invalid();
  if (!record(value.curation) || !record(value.curation.completeHorizon)) return invalid();
  const today = sportsNowDay(now);
  const horizon = value.curation.completeHorizon as Record<string, unknown>;
  if (!validCoverage(horizon.river, today) || !validCoverage(horizon.ufc, today)) return invalid();

  const references = new Set<string>();
  let riverCount = 0;
  let ufcCount = 0;
  const events: CuratedEvent[] = [];
  for (const raw of value.events) {
    if (!record(raw) || (raw.kind !== "football_match" && raw.kind !== "ufc_card")) return invalid();
    const externalReference = typeof raw.externalReference === "string" ? raw.externalReference.trim() : "";
    const referenceKey = `${raw.kind}:${raw.sourceProvider}:${externalReference}`;
    if (!externalReference || externalReference.length > 200 || references.has(referenceKey)) return invalid();
    references.add(referenceKey);

    if (!record(raw.source) || !safeSourceUrl(raw.source.primary) || !validInstant(raw.source.checkedAt, now)) return invalid();
    if (raw.kind === "football_match") {
      if (raw.footballCategory != null && raw.footballCategory !== "river") return invalid();
      if (raw.sourceProvider !== "espn" || !/^\d{1,40}$/.test(externalReference)) return invalid();
      const payload = footballEventInput(raw);
      if (!payload || payload.eventDate === null || payload.status !== "scheduled") return invalid();
      riverCount++;
      events.push({ kind: "football_match", sourceProvider: "espn", externalReference, source: raw.source as CuratedSource, payload });
    } else {
      if (raw.sourceProvider !== "ufc_official" || !/^[a-z0-9-]{1,160}$/.test(externalReference)) return invalid();
      const payload = ufcCardInput(raw);
      if (!payload || !record(raw.source.validation) || raw.source.validation.officialCardComplete !== true || raw.source.validation.officialFightCount !== payload.fights.length) return invalid();
      const pairs = new Set<string>();
      for (const fight of payload.fights) {
        const key = pairKey(fight.firstFighter, fight.secondFighter);
        if (pairs.has(key)) return invalid();
        pairs.add(key);
      }
      const location: Record<string, string | null> = {};
      for (const field of ["venue", "city", "country", "eventType"]) {
        if (!Object.hasOwn(raw, field)) continue;
        const value = raw[field];
        if (value !== null && (typeof value !== "string" || !value.trim() || value.length > (field === "venue" ? 200 : 160))) return invalid();
        if (field === "eventType" && value !== null && !["numerado", "fight_night", "otro"].includes(String(value))) return invalid();
        location[field] = typeof value === "string" ? value.trim() : null;
      }
      ufcCount++;
      events.push({ kind: "ufc_card", sourceProvider: "ufc_official", externalReference, source: raw.source as CuratedSource, payload, location });
    }
  }
  if (riverCount === 0 || ufcCount === 0) return invalid();
  const riverHorizon = horizon.river as SportsCuratedBundle["curation"]["completeHorizon"]["river"];
  const ufcHorizon = horizon.ufc as SportsCuratedBundle["curation"]["completeHorizon"]["ufc"];
  if (events.some(event => event.kind === "football_match" && event.payload.eventDate !== null && event.payload.eventDate > riverHorizon.through) || events.some(event => event.kind === "ufc_card" && event.payload.eventDate > ufcHorizon.through)) return invalid();
  return { ok: true, bundle: { schemaVersion: 1, status: String(value.status ?? "curated"), checkedAt: value.checkedAt, timezone: "America/Argentina/Buenos_Aires", curation: { completeHorizon: { river: riverHorizon, ufc: ufcHorizon } }, events } };
}

export function sportsBundleSummary(bundle: SportsCuratedBundle) {
  const river = bundle.events.filter(event => event.kind === "football_match").length;
  const cards = bundle.events.filter(event => event.kind === "ufc_card");
  return { riverMatches: river, ufcCards: cards.length, ufcFights: cards.reduce((count, event) => count + (event.kind === "ufc_card" ? event.payload.fights.length : 0), 0), through: { river: bundle.curation.completeHorizon.river.through, ufc: bundle.curation.completeHorizon.ufc.through } };
}
