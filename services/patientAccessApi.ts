export type PatientAccessNext = 'questionnaire' | 'completed' | 'conclusion' | 'unavailable';

export interface PatientQuestionnaireDto {
  id: string;
  status: string;
  nombre?: string;
  sexo?: string;
  answers?: Record<string, string>;
  lastAnswerSavedAt?: number | null;
  lastAnsweredQuestionId?: string | null;
  lastAnsweredQuestionIndex?: number | null;
  questionnaireConfirmedName?: string | null;
  questionnaireConfirmedNameAt?: number | null;
}

export interface PatientBootstrapResponse {
  success: boolean;
  next: PatientAccessNext;
}

export interface PatientUnlockResponse {
  success: boolean;
  next: PatientAccessNext;
  patient?: PatientQuestionnaireDto;
}

export interface PatientActionResponse {
  success: boolean;
  status?: string;
  next?: PatientAccessNext;
  idempotent?: boolean;
}

export type PatientConclusionState = 'available' | 'expired' | 'unavailable';

export interface PatientConclusionStatusResponse {
  success: boolean;
  state: PatientConclusionState;
}

export interface PatientConclusionDto {
  id: string;
  status: 'finalized';
  displayName: string;
  finalConclusion: string | null;
  audioConclusion?: string;
}

export interface PatientConclusionResponse {
  success: true;
  patient: PatientConclusionDto;
}

export class PatientAccessApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'PatientAccessApiError';
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new PatientAccessApiError(response.status, data?.error || 'Acceso temporalmente no disponible.');
  }
  return data as T;
}

const patientUrl = (patientId: string, suffix: string) =>
  `/api/patient-access/${encodeURIComponent(patientId)}/${suffix}`;

export const PatientAccessApi = {
  bootstrap(patientId: string) {
    return requestJson<PatientBootstrapResponse>(patientUrl(patientId, 'bootstrap'));
  },

  unlock(patientId: string, accessPin: string) {
    return requestJson<PatientUnlockResponse>(patientUrl(patientId, 'unlock'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessPin })
    });
  },

  conclusionStatus(patientId: string) {
    return requestJson<PatientConclusionStatusResponse>(patientUrl(patientId, 'conclusion-status'));
  },

  conclusion(patientId: string, accessPin: string, channel: 'session' | 'direct') {
    return requestJson<PatientConclusionResponse>(patientUrl(patientId, 'conclusion'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessPin, channel })
    });
  },

  action(
    patientId: string,
    accessPin: string,
    action: 'confirm_name' | 'save_progress' | 'complete',
    payload: Record<string, unknown>
  ) {
    return requestJson<PatientActionResponse>(patientUrl(patientId, 'action'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessPin, action, payload })
    });
  }
};
