import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

let firebaseConfig: any = {};
firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8'));

const dbId = process.env.FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || "(default)";
const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;

console.log(`Using dbId: ${dbId}, projectId: ${projectId}`);
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: projectId,
});

const db = getFirestore(admin.app(), dbId);

async function test() {
  try {
    console.log("Testing insert...");
    await db.collection("patientRequests").doc("test_insert").set({ test: 1 });
    console.log("Insert succeeded.");
  } catch (err) {
    console.error("Insert error:", err);
  }

  try {
    console.log("Testing limit(20)...");
    const snapshot1 = await db.collection("patientRequests").limit(20).get();
    console.log(`Limit(20) succeeded: ${snapshot1.size} docs`);

    console.log("Testing where('status')...");
    const snapshot2 = await db.collection("patientRequests").where("status", "==", "pending").get();
    console.log(`Where() succeeded: ${snapshot2.size} docs`);

  } catch (error) {
    console.error("Test error:", error);
  }
}

test();
