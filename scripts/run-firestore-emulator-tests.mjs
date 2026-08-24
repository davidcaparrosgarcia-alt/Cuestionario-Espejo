import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const TEST_PROJECT_ID = "demo-ce-patient-harness";
const suite = process.argv[2] || "all";
const runners = {
  integration: "npm run test:integration:runner",
  security: "npm run test:security:runner",
  all: "npm run test:emulator:runner"
};

if (!(suite in runners)) {
  console.error(`Suite desconocida: ${suite}`);
  process.exit(2);
}

const firebaseCli = path.resolve("node_modules/firebase-tools/lib/bin/firebase.js");
if (!existsSync(firebaseCli)) {
  console.error("firebase-tools no esta instalado. Ejecuta npm ci antes de las pruebas.");
  process.exit(2);
}

const env = {
  ...process.env,
  TEST_FIRESTORE_MODE: "emulator",
  FIREBASE_PROJECT_ID: TEST_PROJECT_ID,
  GCLOUD_PROJECT: TEST_PROJECT_ID,
  GOOGLE_CLOUD_PROJECT: TEST_PROJECT_ID,
  FIRESTORE_DATABASE_ID: "(default)",
  PATIENT_ACCESS_RATE_LIMIT_SECRET: "synthetic-emulator-only-secret",
  SOYBIENESTAR_WEBHOOK_URL: "",
  SOYBIENESTAR_BRIDGE_SECRET: "",
  QUESTIONNAIRE_BRIDGE_SECRET: "",
  BRIDGE_SECRET: "",
  FIREBASE_CLIENT_EMAIL: "",
  FIREBASE_PRIVATE_KEY: "",
  GOOGLE_APPLICATION_CREDENTIALS: ""
};

if (!env.JAVA_HOME && process.platform === "win32") {
  const androidStudioJre = "C:\\Program Files\\Android\\Android Studio\\jbr";
  if (existsSync(path.join(androidStudioJre, "bin", "java.exe"))) {
    env.JAVA_HOME = androidStudioJre;
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") || "Path";
    env[pathKey] = `${path.join(androidStudioJre, "bin")}${path.delimiter}${env[pathKey] || ""}`;
  }
}

const result = spawnSync(process.execPath, [
  firebaseCli,
  "emulators:exec",
  "--config", "firebase.test.json",
  "--project", TEST_PROJECT_ID,
  "--only", "firestore",
  runners[suite]
], {
  cwd: process.cwd(),
  env,
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}

process.exit(result.status ?? 2);
