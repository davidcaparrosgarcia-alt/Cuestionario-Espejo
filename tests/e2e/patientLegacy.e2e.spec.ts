import { expect, test, type Page } from '@playwright/test';
import {
  E2E_PROJECT_ID,
  E2E_PIN,
  PATIENT_COMPLETED,
  PATIENT_SENT,
  getPatientFixture,
  patientSessionUrl,
  seedE2EFixtures
} from './e2eHarness';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const REDIRECT_TARGET = 'https://soybienestar.es/herramientas';
const SIDE_EFFECT_ENDPOINTS = new Set([
  '/api/notify-soybienestar-status',
  '/api/generate-patient-report',
  '/api/notify-questionnaire-completed'
]);

type BrowserEvidence = {
  hosts: Set<string>;
  externalViolations: string[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  redirectIntent: string[];
  mockedEndpoints: string[];
};

async function installBrowserIsolation(page: Page): Promise<BrowserEvidence> {
  const evidence: BrowserEvidence = {
    hosts: new Set(), externalViolations: [], consoleErrors: [], pageErrors: [],
    failedRequests: [], redirectIntent: [], mockedEndpoints: []
  };

  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {}, getVoices() { return []; },
        speak(utterance: SpeechSynthesisUtterance) {
          queueMicrotask(() => utterance.onend?.(new Event('end') as SpeechSynthesisEvent));
        },
        pause() {}, resume() {}, pending: false, speaking: false, paused: false, onvoiceschanged: null
      }
    });
    HTMLMediaElement.prototype.play = async () => undefined;
    HTMLMediaElement.prototype.pause = () => undefined;
  });

  page.on('console', message => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('requestfailed', request => {
    if (request.url() !== REDIRECT_TARGET) evidence.failedRequests.push(`${request.url()} :: ${request.failure()?.errorText}`);
  });

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());

    if (['data:', 'blob:'].includes(url.protocol)) {
      await route.continue();
      return;
    }

    evidence.hosts.add(url.hostname);
    if (request.url() === REDIRECT_TARGET && request.isNavigationRequest()) {
      evidence.redirectIntent.push(request.url());
      await route.abort('blockedbyclient');
      return;
    }
    if (!LOCAL_HOSTS.has(url.hostname)) {
      evidence.externalViolations.push(request.url());
      await route.abort('blockedbyclient');
      return;
    }
    if (SIDE_EFFECT_ENDPOINTS.has(url.pathname)) {
      evidence.mockedEndpoints.push(url.pathname);
      const body = url.pathname === '/api/generate-patient-report'
        ? { success: true, reportReady: true, aiModel: 'synthetic-e2e-model' }
        : { success: true };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }
    await route.continue();
  });

  return evidence;
}

function assertCleanBrowserEvidence(evidence: BrowserEvidence, expectedRedirect = false) {
  expect(evidence.externalViolations).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.failedRequests).toEqual([]);
  if (expectedRedirect) expect(evidence.redirectIntent).toEqual([REDIRECT_TARGET]);
  else expect(evidence.redirectIntent).toEqual([]);
}

async function waitForPatientHydration(page: Page, patientId: string) {
  await page.waitForFunction(id => Boolean((window as any).DataService?._patientByIdCache?.[id]), patientId);
}

async function enterPin(page: Page, patientId: string, pin: string) {
  await waitForPatientHydration(page, patientId);
  await page.getByRole('button', { name: 'Empezar Cuestionario' }).click();
  await page.locator('input[maxlength="4"]').fill(pin);
  await page.getByRole('button', { name: 'Entrar al Cuestionario' }).click();
}

async function waitForPatient(id: string, predicate: (patient: Record<string, unknown>) => boolean) {
  await expect.poll(async () => predicate(await getPatientFixture(id))).toBe(true);
}

test.beforeEach(async () => {
  await seedE2EFixtures();
});

test('aislamiento: utiliza solo el proyecto demo y emuladores locales', async ({ page }) => {
  const evidence = await installBrowserIsolation(page);
  await page.goto(patientSessionUrl(PATIENT_SENT));
  await expect(page.getByRole('button', { name: 'Empezar Cuestionario' })).toBeVisible();
  await waitForPatientHydration(page, PATIENT_SENT);
  const runtime = await page.evaluate(() => (window as any).__CE_E2E_FIREBASE_RUNTIME__);
  expect(runtime).toEqual({
    projectId: E2E_PROJECT_ID,
    firestore: { host: '127.0.0.1', port: 8089 },
    auth: { host: '127.0.0.1', port: 9099 }
  });
  expect([...evidence.hosts]).toEqual(expect.arrayContaining(['127.0.0.1']));
  expect([...evidence.hosts].some(host => host.includes('firebase') || host.includes('googleapis'))).toBe(false);
  expect((await getPatientFixture(PATIENT_SENT)).status).toBe('sent');
  assertCleanBrowserEvidence(evidence);
});

test('baseline legacy: PIN correcto, persistencia, reload, revisión y completed', async ({ page }) => {
  const evidence = await installBrowserIsolation(page);
  await page.goto(patientSessionUrl(PATIENT_SENT));
  await enterPin(page, PATIENT_SENT, E2E_PIN);
  await expect(page.getByPlaceholder('Escribe aquí...')).toBeVisible();
  await waitForPatient(PATIENT_SENT, patient => patient.status === 'viewed');
  await page.getByPlaceholder('Escribe aquí...').fill('Paciente');
  await page.getByRole('button', { name: 'Enviar' }).click();

  await expect(page.getByText('Situación sintética uno')).toBeVisible();
  await page.locator('#opt-a').click();
  await waitForPatient(PATIENT_SENT, patient => (patient.answers as Record<string, string>)?.q1 === 'a');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Empezar Cuestionario' })).toBeVisible();
  await enterPin(page, PATIENT_SENT, E2E_PIN);
  await expect(page.getByText('Situación sintética dos')).toBeVisible();
  expect((await getPatientFixture(PATIENT_SENT)).answers).toEqual({ q1: 'a' });

  await page.locator('#opt-b').click();
  await expect(page.getByText('Situación sintética tres')).toBeVisible();
  await page.locator('#opt-a').click();
  await expect(page.getByRole('button', { name: 'Revisar respuestas' })).toBeVisible();
  await page.getByRole('button', { name: 'Revisar respuestas' }).click();
  await expect(page.getByText('Situación sintética tres')).toBeVisible();
  await expect(page.locator('#opt-a')).toHaveClass(/border-green-500/);
  await page.getByRole('button', { name: 'Volver a la pantalla final' }).click();
  await page.getByRole('button', { name: 'Enviar Resultados' }).click();

  await waitForPatient(PATIENT_SENT, patient =>
    patient.status === 'completed' && typeof patient.dateAnswered === 'number' &&
    JSON.stringify(patient.answers) === JSON.stringify({ q1: 'a', q2: 'b', q3: 'a' })
  );
  await expect.poll(() => evidence.redirectIntent.length, { timeout: 15_000 }).toBe(1);
  expect([...new Set(evidence.mockedEndpoints)].sort()).toEqual([...SIDE_EFFECT_ENDPOINTS].sort());
  assertCleanBrowserEvidence(evidence, true);
});

test('baseline legacy: PIN incorrecto no permite entrar ni modifica paciente', async ({ page }) => {
  const evidence = await installBrowserIsolation(page);
  await page.goto(patientSessionUrl(PATIENT_SENT));
  const before = await getPatientFixture(PATIENT_SENT);
  await enterPin(page, PATIENT_SENT, 'x9x9');
  await expect(page.getByText('La clave introducida es incorrecta. Por favor, inténtalo de nuevo.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clave personal de acceso' })).toBeVisible();
  const after = await getPatientFixture(PATIENT_SENT);
  expect(after.status).toBe('sent');
  expect(after.answers).toEqual(before.answers);
  assertCleanBrowserEvidence(evidence);
});

test('baseline legacy: paciente completed queda bloqueado al hidratar el enlace', async ({ page }) => {
  const evidence = await installBrowserIsolation(page);
  await page.goto(patientSessionUrl(PATIENT_COMPLETED));
  const before = await getPatientFixture(PATIENT_COMPLETED);
  await expect(page.getByRole('heading', { name: 'Cuestionario Completado' })).toBeVisible();
  const after = await getPatientFixture(PATIENT_COMPLETED);
  expect(after.status).toBe('completed');
  expect(after.answers).toEqual(before.answers);
  expect(after.dateAnswered).toBe(before.dateAnswered);
  assertCleanBrowserEvidence(evidence);
});
