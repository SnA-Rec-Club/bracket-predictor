// Builds config/leaderboard from config/results + the picks collection.
//
// Runs on its OWN schedule (build-leaderboard.yml), independent of the
// football-data updater. It makes NO external API calls — only Firestore — so
// a flaky football-data fetch can never block leaderboard refreshes (and a
// problem here can't block results updates).
//
// Scoring MUST stay identical to calculateScore() in index.html and the client
// merge. If you change point values or the R32 lock rule, change all three.
import admin from 'firebase-admin';

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SA) { console.error('FIREBASE_SERVICE_ACCOUNT not set'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// R32 kickoff per slot — must match index.html R32_KICKOFFS and the updater's
// R32 array order. Used for per-match locking.
const R32_KICKOFFS = [
  '2026-06-29T20:30:00Z', // 0  1E vs 3ABCDF
  '2026-06-30T21:00:00Z', // 1  1I vs 3CDFGH
  '2026-06-28T19:00:00Z', // 2  SA vs Canada (2A vs 2B) ← pre-launch, exempt
  '2026-06-30T01:00:00Z', // 3  1F vs 2C
  '2026-07-02T23:00:00Z', // 4  2K vs 2L
  '2026-07-02T19:00:00Z', // 5  1H vs 2J
  '2026-07-02T00:00:00Z', // 6  1D vs 3BEFIJ
  '2026-07-01T20:00:00Z', // 7  1G vs 3AEHIJ
  '2026-06-29T17:00:00Z', // 8  1C vs 2F
  '2026-06-30T17:00:00Z', // 9  2E vs 2I
  '2026-07-01T01:00:00Z', // 10 1A vs 3CEFHI
  '2026-07-01T16:00:00Z', // 11 1L vs 3EHIJK
  '2026-07-03T22:00:00Z', // 12 1J vs 2H
  '2026-07-03T18:00:00Z', // 13 2D vs 2G
  '2026-07-03T03:00:00Z', // 14 1B vs 3EFGIJ
  '2026-07-04T01:30:00Z', // 15 1K vs 3DEIJL
].map(d => new Date(d));

// Only slot 2 (SA vs Canada) kicked off before app launch — everyone can score
// it. All other slots require submission before that match's kickoff.
const PRE_LAUNCH_CUTOFF = new Date('2026-06-28T19:00:00Z');

function scoreOne(p, results) {
  let score = 0;
  const bd = { r32: 0, r16: 0, qf: 0, sf: 0, final: 0, thirdPlace: 0, champion: 0 };
  const subTime = p.submittedAt
    ? (p.submittedAt.toDate ? p.submittedAt.toDate() : new Date(p.submittedAt))
    : null;
  (p.r32 || []).forEach((t, i) => {
    if (!t || !results.r32.includes(t)) return;
    const kickoff = R32_KICKOFFS[i];
    // Post-launch matches: only score if submitted before kickoff.
    if (kickoff && kickoff > PRE_LAUNCH_CUTOFF && subTime && subTime >= kickoff) return;
    score += 1; bd.r32++;
  });
  (p.r16 || []).forEach(t => { if (t && results.r16.includes(t)) { score += 2; bd.r16++; } });
  (p.qf || []).forEach(t => { if (t && results.qf.includes(t)) { score += 4; bd.qf++; } });
  (p.sf || []).forEach(t => { if (t && results.sf.includes(t)) { score += 8; bd.sf++; } });
  (p.final || []).forEach(t => { if (t && results.final.includes(t)) { score += 12; bd.final++; } });
  if (p.thirdPlace && p.thirdPlace === results.thirdPlace) { score += 8; bd.thirdPlace = 1; }
  if (p.champion && p.champion === results.champion) { score += 20; bd.champion = 1; }
  return { score, breakdown: bd };
}

async function main() {
  // Results are whatever the updater last wrote. If absent, score against empty
  // sets (everyone 0) rather than failing — new submissions still get listed.
  const resDoc = await db.collection('config').doc('results').get();
  const r = resDoc.exists ? resDoc.data() : {};
  const results = {
    r32: r.r32 || [], r16: r.r16 || [], qf: r.qf || [], sf: r.sf || [],
    final: r.final || [], champion: r.champion || null, thirdPlace: r.thirdPlace || null,
  };

  const picksSnap = await db.collection('picks').get();
  const entries = [];
  picksSnap.forEach(doc => {
    const p = doc.data();
    const { score, breakdown } = scoreOne(p, results);
    // id (email hash) lets the client merge its own live entry without name collisions.
    entries.push({ id: doc.id, name: p.name || '(no name)', score, breakdown });
  });
  entries.sort((a, b) => b.score - a.score); // stable: ties keep collection order

  await db.collection('config').doc('leaderboard').set({
    entries,
    count: entries.length,
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`Wrote config/leaderboard (${entries.length} entries).`);
}

main().catch(e => { console.error(e); process.exit(1); });
