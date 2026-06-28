// One-shot script: delete all documents in the picks collection.
// Run via the clear-picks GitHub Actions workflow.
import admin from 'firebase-admin';

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SA) { console.error('FIREBASE_SERVICE_ACCOUNT not set'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
const db = admin.firestore();

const snap = await db.collection('picks').get();
if (snap.empty) { console.log('picks collection is already empty.'); process.exit(0); }

const batches = [];
let batch = db.batch();
let count = 0;
snap.docs.forEach(doc => {
  batch.delete(doc.ref);
  count++;
  if (count % 500 === 0) { batches.push(batch); batch = db.batch(); }
});
batches.push(batch);

await Promise.all(batches.map(b => b.commit()));
console.log(`Deleted ${count} picks.`);
