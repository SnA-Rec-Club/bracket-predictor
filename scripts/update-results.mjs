// Hourly updater: pulls World Cup data from football-data.org and writes
// results + resolved Round-of-32 matchups into Firestore (config/results).
//
// Runs in GitHub Actions (see .github/workflows/update-results.yml).
// Env:
//   FOOTBALL_DATA_TOKEN       football-data.org API token (required)
//   FIREBASE_SERVICE_ACCOUNT  Firebase service-account JSON (required unless DRY_RUN)
//   DRY_RUN=true              fetch + log only, no Firestore writes
//
// NOTE: the exact `stage` strings, team-name spellings, and standings shape
// must be confirmed against the live feed. Run once with DRY_RUN=true (the
// default for manual runs) and check the logged "Stages"/"Statuses"/unmatched
// names, then we lock in any fixes.

import admin from 'firebase-admin';

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
const DRY_RUN = process.env.DRY_RUN === 'true';
const OVERRIDES = process.env.OVERRIDES || ''; // manual R32 overrides, e.g. "1E=Germany, 1A=Mexico"
const LOCK_AT = process.env.LOCK_AT || '';     // submission deadline, ISO UTC; blank = unchanged
const API = 'https://api.football-data.org/v4';
const COMP = 'WC'; // FIFA World Cup competition code

if (!TOKEN) {
  console.log('FOOTBALL_DATA_TOKEN not set — skipping until repo secrets are configured.');
  process.exit(0);
}

// ---- Team-name normalization -------------------------------------------------
// Map football-data spellings to the app's exact strings. These are best
// guesses; the validator below logs any name that doesn't match the app set.
const NAME_MAP = {
  'Turkey': 'Türkiye',
  'Ivory Coast': "Côte d'Ivoire",
  'Bosnia and Herzegovina': 'Bosnia & Herz.',
  'Bosnia-Herzegovina': 'Bosnia & Herz.',
  'Curacao': 'Curaçao',
  'Czech Republic': 'Czechia',
  'Korea Republic': 'South Korea',
  'Congo DR': 'DR Congo',
  'DR Congo (Congo DR)': 'DR Congo',
  'Cabo Verde': 'Cape Verde',
  'Cape Verde Islands': 'Cape Verde',
  'United States': 'USA',
};

// The 48 teams as spelled in the app (index.html `groups`). Used to flag any
// name the feed sends that we haven't mapped.
const VALID_TEAMS = new Set([
  'Mexico','South Africa','South Korea','Czechia','Canada','Bosnia & Herz.','Qatar','Switzerland',
  'Brazil','Morocco','Haiti','Scotland','USA','Paraguay','Australia','Türkiye',
  'Germany','Curaçao',"Côte d'Ivoire",'Ecuador','Netherlands','Japan','Sweden','Tunisia',
  'Belgium','Egypt','Iran','New Zealand','Spain','Cape Verde','Saudi Arabia','Uruguay',
  'France','Senegal','Iraq','Norway','Argentina','Algeria','Austria','Jordan',
  'Portugal','DR Congo','Uzbekistan','Colombia','England','Croatia','Ghana','Panama',
]);

const unmatched = new Set();
function normTeam(name) {
  if (!name) return null;
  const n = NAME_MAP[name] || name;
  if (!VALID_TEAMS.has(n)) unmatched.add(`${name} -> ${n}`);
  return n;
}

// ---- R32 bracket slots (positions + kickoff time), in index.html slot order.
// We map each resolved feed match to its slot by kickoff time; positions are
// used for the manual override path. ----
const R32 = [
  { home: '1E', away: '3ABCDF', date: '2026-06-29T20:30:00Z' },
  { home: '1I', away: '3CDFGH', date: '2026-06-30T21:00:00Z' },
  { home: '2A', away: '2B',     date: '2026-06-28T19:00:00Z' },
  { home: '1F', away: '2C',     date: '2026-06-30T01:00:00Z' },
  { home: '2K', away: '2L',     date: '2026-07-02T23:00:00Z' },
  { home: '1H', away: '2J',     date: '2026-07-02T19:00:00Z' },
  { home: '1D', away: '3BEFIJ', date: '2026-07-02T00:00:00Z' },
  { home: '1G', away: '3AEHIJ', date: '2026-07-01T20:00:00Z' },
  { home: '1C', away: '2F',     date: '2026-06-29T17:00:00Z' },
  { home: '2E', away: '2I',     date: '2026-06-30T17:00:00Z' },
  { home: '1A', away: '3CEFHI', date: '2026-07-01T01:00:00Z' },
  { home: '1L', away: '3EHIJK', date: '2026-07-01T16:00:00Z' },
  { home: '1J', away: '2H',     date: '2026-07-03T22:00:00Z' },
  { home: '2D', away: '2G',     date: '2026-07-03T18:00:00Z' },
  { home: '1B', away: '3EFGIJ', date: '2026-07-03T03:00:00Z' },
  { home: '1K', away: '3DEIJL', date: '2026-07-04T01:30:00Z' },
];

// Parse manual overrides like "1E=Germany, 1A=Mexico, D1=USA" into { '1E': 'Germany', ... }.
// Accepts either "1E" or "E1" order. Only group winners/runners-up (1/2), not 3rd-place.
function parseOverrides(str) {
  const map = {};
  (str || '').split(',').map(s => s.trim()).filter(Boolean).forEach(pair => {
    const eq = pair.indexOf('=');
    if (eq < 0) return;
    let pos = pair.slice(0, eq).trim().toUpperCase();
    const team = normTeam(pair.slice(eq + 1).trim());
    if (/^[A-L][12]$/.test(pos)) pos = pos[1] + pos[0]; // "E1" -> "1E"
    if (/^[12][A-L]$/.test(pos) && team) map[pos] = team;
  });
  return map;
}

// ---- HTTP --------------------------------------------------------------------
async function fdGet(path) {
  const res = await fetch(API + path, { headers: { 'X-Auth-Token': TOKEN } });
  if (!res.ok) throw new Error(`football-data ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// ---- Main --------------------------------------------------------------------
async function main() {
  console.log(`DRY_RUN=${DRY_RUN}`);

  const matchData = await fdGet(`/competitions/${COMP}/matches`);
  const matches = matchData.matches || [];
  console.log(`Fetched ${matches.length} matches`);
  console.log('Stages present:', [...new Set(matches.map(m => m.stage))].join(', '));
  console.log('Statuses present:', [...new Set(matches.map(m => m.status))].join(', '));

  if (DRY_RUN) {
    const sample = matches.find(m => m.stage === 'LAST_32') || matches.find(m => m.stage === 'LAST_16');
    console.log('DEBUG sample knockout match:', JSON.stringify(sample));
  }

  // --- Results: winners bucketed by round (set membership is all the app needs) ---
  const STAGE_TO_ROUND = { LAST_32: 'r32', LAST_16: 'r16', QUARTER_FINALS: 'qf', SEMI_FINALS: 'sf' };
  const results = { r32: [], r16: [], qf: [], sf: [], final: [], champion: null, thirdPlace: null };

  for (const m of matches) {
    if (m.status !== 'FINISHED') continue;
    const winnerName = m.score?.winner === 'HOME_TEAM' ? m.homeTeam?.name
                     : m.score?.winner === 'AWAY_TEAM' ? m.awayTeam?.name : null;
    const w = normTeam(winnerName);
    if (!w) continue;
    const round = STAGE_TO_ROUND[m.stage];
    if (round) {
      results[round].push(w);
      if (round === 'sf') results.final.push(w); // SF winners are the finalists
    } else if (m.stage === 'FINAL') {
      results.champion = w;
    } else if (m.stage === 'THIRD_PLACE') {
      results.thirdPlace = w;
    }
  }

  // --- Resolve R32 matchups: feed first, manual overrides fill the gaps -----
  // The feed assigns real teams to LAST_32 matches (group math + 3rd-place
  // allocation) once official; we map each to its slot by kickoff time. Until
  // then, a manual override (confirmed group winners) fills in known sides,
  // producing partial matchups like ["Germany", null].
  const slotByDate = {};
  R32.forEach((s, i) => { slotByDate[s.date] = i; });
  const feed = Array(16).fill(null);
  let unmappedDates = 0;
  for (const m of matches) {
    if (m.stage !== 'LAST_32') continue;
    const slot = slotByDate[m.utcDate];
    if (slot === undefined) { unmappedDates++; if (DRY_RUN) console.warn('Unmapped LAST_32 utcDate:', m.utcDate); continue; }
    feed[slot] = [normTeam(m.homeTeam?.name), normTeam(m.awayTeam?.name)];
  }

  const posMap = parseOverrides(OVERRIDES);
  const ovTeam = (pos) => ((pos[0] === '1' || pos[0] === '2') ? (posMap[pos] || null) : null);
  // Each slot is an object { home, away } (Firestore forbids arrays of arrays).
  const r32Fixtures = R32.map((s, i) => {
    const home = (feed[i] && feed[i][0]) || ovTeam(s.home) || null;
    const away = (feed[i] && feed[i][1]) || ovTeam(s.away) || null;
    return (home || away) ? { home, away } : null;
  });

  if (DRY_RUN) {
    console.log(`DEBUG LAST_32 feed matches: ${matches.filter(m => m.stage === 'LAST_32').length}, unmapped by date: ${unmappedDates}`);
    console.log('DEBUG override posMap:', JSON.stringify(posMap));
    // Log each fixture as plain text (avoids secret-masking of JSON braces)
    console.log('DEBUG r32Fixtures:');
    r32Fixtures.forEach((fx, i) => {
      const s = R32[i];
      console.log(`  SLOT-${i} [${s.home} vs ${s.away}] => ${fx ? fx.home + ' vs ' + fx.away : 'null'}`);
    });
  }

  // --- Per-round earliest kickoff (groundwork for per-match locking later) ---
  const STAGE_TO_LOCK = { LAST_32: 'r32', LAST_16: 'r16', QUARTER_FINALS: 'qf', SEMI_FINALS: 'sf', FINAL: 'final', THIRD_PLACE: 'third' };
  const roundKickoffs = {};
  for (const m of matches) {
    const k = STAGE_TO_LOCK[m.stage];
    if (k && m.utcDate) {
      if (!roundKickoffs[k] || m.utcDate < roundKickoffs[k]) roundKickoffs[k] = m.utcDate;
    }
  }

  // --- Summary ---
  console.log('Results counts:', {
    r32: results.r32.length, r16: results.r16.length, qf: results.qf.length,
    sf: results.sf.length, final: results.final.length,
    champion: results.champion, thirdPlace: results.thirdPlace,
  });
  console.log('R32 fixtures resolved:', r32Fixtures.filter(Boolean).length, '/ 16');
  console.log('Round kickoffs:', roundKickoffs);
  if (unmatched.size) console.warn('UNMATCHED TEAM NAMES (add to NAME_MAP):', [...unmatched]);

  if (DRY_RUN) {
    console.log('DRY_RUN — not writing to Firestore.');
    return;
  }

  // --- Write to Firestore via Admin SDK (bypasses security rules) ---
  if (!SA) {
    console.log('FIREBASE_SERVICE_ACCOUNT not set — fetched OK but skipping write until configured.');
    process.exit(0);
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  const payload = {
    r32: results.r32, r16: results.r16, qf: results.qf, sf: results.sf,
    final: results.final, champion: results.champion, thirdPlace: results.thirdPlace,
    updatedAt: FieldValue.serverTimestamp(),
  };
  // Only write r32Fixtures when we actually have some — otherwise an empty
  // scheduled run would wipe matchups set by a manual override.
  if (r32Fixtures.some(Boolean)) payload.r32Fixtures = r32Fixtures;
  await db.collection('config').doc('results').set(payload, { merge: true });

  const settings = { roundKickoffs, updatedAt: FieldValue.serverTimestamp() };
  if (LOCK_AT) {
    const d = new Date(LOCK_AT);
    if (isNaN(d.getTime())) { console.error(`Invalid LOCK_AT: ${LOCK_AT}`); process.exit(1); }
    settings.lockAt = admin.firestore.Timestamp.fromDate(d);
    console.log(`Setting submission deadline (lockAt) to ${d.toISOString()}`);
  }
  await db.collection('config').doc('settings').set(settings, { merge: true });

  console.log('Wrote config/results and config/settings.');
}

main().catch(e => { console.error(e); process.exit(1); });
