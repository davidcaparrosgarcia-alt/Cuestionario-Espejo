import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const TEST_PROJECT_ID = 'demo-ce-patient-harness';
const LOCAL_HOST = '127.0.0.1';
const firebaseCli = path.resolve('node_modules/firebase-tools/lib/bin/firebase.js');

if (!existsSync(firebaseCli)) {
  console.error('E2E SAFETY ABORT: firebase-tools no esta instalado.');
  process.exit(2);
}

const env = {
  ...process.env,
  TEST_FIRESTORE_MODE: 'emulator',
  FIREBASE_PROJECT_ID: TEST_PROJECT_ID,
  GCLOUD_PROJECT: TEST_PROJECT_ID,
  GOOGLE_CLOUD_PROJECT: TEST_PROJECT_ID,
  FIRESTORE_DATABASE_ID: '(default)',
  NODE_ENV: 'test',
  VITE_E2E_FIREBASE_EMULATOR: 'true',
  VITE_E2E_FIRESTORE_HOST: LOCAL_HOST,
  VITE_E2E_FIRESTORE_PORT: '8089',
  VITE_E2E_AUTH_HOST: LOCAL_HOST,
  VITE_E2E_AUTH_PORT: '9099',
  DISABLE_HMR: 'true',
  PATIENT_ACCESS_RATE_LIMIT_SECRET: 'synthetic-emulator-only-secret',
  SMTP_HOST: LOCAL_HOST,
  SMTP_PORT: '1',
  SMTP_USER: '',
  SMTP_PASS: '',
  SMTP_FROM: '',
  NOTIFICATION_EMAILS: '',
  GEMINI_API_KEY: '',
  GEMINI_MODEL: '',
  GOOGLE_API_KEY: '',
  VITE_GEMINI_API_KEY: '',
  SOYBIENESTAR_WEBHOOK_URL: '',
  SOYBIENESTAR_BRIDGE_SECRET: '',
  QUESTIONNAIRE_BRIDGE_SECRET: '',
  BRIDGE_SECRET: '',
  APP_PUBLIC_URL: 'http://127.0.0.1:3000',
  DEFAULT_COORDINATOR_EMAIL: 'coordinator@tests.invalid',
  FIREBASE_CLIENT_EMAIL: '',
  FIREBASE_PRIVATE_KEY: '',
  GOOGLE_APPLICATION_CREDENTIALS: ''
};

const safetyValues = [
  env.FIREBASE_PROJECT_ID === TEST_PROJECT_ID,
  env.GCLOUD_PROJECT === TEST_PROJECT_ID,
  env.VITE_E2E_FIREBASE_EMULATOR === 'true',
  env.VITE_E2E_FIRESTORE_HOST === LOCAL_HOST,
  env.VITE_E2E_AUTH_HOST === LOCAL_HOST,
  /^\d+$/.test(env.VITE_E2E_FIRESTORE_PORT),
  /^\d+$/.test(env.VITE_E2E_AUTH_PORT)
];

if (safetyValues.some(value => !value)) {
  console.error('E2E SAFETY ABORT: el runner no esta completamente aislado en el proyecto demo local.');
  process.exit(2);
}

if (!env.JAVA_HOME && process.platform === 'win32') {
  const androidStudioJre = 'C:\\Program Files\\Android\\Android Studio\\jbr';
  if (existsSync(path.join(androidStudioJre, 'bin', 'java.exe'))) {
    env.JAVA_HOME = androidStudioJre;
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'Path';
    env[pathKey] = `${path.join(androidStudioJre, 'bin')}${path.delimiter}${env[pathKey] || ''}`;
  }
}

const result = spawnSync(process.execPath, [
  firebaseCli,
  'emulators:exec',
  '--config', 'firebase.test.json',
  '--project', TEST_PROJECT_ID,
  '--only', 'firestore,auth',
  'npm run test:e2e:runner'
], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}

process.exit(result.status ?? 2);
