export const TEST_FIREBASE_PROJECT_ID = "demo-ce-patient-harness";

export function assertSafeLocalWebhookTarget(webhookUrl: string, bridgeSecret: string): void {
  if (!webhookUrl) {
    if (bridgeSecret) {
      throw new Error("SAFETY ABORT: no se admite secreto de webhook sin URL local.");
    }
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error("SAFETY ABORT: SOYBIENESTAR_WEBHOOK_URL no es una URL valida.");
  }

  if (
    parsed.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    !parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("SAFETY ABORT: el webhook de test debe ser HTTP local con puerto explicito.");
  }

  if (!bridgeSecret.startsWith("synthetic-emulator-")) {
    throw new Error("SAFETY ABORT: el secreto del webhook local debe ser sintetico.");
  }
}

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

  assertSafeLocalWebhookTarget(
    process.env.SOYBIENESTAR_WEBHOOK_URL || "",
    process.env.SOYBIENESTAR_BRIDGE_SECRET || ""
  );

  for (const name of [
    "QUESTIONNAIRE_BRIDGE_SECRET",
    "BRIDGE_SECRET",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "NOTIFICATION_EMAILS",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "GOOGLE_API_KEY",
    "VITE_GEMINI_API_KEY"
  ]) {
    if (process.env[name]) {
      throw new Error(`SAFETY ABORT: ${name} debe estar vacia durante las pruebas.`);
    }
  }

  if (!process.env.PATIENT_ACCESS_RATE_LIMIT_SECRET?.startsWith("synthetic-emulator-")) {
    throw new Error("SAFETY ABORT: falta el secreto sintetico de rate limit.");
  }

  if (process.env.SMTP_HOST !== "127.0.0.1" || process.env.SMTP_PORT !== "1") {
    throw new Error("SAFETY ABORT: SMTP debe quedar neutralizado en 127.0.0.1:1.");
  }

  return { host: match[1], port: Number(match[2]) };
}
