import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs';

const configPath = './firebase-applet-config.json';
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

async function test() {
  try {
    const docSnap = await getDoc(doc(db, 'questionnaires', 'active'));
    console.log("Read succeeded:", docSnap.data());
  } catch (e) {
    console.error("Read failed:", e);
  }
  process.exit(0);
}
test();
