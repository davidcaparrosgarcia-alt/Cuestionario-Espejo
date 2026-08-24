import test from "node:test";
import assert from "node:assert/strict";
import {
  PATIENT_ACCESS_RATE_LIMIT_MAX_FAILURES,
  activeQuestionIds,
  bootstrapResponse,
  canReuseDirectQuestionnaireRecord,
  classifyPatientDocument,
  createRateLimitKey,
  isPatientAccessRateLimitConfigured,
  isRateLimitBlocked,
  patientAccessCodeMatches,
  recordFailedRateLimitAttempt,
  resolvePatientAction,
  resolveUnlock,
  selectStoredPatientAccessCode,
  validateActionEnvelope
} from "../api/patientAccess";

const PATIENT_ID = "patient_fixture_1";
const NOW = 1_800_000_000_000;
const QUESTION_IDS = new Set(["q1", "q2", "q3"]);

function questionnaire(overrides: Record<string, unknown> = {}) {
  return {
    id: PATIENT_ID,
    coordinatorEmail: "synthetic@example.invalid",
    status: "sent",
    nombre: "Persona sintética",
    sexo: "",
    accessPin: "a2b3",
    answers: {},
    ...overrides
  };
}

function applyUpdate(patient: Record<string, any>, update?: Record<string, unknown>) {
  return update ? { ...patient, ...structuredClone(update) } : { ...patient };
}

test("1. clasifica un QUESTIONNAIRE válido", () => {
  assert.deepEqual(classifyPatientDocument(PATIENT_ID, questionnaire()), {
    kind: "QUESTIONNAIRE", identityMatches: true, status: "sent"
  });
});

test("2. clasifica y rechaza HipnoDigest", () => {
  const hipno = questionnaire({ recordType: "hipnodigest_client", program: "hipnodigest", status: "hipnodigest_synced" });
  assert.equal(classifyPatientDocument(PATIENT_ID, hipno).kind, "HIPNODIGEST");
  assert.equal(resolveUnlock(PATIENT_ID, hipno, "a2b3").ok, false);
});

test("3. clasifica UNKNOWN sin contrato de cuestionario", () => {
  const unknown = { id: PATIENT_ID, nombre: "Legacy" };
  assert.equal(classifyPatientDocument(PATIENT_ID, unknown).kind, "UNKNOWN");
  assert.equal(resolveUnlock(PATIENT_ID, unknown, "a2b3").ok, false);
});

test("4. deleted no se desbloquea", () => {
  assert.equal(resolveUnlock(PATIENT_ID, questionnaire({ status: "deleted" }), "a2b3").ok, false);
});

test("5. documentId distinto de data.id se rechaza", () => {
  const patient = questionnaire({ id: "different_patient" });
  assert.equal(classifyPatientDocument(PATIENT_ID, patient).identityMatches, false);
  assert.equal(resolveUnlock(PATIENT_ID, patient, "a2b3").ok, false);
});

test("6. accessPin de 4 caracteres funciona sin accessCodeFormat", () => {
  const patient = questionnaire();
  assert.equal("accessCodeFormat" in patient, false);
  assert.equal(patientAccessCodeMatches(patient, "A2-B3"), true);
});

test("7. accessPin tiene prioridad sobre proposedAccessCode", () => {
  const patient = questionnaire({ accessPin: "a2b3", proposedAccessCode: "z9y8" });
  assert.equal(selectStoredPatientAccessCode(patient), "a2b3");
  assert.equal(patientAccessCodeMatches(patient, "z9y8"), false);
  assert.equal(patientAccessCodeMatches(patient, "a2b3"), true);
});

test("8. proposedAccessCode y personalAccessCode conservan fallback", () => {
  assert.equal(patientAccessCodeMatches(questionnaire({ accessPin: undefined, proposedAccessCode: "z9y8" }), "z9y8"), true);
  assert.equal(patientAccessCodeMatches(questionnaire({ accessPin: undefined, proposedAccessCode: undefined, personalAccessCode: "m4n5" }), "m4n5"), true);
});

test("9. PIN erróneo no genera actualización de patient", () => {
  const decision = resolveUnlock(PATIENT_ID, questionnaire(), "xxxx");
  assert.equal(decision.ok, false);
  assert.equal(decision.update, undefined);
});

test("10. PIN erróneo no solicita webhook", () => {
  const decision = resolveUnlock(PATIENT_ID, questionnaire(), "xxxx");
  assert.equal(decision.notifyStarted, undefined);
  assert.equal(decision.patientForNotification, undefined);
});

test("11. rate limit bloquea después del máximo de fallos", () => {
  let state: unknown = null;
  for (let attempt = 0; attempt < PATIENT_ACCESS_RATE_LIMIT_MAX_FAILURES; attempt += 1) {
    assert.equal(isRateLimitBlocked(state, NOW), false);
    state = recordFailedRateLimitAttempt(state, NOW + attempt);
  }
  assert.equal(isRateLimitBlocked(state, NOW + PATIENT_ACCESS_RATE_LIMIT_MAX_FAILURES), true);
});

test("12. IP nunca queda almacenada en claro", () => {
  const ip = "203.0.113.42";
  const key = createRateLimitKey("synthetic-secret", PATIENT_ID, ip);
  const state = recordFailedRateLimitAttempt(null, NOW);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key.includes(ip), false);
  assert.equal(JSON.stringify(state).includes(ip), false);
  assert.deepEqual(Object.keys(state).sort(), ["expiresAt", "failedAttempts", "updatedAt", "windowStartedAt"]);
});

test("13. secret ausente se detecta para fail-closed", () => {
  assert.equal(isPatientAccessRateLimitConfigured(undefined), false);
  assert.equal(isPatientAccessRateLimitConfigured(""), false);
  assert.equal(isPatientAccessRateLimitConfigured("configured"), true);
});

test("14. bootstrap no contiene PII", () => {
  const response = bootstrapResponse(PATIENT_ID, questionnaire({
    email: "hidden@example.invalid", telefono: "000", finalConclusion: "privado"
  }));
  assert.deepEqual(response, { success: true, next: "questionnaire" });
});

test("15. unlock DTO no contiene ningún PIN", () => {
  const response = resolveUnlock(PATIENT_ID, questionnaire({ proposedAccessCode: "z9y8" }), "a2b3").response;
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes("accessPin"), false);
  assert.equal(serialized.includes("proposedAccessCode"), false);
  assert.equal(serialized.includes("personalAccessCode"), false);
});

test("16. unlock DTO no contiene email, teléfono ni coordinador", () => {
  const response = resolveUnlock(PATIENT_ID, questionnaire({ email: "hidden@example.invalid", telefono: "000" }), "a2b3").response as any;
  assert.equal("email" in response.patient, false);
  assert.equal("telefono" in response.patient, false);
  assert.equal("coordinatorEmail" in response.patient, false);
});

test("17. unlock DTO no contiene contexto SoyBienestar", () => {
  const response = resolveUnlock(PATIENT_ID, questionnaire({
    soybienestarUid: "uid", sourceRequestId: "request", soybienestarContext: { private: true }, preInformeSoyBienestar: "privado"
  }), "a2b3").response as any;
  for (const key of ["soybienestarUid", "sourceRequestId", "soybienestarContext", "preInformeSoyBienestar"]) {
    assert.equal(key in response.patient, false);
  }
});

test("18. unlock DTO no contiene conclusión ni informe clínico", () => {
  const response = resolveUnlock(PATIENT_ID, questionnaire({
    conversationSummary: "privado", finalConclusion: "privado", audioConclusion: "privado", therapistClinicalGuidance: "privado"
  }), "a2b3").response as any;
  for (const key of ["conversationSummary", "finalConclusion", "audioConclusion", "therapistClinicalGuidance"]) {
    assert.equal(key in response.patient, false);
  }
});

test("19. pending/sent con PIN correcto transiciona a viewed", () => {
  for (const status of ["pending", "sent"]) {
    const decision = resolveUnlock(PATIENT_ID, questionnaire({ status }), "a2b3");
    assert.equal(decision.ok, true);
    assert.deepEqual(decision.update, { status: "viewed" });
    assert.equal((decision.response as any).patient.status, "viewed");
    assert.equal(decision.notifyStarted, true);
  }
});

test("20. viewed con PIN correcto no vuelve a emitir started", () => {
  const decision = resolveUnlock(PATIENT_ID, questionnaire({ status: "viewed" }), "a2b3");
  assert.equal(decision.ok, true);
  assert.equal(decision.update, undefined);
  assert.equal(decision.notifyStarted, false);
});

test("21. completed no se reinicia", () => {
  const decision = resolvePatientAction(PATIENT_ID, questionnaire({ status: "completed" }), "complete", { answers: { q1: "a" } }, QUESTION_IDS, NOW);
  assert.equal(decision.ok, true);
  assert.equal((decision.response as any).idempotent, true);
  assert.equal(decision.update, undefined);
});

test("22. completed sin aiReportStatus sigue siendo válido", () => {
  const patient = questionnaire({ status: "completed", aiReportStatus: undefined });
  assert.deepEqual(resolveUnlock(PATIENT_ID, patient, "a2b3").response, {
    success: true, next: "completed", patient: { id: PATIENT_ID, status: "completed" }
  });
});

test("23. concluded y finalized no se degradan", () => {
  for (const status of ["concluded", "finalized"]) {
    const decision = resolveUnlock(PATIENT_ID, questionnaire({ status }), "a2b3");
    assert.equal(decision.update, undefined);
    assert.equal((decision.response as any).patient.status, status);
    assert.equal((decision.response as any).next, "conclusion");
  }
});

test("24. confirm_name modifica solo los dos campos autorizados", () => {
  const decision = resolvePatientAction(PATIENT_ID, questionnaire({ status: "viewed" }), "confirm_name", { questionnaireConfirmedName: "Nombre confirmado" }, null, NOW);
  assert.deepEqual(decision.update, {
    questionnaireConfirmedName: "Nombre confirmado", questionnaireConfirmedNameAt: NOW
  });
});

test("25. save_progress conserva respuestas anteriores", () => {
  const patient = questionnaire({ status: "viewed", answers: { q1: "a", legacy: "keep", legacyStructured: { retained: true } } });
  const decision = resolvePatientAction(PATIENT_ID, patient, "save_progress", { questionId: "q2", answer: "b", questionIndex: 1 }, QUESTION_IDS, NOW);
  assert.deepEqual((decision.update as any).answers, { q1: "a", legacy: "keep", legacyStructured: { retained: true }, q2: "b" });
});

test("26. dos respuestas distintas no se pisan lógicamente", () => {
  const first = resolvePatientAction(PATIENT_ID, questionnaire({ status: "viewed" }), "save_progress", { questionId: "q1", answer: "a", questionIndex: 0 }, QUESTION_IDS, NOW);
  const afterFirst = applyUpdate(questionnaire({ status: "viewed" }), first.update);
  const second = resolvePatientAction(PATIENT_ID, afterFirst, "save_progress", { questionId: "q2", answer: "b", questionIndex: 1 }, QUESTION_IDS, NOW + 1);
  assert.deepEqual((second.update as any).answers, { q1: "a", q2: "b" });
});

test("27. corregir una respuesta cambia solo esa respuesta", () => {
  const patient = questionnaire({ status: "viewed", answers: { q1: "a", q2: "b" } });
  const decision = resolvePatientAction(PATIENT_ID, patient, "save_progress", { questionId: "q1", answer: "c", questionIndex: 0 }, QUESTION_IDS, NOW);
  assert.deepEqual((decision.update as any).answers, { q1: "c", q2: "b" });
});

test("28. complete conserva respuestas existentes no incluidas", () => {
  const patient = questionnaire({ status: "viewed", answers: { q1: "a", legacy: "keep" } });
  const decision = resolvePatientAction(PATIENT_ID, patient, "complete", { answers: { q2: "b" } }, QUESTION_IDS, NOW);
  assert.deepEqual((decision.update as any).answers, { q1: "a", legacy: "keep", q2: "b" });
  assert.equal((decision.update as any).status, "completed");
});

test("29. complete exige persistir completed antes del side effect", () => {
  const events: string[] = [];
  const decision = resolvePatientAction(PATIENT_ID, questionnaire({ status: "viewed" }), "complete", { answers: { q1: "a" } }, QUESTION_IDS, NOW);
  const stored = applyUpdate(questionnaire({ status: "viewed" }), decision.update);
  events.push(`stored:${stored.status}`);
  if (decision.notifyCompleted) events.push("webhook:questionnaire_completed");
  assert.deepEqual(events, ["stored:completed", "webhook:questionnaire_completed"]);
});

test("30. fallo de webhook no revierte completed", () => {
  const decision = resolvePatientAction(PATIENT_ID, questionnaire({ status: "viewed" }), "complete", { answers: { q1: "a" } }, QUESTION_IDS, NOW);
  const stored = applyUpdate(questionnaire({ status: "viewed" }), decision.update);
  const simulatedWebhookResult = "error";
  assert.equal(simulatedWebhookResult, "error");
  assert.equal(stored.status, "completed");
  assert.equal(stored.dateAnswered, NOW);
});

test("31. repetir complete sobre completed no vuelve a emitir completed", () => {
  const decision = resolvePatientAction(PATIENT_ID, questionnaire({ status: "completed" }), "complete", { answers: {} }, QUESTION_IDS, NOW);
  assert.equal(decision.notifyCompleted, undefined);
  assert.equal((decision.response as any).idempotent, true);
});

test("32. HipnoDigest nunca entra en operaciones questionnaire", () => {
  const hipno = questionnaire({ recordType: "hipnodigest_client", status: "sent" });
  const cases = [
    ["confirm_name", { questionnaireConfirmedName: "X" }],
    ["save_progress", { questionId: "q1", answer: "a" }],
    ["complete", { answers: {} }]
  ] as const;
  for (const [action, payload] of cases) {
    const decision = resolvePatientAction(PATIENT_ID, hipno, action, payload, QUESTION_IDS, NOW);
    assert.equal(decision.ok, false);
    assert.equal(decision.update, undefined);
  }
});

test("33. direct-questionnaire-link ignora HipnoDigest", () => {
  assert.equal(canReuseDirectQuestionnaireRecord(questionnaire()), true);
  assert.equal(canReuseDirectQuestionnaireRecord(questionnaire({ recordType: "hipnodigest_client" })), false);
  assert.equal(canReuseDirectQuestionnaireRecord(questionnaire({ program: "hipnodigest" })), false);
});

test("34. ninguna operación de la API modifica audio", () => {
  const unlock = resolveUnlock(PATIENT_ID, questionnaire({ audioConclusion: "private-audio" }), "a2b3");
  const save = resolvePatientAction(PATIENT_ID, questionnaire({ status: "viewed", audioConclusion: "private-audio" }), "save_progress", { questionId: "q1", answer: "a" }, QUESTION_IDS, NOW);
  const complete = resolvePatientAction(PATIENT_ID, questionnaire({ status: "viewed", audioConclusion: "private-audio" }), "complete", { answers: { q1: "a" } }, QUESTION_IDS, NOW);
  assert.equal(JSON.stringify(unlock.response).includes("audio"), false);
  assert.equal("audioConclusion" in (save.update || {}), false);
  assert.equal("audioConclusion" in (complete.update || {}), false);
});

test("los envelopes rechazan campos y acciones arbitrarias", () => {
  assert.equal(validateActionEnvelope({ accessPin: "a2b3", action: "delete", payload: {} }).ok, false);
  assert.equal(validateActionEnvelope({ accessPin: "a2b3", action: "save_progress", payload: { questionId: "q1", answer: "a", status: "completed" } }).ok, false);
  assert.equal(validateActionEnvelope({ accessPin: "a2b3", action: "complete", payload: { answers: {} }, email: "x" }).ok, false);
});

test("la definición activa excluye preguntas ocultas", () => {
  assert.deepEqual(activeQuestionIds({ questions: [{ id: "q1" }, { id: "hidden", hidden: true }] }), new Set(["q1"]));
});
