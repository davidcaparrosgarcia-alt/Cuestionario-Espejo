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
  '/api/generate-patient-report',
  '/api/notify-questionnaire-completed'
]);
const LEGACY_NOTIFY_ENDPOINT = '/api/notify-soybienestar-status';

type GatewayRequest = { method: string; path: string; action?: string };

type BrowserEvidence = {
  hosts: Set<string>;
  externalViolations: string[];
  consoleErrors: string[];
  expectedUnauthorizedConsoleErrors: string[];
  expectedConfirmNameFailureConsoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  redirectIntent: string[];
  mockedEndpoints: string[];
  prohibitedLegacyRequests: string[];
  gatewayRequests: GatewayRequest[];
  gatewayResponses: string[];
};

async function installBrowserIsolation(page: Page, expectConfirmNameFailure = false): Promise<BrowserEvidence> {
  const evidence: BrowserEvidence = {
    hosts: new Set(), externalViolations: [], consoleErrors: [], expectedUnauthorizedConsoleErrors: [],
    expectedConfirmNameFailureConsoleErrors: [], pageErrors: [],
    failedRequests: [], redirectIntent: [], mockedEndpoints: [], prohibitedLegacyRequests: [],
    gatewayRequests: [], gatewayResponses: []
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

    const directPatientCalls: string[] = [];
    (window as any).__CE_E2E_DIRECT_PATIENT_CALLS__ = directPatientCalls;
    let dataService: any;
    Object.defineProperty(window, 'DataService', {
      configurable: true,
      get: () => dataService,
      set: value => {
        dataService = value;
        for (const method of ['getPatientById', 'updatePatient']) {
          value[method] = () => {
            directPatientCalls.push(method);
            throw new Error(`E2E DIRECT PATIENT ACCESS BLOCKED: ${method}`);
          };
        }
      }
    });
  });

  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.text() === 'Failed to load resource: the server responded with a status of 401 (Unauthorized)') {
      evidence.expectedUnauthorizedConsoleErrors.push(message.text());
      return;
    }
    if (expectConfirmNameFailure && (
      message.text() === 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)' ||
      message.text().startsWith('No se pudo guardar el nombre confirmado del cuestionario.')
    )) {
      evidence.expectedConfirmNameFailureConsoleErrors.push(message.text());
      return;
    }
    evidence.consoleErrors.push(message.text());
  });
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('requestfailed', request => {
    if (request.url() !== REDIRECT_TARGET) evidence.failedRequests.push(`${request.url()} :: ${request.failure()?.errorText}`);
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/patient-access/')) {
      evidence.gatewayResponses.push(`${response.request().method()} ${url.pathname} ${response.status()}`);
    }
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
    if (url.pathname === LEGACY_NOTIFY_ENDPOINT) {
      evidence.prohibitedLegacyRequests.push(`${request.method()} ${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname.startsWith('/api/patient-access/')) {
      let action: string | undefined;
      if (url.pathname.endsWith('/action')) {
        try {
          action = JSON.parse(request.postData() || '{}').action;
        } catch {}
      }
      evidence.gatewayRequests.push({ method: request.method(), path: url.pathname, action });
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

function assertCleanBrowserEvidence(
  evidence: BrowserEvidence,
  expectedRedirect = false,
  expectedUnauthorized = false,
  expectedConfirmNameFailure = false
) {
  expect(evidence.externalViolations).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.failedRequests).toEqual([]);
  expect(evidence.prohibitedLegacyRequests).toEqual([]);
  if (expectedUnauthorized) {
    expect(evidence.expectedUnauthorizedConsoleErrors).toHaveLength(1);
    expect(evidence.gatewayResponses.some(entry => entry.includes('/unlock 401'))).toBe(true);
  } else {
    expect(evidence.expectedUnauthorizedConsoleErrors).toEqual([]);
  }
  if (expectedConfirmNameFailure) {
    expect(evidence.expectedConfirmNameFailureConsoleErrors.length).toBeGreaterThanOrEqual(1);
    expect(evidence.gatewayResponses.some(entry => entry.includes('/action 503'))).toBe(true);
  } else {
    expect(evidence.expectedConfirmNameFailureConsoleErrors).toEqual([]);
  }
  if (expectedRedirect) expect(evidence.redirectIntent).toEqual([REDIRECT_TARGET]);
  else expect(evidence.redirectIntent).toEqual([]);
}

async function waitForGatewayResponse(evidence: BrowserEvidence, method: string, suffix: string, count = 1) {
  await expect.poll(() => evidence.gatewayResponses.filter(entry => entry.startsWith(`${method} `) && entry.includes(suffix)).length)
    .toBeGreaterThanOrEqual(count);
}

async function enterPin(page: Page, evidence: BrowserEvidence, patientId: string, pin: string, bootstrapCount = 1) {
  await waitForGatewayResponse(evidence, 'GET', `/api/patient-access/${patientId}/bootstrap`, bootstrapCount);
  await page.getByRole('button', { name: 'Empezar Cuestionario' }).click();
  await page.locator('input[maxlength="4"]').fill(pin);
  await page.getByRole('button', { name: 'Entrar al Cuestionario' }).click();
}

async function waitForPatient(id: string, predicate: (patient: Record<string, unknown>) => boolean) {
  await expect.poll(async () => predicate(await getPatientFixture(id))).toBe(true);
}

async function assertPinNotPersisted(page: Page, pin: string) {
  const persisted = await page.evaluate(expectedPin => ({
    localStorage: Object.values(localStorage).some(value => value.includes(expectedPin)),
    sessionStorage: Object.values(sessionStorage).some(value => value.includes(expectedPin)),
    cookie: document.cookie.includes(expectedPin),
    url: window.location.href.includes(expectedPin)
  }), pin);
  expect(persisted).toEqual({ localStorage: false, sessionStorage: false, cookie: false, url: false });
}

test.beforeEach(async () => {
  await seedE2EFixtures();
});

test('aislamiento: utiliza solo el proyecto demo y emuladores locales', async ({ page }) => {
  const evidence = await installBrowserIsolation(page);
  const before = await getPatientFixture(PATIENT_SENT);
  await page.goto(patientSessionUrl(PATIENT_SENT));
  await expect(page.getByRole('button', { name: 'Empezar Cuestionario' })).toBeVisible();
  await waitForGatewayResponse(evidence, 'GET', `/api/patient-access/${PATIENT_SENT}/bootstrap`);
  const runtime = await page.evaluate(() => (window as any).__CE_E2E_FIREBASE_RUNTIME__);
  expect(runtime).toEqual({
    projectId: E2E_PROJECT_ID,
    firestore: { host: '127.0.0.1', port: 8089 },
    auth: { host: '127.0.0.1', port: 9099 }
  });
  expect([...evidence.hosts]).toEqual(expect.arrayContaining(['127.0.0.1']));
  expect([...evidence.hosts].some(host => host.includes('firebase') || host.includes('googleapis'))).toBe(false);
  expect(await getPatientFixture(PATIENT_SENT)).toEqual(before);
  expect(await page.evaluate(() => (window as any).__CE_E2E_DIRECT_PATIENT_CALLS__)).toEqual([]);
  assertCleanBrowserEvidence(evidence);
});

test('baseline legacy: PIN correcto, persistencia, reload, revisión y completed', async ({ page }) => {
  const evidence = await installBrowserIsolation(page);
  await page.goto(patientSessionUrl(PATIENT_SENT));
  await enterPin(page, evidence, PATIENT_SENT, E2E_PIN);
  await expect(page.getByPlaceholder('Escribe aquí...')).toBeVisible();
  await assertPinNotPersisted(page, E2E_PIN);
  await waitForPatient(PATIENT_SENT, patient => patient.status === 'viewed');
  await page.getByPlaceholder('Escribe aquí...').fill('Paciente');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await waitForPatient(PATIENT_SENT, patient => patient.questionnaireConfirmedName === 'Paciente');

  await expect(page.getByText('Situación sintética uno')).toBeVisible();
  await page.locator('#opt-a').click();
  await waitForPatient(PATIENT_SENT, patient => (patient.answers as Record<string, string>)?.q1 === 'a');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Empezar Cuestionario' })).toBeVisible();
  await enterPin(page, evidence, PATIENT_SENT, E2E_PIN, 2);
  await expect(page.getByText('Situación sintética dos')).toBeVisible();
  expect((await getPatientFixture(PATIENT_SENT)).answers).toEqual({ q1: 'a' });

  await page.locator('#opt-b').click();
  await expect(page.getByText('Situación sintética tres')).toBeVisible();
  await page.locator('#opt-a').click();
  await expect(page.getByRole('button', { name: 'Revisar respuestas' })).toBeVisible();
  await page.getByRole('button', { name: 'Revisar respuestas' }).click();
  await expect(page.getByText('Situación sintética tres')).toBeVisible();
  await expect(page.locator('#opt-a')).toHaveClass(/border-green-500/);
  await page.locator('#opt-b').click();
  await waitForPatient(PATIENT_SENT, patient => (patient.answers as Record<string, string>)?.q3 === 'b');
  await page.locator('#opt-a').click();
  await waitForPatient(PATIENT_SENT, patient => (patient.answers as Record<string, string>)?.q3 === 'a');
  await page.getByRole('button', { name: 'Volver a la pantalla final' }).click();
  await page.getByRole('button', { name: 'Enviar Resultados' }).click();

  await waitForPatient(PATIENT_SENT, patient =>
    patient.status === 'completed' && typeof patient.dateAnswered === 'number' &&
    JSON.stringify(patient.answers) === JSON.stringify({ q1: 'a', q2: 'b', q3: 'a' })
  );
  await expect.poll(() => evidence.redirectIntent.length, { timeout: 15_000 }).toBe(1);
  expect([...new Set(evidence.mockedEndpoints)].sort()).toEqual([...SIDE_EFFECT_ENDPOINTS].sort());
  expect(evidence.gatewayRequests.some(request => request.method === 'GET' && request.path.endsWith('/bootstrap'))).toBe(true);
  expect(evidence.gatewayRequests.some(request => request.method === 'POST' && request.path.endsWith('/unlock'))).toBe(true);
  expect(evidence.gatewayRequests.some(request => request.method === 'PATCH' && request.action === 'confirm_name')).toBe(true);
  expect(evidence.gatewayRequests.filter(request => request.method === 'PATCH' && request.action === 'save_progress').length).toBeGreaterThanOrEqual(5);
  expect(evidence.gatewayRequests.some(request => request.method === 'PATCH' && request.action === 'complete')).toBe(true);
  expect(await page.evaluate(() => (window as any).__CE_E2E_DIRECT_PATIENT_CALLS__)).toEqual([]);
  assertCleanBrowserEvidence(evidence, true);
});

test('confirm_name muestra feedback, no avanza y permite reintentar tras un 503', async ({ page }) => {
  const evidence = await installBrowserIsolation(page, true);
  let rejectFirstConfirmName = true;

  await page.route('**/api/patient-access/*/action', async route => {
    const request = route.request();
    const body = JSON.parse(request.postData() || '{}');
    if (rejectFirstConfirmName && body.action === 'confirm_name') {
      rejectFirstConfirmName = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic confirm_name failure' })
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(patientSessionUrl(PATIENT_SENT));
  await enterPin(page, evidence, PATIENT_SENT, E2E_PIN);
  await expect(page.getByPlaceholder('Escribe aquí...')).toBeVisible();
  await waitForPatient(PATIENT_SENT, patient => patient.status === 'viewed');

  await page.getByPlaceholder('Escribe aquí...').fill('Paciente');
  await page.getByRole('button', { name: 'Enviar' }).click();

  await expect(page.getByText('No se ha podido guardar tu nombre. Revisa la conexión e inténtalo de nuevo.')).toBeVisible();
  await expect(page.getByText('Situación sintética uno')).not.toBeVisible();
  const afterFailure = await getPatientFixture(PATIENT_SENT);
  expect(afterFailure.status).toBe('viewed');
  expect(afterFailure.questionnaireConfirmedName).toBeUndefined();

  await page.getByPlaceholder('Escribe aquí...').fill('Paciente');
  await page.getByRole('button', { name: 'Enviar' }).click();

  await waitForPatient(PATIENT_SENT, patient => patient.questionnaireConfirmedName === 'Paciente');
  await expect(page.getByText('Situación sintética uno')).toBeVisible();
  expect(rejectFirstConfirmName).toBe(false);
  expect(await page.evaluate(() => (window as any).__CE_E2E_DIRECT_PATIENT_CALLS__)).toEqual([]);
  assertCleanBrowserEvidence(evidence, false, false, true);
});

test('baseline legacy: PIN incorrecto no permite entrar ni modifica paciente', async ({ page }) => {
  const evidence = await installBrowserIsolation(page);
  await page.goto(patientSessionUrl(PATIENT_SENT));
  const before = await getPatientFixture(PATIENT_SENT);
  await enterPin(page, evidence, PATIENT_SENT, 'x9x9');
  await expect(page.getByText('La clave introducida es incorrecta. Por favor, inténtalo de nuevo.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clave personal de acceso' })).toBeVisible();
  const after = await getPatientFixture(PATIENT_SENT);
  expect(after.status).toBe('sent');
  expect(after.answers).toEqual(before.answers);
  expect(await page.evaluate(() => (window as any).__CE_E2E_DIRECT_PATIENT_CALLS__)).toEqual([]);
  assertCleanBrowserEvidence(evidence, false, true);
});

test('baseline legacy: paciente completed queda bloqueado al hidratar el enlace', async ({ page }) => {
  const evidence = await installBrowserIsolation(page);
  await page.goto(patientSessionUrl(PATIENT_COMPLETED));
  const before = await getPatientFixture(PATIENT_COMPLETED);
  await expect(page.getByRole('heading', { name: 'Cuestionario Completado' })).toBeVisible();
  await waitForGatewayResponse(evidence, 'GET', `/api/patient-access/${PATIENT_COMPLETED}/bootstrap`);
  const after = await getPatientFixture(PATIENT_COMPLETED);
  expect(after.status).toBe('completed');
  expect(after.answers).toEqual(before.answers);
  expect(after.dateAnswered).toBe(before.dateAnswered);
  expect(after).toEqual(before);
  expect(await page.evaluate(() => (window as any).__CE_E2E_DIRECT_PATIENT_CALLS__)).toEqual([]);
  assertCleanBrowserEvidence(evidence);
});
