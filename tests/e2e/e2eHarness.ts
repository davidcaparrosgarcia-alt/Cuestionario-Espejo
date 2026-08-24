import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export const E2E_PROJECT_ID = 'demo-ce-patient-harness';
export const E2E_PIN = 'a2b3';
export const PATIENT_SENT = 'patient_e2e_sent';
export const PATIENT_VIEWED = 'patient_e2e_viewed';
export const PATIENT_COMPLETED = 'patient_e2e_completed';
export const PATIENT_CONCLUDED = 'patient_e2e_concluded';
export const PATIENT_FINALIZED = 'patient_e2e_finalized';
export const PATIENT_CONCLUSION_AUDIO_REF = 'audio_ref_patient_conclusion_e2e';
export const PATIENT_CONCLUSION_PUBLIC_TEXT = 'CONCLUSION_PUBLICA_E2E';
export const PATIENT_CONCLUSION_INTERNAL_TEXT = 'INTERNAL_SUMMARY_MUST_NEVER_REACH_BROWSER';
export const PATIENT_CONCLUSION_AUDIO_DATA = 'data:audio/wav;base64,UklGRg==';

const assertHarnessEnvironment = () => {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const projectIds = [process.env.FIREBASE_PROJECT_ID, process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT];

  if (
    process.env.VITE_E2E_FIREBASE_EMULATOR !== 'true' ||
    firestoreHost !== '127.0.0.1:8089' ||
    authHost !== '127.0.0.1:9099' ||
    projectIds.some(projectId => projectId !== E2E_PROJECT_ID)
  ) {
    throw new Error('E2E SAFETY ABORT: Playwright fixtures are not connected to the expected local emulators.');
  }
};

assertHarnessEnvironment();

const existingApp = getApps().find(app => app.name === 'ce-browser-e2e-seeder');
const adminApp = existingApp || initializeApp({ projectId: E2E_PROJECT_ID }, 'ce-browser-e2e-seeder');
const db = getFirestore(adminApp);

const questions = [
  {
    id: 'q1', scenario: 'Situación sintética uno', postOptionsText: '',
    options: [{ key: 'a', text: 'Respuesta uno A' }, { key: 'b', text: 'Respuesta uno B' }]
  },
  {
    id: 'q2', scenario: 'Situación sintética dos',
    options: [{ key: 'a', text: 'Respuesta dos A' }, { key: 'b', text: 'Respuesta dos B' }]
  },
  {
    id: 'q3', scenario: 'Situación sintética tres',
    options: [{ key: 'a', text: 'Respuesta tres A' }, { key: 'b', text: 'Respuesta tres B' }]
  }
];

const globalConfig = {
  welcomeText: '', welcomeAudio: {},
  nameQuestionText: 'Confirma tu nombre', nameQuestionAudio: {},
  startText: '', startAudio: {},
  finishText: 'Revisa y envía tus respuestas sintéticas.', finishAudio: {},
  afterSendText: '', afterSendAudio: {},
  defaultVoiceMode: 'none', defaultTheme: 'light', backgrounds: []
};

const patient = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre: 'Paciente E2E',
  edad: '40',
  sexo: 'prefiero_no_definirme',
  observaciones: 'Fixture sintetico sin datos clinicos.',
  telefono: '+34900000000',
  email: `${id}@tests.invalid`,
  coordinatorEmail: 'coordinator@tests.invalid',
  accessPin: E2E_PIN,
  status,
  answers: {},
  source: 'e2e-local-only',
  ...extra
});

export async function seedE2EFixtures() {
  const batch = db.batch();
  batch.set(db.collection('questionnaires').doc('active'), { questions });
  batch.set(db.collection('config').doc('global_config'), globalConfig);
  batch.set(db.collection('patients').doc(PATIENT_SENT), patient(PATIENT_SENT, 'sent'));
  batch.set(db.collection('patients').doc(PATIENT_VIEWED), patient(PATIENT_VIEWED, 'viewed', {
    answers: { q1: 'a' }, lastAnsweredQuestionId: 'q1', lastAnsweredQuestionIndex: 0
  }));
  batch.set(db.collection('patients').doc(PATIENT_COMPLETED), patient(PATIENT_COMPLETED, 'completed', {
    answers: { q1: 'a', q2: 'b', q3: 'a' }, dateAnswered: 1_700_000_000_000
  }));
  batch.set(db.collection('patients').doc(PATIENT_CONCLUDED), patient(PATIENT_CONCLUDED, 'concluded', {
    conclusionViews: 0,
    nombre: 'Alias Inicial',
    questionnaireConfirmedName: 'Nombre Elegido',
    finalConclusion: PATIENT_CONCLUSION_PUBLIC_TEXT,
    conversationSummary: PATIENT_CONCLUSION_INTERNAL_TEXT,
    audioConclusion: PATIENT_CONCLUSION_AUDIO_REF
  }));
  batch.set(db.collection('patients').doc(PATIENT_FINALIZED), patient(PATIENT_FINALIZED, 'finalized', {
    conclusionViews: 1,
    nombre: 'Alias Inicial',
    questionnaireConfirmedName: 'Nombre Elegido',
    finalConclusion: PATIENT_CONCLUSION_PUBLIC_TEXT,
    conversationSummary: PATIENT_CONCLUSION_INTERNAL_TEXT
  }));
  batch.set(db.collection('audios').doc(PATIENT_CONCLUSION_AUDIO_REF), {
    kind: 'patient_conclusion',
    data: PATIENT_CONCLUSION_AUDIO_DATA,
    usedBy: 0,
    stable: 'must-remain-unchanged'
  });
  await batch.commit();
}

export async function getPatientFixture(id: string) {
  const snapshot = await db.collection('patients').doc(id).get();
  return snapshot.data() as Record<string, unknown>;
}

export async function getAudioFixture(id: string) {
  const snapshot = await db.collection('audios').doc(id).get();
  return snapshot.data() as Record<string, unknown>;
}

export function patientSessionUrl(id: string) {
  const token = Buffer.from(JSON.stringify({ id, nombre: 'Paciente E2E', status: 'sent' }), 'utf8').toString('base64');
  return `/#/session?p=${encodeURIComponent(token)}`;
}

export function patientConclusionUrl(id: string) {
  return `/#/conclusion?id=${encodeURIComponent(id)}`;
}
