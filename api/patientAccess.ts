import crypto from "crypto";

export const PATIENT_ACCESS_RATE_LIMIT_MAX_FAILURES = 5;
export const PATIENT_ACCESS_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const PATIENT_ACCESS_RATE_LIMIT_COLLECTION = "patientAccessRateLimits";

export const QUESTIONNAIRE_STATUSES = [
  "pending",
  "sent",
  "viewed",
  "completed",
  "concluded",
  "finalized",
  "deleted"
] as const;

export type QuestionnaireStatus = typeof QUESTIONNAIRE_STATUSES[number];
export type PatientDocumentKind = "QUESTIONNAIRE" | "HIPNODIGEST" | "UNKNOWN";
export type PatientAccessNext = "questionnaire" | "completed" | "conclusion" | "unavailable";
export type PatientConclusionState = "available" | "expired" | "unavailable";
export type PatientConclusionChannel = "session" | "direct";

export interface PatientConclusionDto {
  id: string;
  status: "finalized";
  displayName: string;
  finalConclusion: string | null;
  audioConclusion?: string;
}

export interface PatientClassification {
  kind: PatientDocumentKind;
  identityMatches: boolean;
  status: QuestionnaireStatus | null;
}

export interface RateLimitState {
  failedAttempts: number;
  windowStartedAt: number;
  expiresAt: number;
  updatedAt: number;
}

export interface UnlockDecision {
  ok: boolean;
  reason?: "unavailable" | "invalid_pin";
  update?: Record<string, unknown>;
  response?: Record<string, unknown>;
  notifyStarted?: boolean;
  patientForNotification?: Record<string, unknown>;
}

export interface ActionDecision {
  ok: boolean;
  statusCode?: number;
  reason?: string;
  update?: Record<string, unknown>;
  response?: Record<string, unknown>;
  notifyCompleted?: boolean;
  patientForNotification?: Record<string, unknown>;
}

export interface ConclusionDecision {
  ok: boolean;
  statusCode?: number;
  expired?: boolean;
  update?: Record<string, unknown>;
  patient?: PatientConclusionDto;
  audioRef?: string;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, any>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

export function isHipnoDigestDocument(data: unknown): boolean {
  if (!isRecord(data)) return false;
  return data.recordType === "hipnodigest_client" || data.program === "hipnodigest";
}

export function classifyPatientDocument(documentId: string, data: unknown): PatientClassification {
  const identityMatches = isRecord(data) && typeof data.id === "string" && data.id === documentId;

  if (isHipnoDigestDocument(data)) {
    return { kind: "HIPNODIGEST", identityMatches, status: null };
  }

  if (!isRecord(data) || !QUESTIONNAIRE_STATUSES.includes(data.status as QuestionnaireStatus)) {
    return { kind: "UNKNOWN", identityMatches, status: null };
  }

  const hasQuestionnaireContract =
    typeof data.id === "string" &&
    typeof data.coordinatorEmail === "string" &&
    data.coordinatorEmail.trim().length > 0;

  if (!hasQuestionnaireContract) {
    return { kind: "UNKNOWN", identityMatches, status: null };
  }

  return { kind: "QUESTIONNAIRE", identityMatches, status: data.status as QuestionnaireStatus };
}

export function canReuseDirectQuestionnaireRecord(documentId: string, data: unknown): boolean {
  const classification = classifyPatientDocument(documentId, data);
  return classification.kind === "QUESTIONNAIRE" &&
    classification.identityMatches &&
    classification.status !== "deleted";
}

export function normalizePatientAccessCode(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 4);
}

export function selectStoredPatientAccessCode(data: unknown): string | null {
  if (!isRecord(data)) return null;

  for (const field of ["accessPin", "proposedAccessCode", "personalAccessCode"] as const) {
    if (typeof data[field] !== "string" || !data[field].trim()) continue;
    const normalized = normalizePatientAccessCode(data[field]);
    return /^[a-z0-9]{4}$/.test(normalized) ? normalized : null;
  }

  return null;
}

export function patientAccessCodeMatches(data: unknown, providedCode: unknown): boolean {
  const storedCode = selectStoredPatientAccessCode(data);
  const receivedCode = normalizePatientAccessCode(providedCode);
  if (!storedCode || !/^[a-z0-9]{4}$/.test(receivedCode)) return false;
  return crypto.timingSafeEqual(Buffer.from(storedCode), Buffer.from(receivedCode));
}

export function createRateLimitKey(secret: string, patientId: string, ipAddress: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${patientId}\u0000${ipAddress}`)
    .digest("hex");
}

export function isPatientAccessRateLimitConfigured(secret: unknown): secret is string {
  return typeof secret === "string" && secret.length > 0;
}

export function isRateLimitBlocked(state: unknown, now: number): boolean {
  if (!isRecord(state)) return false;
  const windowStartedAt = Number(state.windowStartedAt);
  const failures = Number(state.failedAttempts);
  if (!Number.isFinite(windowStartedAt) || now - windowStartedAt >= PATIENT_ACCESS_RATE_LIMIT_WINDOW_MS) {
    return false;
  }
  return Number.isFinite(failures) && failures >= PATIENT_ACCESS_RATE_LIMIT_MAX_FAILURES;
}

export function recordFailedRateLimitAttempt(state: unknown, now: number): RateLimitState {
  const isCurrentWindow = isRecord(state) &&
    Number.isFinite(Number(state.windowStartedAt)) &&
    now - Number(state.windowStartedAt) < PATIENT_ACCESS_RATE_LIMIT_WINDOW_MS;
  const windowStartedAt = isCurrentWindow ? Number((state as any).windowStartedAt) : now;
  const previousFailures = isCurrentWindow && Number.isFinite(Number((state as any).failedAttempts))
    ? Math.max(0, Number((state as any).failedAttempts))
    : 0;

  return {
    failedAttempts: previousFailures + 1,
    windowStartedAt,
    expiresAt: windowStartedAt + PATIENT_ACCESS_RATE_LIMIT_WINDOW_MS,
    updatedAt: now
  };
}

export function bootstrapResponse(documentId: string, data: unknown): { success: true; next: PatientAccessNext } {
  const classification = classifyPatientDocument(documentId, data);
  if (classification.kind !== "QUESTIONNAIRE" || !classification.identityMatches) {
    return { success: true, next: "unavailable" };
  }

  switch (classification.status) {
    case "pending":
    case "sent":
    case "viewed":
      return { success: true, next: "questionnaire" };
    case "completed":
      return { success: true, next: "completed" };
    case "concluded":
    case "finalized":
      return { success: true, next: "conclusion" };
    default:
      return { success: true, next: "unavailable" };
  }
}

export function conclusionStatusResponse(
  documentId: string,
  data: unknown
): { success: true; state: PatientConclusionState } {
  const classification = classifyPatientDocument(documentId, data);
  if (
    classification.kind !== "QUESTIONNAIRE" ||
    !classification.identityMatches ||
    !["concluded", "finalized"].includes(classification.status || "")
  ) {
    return { success: true, state: "unavailable" };
  }

  const views = Number((data as Record<string, unknown>).conclusionViews);
  return {
    success: true,
    state: Number.isFinite(views) && views >= 2 ? "expired" : "available"
  };
}

export function validateConclusionEnvelope(body: unknown):
  | { ok: true; accessPin: string; channel: PatientConclusionChannel }
  | { ok: false; error: string } {
  if (!isRecord(body) || !hasOnlyKeys(body, ["accessPin", "channel"])) {
    return { ok: false, error: "Solicitud no valida." };
  }
  if (typeof body.accessPin !== "string" || !["session", "direct"].includes(body.channel)) {
    return { ok: false, error: "Solicitud no valida." };
  }
  return { ok: true, accessPin: body.accessPin, channel: body.channel };
}

function conclusionDisplayName(data: Record<string, unknown>): string {
  const confirmed = typeof data.questionnaireConfirmedName === "string"
    ? data.questionnaireConfirmedName.trim()
    : "";
  if (confirmed) return confirmed;
  const administrative = typeof data.nombre === "string" ? data.nombre.trim() : "";
  return administrative || "Paciente";
}

export function buildConclusionPatientDto(
  documentId: string,
  data: Record<string, unknown>,
  resolvedAudio?: string | null
): PatientConclusionDto {
  const rawFinalConclusion = typeof data.finalConclusion === "string"
    ? data.finalConclusion
    : null;
  const finalConclusion = rawFinalConclusion && rawFinalConclusion.trim()
    ? rawFinalConclusion
    : null;
  const patient: PatientConclusionDto = {
    id: documentId,
    status: "finalized",
    displayName: conclusionDisplayName(data),
    finalConclusion
  };
  if (typeof resolvedAudio === "string" && resolvedAudio.trim()) {
    patient.audioConclusion = resolvedAudio;
  }
  return patient;
}

export function resolveConclusionAccess(
  documentId: string,
  data: unknown,
  providedCode: unknown,
  channel: PatientConclusionChannel,
  now: number
): ConclusionDecision {
  const classification = classifyPatientDocument(documentId, data);
  if (
    classification.kind !== "QUESTIONNAIRE" ||
    !classification.identityMatches ||
    !["concluded", "finalized"].includes(classification.status || "") ||
    !patientAccessCodeMatches(data, providedCode)
  ) {
    return { ok: false, statusCode: 401 };
  }

  const patientData = data as Record<string, unknown>;
  const numericViews = Number(patientData.conclusionViews);
  const currentViews = Number.isFinite(numericViews) ? Math.max(0, numericViews) : 0;
  if (channel === "direct" && currentViews >= 2) {
    return { ok: false, statusCode: 410, expired: true };
  }

  const audioSource = typeof patientData.audioConclusion === "string"
    ? patientData.audioConclusion.trim()
    : "";
  const audioRef = audioSource.startsWith("audio_ref_") ? audioSource : undefined;
  const isDataAudio = /^data:audio\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(audioSource);
  const isRawBase64Audio = audioSource.length >= 8 && audioSource.length % 4 === 0 && /^[a-z0-9+/]+={0,2}$/i.test(audioSource);
  const inlineAudio = !audioRef && (isDataAudio || isRawBase64Audio) ? audioSource : undefined;

  return {
    ok: true,
    update: {
      status: "finalized",
      dateConclusionViewed: now,
      conclusionViews: currentViews + 1
    },
    patient: buildConclusionPatientDto(documentId, patientData, inlineAudio),
    audioRef
  };
}

function sanitizeAnswers(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, answer] of Object.entries(value)) {
    if (typeof answer === "string") result[key] = answer;
  }
  return result;
}

function preserveStoredAnswers(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

export function resolveUnlock(documentId: string, data: unknown, providedCode: unknown): UnlockDecision {
  const classification = classifyPatientDocument(documentId, data);
  if (
    classification.kind !== "QUESTIONNAIRE" ||
    !classification.identityMatches ||
    classification.status === "deleted"
  ) {
    return { ok: false, reason: "unavailable" };
  }
  if (!patientAccessCodeMatches(data, providedCode)) {
    return { ok: false, reason: "invalid_pin" };
  }

  const patient = data as Record<string, any>;
  if (classification.status === "completed") {
    return {
      ok: true,
      response: { success: true, next: "completed", patient: { id: documentId, status: "completed" } }
    };
  }
  if (classification.status === "concluded" || classification.status === "finalized") {
    return {
      ok: true,
      response: {
        success: true,
        next: "conclusion",
        patient: { id: documentId, status: classification.status }
      }
    };
  }

  const shouldTransitionToViewed = classification.status === "pending" || classification.status === "sent";
  const responseStatus = shouldTransitionToViewed ? "viewed" : classification.status;
  const patientDto = {
    id: documentId,
    status: responseStatus,
    nombre: typeof patient.nombre === "string" ? patient.nombre : "",
    sexo: typeof patient.sexo === "string" ? patient.sexo : "",
    answers: sanitizeAnswers(patient.answers),
    lastAnswerSavedAt: typeof patient.lastAnswerSavedAt === "number" ? patient.lastAnswerSavedAt : null,
    lastAnsweredQuestionId: typeof patient.lastAnsweredQuestionId === "string" ? patient.lastAnsweredQuestionId : null,
    lastAnsweredQuestionIndex: typeof patient.lastAnsweredQuestionIndex === "number" ? patient.lastAnsweredQuestionIndex : null,
    questionnaireConfirmedName: typeof patient.questionnaireConfirmedName === "string" ? patient.questionnaireConfirmedName : null,
    questionnaireConfirmedNameAt: typeof patient.questionnaireConfirmedNameAt === "number" ? patient.questionnaireConfirmedNameAt : null
  };

  return {
    ok: true,
    update: shouldTransitionToViewed ? { status: "viewed" } : undefined,
    response: { success: true, next: "questionnaire", patient: patientDto },
    notifyStarted: shouldTransitionToViewed,
    patientForNotification: shouldTransitionToViewed ? { ...patient, status: "viewed" } : undefined
  };
}

export function validateActionEnvelope(body: unknown):
  | { ok: true; accessPin: string; action: "confirm_name" | "save_progress" | "complete"; payload: Record<string, any> }
  | { ok: false; error: string } {
  if (!isRecord(body) || !hasOnlyKeys(body, ["accessPin", "action", "payload"])) {
    return { ok: false, error: "Solicitud no valida." };
  }
  if (typeof body.accessPin !== "string") return { ok: false, error: "Solicitud no valida." };
  if (!["confirm_name", "save_progress", "complete"].includes(body.action)) {
    return { ok: false, error: "Accion no permitida." };
  }
  if (!isRecord(body.payload)) return { ok: false, error: "Payload no valido." };

  if (body.action === "confirm_name") {
    if (!hasOnlyKeys(body.payload, ["questionnaireConfirmedName"])) return { ok: false, error: "Payload no valido." };
    const name = body.payload.questionnaireConfirmedName;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 160) {
      return { ok: false, error: "Nombre no valido." };
    }
  }

  if (body.action === "save_progress") {
    if (!hasOnlyKeys(body.payload, ["questionId", "answer", "questionIndex"])) return { ok: false, error: "Payload no valido." };
    if (typeof body.payload.questionId !== "string" || !body.payload.questionId.trim()) return { ok: false, error: "Pregunta no valida." };
    if (typeof body.payload.answer !== "string") return { ok: false, error: "Respuesta no valida." };
    if (body.payload.questionIndex !== undefined && (!Number.isInteger(body.payload.questionIndex) || body.payload.questionIndex < 0)) {
      return { ok: false, error: "Indice no valido." };
    }
  }

  if (body.action === "complete") {
    if (!hasOnlyKeys(body.payload, ["answers"])) return { ok: false, error: "Payload no valido." };
    if (body.payload.answers !== undefined && !isRecord(body.payload.answers)) return { ok: false, error: "Respuestas no validas." };
    if (isRecord(body.payload.answers) && Object.values(body.payload.answers).some(answer => typeof answer !== "string")) {
      return { ok: false, error: "Respuestas no validas." };
    }
  }

  return {
    ok: true,
    accessPin: body.accessPin,
    action: body.action,
    payload: body.payload
  };
}

export function activeQuestionIds(questionnaireData: unknown): Set<string> | null {
  if (!isRecord(questionnaireData) || !Array.isArray(questionnaireData.questions)) return null;
  const ids = questionnaireData.questions
    .filter(question => isRecord(question) && question.hidden !== true && typeof question.id === "string" && question.id)
    .map(question => String(question.id));
  return ids.length > 0 ? new Set(ids) : null;
}

function terminalActionResponse(documentId: string, status: QuestionnaireStatus): ActionDecision {
  return {
    ok: true,
    response: { success: true, idempotent: true, patient: { id: documentId, status }, next: status === "completed" ? "completed" : "conclusion" }
  };
}

export function resolvePatientAction(
  documentId: string,
  data: unknown,
  action: "confirm_name" | "save_progress" | "complete",
  payload: Record<string, any>,
  questionIds: Set<string> | null,
  now: number
): ActionDecision {
  const classification = classifyPatientDocument(documentId, data);
  if (classification.kind !== "QUESTIONNAIRE" || !classification.identityMatches || classification.status === "deleted") {
    return { ok: false, statusCode: 401, reason: "Acceso no autorizado." };
  }

  const patient = data as Record<string, any>;
  if (action === "complete" && ["completed", "concluded", "finalized"].includes(classification.status || "")) {
    return terminalActionResponse(documentId, classification.status as QuestionnaireStatus);
  }
  if (!["pending", "sent", "viewed"].includes(classification.status || "")) {
    return { ok: false, statusCode: 409, reason: "Estado no compatible con la accion." };
  }

  if (action === "confirm_name") {
    return {
      ok: true,
      update: {
        questionnaireConfirmedName: payload.questionnaireConfirmedName.trim(),
        questionnaireConfirmedNameAt: now
      },
      response: { success: true, status: classification.status }
    };
  }

  if (!questionIds) {
    return { ok: false, statusCode: 503, reason: "Cuestionario activo no disponible." };
  }

  const existingAnswers = preserveStoredAnswers(patient.answers);
  if (action === "save_progress") {
    const questionId = payload.questionId.trim();
    if (!questionIds.has(questionId)) return { ok: false, statusCode: 422, reason: "Pregunta no valida." };
    const answerChanged = existingAnswers[questionId] !== payload.answer;
    const hasCurrentReport = patient.aiReportStatus === "ready" ||
      typeof patient.aiInputAnswersHash === "string" ||
      typeof patient.conversationSummary === "string" ||
      typeof patient.finalConclusion === "string";
    const update: Record<string, unknown> = {
      answers: { ...existingAnswers, [questionId]: payload.answer },
      lastAnswerSavedAt: now,
      lastAnsweredQuestionId: questionId
    };
    if (payload.questionIndex !== undefined) update.lastAnsweredQuestionIndex = payload.questionIndex;
    if (answerChanged && hasCurrentReport) {
      update.aiReportStatus = "stale";
      update.aiReportStaleAt = now;
    }
    return { ok: true, update, response: { success: true, status: classification.status } };
  }

  const submittedAnswers = sanitizeAnswers(payload.answers);
  for (const questionId of Object.keys(submittedAnswers)) {
    if (!questionIds.has(questionId)) return { ok: false, statusCode: 422, reason: "Pregunta no valida." };
  }
  const combinedAnswers = { ...existingAnswers, ...submittedAnswers };
  const completedPatient = { ...patient, answers: combinedAnswers, status: "completed" };
  return {
    ok: true,
    update: {
      answers: combinedAnswers,
      lastAnswerSavedAt: now,
      dateAnswered: now,
      status: "completed",
      aiReportStatus: "pending",
      aiReportError: null,
      aiReportErrorAt: null
    },
    response: { success: true, status: "completed", next: "completed", idempotent: false },
    notifyCompleted: true,
    patientForNotification: completedPatient
  };
}
