import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app); // Default database

async function run() {
  try {
    const d = await getDoc(doc(db, 'audios', 'test_probe_manual'));
    console.log("SUCCESS: Read from default db audios/test_probe_manual", d.exists());
  } catch (e) {
    console.error("ERROR:", e.message);
  }
  process.exit(0);
}
run();
