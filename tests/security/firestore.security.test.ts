import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { assertFirestoreEmulatorSafety, TEST_FIREBASE_PROJECT_ID } from "../helpers/emulatorSafety";

const { host, port } = assertFirestoreEmulatorSafety();
let testEnv: RulesTestEnvironment;
const OWNER_EMAIL = "coordinator@tests.invalid";
const OTHER_EMAIL = "other@tests.invalid";
const ADMIN_UID = "7D079IDPnkcvJxB8sNSEbLKS1EY2";

const anonymousDb = () => testEnv.unauthenticatedContext().firestore();
const ownerDb = () => testEnv.authenticatedContext("owner-uid", { email: OWNER_EMAIL }).firestore();
const otherDb = () => testEnv.authenticatedContext("other-uid", { email: OTHER_EMAIL }).firestore();
const adminDb = () => testEnv.authenticatedContext(ADMIN_UID, { email: "admin@tests.invalid" }).firestore();
const patient = (id: string, coordinatorEmail = OWNER_EMAIL) => ({ id, coordinatorEmail, status: "sent", accessPin: "a2b3" });

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: TEST_FIREBASE_PROJECT_ID,
    firestore: { host, port, rules: readFileSync("firestore.rules", "utf8") }
  });
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "patients", "patient_owner"), patient("patient_owner")),
      setDoc(doc(db, "patients", "patient_other"), patient("patient_other", OTHER_EMAIL)),
      setDoc(doc(db, "patients", "patient_owner_update"), patient("patient_owner_update")),
      setDoc(doc(db, "patients", "patient_other_update"), patient("patient_other_update", OTHER_EMAIL)),
      setDoc(doc(db, "patients", "patient_owner_delete"), patient("patient_owner_delete")),
      setDoc(doc(db, "patients", "patient_other_delete"), patient("patient_other_delete", OTHER_EMAIL)),
      setDoc(doc(db, "users", OWNER_EMAIL), { email: OWNER_EMAIL, nombre: "Owner", pin: "1111" }),
      setDoc(doc(db, "users", OTHER_EMAIL), { email: OTHER_EMAIL, nombre: "Other", pin: "2222" }),
      setDoc(doc(db, "audios", "audio_legacy"), { data: "legacy" }),
      setDoc(doc(db, "audios", "audio_general"), { data: "general", kind: "question" }),
      setDoc(doc(db, "audios", "audio_private"), { data: "private", kind: "patient_conclusion", coordinatorEmail: OWNER_EMAIL }),
      setDoc(doc(db, "audios", "audio_private_owner_update"), { data: "private", kind: "patient_conclusion", coordinatorEmail: OWNER_EMAIL }),
      setDoc(doc(db, "audios", "audio_private_other_update"), { data: "private", kind: "patient_conclusion", coordinatorEmail: OWNER_EMAIL }),
      setDoc(doc(db, "audios", "audio_private_owner_email"), { data: "private", kind: "patient_conclusion", coordinatorEmail: OWNER_EMAIL }),
      setDoc(doc(db, "audios", "audio_private_owner_kind"), { data: "private", kind: "patient_conclusion", coordinatorEmail: OWNER_EMAIL }),
      setDoc(doc(db, "audios", "audio_private_owner_delete"), { data: "private", kind: "patient_conclusion", coordinatorEmail: OWNER_EMAIL }),
      setDoc(doc(db, "audios", "audio_private_other_delete"), { data: "private", kind: "patient_conclusion", coordinatorEmail: OWNER_EMAIL }),
      setDoc(doc(db, "config", "global_config"), { public: true }),
      setDoc(doc(db, "questionnaires", "active"), { questions: [] }),
      setDoc(doc(db, "questions", "question_fixture"), { text: "Synthetic question" })
    ]);
  });
});

after(async () => testEnv.cleanup());

test("01 anonymous patient GET is denied", async () => {
  await assertFails(getDoc(doc(anonymousDb(), "patients", "patient_owner")));
});
test("02 anonymous patient LIST is denied", async () => {
  await assertFails(getDocs(collection(anonymousDb(), "patients")));
});
test("03 anonymous patient CREATE is denied", async () => {
  await assertFails(setDoc(doc(anonymousDb(), "patients", "patient_anon_create"), patient("patient_anon_create")));
});
test("04 anonymous patient UPDATE is denied", async () => {
  await assertFails(updateDoc(doc(anonymousDb(), "patients", "patient_owner"), { status: "viewed" }));
});
test("05 anonymous patient DELETE is denied", async () => {
  await assertFails(deleteDoc(doc(anonymousDb(), "patients", "patient_owner")));
});
test("06 coordinator own patient GET passes", async () => {
  assert.equal((await assertSucceeds(getDoc(doc(ownerDb(), "patients", "patient_owner")))).exists(), true);
});
test("07 coordinator other patient GET is denied", async () => {
  await assertFails(getDoc(doc(ownerDb(), "patients", "patient_other")));
});
test("08 coordinator own patient filtered query passes", async () => {
  const snapshot = await assertSucceeds(getDocs(query(collection(ownerDb(), "patients"), where("coordinatorEmail", "==", OWNER_EMAIL))));
  assert.ok(snapshot.size >= 1);
});
test("09 coordinator other-email query is denied", async () => {
  await assertFails(getDocs(query(collection(ownerDb(), "patients"), where("coordinatorEmail", "==", OTHER_EMAIL))));
});
test("10 coordinator unfiltered patient list is denied", async () => {
  await assertFails(getDocs(collection(ownerDb(), "patients")));
});
test("11 coordinator create own patient passes", async () => {
  const id = "patient_create_own";
  await assertSucceeds(setDoc(doc(ownerDb(), "patients", id), patient(id)));
});
test("12 coordinator create for other coordinator is denied", async () => {
  const id = "patient_create_other";
  await assertFails(setDoc(doc(ownerDb(), "patients", id), patient(id, OTHER_EMAIL)));
});
test("13 coordinator create with id mismatch is denied", async () => {
  await assertFails(setDoc(doc(ownerDb(), "patients", "patient_path_id"), patient("different_id")));
});
test("14 coordinator update own patient passes", async () => {
  await assertSucceeds(updateDoc(doc(ownerDb(), "patients", "patient_owner_update"), { status: "viewed" }));
});
test("15 coordinator update other patient is denied", async () => {
  await assertFails(updateDoc(doc(ownerDb(), "patients", "patient_other_update"), { status: "viewed" }));
});
test("16 coordinator cannot change coordinatorEmail", async () => {
  await assertFails(updateDoc(doc(ownerDb(), "patients", "patient_owner_update"), { coordinatorEmail: OTHER_EMAIL }));
});
test("17 coordinator cannot change patient id", async () => {
  await assertFails(updateDoc(doc(ownerDb(), "patients", "patient_owner_update"), { id: "changed_id" }));
});
test("18 coordinator delete own patient passes", async () => {
  await assertSucceeds(deleteDoc(doc(ownerDb(), "patients", "patient_owner_delete")));
});
test("19 coordinator delete other patient is denied", async () => {
  await assertFails(deleteDoc(doc(ownerDb(), "patients", "patient_other_delete")));
});
test("20 admin patient get list create update delete pass", async () => {
  const db = adminDb(); const id = "patient_admin_crud";
  await assertSucceeds(setDoc(doc(db, "patients", id), patient("different_admin_id", OTHER_EMAIL)));
  await assertSucceeds(getDoc(doc(db, "patients", "patient_other")));
  await assertSucceeds(getDocs(collection(db, "patients")));
  await assertSucceeds(updateDoc(doc(db, "patients", id), { coordinatorEmail: OWNER_EMAIL, id: "admin_changed_id" }));
  await assertSucceeds(deleteDoc(doc(db, "patients", id)));
});

test("21 anonymous user GET is denied", async () => {
  await assertFails(getDoc(doc(anonymousDb(), "users", OWNER_EMAIL)));
});
test("22 coordinator own user GET passes", async () => {
  await assertSucceeds(getDoc(doc(ownerDb(), "users", OWNER_EMAIL)));
});
test("23 coordinator other user GET is denied", async () => {
  await assertFails(getDoc(doc(ownerDb(), "users", OTHER_EMAIL)));
});
test("24 coordinator users LIST is denied", async () => {
  await assertFails(getDocs(collection(ownerDb(), "users")));
});
test("25 coordinator create own user passes", async () => {
  const email = "new-owner@tests.invalid";
  const db = testEnv.authenticatedContext("new-owner", { email }).firestore();
  await assertSucceeds(setDoc(doc(db, "users", email), { email, nombre: "New" }));
});
test("26 coordinator create other user is denied", async () => {
  await assertFails(setDoc(doc(ownerDb(), "users", "foreign@tests.invalid"), { email: "foreign@tests.invalid" }));
});
test("27 coordinator update own user passes", async () => {
  await assertSucceeds(updateDoc(doc(ownerDb(), "users", OWNER_EMAIL), { nombre: "Updated owner" }));
});
test("28 coordinator update other user is denied", async () => {
  await assertFails(updateDoc(doc(ownerDb(), "users", OTHER_EMAIL), { nombre: "Forbidden" }));
});
test("29 admin users access passes", async () => {
  const db = adminDb(); const email = "admin-created@tests.invalid";
  await assertSucceeds(setDoc(doc(db, "users", email), { email }));
  await assertSucceeds(getDoc(doc(db, "users", OTHER_EMAIL)));
  await assertSucceeds(getDocs(collection(db, "users")));
  await assertSucceeds(updateDoc(doc(db, "users", email), { nombre: "Admin" }));
  await assertSucceeds(deleteDoc(doc(db, "users", email)));
});

test("30 anonymous GET legacy audio without kind passes", async () => {
  await assertSucceeds(getDoc(doc(anonymousDb(), "audios", "audio_legacy")));
});
test("31 anonymous GET general non-private audio passes", async () => {
  await assertSucceeds(getDoc(doc(anonymousDb(), "audios", "audio_general")));
});
test("32 anonymous GET patient_conclusion is denied", async () => {
  await assertFails(getDoc(doc(anonymousDb(), "audios", "audio_private")));
});
test("33 owner coordinator GET patient_conclusion passes", async () => {
  await assertSucceeds(getDoc(doc(ownerDb(), "audios", "audio_private")));
});
test("34 other coordinator GET patient_conclusion is denied", async () => {
  await assertFails(getDoc(doc(otherDb(), "audios", "audio_private")));
});
test("35 admin GET patient_conclusion passes", async () => {
  await assertSucceeds(getDoc(doc(adminDb(), "audios", "audio_private")));
});
test("36 anonymous LIST audios is denied", async () => {
  await assertFails(getDocs(collection(anonymousDb(), "audios")));
});
test("37 normal coordinator generic LIST audios is denied", async () => {
  await assertFails(getDocs(collection(ownerDb(), "audios")));
});
test("38 admin LIST audios passes", async () => {
  await assertSucceeds(getDocs(collection(adminDb(), "audios")));
});
test("39 authenticated coordinator CREATE general audio passes", async () => {
  await assertSucceeds(setDoc(doc(ownerDb(), "audios", "audio_general_create"), { data: "general" }));
});
test("40 coordinator CREATE own patient_conclusion passes", async () => {
  await assertSucceeds(setDoc(doc(ownerDb(), "audios", "audio_private_create_own"), { data: "private", kind: "patient_conclusion", coordinatorEmail: OWNER_EMAIL }));
});
test("41 coordinator CREATE patient_conclusion owned by another is denied", async () => {
  await assertFails(setDoc(doc(ownerDb(), "audios", "audio_private_create_other"), { data: "private", kind: "patient_conclusion", coordinatorEmail: OTHER_EMAIL }));
});
test("42 owner UPDATE patient_conclusion passes", async () => {
  await assertSucceeds(updateDoc(doc(ownerDb(), "audios", "audio_private_owner_update"), { data: "updated", usedBy: { patient: true } }));
});
test("43 other coordinator UPDATE patient_conclusion is denied", async () => {
  await assertFails(updateDoc(doc(otherDb(), "audios", "audio_private_other_update"), { data: "forbidden" }));
});
test("44 owner cannot change private audio coordinatorEmail", async () => {
  await assertFails(updateDoc(doc(ownerDb(), "audios", "audio_private_owner_email"), { coordinatorEmail: OTHER_EMAIL }));
});
test("45 owner cannot change private audio kind to public", async () => {
  await assertFails(updateDoc(doc(ownerDb(), "audios", "audio_private_owner_kind"), { kind: "question" }));
});
test("46 owner DELETE own patient_conclusion passes", async () => {
  await assertSucceeds(deleteDoc(doc(ownerDb(), "audios", "audio_private_owner_delete")));
});
test("47 other coordinator DELETE patient_conclusion is denied", async () => {
  await assertFails(deleteDoc(doc(otherDb(), "audios", "audio_private_other_delete")));
});

test("48 anonymous GET config global_config passes", async () => {
  await assertSucceeds(getDoc(doc(anonymousDb(), "config", "global_config")));
});
test("49 anonymous GET questionnaires active passes", async () => {
  await assertSucceeds(getDoc(doc(anonymousDb(), "questionnaires", "active")));
});
test("50 anonymous GET question fixture passes", async () => {
  await assertSucceeds(getDoc(doc(anonymousDb(), "questions", "question_fixture")));
});
