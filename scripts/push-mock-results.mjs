// One-shot script: push fake results into Firestore for scoring tests.
// Wipe by running the normal update-results workflow (it overwrites with real data).
import admin from 'firebase-admin';

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SA) { console.error('FIREBASE_SERVICE_ACCOUNT not set'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const mock = {
  r32: [
    'Germany', 'France', 'South Africa', 'Netherlands',
    'Portugal', 'Spain', 'USA', 'Belgium',
    'Brazil', 'Argentina', 'England', 'Colombia',
    'Mexico', 'Japan', 'Australia', 'Uruguay',
  ],
  r16: ['Germany', 'France', 'Netherlands', 'Portugal', 'Brazil', 'England', 'Colombia', 'Mexico'],
  qf:  ['Germany', 'Netherlands', 'Brazil', 'Colombia'],
  sf:  ['Germany', 'Brazil'],
  final: ['Germany', 'Brazil'],
  champion: 'Germany',
  thirdPlace: 'Netherlands',
  updatedAt: FieldValue.serverTimestamp(),
};

await db.collection('config').doc('results').set(mock);
console.log('Mock results pushed:', JSON.stringify(mock, null, 2));
