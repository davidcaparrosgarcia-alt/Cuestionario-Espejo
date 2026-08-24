import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { assertFirestoreEmulatorSafety, TEST_FIREBASE_PROJECT_ID } from "../helpers/emulatorSafety";

const { host, port } = assertFirestoreEmulatorSafety();
let testEnv: RulesTestEnvironment;
const patientId = "patient_test_security_baseline";

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: TEST_FIREBASE_PROJECT_ID,
    firestore: {
      host,
      port,
      rules: readFileSync("firestore.rules", "utf8")
    }
  });
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "patients", patientId), {
      id: patientId,
      status: "sent",
      coordinatorEmail: "coordinator@tests.invalid",
      accessPin: "a2b3"
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

test("security baseline: anonymous patients direct GET is currently allowed", async () => {
  const patientRef = doc(testEnv.unauthenticatedContext().firestore(), "patients", patientId);
  const snapshot = await assertSucceeds(getDoc(patientRef));
  assert.equal(snapshot.exists(), true);
});

test("security baseline: anonymous patients direct UPDATE is currently allowed", async () => {
  const patientRef = doc(testEnv.unauthenticatedContext().firestore(), "patients", patientId);
  await assertSucceeds(updateDoc(patientRef, { baselineProbe: "synthetic" }));
});

test.skip("EXPECTED FAIL UNTIL FIRESTORE LOCKDOWN: anonymous patients direct GET must be denied", async () => {
  const patientRef = doc(testEnv.unauthenticatedContext().firestore(), "patients", patientId);
  await assertFails(getDoc(patientRef));
});

test.skip("EXPECTED FAIL UNTIL FIRESTORE LOCKDOWN: anonymous patients direct UPDATE must be denied", async () => {
  const patientRef = doc(testEnv.unauthenticatedContext().firestore(), "patients", patientId);
  await assertFails(updateDoc(patientRef, { baselineProbe: "must-be-denied" }));
});
