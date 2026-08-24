import { expect, test, type Page } from '@playwright/test';
import {
  E2E_PIN,
  PATIENT_CONCLUDED,
  PATIENT_CONCLUSION_AUDIO_DATA,
  PATIENT_CONCLUSION_AUDIO_REF,
  PATIENT_CONCLUSION_INTERNAL_TEXT,
  PATIENT_CONCLUSION_PUBLIC_TEXT,
  getAudioFixture,
  getPatientFixture,
  patientConclusionUrl,
  patientSessionUrl,
  seedE2EFixtures
} from './e2eHarness';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const FORBIDDEN_DTO_KEYS = [
  'conversationSummary', 'accessPin', 'email', 'telefono', 'coordinatorEmail', 'answers',
  'soybienestarContext', 'preInformeSoyBienestar'
];

type ConclusionEvidence = {
  externalViolations: string[];
  consoleErrors: string[];
  expectedUnauthorizedConsoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  gatewayRequests: Array<{ method: string; path: string; channel?: string }>;
  gatewayResponses: string[];
  conclusionBodies: Array<Record<string, unknown>>;
};

async function installConclusionIsolation(page: Page): Promise<ConclusionEvidence> {
  const evidence: ConclusionEvidence = {
    externalViolations: [], consoleErrors: [], expectedUnauthorizedConsoleErrors: [], pageErrors: [],
    failedRequests: [], gatewayRequests: [], gatewayResponses: [], conclusionBodies: []
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
    evidence.consoleErrors.push(message.text());
  });
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('requestfailed', request => evidence.failedRequests.push(`${request.url()} :: ${request.failure()?.errorText}`));
  page.on('response', async response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/patient-access/')) return;
    evidence.gatewayResponses.push(`${response.request().method()} ${url.pathname} ${response.status()}`);
    if (url.pathname.endsWith('/conclusion') && response.status() === 200) {
      evidence.conclusionBodies.push(await response.json());
    }
  });

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (['data:', 'blob:'].includes(url.protocol)) {
      await route.continue();
      return;
    }
    if (!LOCAL_HOSTS.has(url.hostname)) {
      evidence.externalViolations.push(request.url());
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname.startsWith('/api/patient-access/')) {
      let channel: string | undefined;
      if (url.pathname.endsWith('/conclusion')) {
        try { channel = JSON.parse(request.postData() || '{}').channel; } catch {}
      }
      evidence.gatewayRequests.push({ method: request.method(), path: url.pathname, channel });
    }
    await route.continue();
  });

  return evidence;
}

function assertSafeConclusionDto(body: Record<string, any>) {
  expect(Object.keys(body).sort()).toEqual(['patient', 'success']);
  expect(Object.keys(body.patient).sort()).toEqual(['audioConclusion', 'displayName', 'finalConclusion', 'id', 'status']);
  const serialized = JSON.stringify(body);
  for (const forbidden of FORBIDDEN_DTO_KEYS) expect(serialized).not.toContain(forbidden);
  expect(serialized).not.toContain(PATIENT_CONCLUSION_INTERNAL_TEXT);
  expect(serialized).not.toContain(PATIENT_CONCLUSION_AUDIO_REF);
}

async function assertCleanEvidence(page: Page, evidence: ConclusionEvidence, expectedUnauthorized = 1) {
  expect(evidence.externalViolations).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.failedRequests).toEqual([]);
  expect(evidence.expectedUnauthorizedConsoleErrors).toHaveLength(expectedUnauthorized);
  expect(await page.evaluate(() => (window as any).__CE_E2E_DIRECT_PATIENT_CALLS__)).toEqual([]);
}

async function waitForPatient(id: string, predicate: (patient: Record<string, unknown>) => boolean) {
  await expect.poll(async () => predicate(await getPatientFixture(id))).toBe(true);
}

async function waitForGatewayResponse(evidence: ConclusionEvidence, method: string, suffix: string, count = 1) {
  await expect.poll(() => evidence.gatewayResponses.filter(
    entry => entry.startsWith(`${method} `) && entry.includes(suffix)
  ).length).toBeGreaterThanOrEqual(count);
}

test.beforeEach(async () => {
  await seedE2EFixtures();
});

test('conclusión session no filtra datos, registra vistas y no aplica límite de dos', async ({ page }) => {
  const evidence = await installConclusionIsolation(page);
  const audioBefore = await getAudioFixture(PATIENT_CONCLUSION_AUDIO_REF);

  await page.goto(patientSessionUrl(PATIENT_CONCLUDED));
  await waitForGatewayResponse(evidence, 'GET', `/api/patient-access/${PATIENT_CONCLUDED}/bootstrap`);
  await expect(page.getByRole('heading', { name: 'Clave personal de acceso' })).toBeVisible();
  await expect(page.getByText(PATIENT_CONCLUSION_PUBLIC_TEXT)).not.toBeVisible();
  await expect(page.getByText(PATIENT_CONCLUSION_INTERNAL_TEXT)).not.toBeVisible();

  await page.locator('input[maxlength="4"]').fill('xxxx');
  await page.getByRole('button', { name: 'Entrar al Cuestionario' }).click();
  await expect(page.getByText('La clave introducida es incorrecta. Por favor, inténtalo de nuevo.')).toBeVisible();
  let stored = await getPatientFixture(PATIENT_CONCLUDED);
  expect(stored.status).toBe('concluded');
  expect(stored.conclusionViews).toBe(0);

  await page.locator('input[maxlength="4"]').fill(E2E_PIN);
  await page.getByRole('button', { name: 'Entrar al Cuestionario' }).click();
  await expect(page.getByText(PATIENT_CONCLUSION_PUBLIC_TEXT)).toBeVisible();
  await expect(page.getByText(PATIENT_CONCLUSION_INTERNAL_TEXT)).not.toBeVisible();
  await waitForPatient(PATIENT_CONCLUDED, patient => patient.status === 'finalized' && patient.conclusionViews === 1);

  for (const [reloadIndex, expectedViews] of [2, 3].entries()) {
    await page.reload();
    await waitForGatewayResponse(
      evidence,
      'GET',
      `/api/patient-access/${PATIENT_CONCLUDED}/bootstrap`,
      reloadIndex + 2
    );
    await expect(page.getByRole('heading', { name: 'Clave personal de acceso' })).toBeVisible();
    await page.locator('input[maxlength="4"]').fill(E2E_PIN);
    await page.getByRole('button', { name: 'Entrar al Cuestionario' }).click();
    await expect(page.getByText(PATIENT_CONCLUSION_PUBLIC_TEXT)).toBeVisible();
    await waitForPatient(PATIENT_CONCLUDED, patient => patient.conclusionViews === expectedViews);
  }

  stored = await getPatientFixture(PATIENT_CONCLUDED);
  expect(typeof stored.dateConclusionViewed).toBe('number');
  expect(evidence.gatewayRequests.filter(request => request.channel === 'session')).toHaveLength(4);
  await expect.poll(() => evidence.conclusionBodies.length).toBe(3);
  evidence.conclusionBodies.forEach(assertSafeConclusionDto);
  expect(evidence.conclusionBodies[0].patient).toMatchObject({
    finalConclusion: PATIENT_CONCLUSION_PUBLIC_TEXT,
    audioConclusion: PATIENT_CONCLUSION_AUDIO_DATA
  });
  expect(await getAudioFixture(PATIENT_CONCLUSION_AUDIO_REF)).toEqual(audioBefore);
  await assertCleanEvidence(page, evidence);
});

test('conclusión directa prioriza nombre confirmado y bloquea la tercera vista', async ({ page }) => {
  const evidence = await installConclusionIsolation(page);

  await page.goto(patientConclusionUrl(PATIENT_CONCLUDED));
  await waitForGatewayResponse(evidence, 'GET', `/api/patient-access/${PATIENT_CONCLUDED}/conclusion-status`);
  await expect(page.getByRole('heading', { name: 'Acceso Protegido' })).toBeVisible();
  await expect(page.getByText(PATIENT_CONCLUSION_PUBLIC_TEXT)).not.toBeVisible();
  await expect(page.getByText(PATIENT_CONCLUSION_INTERNAL_TEXT)).not.toBeVisible();

  await page.locator('input[type="password"]').fill('xxxx');
  await page.getByRole('button', { name: 'Ver mis resultados' }).click();
  await expect(page.getByText('Clave incorrecta')).toBeVisible();
  let stored = await getPatientFixture(PATIENT_CONCLUDED);
  expect(stored.status).toBe('concluded');
  expect(stored.conclusionViews).toBe(0);

  await page.locator('input[type="password"]').fill(E2E_PIN);
  await page.getByRole('button', { name: 'Ver mis resultados' }).click();
  await expect(page.getByText(PATIENT_CONCLUSION_PUBLIC_TEXT)).toBeVisible();
  await expect(page.getByText('Preparado para:')).toContainText('Nombre Elegido');
  await expect(page.getByText('Preparado para:')).not.toContainText('Alias Inicial');
  await waitForPatient(PATIENT_CONCLUDED, patient => patient.status === 'finalized' && patient.conclusionViews === 1);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Acceso Protegido' })).toBeVisible();
  await page.locator('input[type="password"]').fill(E2E_PIN);
  await page.getByRole('button', { name: 'Ver mis resultados' }).click();
  await expect(page.getByText(PATIENT_CONCLUSION_PUBLIC_TEXT)).toBeVisible();
  await waitForPatient(PATIENT_CONCLUDED, patient => patient.conclusionViews === 2);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Enlace Caducado' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver mis resultados' })).not.toBeVisible();
  await expect(page.getByText(PATIENT_CONCLUSION_PUBLIC_TEXT)).not.toBeVisible();
  stored = await getPatientFixture(PATIENT_CONCLUDED);
  expect(stored.conclusionViews).toBe(2);

  expect(evidence.gatewayRequests.some(request => request.path.endsWith('/conclusion-status'))).toBe(true);
  expect(evidence.gatewayRequests.filter(request => request.channel === 'direct')).toHaveLength(3);
  await expect.poll(() => evidence.conclusionBodies.length).toBe(2);
  evidence.conclusionBodies.forEach(assertSafeConclusionDto);
  await assertCleanEvidence(page, evidence);
});
