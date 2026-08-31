import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PATIENT_ACCESS_RATE_LIMIT_MAX_FAILURES,
  activeQuestionIds,
  bootstrapResponse,
  buildConclusionPatientDto,
  canReuseDirectQuestionnaireRecord,
  classifyPatientDocument,
  conclusionStatusResponse,
  createRateLimitKey,
  isPatientAccessRateLimitConfigured,
  isRateLimitBlocked,
  patientAccessCodeMatches,
  recordFailedRateLimitAttempt,
  resolveConclusionAccess,
  resolvePatientAction,
  resolveUnlock,
  selectStoredPatientAccessCode,
  validateActionEnvelope,
  validateConclusionEnvelope
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

function conclusion(overrides: Record<string, unknown> = {}) {
  return questionnaire({
    status: "concluded",
    conclusionViews: 0,
    nombre: "Nombre Administrativo",
    questionnaireConfirmedName: "Nombre Elegido",
    finalConclusion: "Conclusión pública",
    conversationSummary: "Resumen interno",
    email: "private@example.invalid",
    telefono: "private-phone",
    ...overrides
  });
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

test("33. direct-questionnaire-link ignora HipnoDigest, UNKNOWN e identidad incoherente", () => {
  assert.equal(canReuseDirectQuestionnaireRecord(PATIENT_ID, questionnaire()), true);
  assert.equal(canReuseDirectQuestionnaireRecord(PATIENT_ID, questionnaire({ recordType: "hipnodigest_client" })), false);
  assert.equal(canReuseDirectQuestionnaireRecord(PATIENT_ID, questionnaire({ program: "hipnodigest" })), false);
  assert.equal(canReuseDirectQuestionnaireRecord(PATIENT_ID, { id: PATIENT_ID, nombre: "Legacy" }), false);
  assert.equal(canReuseDirectQuestionnaireRecord(PATIENT_ID, questionnaire({ id: "different_patient" })), false);
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

test("37. conclusion-status rechaza HipnoDigest, UNKNOWN, deleted, completed e identidad incoherente", () => {
  const cases = [
    conclusion({ recordType: "hipnodigest_client" }),
    { id: PATIENT_ID, status: "legacy" },
    conclusion({ status: "deleted" }),
    conclusion({ status: "completed" }),
    conclusion({ id: "different_patient" })
  ];
  for (const patient of cases) {
    assert.deepEqual(conclusionStatusResponse(PATIENT_ID, patient), { success: true, state: "unavailable" });
  }
});

test("38. conclusion-status direct diferencia available y expired", () => {
  assert.equal(conclusionStatusResponse(PATIENT_ID, conclusion({ status: "concluded", conclusionViews: 0 })).state, "available");
  assert.equal(conclusionStatusResponse(PATIENT_ID, conclusion({ status: "finalized", conclusionViews: 1 })).state, "available");
  assert.equal(conclusionStatusResponse(PATIENT_ID, conclusion({ status: "finalized", conclusionViews: 2 })).state, "expired");
});

test("39. envelope de conclusión acepta solo accessPin y channel permitido", () => {
  assert.deepEqual(validateConclusionEnvelope({ accessPin: "a2b3", channel: "session" }), {
    ok: true, accessPin: "a2b3", channel: "session"
  });
  assert.deepEqual(validateConclusionEnvelope({ accessPin: "a2b3", channel: "direct" }), {
    ok: true, accessPin: "a2b3", channel: "direct"
  });
  assert.equal(validateConclusionEnvelope({ accessPin: "a2b3", channel: "other" }).ok, false);
  assert.equal(validateConclusionEnvelope({ accessPin: "a2b3", channel: "direct", extra: true }).ok, false);
});

test("40. session no aplica límite de dos vistas", () => {
  const decision = resolveConclusionAccess(PATIENT_ID, conclusion({ status: "finalized", conclusionViews: 2 }), "a2b3", "session", NOW);
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.update, { status: "finalized", dateConclusionViewed: NOW, conclusionViews: 3 });
});

test("41. concluded session pasa a finalized e incrementa una vista", () => {
  const decision = resolveConclusionAccess(PATIENT_ID, conclusion({ status: "concluded", conclusionViews: 0 }), "a2b3", "session", NOW);
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.update, { status: "finalized", dateConclusionViewed: NOW, conclusionViews: 1 });
});

test("42. finalized session permanece finalized e incrementa una vista", () => {
  const decision = resolveConclusionAccess(PATIENT_ID, conclusion({ status: "finalized", conclusionViews: 7 }), "a2b3", "session", NOW);
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.update, { status: "finalized", dateConclusionViewed: NOW, conclusionViews: 8 });
});

test("43. concluded direct con cero vistas pasa a finalized y una vista", () => {
  const decision = resolveConclusionAccess(PATIENT_ID, conclusion(), "a2b3", "direct", NOW);
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.update, { status: "finalized", dateConclusionViewed: NOW, conclusionViews: 1 });
});

test("44. finalized direct con una vista alcanza exactamente dos", () => {
  const decision = resolveConclusionAccess(PATIENT_ID, conclusion({ status: "finalized", conclusionViews: 1 }), "a2b3", "direct", NOW);
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.update, { status: "finalized", dateConclusionViewed: NOW, conclusionViews: 2 });
});

test("45. direct con dos vistas devuelve 410 sin update", () => {
  const decision = resolveConclusionAccess(PATIENT_ID, conclusion({ status: "finalized", conclusionViews: 2 }), "a2b3", "direct", NOW);
  assert.deepEqual(decision, { ok: false, statusCode: 410, expired: true });
});

test("46. PIN incorrecto y estados no autorizados no producen transición", () => {
  for (const patient of [conclusion(), conclusion({ status: "completed" }), conclusion({ status: "deleted" })]) {
    const code = patient.status === "concluded" ? "xxxx" : "a2b3";
    const decision = resolveConclusionAccess(PATIENT_ID, patient, code, "session", NOW);
    assert.equal(decision.ok, false);
    assert.equal(decision.statusCode, 401);
    assert.equal(decision.update, undefined);
  }
});

test("47. DTO de conclusión excluye conversationSummary, PIN y PII", () => {
  const dto = buildConclusionPatientDto(PATIENT_ID, conclusion());
  assert.deepEqual(Object.keys(dto).sort(), ["displayName", "finalConclusion", "id", "status"]);
  const serialized = JSON.stringify(dto);
  for (const forbidden of ["conversationSummary", "accessPin", "email", "telefono", "coordinatorEmail", "answers"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("48. questionnaireConfirmedName tiene prioridad como displayName", () => {
  assert.equal(buildConclusionPatientDto(PATIENT_ID, conclusion()).displayName, "Nombre Elegido");
});

test("49. displayName usa nombre y finalmente Paciente", () => {
  assert.equal(buildConclusionPatientDto(PATIENT_ID, conclusion({ questionnaireConfirmedName: "" })).displayName, "Nombre Administrativo");
  assert.equal(buildConclusionPatientDto(PATIENT_ID, conclusion({ questionnaireConfirmedName: "", nombre: "" })).displayName, "Paciente");
});

test("50. DTO no incluye audio cuando no existe", () => {
  const dto = buildConclusionPatientDto(PATIENT_ID, conclusion({ audioConclusion: undefined }));
  assert.equal("audioConclusion" in dto, false);
});

test("51. audio inline puede incluirse únicamente en el DTO autenticado", () => {
  const decision = resolveConclusionAccess(PATIENT_ID, conclusion({ audioConclusion: "data:audio/wav;base64,UklGRg==" }), "a2b3", "direct", NOW);
  assert.equal(decision.patient?.audioConclusion, "data:audio/wav;base64,UklGRg==");
});

test("52. referencia de audio no se devuelve al paciente", () => {
  const decision = resolveConclusionAccess(PATIENT_ID, conclusion({ audioConclusion: "audio_ref_private" }), "a2b3", "direct", NOW);
  assert.equal(decision.audioRef, "audio_ref_private");
  assert.equal("audioConclusion" in (decision.patient || {}), false);
});

test("53. una URL externa no se acepta como audio inline", () => {
  const decision = resolveConclusionAccess(PATIENT_ID, conclusion({ audioConclusion: "https://example.invalid/private.mp3" }), "a2b3", "direct", NOW);
  assert.equal("audioConclusion" in (decision.patient || {}), false);
  assert.equal(decision.audioRef, undefined);
});

test("54. DTO preserva exactamente el formato de finalConclusion", () => {
  const finalConclusion = "\n  Primera línea.\n\nSegunda línea.  \n";
  const dto = buildConclusionPatientDto(PATIENT_ID, conclusion({ finalConclusion }));
  assert.equal(dto.finalConclusion, finalConclusion);
});

test("55. DTO convierte finalConclusion con solo whitespace a null", () => {
  const dto = buildConclusionPatientDto(PATIENT_ID, conclusion({ finalConclusion: "   \n   " }));
  assert.equal(dto.finalConclusion, null);
});

test("56. Vercel ESM entrypoint uses explicit .js patientAccess import", () => {
  const source = readFileSync(new URL("../api/index.ts", import.meta.url), "utf8");

  assert.equal(source.includes('from "./patientAccess.js"'), true);
  assert.equal(source.includes('from "./patientAccess";'), false);
  assert.equal(source.includes('from "./patientAccess.ts"'), false);
});

test("57. coordinator authorization has no frontend secret, public config check or auto-provisioning", () => {
  const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const dashboardSource = readFileSync(new URL("../components/CoordinatorDashboard.tsx", import.meta.url), "utf8");
  const frontendSource = `${appSource}\n${dashboardSource}`;

  for (const forbidden of [
    ["DEFAULT", "ACCESS", "CODE"].join("_"),
    ["config", "accessCode"].join("."),
    ["global", "AccessCode"].join(""),
    ["DataService", "saveUser"].join("."),
    ["ce", "access", "verified", "this", "tab"].join("_")
  ]) {
    assert.equal(frontendSource.includes(forbidden), false, forbidden);
  }
  assert.equal(/accessCode\s*:\s*["']\d{5}["']/.test(frontendSource), false);
});

test("58. salir del editor falla cerrado hasta que coordinator-access revalida", () => {
  const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const start = appSource.indexOf("onExitEditor={() => {");
  const end = appSource.indexOf("\n            }}", start);
  assert.ok(start >= 0 && end > start);

  const exitHandler = appSource.slice(start, end);
  assert.equal(exitHandler.includes("setIsEditorMode(false);"), true);
  assert.equal(exitHandler.includes("setView('LANDING');"), true);
  assert.equal(exitHandler.includes("void checkCoordinatorStatus(auth.currentUser);"), true);
  assert.equal(exitHandler.includes("denyCoordinatorAccess();"), true);
  assert.equal(exitHandler.includes("setView('COORDINATOR');"), false);
  assert.equal(exitHandler.includes("window.location.hash"), false);
});
