import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function run() {
  try {
    await setDoc(doc(db, 'test', 'test_probe_manual'), { data: "test" });
    console.log("SUCCESS: Wrote to test/test_probe_manual");
  } catch (e) {
    console.error("ERROR:", e.message);
  }
  process.exit(0);
}
run();
