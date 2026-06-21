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

// ---- R32 bracket structure (mirror of index.html r32Structure) --------------
const R32 = [
  { home: '1A', away: '2B' }, { home: '1C', away: '3DEF' }, { home: '1E', away: '2F' }, { home: '1G', away: '3HIJ' },
  { home: '1I', away: '2J' }, { home: '1K', away: '3ABC' }, { home: '2A', away: '2C' }, { home: '1B', away: '3GHI' },
  { home: '1D', away: '2E' }, { home: '1F', away: '3JKL' }, { home: '1H', away: '2G' }, { home: '1J', away: '3DEF' },
  { home: '2I', away: '2K' }, { home: '1L', away: '3ABC' }, { home: '2D', away: '2F' }, { home: '2H', away: '2L' },
];

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

  // --- Resolve R32 matchups from group standings (for narrowing + labels) ---
  let r32Fixtures = Array(16).fill(null);
  try {
    const standData = await fdGet(`/competitions/${COMP}/standings`);
    const groupTables = {}; // 'A' -> [1st, 2nd, 3rd, 4th]
    for (const s of (standData.standings || [])) {
      if (s.type && s.type !== 'TOTAL') continue;
      const letter = (s.group || '').replace('GROUP_', '').trim();
      if (!letter) continue;
      groupTables[letter] = (s.table || []).map(r => normTeam(r.team?.name));
    }
    const resolvePos = (pos) => {
      const rank = pos[0];
      const grp = pos.slice(1);
      if (rank === '1') return groupTables[grp]?.[0] || null;
      if (rank === '2') return groupTables[grp]?.[1] || null;
      // 3rd-place slots ("3DEF" etc.) need the FIFA best-third-place allocation
      // table — TODO: implement once confirmed against the live feed. Until then
      // these slots stay null and the app shows the placeholder ("1C vs 3rd DEF").
      return null;
    };
    r32Fixtures = R32.map(s => {
      const home = resolvePos(s.home);
      const away = resolvePos(s.away);
      return (home && away) ? [home, away] : null;
    });
  } catch (e) {
    console.warn('Standings fetch/resolve failed (R32 fixtures left empty):', e.message);
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

  await db.collection('config').doc('results').set({
    r32: results.r32, r16: results.r16, qf: results.qf, sf: results.sf,
    final: results.final, champion: results.champion, thirdPlace: results.thirdPlace,
    r32Fixtures,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.collection('config').doc('settings').set({
    roundKickoffs,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log('Wrote config/results and config/settings.');
}

main().catch(e => { console.error(e); process.exit(1); });
