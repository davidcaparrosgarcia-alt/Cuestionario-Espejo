export const SYNTHETIC_ACCESS_PIN = "a2b3";

const basePatient = {
  coordinatorEmail: "coordinator@tests.invalid",
  nombre: "Paciente Sintetico",
  sexo: "",
  email: "patient@tests.invalid",
  telefono: "synthetic-phone-not-dialable",
  accessPin: SYNTHETIC_ACCESS_PIN,
  answers: {}
};

function patient(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return { ...basePatient, id, status, ...overrides };
}

export const patientFixtures: Record<string, Record<string, unknown>> = {
  patient_test_pending: patient("patient_test_pending", "pending"),
  patient_test_sent: patient("patient_test_sent", "sent"),
  patient_test_viewed: patient("patient_test_viewed", "viewed", { answers: { q1: "a" } }),
  patient_test_completed: patient("patient_test_completed", "completed", { answers: { q1: "a", q2: "b" } }),
  patient_test_concluded: patient("patient_test_concluded", "concluded"),
  patient_test_finalized: patient("patient_test_finalized", "finalized"),
  patient_test_deleted: patient("patient_test_deleted", "deleted"),
  patient_test_hipnodigest_recordtype: patient("patient_test_hipnodigest_recordtype", "sent", {
    recordType: "hipnodigest_client"
  }),
  patient_test_hipnodigest_program: patient("patient_test_hipnodigest_program", "sent", {
    program: "hipnodigest"
  }),
  patient_test_unknown: patient("patient_test_unknown", "legacy_unknown"),
  patient_test_identity_mismatch: patient("different_synthetic_identity", "sent"),
  patient_test_rate_limit: patient("patient_test_rate_limit", "sent"),
  patient_test_rate_limit_reset: patient("patient_test_rate_limit_reset", "sent"),
  patient_test_action: patient("patient_test_action", "viewed", { answers: { q1: "a" }, stableField: "preserve" }),
  patient_test_complete: patient("patient_test_complete", "viewed", { answers: { q1: "a" } }),
  patient_test_concurrent_unlock: patient("patient_test_concurrent_unlock", "sent"),
  patient_test_concurrent_complete: patient("patient_test_concurrent_complete", "viewed", { answers: { q1: "a" } })
};

export const activeQuestionnaireFixture = {
  id: "active",
  questions: [
    { id: "q1", scenario: "Pregunta sintetica uno", options: [{ key: "a", text: "A" }] },
    { id: "q2", scenario: "Pregunta sintetica dos", options: [{ key: "b", text: "B" }] },
    { id: "q3", scenario: "Pregunta sintetica tres", options: [{ key: "c", text: "C" }] },
    { id: "q_hidden", scenario: "Pregunta sintetica oculta", hidden: true, options: [{ key: "x", text: "X" }] }
  ]
};

export function clonePatientFixture(id: string): Record<string, unknown> {
  const fixture = patientFixtures[id];
  if (!fixture) throw new Error(`Fixture desconocido: ${id}`);
  return structuredClone(fixture);
}
