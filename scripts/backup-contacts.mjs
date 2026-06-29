// One-shot: dump the private `contacts` collection (email <-> name) to JSON.
// Contents are NEVER printed (this repo is public) — only counts are logged.
// The workflow encrypts the output before uploading it as an artifact.
import admin from 'firebase-admin';
import { writeFileSync } from 'fs';

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SA) { console.error('FIREBASE_SERVICE_ACCOUNT not set'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
const db = admin.firestore();

const snap = await db.collection('contacts').get();
const docs = [];
snap.forEach(d => {
  const data = d.data();
  let submittedAt = null;
  if (data.submittedAt && data.submittedAt.toDate) {
    submittedAt = {
      iso: data.submittedAt.toDate().toISOString(),
      seconds: data.submittedAt.seconds,
      nanoseconds: data.submittedAt.nanoseconds,
    };
  }
  docs.push({ _id: d.id, name: data.name || null, email: data.email || null, submittedAt });
});

writeFileSync('contacts.json', JSON.stringify({ collection: 'contacts', count: docs.length, docs }, null, 2));
console.log(`Dumped ${docs.length} contacts to contacts.json (contents not logged).`);
