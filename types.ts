
export interface CoordinatorProfile {
  nombre: string;
  email: string;
}

export interface AuthUser {
  email: string;
  pin?: string; // Campo legado; no se utiliza para autorización
  nombre: string;
  securityQuestion?: string;
  securityAnswer?: string;
  samplePatientDeleted?: boolean;
}

export interface PatientData {
  id: string;
  nombre: string;
  edad: string;
  sexo: string;
  observaciones: string;
  telefono: string;
  email: string;
  coordinatorEmail?: string; 
  accessPin?: string; // Clave personal alfanumérica para ver la conclusión
  // Estados actualizados según nueva lógica
  status: 'pending' | 'sent' | 'viewed' | 'completed' | 'concluded' | 'finalized' | 'deleted';
  answers?: Record<string, string>;
  conversationSummary?: string; // Resumen técnico IA
  questionnaireConfirmedName?: string;
  questionnaireConfirmedNameAt?: number;
  therapistClinicalGuidance?: string;
  therapistClinicalGuidanceUpdatedAt?: number;
  therapistClinicalGuidanceUpdatedBy?: string;
  finalConclusion?: string; // Conclusión editable para el paciente
  conclusionViews?: number; // Contador de veces que ha visto la conclusión
  
  // Nuevos campos
  dateSent?: number;
  dateAnswered?: number;
  dateConclusionSent?: number;
  dateConclusionViewed?: number;
  audioConclusion?: string; // Base64 del audio
  audioConclusionCreatedAt?: number;
  audioConclusionExpiresAt?: number;
  audioConclusionConsumedAt?: number | null;
  audioConclusionExpiredAt?: number;
  audioConclusionDurationMs?: number;
  audioConclusionMimeType?: string;
  audioConclusionSizeBytes?: number;
  lastAnswerSavedAt?: number;
  lastAnsweredQuestionId?: string;
  lastAnsweredQuestionIndex?: number;

  lastQuestionnaireEmailSentAt?: number;
  lastQuestionnaireEmailSentTo?: string;
  lastQuestionnaireEmailSubject?: string;
  lastQuestionnaireEmailStatus?: string;
  lastQuestionnaireEmailSentBy?: string;

  // Borrado lógico
  deletedAt?: number | null;
  deletedBy?: string | null;
  deletedReason?: string | null;
  previousStatusBeforeDelete?: string | null;
  restoredAt?: number | null;
  restoredBy?: string | null;
  
  
  // Integración SoyBienestar
  source?: string;
  sourceRequestId?: string;
  soybienestarUid?: string;
  soybienestarContext?: any;
  proposedAccessCode?: string;
  accessCodeFormat?: 'v2_4_alphanumeric';
  previousAccessPin?: string;
  accessPinMigratedAt?: number;
  directAccessCreated?: boolean;
  directQuestionnaireUrlCreatedAt?: number;
  questionnaireUrl?: string;
  therapistReviewedAt?: number;
  therapistReviewedBy?: string;
  lastSoyBienestarDossierSyncAt?: number;
  lastSoyBienestarDossierSyncStatus?: "ok" | "error" | "skipped";
  lastSoyBienestarStatusSyncAt?: number;
  lastSoyBienestarStatusSyncEvent?: string;
  lastSoyBienestarStatusSyncStatus?: string;
  preInformeSoyBienestar?: string;
  preferredChannels?: {
    email?: boolean;
    whatsapp?: boolean;
    sms?: boolean;
  };
  aiGeneratedAt?: number;
  aiInputAnswerCount?: number;
  aiInputHadSoyBienestarContext?: boolean;
  aiInputAnswersHash?: string;
  aiClinicalPromptHash?: string;
  aiConclusionPromptHash?: string;
  aiModel?: string;
  aiProvider?: string;
  aiReportStatus?: string;
  aiReportError?: string | null;
  aiReportErrorAt?: number | null;
  aiReportLastAttemptAt?: number;
}

export interface DualAudio {
  male?: string;
  female?: string;
  male2?: string;
  female2?: string;
}

export interface Question {
  id: string;
  hidden?: boolean;
  scenario: string;
  options: {
    key: string;
    text: string;
    audio?: DualAudio; // Audio específico por género
  }[];
  speechScript?: string;
  audio?: DualAudio; // Audio específico por género para el escenario
  isScale?: boolean;
  scaleRange?: { min: number; max: number }; // Nuevo: Rango para desplegable numérico
  scaleLabel?: string;
  followUp?: string;
  postOptionsText?: string;
  postOptionsAudio?: DualAudio;
}

export interface AIProviderStatus {
  id: string;
  provider: string;
  model: string;
  enabled: boolean;
  priority: number;
  status: 'active' | 'standby' | 'failed' | 'exhausted';
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastErrorCode?: string;
  activeSince?: number;
  reportsGenerated: number;
  quotaExhausted?: boolean;
  quotaExhaustedSince?: number;
  circuitOpenUntil?: number;
}

// Configuración global de textos y flujos
export interface GlobalConfig {
  welcomeText: string;
  welcomeAudio: DualAudio;
  nameQuestionText: string;
  nameQuestionAudio: DualAudio;
  startText: string;
  startAudio: DualAudio;
  finishText: string; // Nuevo: Texto previo al envío
  finishAudio: DualAudio; // Nuevo: Audio previo al envío
  afterSendText: string; // Nuevo: Texto post envío
  afterSendAudio: DualAudio; // Nuevo: Audio post envío
  defaultVoiceMode: Voice;
  femaleVoiceVariant?: 1 | 2;
  maleVoiceVariant?: 1 | 2;
  defaultTheme?: 'light' | 'dark';
  backgrounds?: string[]; // Array de URLs (máximo 2)
  
  // Nuevos campos de Ajustes
  clinicalPrompt?: string;
  conclusionPrompt?: string;
  questionnaireMessage?: string;
  conclusionMessage?: string;
  notificationEmails?: string;
  
  // Ajustes No Sensibles
  conclusionBaseUrl?: string;
  bookingUrl?: string;
  therapiesInfoUrl?: string;
  
  // Ajustes Sensibles
  authorizedEmails?: string;
  aiFallbackEnabled?: boolean;
  aiProviders?: AIProviderStatus[];
}

export enum Voice {
  MALE = 'male',
  FEMALE = 'female',
  NONE = 'none'
}

export type View = 'COORDINATOR' | 'PATIENT_SESSION' | 'LANDING' | 'CONCLUSION_VIEW';
