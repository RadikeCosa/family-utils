import type { FightInput } from "./rules.ts";
import { normalizeSportsAlias } from "./sync-rules.ts";
/* eslint @typescript-eslint/no-explicit-any: off -- the provider JSON is a changing external payload, validated field-by-field below. */

const USER_AGENT = "FamilyUtilsSportsSync/1.0 (+https://family-utils-umber.vercel.app/deportes; family use)";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 1_000_000;
const UFC_EVENTS_URL = "https://www.ufc.com/events";
const ESPN_RIVER_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/16/schedule?fixture=true";
const htmlNames: Record<string, string> = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " ", ndash: "–", rsquo: "’" };

export class ProviderError extends Error {
  readonly code: string;
  constructor(message: string, code: string) { super(message); this.code=code; }
}
async function providerText(url: string, deadlineAt=Date.now()+REQUEST_TIMEOUT_MS): Promise<string> {
  let response: Response;
  const timeout=Math.min(REQUEST_TIMEOUT_MS,deadlineAt-Date.now());if(timeout<=0)throw new ProviderError("network_budget_exhausted","BUDGET");
  try { response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(timeout), cache: "no-store" }); }
  catch (error) { throw new ProviderError(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network", "NETWORK"); }
  if (!response.ok) throw new ProviderError(`http_${response.status}`, "HTTP");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new ProviderError("response_too_large", "OVERSIZED");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new ProviderError("response_too_large", "OVERSIZED");
  return text;
}
function decodeHtml(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const value = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : "�";
    }
    return htmlNames[code.toLowerCase()] ?? entity;
  });
}
function plainText(value: string) {
  return decodeHtml(value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
function checkedMatch(expression: RegExp, value: string, description: string) {
  const match = expression.exec(value);
  if (!match) throw new ProviderError(`invalid_${description}`, "SCHEMA");
  return match;
}
export type RiverProviderEvent = { reference: string; title: string; competition: string; date: string; startsAt: string | null; venue: string | null; firstParticipant: string; secondParticipant: string; homeName: string; awayName: string; sourceUrl: string };
function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
export async function fetchRiverSchedule(deadlineAt?:number): Promise<{ events: RiverProviderEvent[]; coveredThrough: string | null }> {
  const raw = await providerText(ESPN_RIVER_URL,deadlineAt);
  let data: Record<string, any>;
  try { data = JSON.parse(raw) as Record<string, any>; } catch { throw new ProviderError("invalid_json", "SCHEMA"); }
  if (String(data.team?.id) !== "16" || !Array.isArray(data.events)) throw new ProviderError("unexpected_river_schedule", "SCHEMA");
  const events = data.events.map((event: any) => {
    const match = event.competitions?.[0];
    const competitors = match?.competitors;
    if (!event.id || !Array.isArray(competitors) || competitors.length !== 2 || !event.name || !event.seasonType?.name) throw new ProviderError("invalid_river_event", "SCHEMA");
    const home = competitors.find((item: any) => item.homeAway === "home");
    const away = competitors.find((item: any) => item.homeAway === "away");
    if (!home?.team?.displayName || !away?.team?.displayName) throw new ProviderError("invalid_river_teams", "SCHEMA");
    const known = event.timeValid === true && match.timeValid === true ? timestamp(event.date) : null;
    const date = typeof event.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(event.date) ? event.date.slice(0, 10) : null;
    if (!date) throw new ProviderError("invalid_river_date", "SCHEMA");
    return { reference: String(event.id), title: event.name.slice(0,160), competition: String(event.seasonType.name).slice(0,120), date, startsAt: known, venue: typeof match.venue?.fullName === "string" ? match.venue.fullName.slice(0,200) : null, firstParticipant: home.team.displayName.slice(0,120), secondParticipant: away.team.displayName.slice(0,120), homeName: home.team.displayName, awayName: away.team.displayName, sourceUrl: `https://www.espn.com/soccer/match/_/gameId/${encodeURIComponent(String(event.id))}` } satisfies RiverProviderEvent;
  }).filter((event: RiverProviderEvent) => normalizeSportsAlias(event.firstParticipant) === "river plate" || normalizeSportsAlias(event.secondParticipant) === "river plate");
  if (!events.length && data.status?.name !== "STATUS_SCHEDULED") throw new ProviderError("empty_river_schedule_unconfirmed", "INCOMPLETE");
  const validUntil = typeof data.season?.year === "number" ? `${data.season.year}-12-31` : null;
  return { events, coveredThrough: validUntil };
}

type UfcListingEvent = { title: string; url: string; officialReference: string };
export type UfcProviderCard = { reference: string; title: string; eventDate: string; preliminaryStartsAt: string | null; mainCardStartsAt: string | null; earlyPreliminariesStartsAt: string | null; venue: string | null; sourceUrl: string; fights: Array<FightInput & { externalReference: string | null }> };
function ufcListing(html: string): UfcListingEvent[] {
  if (/\/sorry\/|captcha|enablejs/i.test(html)) throw new ProviderError("ufc_challenge", "BLOCKED");
  const candidates = [...html.matchAll(/<h3\b[^>]*class="[^"]*c-card-event--result__headline[^"]*"[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/gi)];
  if (!candidates.length) throw new ProviderError("ufc_listing_markup_changed", "SCHEMA");
  const seen = new Set<string>();
  return candidates.flatMap(match => {
    const url = new URL(decodeHtml(match[1]), UFC_EVENTS_URL);
    if (url.hostname !== "www.ufc.com" || !/^\/event\/[\w-]+$/.test(url.pathname) || seen.has(url.pathname)) return [];
    seen.add(url.pathname);
    return [{ title: plainText(match[2]), url: url.href, officialReference: url.pathname.slice("/event/".length) }];
  });
}
function eventTitlePair(title: string): [string,string] | null {
  const pair = title.split(/\s+vs\.?\s+/i);
  return pair.length === 2 && pair.every(Boolean) ? pair.map(normalizeSportsAlias) as [string,string] : null;
}
function samePair(a: [string,string] | null, b: [string,string] | null) { return !!a && !!b && a.slice().sort().join("|") === b.slice().sort().join("|"); }
function headingMatchesFight(heading:[string,string],fighters:[string,string]) {
  const fits=(name:string,surname:string)=>name===surname||name.endsWith(` ${surname}`);
  return (fits(normalizeSportsAlias(fighters[0]),heading[0])&&fits(normalizeSportsAlias(fighters[1]),heading[1]))||(fits(normalizeSportsAlias(fighters[0]),heading[1])&&fits(normalizeSportsAlias(fighters[1]),heading[0]));
}
const monthNumbers: Record<string,string> = { jan:"01", january:"01", ene:"01", enero:"01", feb:"02", february:"02", mar:"03", march:"03", abr:"04", apr:"04", april:"04", may:"05", mayo:"05", jun:"06", june:"06", jul:"07", july:"07", ago:"08", aug:"08", august:"08", sep:"09", sept:"09", september:"09", oct:"10", october:"10", okt:"10", nov:"11", november:"11", dec:"12", december:"12", dic:"12" };
function officialEventDate(html: string): string {
  const headline = checkedMatch(/c-hero__headline-suffix[^>]*>([\s\S]*?)<\/div>/i, html, "ufc_date");
  const label = plainText(headline[1]);
  const date = checkedMatch(/(?:\b[A-Za-záéíóúñ]{2,}\b\s*,?\s*)?([A-Za-záéíóúñ]+)\s+(\d{1,2})\b/i, label, "ufc_date_label");
  const month = monthNumbers[date[1].toLowerCase().slice(0,4)] ?? monthNumbers[date[1].toLowerCase().slice(0,3)];
  if (!month) throw new ProviderError("ambiguous_ufc_date", "AMBIGUOUS_DATE");
  const main = checkedMatch(/field--name-fight-card-time-main[^>]*>[\s\S]*?<time[^>]*datetime="([^"]+)"/i, html, "ufc_main_start");
  const year = Date.parse(main[1]);
  if (!Number.isFinite(year)) throw new ProviderError("ambiguous_ufc_date", "AMBIGUOUS_DATE");
  const dateOnly = `${new Date(year).getUTCFullYear()}-${month}-${date[2].padStart(2,"0")}`;
  const [y,m,d] = dateOnly.split("-").map(Number);
  const parsed = new Date(Date.UTC(y,m-1,d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m-1 || parsed.getUTCDate() !== d) throw new ProviderError("ambiguous_ufc_date", "AMBIGUOUS_DATE");
  return dateOnly;
}
function blockContent(html: string, id: string) {
  const opening = checkedMatch(new RegExp(`<div\\s+id="${id}"[^>]*>`, "i"), html, `${id}_block`);
  const next = html.slice(opening.index! + opening[0].length);
  const nextBlock = /<div\s+id="(?:main-card|prelims-card|early-prelims)"/i.exec(next);
  return nextBlock ? next.slice(0,nextBlock.index) : next;
}
export function parseFightBlock(html: string, id: string): { startsAt: string | null; fights: Array<FightInput & { externalReference:string|null }> } {
  if (!new RegExp(`<div\\s+id="${id}"[^>]*>`,'i').test(html)) return { startsAt:null, fights:[] };
  const content = blockContent(html,id);
  const timeMatch = /c-event-fight-card-broadcaster__time[^>]*data-timestamp="(\d+)"/i.exec(content);
  const startsAt = timeMatch ? new Date(Number(timeMatch[1])*1000).toISOString() : null;
  const fightCards = [...content.matchAll(/<div\s+class="c-listing-fight__content-row"[\s\S]*?<div\s+class="c-listing-fight__names-row"[\s\S]*?<\/div>\s*<\/div>/gi)];
  if (!fightCards.length) return { startsAt, fights:[] };
  const fights = fightCards.map((card,index) => {
    const names = [...card[0].matchAll(/<div\s+class="c-listing-fight__corner-name[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)].map(match => plainText(match[1]));
    const athleteIds = [...card[0].matchAll(/<a\s+href="https?:\/\/(?:www\.)?ufcespanol\.com\/athlete\/([^"]+)"/gi)].map(match=>decodeHtml(match[1]));
    if (names.length !== 2 || names.some(name=>!name) || names[0].toLowerCase()===names[1].toLowerCase()) throw new ProviderError(`invalid_fight_${id}_${index}`,"INCOMPLETE");
    const boutBlock: FightInput["boutBlock"] = id==="main-card"?"main":id==="early-prelims"?"early_preliminaries":"preliminaries";
    return { boutOrder:index+1, firstFighter:names[0].slice(0,120), secondFighter:names[1].slice(0,120), boutBlock, isMainEvent:false, externalReference:athleteIds.length===2?athleteIds.sort().join("|").slice(0,200):null };
  });
  return { startsAt, fights };
}
export async function fetchUfcListing(deadlineAt?:number): Promise<UfcListingEvent[]> { return ufcListing(await providerText(UFC_EVENTS_URL,deadlineAt)); }
export async function fetchUfcCard(listing: UfcListingEvent,deadlineAt?:number): Promise<UfcProviderCard> {
  const html = await providerText(listing.url,deadlineAt);
  if (/\/sorry\/|captcha|enablejs/i.test(html)) throw new ProviderError("ufc_challenge", "BLOCKED");
  const headline = checkedMatch(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i, html, "ufc_headline");
  const eventPair = checkedMatch(/e-divider__top[^>]*>([\s\S]*?)<\/span>[\s\S]*?e-divider__bottom[^>]*>([\s\S]*?)<\/span>/i,html,"ufc_main_event");
  const title = `${plainText(headline[1])}: ${plainText(eventPair[1])} vs ${plainText(eventPair[2])}`.slice(0,160);
  const expected = eventTitlePair(title.split(":").at(-1) ?? "");
  if (!expected) throw new ProviderError("ambiguous_ufc_event_title", "AMBIGUOUS_DATE");
  const eventDate = officialEventDate(html);
  const mainBlock=parseFightBlock(html,"main-card");
  const prelimBlock=parseFightBlock(html,"prelims-card");
  if(!mainBlock.fights.length||!prelimBlock.fights.length)throw new ProviderError("ufc_required_block_missing","INCOMPLETE");
  const earlyBlock=parseFightBlock(html,"early-prelims");
  const blocks=[{id:"main-card",...mainBlock},{id:"prelims-card",...prelimBlock},...(earlyBlock.fights.length?[{id:"early-prelims",...earlyBlock}]:[])];
  const fights = blocks.flatMap(block=>block.fights);
  const mains = fights.filter(fight=>headingMatchesFight(expected,[fight.firstFighter,fight.secondFighter]));
  if (mains.length !== 1) throw new ProviderError("ufc_main_event_not_found","INCOMPLETE");
  const main=mains[0];
  main.isMainEvent=true;
  const start = checkedMatch(/field--name-fight-card-time-main[^>]*>[\s\S]*?<time[^>]*datetime="([^"]+)"/i,html,"ufc_main_start");
  const mainStart = Date.parse(start[1]);
  const venue = /field--name-venue[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const officialMainTimestamp=blocks.find(b=>b.id==="main-card")?.startsAt;
  return { reference:listing.officialReference,title,eventDate,preliminaryStartsAt:blocks.find(b=>b.id==="prelims-card")?.startsAt??null,mainCardStartsAt:officialMainTimestamp??(Number.isFinite(mainStart)?new Date(mainStart).toISOString():null),earlyPreliminariesStartsAt:blocks.find(b=>b.id==="early-prelims")?.startsAt??null,venue:venue?plainText(venue[1]).slice(0,200):null,sourceUrl:listing.url,fights };
}
export function matchUfcListing(cardTitle: string, listings: UfcListingEvent[]) {
  const eventPair = eventTitlePair(cardTitle.split(":").at(-1) ?? "");
  if (!eventPair) return null;
  const matches = listings.filter(item=>samePair(eventPair,eventTitlePair(item.title)));
  return matches.length===1?matches[0]:null;
}
