export const TEST_FIREBASE_PROJECT_ID = "demo-ce-patient-harness";

export function assertFirestoreEmulatorSafety(): { host: string; port: number } {
  if (process.env.TEST_FIRESTORE_MODE !== "emulator") {
    throw new Error("SAFETY ABORT: TEST_FIRESTORE_MODE debe ser emulator.");
  }

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
  const match = /^(localhost|127\.0\.0\.1):(\d+)$/.exec(emulatorHost);
  if (!match) {
    throw new Error("SAFETY ABORT: FIRESTORE_EMULATOR_HOST debe apuntar a localhost o 127.0.0.1.");
  }

  for (const name of ["FIREBASE_PROJECT_ID", "GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"]) {
    if (process.env[name] !== TEST_FIREBASE_PROJECT_ID) {
      throw new Error(`SAFETY ABORT: ${name} no coincide con el proyecto demo aislado.`);
    }
  }

  if (process.env.FIRESTORE_DATABASE_ID !== "(default)") {
    throw new Error("SAFETY ABORT: la suite solo admite la base (default) del Emulator.");
  }

  for (const name of [
    "SOYBIENESTAR_WEBHOOK_URL",
    "SOYBIENESTAR_BRIDGE_SECRET",
    "QUESTIONNAIRE_BRIDGE_SECRET",
    "BRIDGE_SECRET",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS"
  ]) {
    if (process.env[name]) {
      throw new Error(`SAFETY ABORT: ${name} debe estar vacia durante las pruebas.`);
    }
  }

  if (!process.env.PATIENT_ACCESS_RATE_LIMIT_SECRET?.startsWith("synthetic-emulator-")) {
    throw new Error("SAFETY ABORT: falta el secreto sintetico de rate limit.");
  }

  return { host: match[1], port: Number(match[2]) };
}
