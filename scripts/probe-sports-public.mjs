// Read-only feasibility experiment; never writes to the application database.
import { writeFile } from 'node:fs/promises';

const now = new Date();
const day = now.toISOString().slice(0, 10).replaceAll('-', '');
const until = new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10).replaceAll('-', '');
const report = { checkedAt: now.toISOString(), purpose: 'Coverage experiment, not production approval', sources: {} };
const clean = value => value.replace(/<[^>]*>/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const local = value => value ? new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : null;
const pairKey = names => names.map(name => clean(name).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z]/g, '')).sort().join('|');
async function get(url, json = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return json ? response.json() : response.text();
}
async function probe(name, action) {
  try { report.sources[name] = await action(); }
  catch (error) { report.sources[name] = { status: 'unavailable', reason: error.cause?.code ?? error.message }; }
}

await Promise.all([
  ...['River Plate proximos partidos', 'UFC proximo evento cartelera'].map((q, index) => probe(`google${index ? 'Ufc' : 'River'}`, async () => {
    const url = `https://www.google.com/search?${new URLSearchParams({ q, hl: 'es', gl: 'ar' })}`;
    const html = await get(url);
    return { url, bytes: html.length, status: /enablejs|\/sorry\/|captcha/i.test(html) ? 'javascript_or_challenge_page' : 'html_received_unverified', structuredSportsExtracted: false };
  })),
  probe('riverEspn', async () => {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/16/schedule?fixture=true';
    const data = await get(url, true);
    if (String(data.team?.id) !== '16' || !Array.isArray(data.events)) throw new Error('Unexpected team or response schema');
    const matches = data.events.filter(event => event.date?.slice(0, 10).replaceAll('-', '') >= day).slice(0, 4).map(event => {
      const match = event.competitions?.[0];
      const knownTime = event.timeValid === true && match?.timeValid === true;
      return { id: event.id, title: event.name, competition: event.season?.displayName, phase: event.seasonType?.name, providerDate: event.date, startsAt: knownTime ? event.date : null, argentina: knownTime ? local(event.date) : 'Hora a confirmar; fecha tentativa del proveedor', timeValid: knownTime, venue: match?.venue?.fullName, teams: match?.competitors?.map(c => ({ id: c.id, name: c.team?.displayName, homeAway: c.homeAway })) };
    });
    return { url, status: matches.length >= 3 ? 'sample_coverage_passed' : 'insufficient_sample', officialComparison: 'pending', matches };
  }),
  probe('ufc', async () => {
    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${day}-${until}&limit=100`;
    const officialUrl = 'https://www.ufc.com/events';
    const [data, listing] = await Promise.all([get(espnUrl, true), get(officialUrl)]);
    if (!Array.isArray(data.events)) throw new Error('Unexpected ESPN response schema');
    const links = [...listing.matchAll(/<h3 class="c-card-event--result__headline"><a href="([^"]+)">([\s\S]*?)<\/a><\/h3>/g)].map(m => ({ url: new URL(m[1], officialUrl).href, title: clean(m[2]) }));
    const cards = [];
    for (const event of data.events.filter(e => new Date(e.date) >= now).slice(0, 2)) {
      const link = links.find(l => pairKey(l.title.split(/\s+vs\.?\s+/i)) === pairKey(event.name.split(':').at(-1).trim().split(/\s+vs\.?\s+/i)));
      if (!link) { cards.push({ id: event.id, title: event.name, status: 'official_link_not_matched' }); continue; }
      const html = await get(link.url);
      const officialBlocks = [];
      const sections = html.split(/<div\s+id="(main-card|prelims-card|early-prelims)"[^>]*>/);
      for (let i = 1; i < sections.length; i += 2) {
        // This HTML adapter is only for this experiment; fail visibly if markup changes.
        const content = sections[i + 1];
        const timestamp = content.match(/c-event-fight-card-broadcaster__time[^>]*data-timestamp="(\d+)"/);
        const fighters = [...content.matchAll(/<div class="c-listing-fight__corner-name\s[^\"]*">([\s\S]*?)<\/div>/g)].map(m => clean(m[1]));
        if (fighters.length % 2) throw new Error('Unpaired official fighters');
        const fights = [];
        for (let n = 0; n < fighters.length; n += 2) fights.push(fighters.slice(n, n + 2));
        if (fights.length) officialBlocks.push({ block: sections[i], startsAt: timestamp ? new Date(Number(timestamp[1]) * 1000).toISOString() : null, argentina: timestamp ? local(Number(timestamp[1]) * 1000) : null, fights });
      }
      const espnFights = event.competitions.map(c => ({ id: c.id, providerStart: c.date, fighters: c.competitors.map(p => p.athlete.displayName) }));
      const officialFights = officialBlocks.flatMap(b => b.fights);
      const missingOnEspn = officialFights.filter(f => !espnFights.some(e => pairKey(e.fighters) === pairKey(f)));
      const extraOnEspn = espnFights.filter(e => !officialFights.some(f => pairKey(e.fighters) === pairKey(f)));
      const hero = html.match(/c-hero__headline-suffix[^>]*>([\s\S]*?)<\/div>/);
      cards.push({ id: event.id, title: event.name, officialUrl: link.url, officialDisplayedDate: hero ? clean(hero[1]) : null, providerEventStart: event.date, officialBlocks, espnFights, comparison: { officialFightCount: officialFights.length, espnFightCount: espnFights.length, missingOnEspn, extraOnEspn, allOfficialBlockTimesFound: officialBlocks.length >= 2 && officialBlocks.every(b => b.startsAt), officialStartsPresentOnEspn: officialBlocks.every(b => espnFights.some(f => new Date(f.providerStart).getTime() === new Date(b.startsAt).getTime())) } });
    }
    return { espnUrl, officialUrl, status: 'sample_requires_review', cards, note: 'ESPN dates do not explicitly label blocks or the main event. Official HTML provides those blocks; do not infer them from array order or UTC day.' };
  }),
]);

const output = process.argv[2];
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
