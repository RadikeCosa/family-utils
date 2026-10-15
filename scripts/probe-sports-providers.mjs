// Read-only feasibility probe. Never prints keys or full provider responses.
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const report = { checkedAt: new Date().toISOString(), approved: { river: false, ufc: false }, providers: {} };
async function query(base, path, params = {}, headers = {}) {
  const url = new URL(path, base);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.errors && Object.keys(data.errors).length) throw new Error('provider rejected query (check free-plan coverage in dashboard)');
  return data;
}
async function probe(name, action) {
  try { report.providers[name] = await action(); }
  catch (error) { report.providers[name] = { status: 'not_verified', reason: error.name === 'TimeoutError' ? 'timeout' : error.message === 'fetch failed' ? 'network unavailable' : error.message }; }
}
const apiKey = process.env.API_SPORTS_KEY;
await probe('apiFootball', async () => {
  if (!apiKey) return { status: 'pending', reason: 'API_SPORTS_KEY missing' };
  const base = 'https://v3.football.api-sports.io/';
  const teams = await query(base, 'teams', { search: 'River Plate' }, { 'x-apisports-key': apiKey });
  const team = teams.response.find(x => x.team.country === 'Argentina');
  if (!team) throw new Error('Argentina River Plate not found');
  const data = await query(base, 'fixtures', { team: team.team.id, next: 3 }, { 'x-apisports-key': apiKey });
  return { status: 'requires_official_comparison_and_terms_review', events: data.response.map(x => ({ id: x.fixture.id, season: x.league.season, date: x.fixture.date, venue: x.fixture.venue, tournament: x.league.name, teams: [x.teams.home.name, x.teams.away.name] })) };
});
await probe('apiMma', async () => {
  if (!apiKey) return { status: 'pending', reason: 'API_SPORTS_KEY missing' };
  // Probe raw fight coverage; do not infer an official date from UTC.
  const data = await query('https://v1.mma.api-sports.io/', 'fights', { season: new Date().getUTCFullYear() }, { 'x-apisports-key': apiKey });
  const future = data.response.filter(x => new Date(x.date) >= new Date());
  return { status: 'requires_card_and_official_date_verification', upcomingFightCount: future.length, sample: future.slice(0, 2).map(x => ({ id: x.id, date: x.date, title: x.slug ?? x.title ?? null, timezone: x.timezone ?? null })) };
});
await probe('theSportsDb', async () => {
  const base = `https://www.thesportsdb.com/api/v1/json/${process.env.THESPORTSDB_KEY || '123'}/`;
  const teams = await query(base, 'searchteams.php', { t: 'River Plate' });
  const river = teams.teams?.find(x => x.strCountry === 'Argentina' && /river/i.test(x.strTeam));
  const leagues = await query(base, 'all_leagues.php');
  // League ID published at https://www.thesportsdb.com/season/4443-ufc/2026
  const ufc = leagues.leagues?.find(x => /UFC|Ultimate Fighting Championship/i.test(x.strLeague)) ?? { idLeague: '4443' };
  const matches = river ? await query(base, 'eventsnext.php', { id: river.idTeam }) : {};
  const cards = ufc ? await query(base, 'eventsnextleague.php', { id: ufc.idLeague }) : {};
  const sample = x => ({ id: x.idEvent, title: x.strEvent, season: x.strSeason, date: x.dateEvent, localDate: x.dateEventLocal, timestamp: x.strTimestamp, venue: x.strVenue, time: x.strTime });
  return { status: 'not_approved', riverFound: !!river, ufcFound: !!ufc, river: (matches.events || []).slice(0, 3).map(sample), ufc: (cards.events || []).slice(0, 2).map(sample), reason: 'The free schedule must return 3 River matches and 2 complete UFC cards; fights, block times, official dates and terms require verification.' };
});
console.log(JSON.stringify(report, null, 2));
