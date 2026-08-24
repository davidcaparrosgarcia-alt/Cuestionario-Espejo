import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { PATIENT_ACCESS_RATE_LIMIT_WINDOW_MS, createRateLimitKey } from "../../api/patientAccess";
import {
  SYNTHETIC_ACCESS_PIN,
  activeQuestionnaireFixture,
  clonePatientFixture,
  patientFixtures
} from "../fixtures/patientAccessFixtures";
import { assertFirestoreEmulatorSafety, assertSafeLocalWebhookTarget } from "../helpers/emulatorSafety";

assertFirestoreEmulatorSafety();

interface WebhookRequestRecord {
  event: string | null;
  linkedQuestionnairePatientId: string | null;
  status: string | null;
  headers: {
    contentType: string | null;
    bridgeSecret: string | null;
  };
  body: Record<string, unknown>;
}

const webhookRequests: WebhookRequestRecord[] = [];
let webhookResponseStatus = 200;
const webhookServer = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const received = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
  const { accessCode: _accessCode, accessPin: _accessPin, ...bodyWithoutPins } = received;
  webhookRequests.push({
    event: typeof received.event === "string" ? received.event : null,
    linkedQuestionnairePatientId: typeof received.linkedQuestionnairePatientId === "string"
      ? received.linkedQuestionnairePatientId
      : null,
    status: typeof received.status === "string" ? received.status : null,
    headers: {
      contentType: request.headers["content-type"] || null,
      bridgeSecret: typeof request.headers["x-bridge-secret"] === "string"
        ? request.headers["x-bridge-secret"]
        : null
    },
    body: bodyWithoutPins
  });
  response.statusCode = webhookResponseStatus;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ success: webhookResponseStatus < 400 }));
});

await new Promise<void>((resolve, reject) => {
  webhookServer.listen(0, "127.0.0.1", resolve);
  webhookServer.on("error", reject);
});
const webhookAddress = webhookServer.address();
if (!webhookAddress || typeof webhookAddress === "string") {
  throw new Error("No se pudo obtener el puerto del webhook local de test.");
}
process.env.SOYBIENESTAR_WEBHOOK_URL = `http://127.0.0.1:${webhookAddress.port}/synthetic-webhook`;
process.env.SOYBIENESTAR_BRIDGE_SECRET = "synthetic-emulator-bridge-secret";
assertFirestoreEmulatorSafety();

const { default: app } = await import("../../api/index");
const db = getFirestore(admin.app(), "(default)");
let server: Server;
let baseUrl = "";

function resetWebhook(status = 200) {
  webhookRequests.length = 0;
  webhookResponseStatus = status;
}

function requestsFor(event: string) {
  return webhookRequests.filter(request => request.event === event);
}

async function clearCollection(name: string) {
  const snapshot = await db.collection(name).get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach(document => batch.delete(document.ref));
  await batch.commit();
}

async function seedPatient(id: string) {
  await db.collection("patients").doc(id).set(clonePatientFixture(id));
}

async function seedConclusionPatient(id: string, overrides: Record<string, unknown> = {}) {
  await db.collection("patients").doc(id).set({
    id,
    coordinatorEmail: "coordinator@tests.invalid",
    nombre: "Nombre Administrativo",
    questionnaireConfirmedName: "Nombre Elegido",
    email: "private@tests.invalid",
    telefono: "private-phone",
    accessPin: SYNTHETIC_ACCESS_PIN,
    status: "concluded",
    conclusionViews: 0,
    finalConclusion: "CONCLUSION_PUBLICA_INTEGRATION",
    conversationSummary: "INTERNAL_SUMMARY_INTEGRATION",
    answers: { q1: "a" },
    ...overrides
  });
}

async function seedFixtures() {
  await clearCollection("patientAccessRateLimits");
  await clearCollection("patients");
  const batch = db.batch();
  for (const [id, fixture] of Object.entries(patientFixtures)) {
    batch.set(db.collection("patients").doc(id), structuredClone(fixture));
  }
  batch.set(db.collection("questionnaires").doc("active"), activeQuestionnaireFixture);
  await batch.commit();
}

async function http(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "192.0.2.10",
      ...(init.headers || {})
    }
  });
  return { response, body: await response.json() };
}

function postUnlock(id: string, accessPin = SYNTHETIC_ACCESS_PIN, ip = "192.0.2.10") {
  return http(`/api/patient-access/${id}/unlock`, {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: JSON.stringify({ accessPin })
  });
}

function patchAction(id: string, action: string, payload: Record<string, unknown>, ip = "192.0.2.10") {
  return http(`/api/patient-access/${id}/action`, {
    method: "PATCH",
    headers: { "x-forwarded-for": ip },
    body: JSON.stringify({ accessPin: SYNTHETIC_ACCESS_PIN, action, payload })
  });
}

function postConclusion(
  id: string,
  channel: "session" | "direct",
  accessPin = SYNTHETIC_ACCESS_PIN,
  ip = "192.0.2.40"
) {
  return http(`/api/patient-access/${id}/conclusion`, {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: JSON.stringify({ accessPin, channel })
  });
}

before(async () => {
  await seedFixtures();
  server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    listeningServer.on("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No se pudo obtener el puerto HTTP de test.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => webhookServer.close(error => error ? reject(error) : resolve()));
  await admin.app().delete();
});

test("integration bootstrap devuelve exclusivamente el contrato esperado para todos los estados", async () => {
  const expected: Record<string, string> = {
    patient_test_pending: "questionnaire",
    patient_test_sent: "questionnaire",
    patient_test_viewed: "questionnaire",
    patient_test_completed: "completed",
    patient_test_concluded: "conclusion",
    patient_test_finalized: "conclusion",
    patient_test_deleted: "unavailable",
    patient_test_hipnodigest_recordtype: "unavailable",
    patient_test_hipnodigest_program: "unavailable",
    patient_test_unknown: "unavailable",
    patient_test_identity_mismatch: "unavailable",
    patient_test_missing: "unavailable"
  };

  for (const [id, next] of Object.entries(expected)) {
    const { response, body } = await http(`/api/patient-access/${id}/bootstrap`);
    assert.equal(response.status, 200, id);
    assert.deepEqual(body, { success: true, next }, id);
  }
});

test("integration unlock correcto persiste sent a viewed y limita el DTO", async () => {
  await seedPatient("patient_test_sent");
  const { response, body } = await postUnlock("patient_test_sent");
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.next, "questionnaire");
  assert.equal(body.patient.status, "viewed");
  assert.deepEqual(Object.keys(body).sort(), ["next", "patient", "success", "syncStatus"]);
  assert.deepEqual(Object.keys(body.patient).sort(), [
    "answers", "id", "lastAnswerSavedAt", "lastAnsweredQuestionId", "lastAnsweredQuestionIndex",
    "nombre", "questionnaireConfirmedName", "questionnaireConfirmedNameAt", "sexo", "status"
  ]);
  const serialized = JSON.stringify(body);
  for (const forbidden of ["accessPin", "proposedAccessCode", "personalAccessCode", "email", "telefono", "coordinatorEmail"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal((await db.collection("patients").doc("patient_test_sent").get()).data()?.status, "viewed");
});

test("integration PIN incorrecto devuelve 401, incrementa bucket y no modifica patient", async () => {
  const id = "patient_test_rate_limit";
  const ip = "192.0.2.20";
  await seedPatient(id);
  const beforeData = (await db.collection("patients").doc(id).get()).data();
  assert.equal((await postUnlock(id, "xxxx", ip)).response.status, 401);
  assert.deepEqual((await db.collection("patients").doc(id).get()).data(), beforeData);
  const key = createRateLimitKey(process.env.PATIENT_ACCESS_RATE_LIMIT_SECRET!, id, ip);
  assert.equal((await db.collection("patientAccessRateLimits").doc(key).get()).data()?.failedAttempts, 1);
});

test("integration rate limit devuelve cinco 401 y despues 429", async () => {
  const id = "patient_test_rate_limit";
  const ip = "192.0.2.21";
  await seedPatient(id);
  const key = createRateLimitKey(process.env.PATIENT_ACCESS_RATE_LIMIT_SECRET!, id, ip);
  await db.collection("patientAccessRateLimits").doc(key).delete();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal((await postUnlock(id, "xxxx", ip)).response.status, 401, `fallo ${attempt}`);
  }
  assert.equal((await postUnlock(id, "xxxx", ip)).response.status, 429);
  assert.equal((await db.collection("patientAccessRateLimits").doc(key).get()).data()?.failedAttempts, 5);
});

test("integration PIN correcto resetea el bucket antes del bloqueo", async () => {
  const id = "patient_test_rate_limit_reset";
  const ip = "192.0.2.22";
  await seedPatient(id);
  const key = createRateLimitKey(process.env.PATIENT_ACCESS_RATE_LIMIT_SECRET!, id, ip);
  await db.collection("patientAccessRateLimits").doc(key).delete();
  assert.equal((await postUnlock(id, "xxxx", ip)).response.status, 401);
  assert.equal((await postUnlock(id, "xxxx", ip)).response.status, 401);
  assert.equal((await postUnlock(id, SYNTHETIC_ACCESS_PIN, ip)).response.status, 200);
  assert.equal((await db.collection("patientAccessRateLimits").doc(key).get()).exists, false);
});

test("integration rate limit expirado abre una ventana nueva sin esperar", async () => {
  const id = "patient_test_rate_limit_expiry";
  const ip = "192.0.2.23";
  await seedPatient(id);
  const key = createRateLimitKey(process.env.PATIENT_ACCESS_RATE_LIMIT_SECRET!, id, ip);
  const expiredWindowStartedAt = Date.now() - PATIENT_ACCESS_RATE_LIMIT_WINDOW_MS - 5_000;
  await db.collection("patientAccessRateLimits").doc(key).set({
    failedAttempts: 5,
    windowStartedAt: expiredWindowStartedAt,
    expiresAt: expiredWindowStartedAt + PATIENT_ACCESS_RATE_LIMIT_WINDOW_MS,
    updatedAt: expiredWindowStartedAt
  });

  assert.equal((await postUnlock(id, "xxxx", ip)).response.status, 401);
  const renewed = (await db.collection("patientAccessRateLimits").doc(key).get()).data()!;
  assert.equal(renewed.failedAttempts, 1);
  assert.ok(renewed.windowStartedAt > expiredWindowStartedAt + PATIENT_ACCESS_RATE_LIMIT_WINDOW_MS);
  assert.equal(renewed.expiresAt, renewed.windowStartedAt + PATIENT_ACCESS_RATE_LIMIT_WINDOW_MS);
});

test("integration safety rechaza cualquier webhook que no sea HTTP local con secreto sintetico", () => {
  assert.doesNotThrow(() => assertSafeLocalWebhookTarget("", ""));
  assert.doesNotThrow(() => assertSafeLocalWebhookTarget("http://127.0.0.1:8123/hook", "synthetic-emulator-secret"));
  assert.doesNotThrow(() => assertSafeLocalWebhookTarget("http://localhost:8123/hook", "synthetic-emulator-secret"));
  assert.throws(() => assertSafeLocalWebhookTarget("https://127.0.0.1:8123/hook", "synthetic-emulator-secret"), /SAFETY ABORT/);
  assert.throws(() => assertSafeLocalWebhookTarget("http://example.invalid:8123/hook", "synthetic-emulator-secret"), /SAFETY ABORT/);
  assert.throws(() => assertSafeLocalWebhookTarget("http://192.0.2.1:8123/hook", "synthetic-emulator-secret"), /SAFETY ABORT/);
  assert.throws(() => assertSafeLocalWebhookTarget("http://127.0.0.1:8123/hook", "possible-real-secret"), /SAFETY ABORT/);
});

test("integration confirm_name cambia solo los dos campos autorizados", async () => {
  const id = "patient_test_action";
  await seedPatient(id);
  const beforeData = (await db.collection("patients").doc(id).get()).data()!;
  assert.equal((await patchAction(id, "confirm_name", { questionnaireConfirmedName: "Nombre Sintetico" })).response.status, 200);
  const afterData = (await db.collection("patients").doc(id).get()).data()!;
  const changed = Object.keys(afterData).filter(key => JSON.stringify(afterData[key]) !== JSON.stringify(beforeData[key])).sort();
  assert.deepEqual(changed, ["questionnaireConfirmedName", "questionnaireConfirmedNameAt"]);
});

test("integration save_progress persiste una respuesta y preserva las anteriores", async () => {
  const id = "patient_test_action";
  await seedPatient(id);
  assert.equal((await patchAction(id, "save_progress", { questionId: "q2", answer: "b", questionIndex: 1 })).response.status, 200);
  const stored = (await db.collection("patients").doc(id).get()).data()!;
  assert.deepEqual(stored.answers, { q1: "a", q2: "b" });
  assert.equal(stored.lastAnsweredQuestionId, "q2");
  assert.equal(stored.lastAnsweredQuestionIndex, 1);
  assert.equal(stored.stableField, "preserve");
});

test("integration save_progress rechaza preguntas inexistentes y hidden sin escribir", async () => {
  for (const questionId of ["q_missing", "q_hidden"]) {
    const id = "patient_test_action";
    await seedPatient(id);
    const beforeData = (await db.collection("patients").doc(id).get()).data();
    assert.equal((await patchAction(id, "save_progress", { questionId, answer: "x", questionIndex: 0 })).response.status, 422, questionId);
    assert.deepEqual((await db.collection("patients").doc(id).get()).data(), beforeData, questionId);
  }
});

test("integration action rechaza campos arbitrarios sin escribir", async () => {
  const id = "patient_test_action";
  await seedPatient(id);
  const beforeData = (await db.collection("patients").doc(id).get()).data();
  const { response } = await http(`/api/patient-access/${id}/action`, {
    method: "PATCH",
    body: JSON.stringify({ accessPin: SYNTHETIC_ACCESS_PIN, action: "save_progress", payload: { questionId: "q2", answer: "b" }, arbitrary: true })
  });
  assert.equal(response.status, 400);
  assert.deepEqual((await db.collection("patients").doc(id).get()).data(), beforeData);
});

test("integration complete persiste answers, completed, dateAnswered y aiReportStatus pending", async () => {
  const id = "patient_test_complete";
  await seedPatient(id);
  const { response, body } = await patchAction(id, "complete", { answers: { q2: "b", q3: "c" } });
  assert.equal(response.status, 200);
  assert.equal(body.idempotent, false);
  const stored = (await db.collection("patients").doc(id).get()).data()!;
  assert.deepEqual(stored.answers, { q1: "a", q2: "b", q3: "c" });
  assert.equal(stored.status, "completed");
  assert.equal(typeof stored.dateAnswered, "number");
  assert.equal(stored.aiReportStatus, "pending");
});

test("integration complete repetido es idempotente y conserva dateAnswered", async () => {
  const id = "patient_test_complete";
  await seedPatient(id);
  const first = await patchAction(id, "complete", { answers: { q2: "b" } });
  const dateAnswered = (await db.collection("patients").doc(id).get()).data()!.dateAnswered;
  const second = await patchAction(id, "complete", { answers: { q2: "c" } });
  const finalData = (await db.collection("patients").doc(id).get()).data()!;
  assert.equal(first.body.idempotent, false);
  assert.equal(second.body.idempotent, true);
  assert.equal(finalData.dateAnswered, dateAnswered);
  assert.equal(finalData.answers.q2, "b");
});

test("integration dos unlock SoyBienestar simultaneos emiten exactamente un questionnaire_started real", async () => {
  const id = "patient_test_soybienestar_unlock";
  await seedPatient(id);
  resetWebhook();
  const results = await Promise.all([
    postUnlock(id, SYNTHETIC_ACCESS_PIN, "192.0.2.30"),
    postUnlock(id, SYNTHETIC_ACCESS_PIN, "192.0.2.30")
  ]);
  assert.deepEqual(results.map(result => result.response.status), [200, 200]);
  assert.equal(results.filter(result => result.body.syncStatus === "ok").length, 1);
  assert.equal((await db.collection("patients").doc(id).get()).data()?.status, "viewed");
  const started = requestsFor("questionnaire_started");
  assert.equal(started.length, 1);
  assert.equal(started[0].linkedQuestionnairePatientId, id);
  assert.equal(started[0].status, "viewed");
  assert.equal(started[0].headers.bridgeSecret, "synthetic-emulator-bridge-secret");
  assert.equal(started[0].headers.contentType, "application/json");
  assert.equal("accessPin" in started[0].body, false);
  assert.equal("accessCode" in started[0].body, false);
});

test("integration dos complete SoyBienestar simultaneos emiten exactamente un questionnaire_completed real", async () => {
  const id = "patient_test_soybienestar_complete";
  await seedPatient(id);
  resetWebhook();
  const results = await Promise.all([
    patchAction(id, "complete", { answers: { q2: "b" } }, "192.0.2.31"),
    patchAction(id, "complete", { answers: { q2: "b" } }, "192.0.2.31")
  ]);
  assert.deepEqual(results.map(result => result.response.status), [200, 200]);
  assert.equal(results.filter(result => result.body.idempotent === false).length, 1);
  assert.equal(results.filter(result => result.body.idempotent === true).length, 1);
  assert.equal(results.filter(result => result.body.syncStatus === "ok").length, 1);
  const stored = (await db.collection("patients").doc(id).get()).data()!;
  assert.equal(stored.status, "completed");
  assert.equal(typeof stored.dateAnswered, "number");
  const completed = requestsFor("questionnaire_completed");
  assert.equal(completed.length, 1);
  assert.equal(completed[0].linkedQuestionnairePatientId, id);
  assert.equal(completed[0].status, "completed");
  assert.equal(completed[0].headers.bridgeSecret, "synthetic-emulator-bridge-secret");
  assert.equal(completed[0].headers.contentType, "application/json");
  assert.equal("accessPin" in completed[0].body, false);
  assert.equal("accessCode" in completed[0].body, false);
});

test("integration webhook local 500 no revierte completed", async () => {
  const id = "patient_test_soybienestar_webhook_failure";
  await seedPatient(id);
  resetWebhook(500);
  const { response, body } = await patchAction(id, "complete", { answers: { q2: "b", q3: "c" } }, "192.0.2.32");
  assert.equal(response.status, 200);
  assert.equal(body.idempotent, false);
  assert.equal(body.syncStatus, "error");
  const stored = (await db.collection("patients").doc(id).get()).data()!;
  assert.equal(stored.status, "completed");
  assert.equal(typeof stored.dateAnswered, "number");
  assert.deepEqual(stored.answers, { q1: "a", q2: "b", q3: "c" });
  assert.equal(stored.lastSoyBienestarStatusSyncEvent, "questionnaire_completed");
  assert.equal(stored.lastSoyBienestarStatusSyncStatus, "error");
  const completed = requestsFor("questionnaire_completed");
  assert.equal(completed.length, 1);
  assert.equal(completed[0].linkedQuestionnairePatientId, id);
  assert.equal(completed[0].status, "completed");
});

test("integration webhook local 500 no revierte sent a viewed", async () => {
  const id = "patient_test_soybienestar_started_failure";
  await seedPatient(id);
  resetWebhook(500);
  const { response, body } = await postUnlock(id, SYNTHETIC_ACCESS_PIN, "192.0.2.33");
  assert.equal(response.status, 200);
  assert.equal(body.syncStatus, "error");
  const stored = (await db.collection("patients").doc(id).get()).data()!;
  assert.equal(stored.status, "viewed");
  assert.equal(stored.lastSoyBienestarStatusSyncEvent, "questionnaire_started");
  assert.equal(stored.lastSoyBienestarStatusSyncStatus, "error");
  assert.equal(requestsFor("questionnaire_started").length, 1);
});

test("integration conclusion-status no escribe y limita su contrato", async () => {
  const id = "patient_test_conclusion_status";
  await seedConclusionPatient(id, { conclusionViews: 1 });
  const beforeData = (await db.collection("patients").doc(id).get()).data();
  const { response, body } = await http(`/api/patient-access/${id}/conclusion-status`);
  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true, state: "available" });
  assert.deepEqual((await db.collection("patients").doc(id).get()).data(), beforeData);
});

test("integration conclusion PIN incorrecto no modifica vista e incrementa rate limit", async () => {
  const id = "patient_test_conclusion_bad_pin";
  const ip = "192.0.2.41";
  await seedConclusionPatient(id);
  const beforeData = (await db.collection("patients").doc(id).get()).data();
  const { response } = await postConclusion(id, "direct", "xxxx", ip);
  assert.equal(response.status, 401);
  assert.deepEqual((await db.collection("patients").doc(id).get()).data(), beforeData);
  const key = createRateLimitKey(process.env.PATIENT_ACCESS_RATE_LIMIT_SECRET!, id, ip);
  assert.equal((await db.collection("patientAccessRateLimits").doc(key).get()).data()?.failedAttempts, 1);
});

test("integration conclusion PIN correcto limpia rate limit", async () => {
  const id = "patient_test_conclusion_rate_reset";
  const ip = "192.0.2.42";
  await seedConclusionPatient(id);
  const key = createRateLimitKey(process.env.PATIENT_ACCESS_RATE_LIMIT_SECRET!, id, ip);
  assert.equal((await postConclusion(id, "direct", "xxxx", ip)).response.status, 401);
  assert.equal((await postConclusion(id, "direct", SYNTHETIC_ACCESS_PIN, ip)).response.status, 200);
  assert.equal((await db.collection("patientAccessRateLimits").doc(key).get()).exists, false);
});

test("integration conclusion session preserva semántica concluded y finalized sin límite", async () => {
  const concludedId = "patient_test_conclusion_session_concluded";
  await seedConclusionPatient(concludedId, { status: "concluded", conclusionViews: 2 });
  assert.equal((await postConclusion(concludedId, "session")).response.status, 200);
  const concluded = (await db.collection("patients").doc(concludedId).get()).data()!;
  assert.equal(concluded.status, "finalized");
  assert.equal(concluded.conclusionViews, 3);
  assert.equal(typeof concluded.dateConclusionViewed, "number");

  const finalizedId = "patient_test_conclusion_session_finalized";
  await seedConclusionPatient(finalizedId, { status: "finalized", conclusionViews: 7 });
  assert.equal((await postConclusion(finalizedId, "session")).response.status, 200);
  const finalized = (await db.collection("patients").doc(finalizedId).get()).data()!;
  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.conclusionViews, 8);
});

test("integration conclusion direct permite vistas cero y uno, y bloquea la tercera", async () => {
  const id = "patient_test_conclusion_direct_sequence";
  await seedConclusionPatient(id, { conclusionViews: 0 });
  assert.equal((await postConclusion(id, "direct")).response.status, 200);
  assert.equal((await db.collection("patients").doc(id).get()).data()?.conclusionViews, 1);
  assert.equal((await postConclusion(id, "direct")).response.status, 200);
  assert.equal((await db.collection("patients").doc(id).get()).data()?.conclusionViews, 2);
  const beforeThird = (await db.collection("patients").doc(id).get()).data();
  const third = await postConclusion(id, "direct");
  assert.equal(third.response.status, 410);
  assert.deepEqual(third.body, { success: false, expired: true });
  assert.deepEqual((await db.collection("patients").doc(id).get()).data(), beforeThird);
});

test("integration conclusion direct concurrente concede una sola segunda vista", async () => {
  const id = "patient_test_conclusion_direct_concurrent";
  await seedConclusionPatient(id, { status: "finalized", conclusionViews: 1 });
  const results = await Promise.all([
    postConclusion(id, "direct", SYNTHETIC_ACCESS_PIN, "192.0.2.43"),
    postConclusion(id, "direct", SYNTHETIC_ACCESS_PIN, "192.0.2.43")
  ]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [200, 410]);
  assert.equal((await db.collection("patients").doc(id).get()).data()?.conclusionViews, 2);
});

test("integration conclusion DTO devuelve solo contenido público tras PIN", async () => {
  const id = "patient_test_conclusion_dto";
  await seedConclusionPatient(id);
  const status = await http(`/api/patient-access/${id}/conclusion-status`);
  assert.equal(JSON.stringify(status.body).includes("CONCLUSION_PUBLICA_INTEGRATION"), false);
  const { response, body } = await postConclusion(id, "direct");
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ["patient", "success"]);
  assert.deepEqual(Object.keys(body.patient).sort(), ["displayName", "finalConclusion", "id", "status"]);
  assert.equal(body.patient.finalConclusion, "CONCLUSION_PUBLICA_INTEGRATION");
  assert.equal(body.patient.displayName, "Nombre Elegido");
  const serialized = JSON.stringify(body);
  for (const forbidden of ["conversationSummary", "accessPin", "email", "telefono", "coordinatorEmail", "answers", "soybienestarContext", "preInformeSoyBienestar"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("integration conclusion audio inline solo aparece tras PIN", async () => {
  const id = "patient_test_conclusion_inline_audio";
  const audio = "data:audio/wav;base64,UklGRg==";
  await seedConclusionPatient(id, { audioConclusion: audio });
  const status = await http(`/api/patient-access/${id}/conclusion-status`);
  assert.equal(JSON.stringify(status.body).includes(audio), false);
  const unlocked = await postConclusion(id, "direct");
  assert.equal(unlocked.body.patient.audioConclusion, audio);
});

test("integration conclusion resuelve audio_ref sin modificar audios", async () => {
  const id = "patient_test_conclusion_ref_audio";
  const audioRef = "audio_ref_patient_conclusion_integration";
  const generalAudioId = "audio_ref_general_integration";
  const privateAudio = { kind: "patient_conclusion", data: "data:audio/wav;base64,UFJJVkFURQ==", usedBy: 9, stable: true };
  const generalAudio = { kind: "question", data: "data:audio/wav;base64,R0VORVJSTA==", usedBy: 3, stable: true };
  await db.collection("audios").doc(audioRef).set(privateAudio);
  await db.collection("audios").doc(generalAudioId).set(generalAudio);
  await seedConclusionPatient(id, { audioConclusion: audioRef });

  const unlocked = await postConclusion(id, "direct");
  assert.equal(unlocked.response.status, 200);
  assert.equal(unlocked.body.patient.audioConclusion, privateAudio.data);
  assert.equal(JSON.stringify(unlocked.body).includes(audioRef), false);
  assert.deepEqual((await db.collection("audios").doc(audioRef).get()).data(), privateAudio);
  assert.deepEqual((await db.collection("audios").doc(generalAudioId).get()).data(), generalAudio);
});
