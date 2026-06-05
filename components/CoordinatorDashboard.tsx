
import React, { useState, useEffect } from 'react';
import { Card, Button, Input, Logo, Toast } from './UI';
import { PatientData, CoordinatorProfile, AuthUser } from '../types';
import { QUESTIONS } from '../constants';
import { DataService } from '../services/dataService';
import { gemini } from '../services/gemini';
import { auth } from '../services/firebase';

interface DashboardProps {
  profile: CoordinatorProfile;
  fullProfile: AuthUser | null;
  onProfileUpdate: (data: Partial<AuthUser>) => void;
  onLogout: () => void;
  onEnterEditMode: () => void;
}

const ACCESS_CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

function normalizeAccessCode(code: string) {
  return String(code || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4);
}

function generateAccessCode(length = 4) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ACCESS_CODE_CHARS[Math.floor(Math.random() * ACCESS_CODE_CHARS.length)];
  }
  return code;
}

function isValidNewAccessCode(code: string) {
  return /^[a-z0-9]{4}$/.test(normalizeAccessCode(code));
}

function isValidLegacyAccessCode(code: string) {
  return /^[a-z0-9]{4,6}$/.test(normalizeAccessCode(code));
}

const safeBtoa = (str: string) => {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
      function toSolidBytes(match, p1) {
          return String.fromCharCode(parseInt(p1, 16));
  }));
};

const isMobileDevice = () => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

const openEmailComposer = (to: string, subject: string, body: string, popupWindow: Window | null) => {
    const isMobile = isMobileDevice();
    const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    
    if (isMobile) {
        if (popupWindow) popupWindow.close();
        window.location.href = mailtoUrl;
    } else {
        if (popupWindow) popupWindow.location.href = gmailUrl;
        else window.open(gmailUrl, '_blank');
    }
};

const openWhatsAppComposer = (phone: string, body: string, popupWindow: Window | null) => {
    const isMobile = isMobileDevice();
    const cleanPhone = phone.replace(/\D/g, '');
    const nativeWaUrl = `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(body)}`;
    const webWaUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`;
    
    if (isMobile) {
        if (popupWindow) popupWindow.close();
        window.location.href = nativeWaUrl;
        setTimeout(() => { window.location.href = webWaUrl; }, 500);
    } else {
        if (popupWindow) popupWindow.location.href = webWaUrl;
        else window.open(webWaUrl, '_blank');
    }
};

const openSmsComposer = (phone: string, body: string, popupWindow: Window | null) => {
    const isMobile = isMobileDevice();
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const separator = isIOS ? '&' : '?';
    const cleanPhone = phone.replace(/\s+/g, '');
    const smsUrl = `sms:${cleanPhone}${separator}body=${encodeURIComponent(body)}`;

    if (isMobile) {
        if (popupWindow) popupWindow.close();
        window.location.href = smsUrl;
    } else {
        if (popupWindow) popupWindow.location.href = smsUrl;
        else window.open(smsUrl, '_blank');
    }
};

import { ReportBlock, formatGeneratedReportForDisplay, normalizeGeneratedClinicalReport, escapeHtml } from '../utils/reportFormatting';

const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Pendiente';
    return new Date(timestamp).toLocaleDateString() + ' ' + new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
};

const getSoyBienestarContextText = (p: PatientData) => {
  if ((p as any).preInformeSoyBienestar) return String((p as any).preInformeSoyBienestar);

  const ctx = (p as any).soybienestarContext;
  if (!ctx) return "";

  if (typeof ctx === "string") return ctx;

  if (ctx.reportExcerpt) {
    try {
      const parsed = typeof ctx.reportExcerpt === "string" ? JSON.parse(ctx.reportExcerpt) : ctx.reportExcerpt;
      return [
        parsed?.titulo,
        parsed?.subtitulo,
        parsed?.cuerpo,
        parsed?.cierre
      ].filter(Boolean).join("\n\n");
    } catch {
      return String(ctx.reportExcerpt);
    }
  }

  return "";
};

const isSoyBienestarPatient = (p: PatientData) =>
  p.source === 'soybienestar' ||
  (p as any).directAccessCreated ||
  !!p.soybienestarUid ||
  !!p.sourceRequestId ||
  !!(p as any).soybienestarContext ||
  !!(p as any).preInformeSoyBienestar;

const getInitialObservationsForDisplay = (p: PatientData) => {
  if (isSoyBienestarPatient(p)) {
    return `<div style="color: #b45309; font-style: italic;">Origen SoyBienestar.<br/>Ficha generada con los datos iniciales de SoyBienestar, pendiente de respuestas del cuestionario.<br/>Estado: ${p.status === 'completed' || p.status === 'concluded' || p.status === 'finalized' ? 'Completado' : 'Pendiente'}</div>`;
  }
  return escapeHtml(p.observaciones || "Sin observaciones.");
};

const buildSoyBienestarClinicalSummary = (patient: PatientData) => {
  const ctx: any = (patient as any).soybienestarContext || {};
  const internal = ctx.latestInternalTherapistReport || {};
  const visible = ctx.latestVisibleOrientationReport || {};
  const feedback = ctx.reportFeedback || {};

  const estadoExpresado = Array.isArray(internal.estado_emocional_predominante?.expresado_por_usuario)
    ? internal.estado_emocional_predominante.expresado_por_usuario.join("; ")
    : "";

  const estadoInferido = Array.isArray(internal.estado_emocional_predominante?.inferido_por_conversacion)
    ? internal.estado_emocional_predominante.inferido_por_conversacion.join("; ")
    : "";

  const impacto = internal.impacto_funcional || {};

  const observaciones = [
    impacto.sueno ? `Sueño: ${impacto.sueno}` : "",
    impacto.energia ? `Energía: ${impacto.energia}` : "",
    impacto.concentracion ? `Concentración: ${impacto.concentracion}` : "",
    impacto.relaciones ? `Relaciones: ${impacto.relaciones}` : "",
    impacto.alimentacion ? `Alimentación: ${impacto.alimentacion}` : "",
    impacto.evitacion ? `Evitación: ${impacto.evitacion}` : "",
    internal.contexto_y_posibles_desencadenantes ? `Contexto y posibles desencadenantes: ${internal.contexto_y_posibles_desencadenantes}` : "",
    ctx.latestReportFeedbackComment || feedback.comment ? `Comentario de validación del usuario: ${ctx.latestReportFeedbackComment || feedback.comment}` : ""
  ].filter(Boolean);

  return [
    "VALORACIÓN PRELIMINAR DEL ESTADO EMOCIONAL",
    internal.motivo_principal || ctx.latestClinicalConclusion || visible.lo_que_parece_pesar_mas || "Pendiente de ampliar con el Cuestionario Espejo.",
    "",
    "DINÁMICA INICIAL OBSERVADA",
    [
      estadoExpresado ? `El usuario expresa: ${estadoExpresado}.` : "",
      estadoInferido ? `En la conversación inicial se infiere: ${estadoInferido}.` : "",
      internal.hipotesis_de_trabajo_no_diagnostica || ctx.globalUserSummary || ""
    ].filter(Boolean).join(" "),
    "",
    "OBSERVACIONES CLAVE",
    observaciones.length > 0
      ? observaciones.map((item, i) => `${i + 1}. ${item}`).join("\n")
      : "1. No constan todavía observaciones clínicas suficientes más allá de la primera consulta.",
    "",
    "ESTRATEGIA INICIAL RECOMENDADA",
    internal.recomendacion_prudente_siguiente_paso || visible.siguiente_paso || "Completar el Cuestionario Espejo para obtener una lectura más profunda y personalizada.",
    "",
    "PRÓXIMO PASO",
    "Esta valoración es preliminar. La ficha completa deberá integrarse con las respuestas del Cuestionario Espejo una vez el paciente lo finalice."
  ].join("\n");
};

// --- TEXTOS DE EJEMPLO ACTUALIZADOS ---
const INTERNAL_CLINICAL_EXAMPLE = `INFORME DE VALORACIÓN INICIAL Y GUÍA TERAPÉUTICA AVANZADA

PERFIL PSICOLÓGICO Y DINÁMICA EMOCIONAL
El paciente presenta un patrón cognitivo predominante de rumiación obsesiva (Bucle Tipo B en Cuestionario), con un marcado enfoque en la anticipación de escenarios negativos. Su estilo de apego sugiere una base ansioso-ambivalente. El mecanismo de defensa principal es la intelectualización del dolor. Se detecta una desconexión severa con el "Niño Interior", manifestada en la incapacidad de mirarse al espejo con aceptación.

OBSERVACIONES CLAVE
1. Bloqueo de Energía Vital: El 80% de recursos mentales se consumen en bucles pasado-futuro.
2. Locus de Control Externo: Bienestar dependiente de validación externa (mensajería/redes).
3. Sueño y Descanso: Patrón de insomnio por rumiación nocturna (Respuesta 11.e), indicando niveles de cortisol elevados crónicos.

ESTRATEGIA DE INTERVENCIÓN PERSONALIZADA (PROTOCOLOS DEL CENTRO)

1. REPROGRAMACIÓN SUBCONSCIENTE (Fase de Choque - Semanas 1-2)
   - Aplicación de Hipnosis Clínica Camuflada combinada con PNL para "destraumatizar" la respuesta automática de ansiedad ante el silencio ajeno.
   - Objetivo: Romper el anclaje negativo que dispara la angustia al esperar mensajes.

2. MEDITACIÓN NEUROPLÁSTICA (Fase de Riego - Diario)
   - Prescripción obligatoria de Meditación "Satanama" (Kirtan Kriya) durante 11 minutos diarios.
   - Justificación: El movimiento de dedos y el mantra estimularán los puntos meridianos del paladar para crear nuevas conexiones sinápticas que sustituyan el hábito de la rumiación.

3. GESTIÓN ENERGÉTICA Y RESPIRACIÓN
   - Práctica de Respiración en Cuadrado (4-4-4-4) ante activadores de estrés laboral.
   - Se valora sesión de Respiración Holotrópica (Breathwork Nivel B) para el mes 2, buscando acceder a la memoria somática y liberar la angustia oprimida en el pecho (DMT natural).

4. TRABAJO DE PROFUNDIDAD
   - Terapia del Niño Interior: Necesario para abordar la herida de "no pertenencia" detectada en la pregunta sobre el grupo de amigos.
   - Ejercicio del Espejo: Pauta diaria de 3 minutos de mirada fija + respiración profunda para reconectar con la propia imagen sin juicio.

PRONÓSTICO
Con la aplicación de la PNL y la constancia en el Satanama, esperamos una reducción del 60% en la rumiación nocturna para la tercera semana.`;

const EXTERNAL_PATIENT_EXAMPLE = `Hola Martín,

He analizado detenidamente tus respuestas en el Cuestionario Espejo y la conclusión es clara: vives en un estado de alerta encubierta que te está agotando.

Olvida por un momento lo que crees saber sobre tu "ansiedad" o tu insomnio. Lo que tus patrones revelan es una "Hipervigilancia Emocional". Tu sistema nervioso ha aprendido a interpretar la incertidumbre (un silencio, un mensaje que tarda, un cambio de planes) como una amenaza vital.

No es que "te preocupes demasiado", es que tu cerebro está gastando el 80% de su energía en escanear peligros que no existen, intentando controlar el futuro para evitar sentirte rechazado. Ese "peso en el pecho" y esa rumiación nocturna no son tu personalidad; son la carga de sostener una máscara de control cuando por dentro sientes que caminas sobre hielo fino.

Lo que ocurre es una desconexión entre tu mente racional (que sabe que no pasa nada) y tu memoria emocional (que grita peligro). Mientras sigas intentando resolver esto "pensando", solo alimentarás el bucle.

Tu perfil indica una capacidad inmensa, pero está bloqueada por este mecanismo de defensa caducado. La solución no es "relajarse", es reprogramar esa respuesta automática. Necesitamos desactivar el miedo al silencio y reconectar con tu seguridad interna para que dejes de vivir esperando validación externa.

Tienes el diagnóstico. Ahora tú decides si seguimos tapando el síntoma o vamos a la raíz.`;

const DEFAULT_CLINICAL_PROMPT = `Actúa como un psicoterapeuta experto especializado en reprogramación mental, PNL y Coach Emocional de alto nivel.
Debes analizar los resultados de una sesión del "Cuestionario Espejo".

NUESTRO ARSENAL TERAPÉUTICO (Úsalo para recomendar tratamientos específicos):
1. REPROGRAMACIÓN SUBCONSCIENTE: Uso de PNL e Hipnosis (presentada como "reestructuración del subconsciente") para destraumatizar y cambiar patrones en 2-3 semanas.
2. MEDITACIÓN NEUROPLÁSTICA: Técnica "Satanama" (mantra + movimiento dedos) para abrir nuevos caminos neuronales y meditaciones canalizadas personalizadas.
3. GESTIÓN ENERGÉTICA (PRANAYAMA): Respiración en cuadrado para el estrés cotidiano y Respiración Holotrópica (Breathwork) para liberar traumas profundos (DMT natural).
4. TRABAJO DE PROFUNDIDAD: Terapia del Niño Interior y sanación de patrones Transgeneracionales (padres/abuelos).
5. HÁBITOS DE AUTOCONSCIENCIA: Ejercicio del espejo (conexión emocional) y auditoría de pensamientos (convertir negativos en positivos).

Debes generar un INFORME TÉCNICO (Uso interno para el especialista):
Redacta en párrafos claros, fluidos y profesionales. Títulos en MAYÚSCULAS. NO uses asteriscos ni guiones de markdown.
Estructura:
VALORACIÓN DEL ESTADO EMOCIONAL PROFUNDO
DINÁMICA DE PENSAMIENTO Y PATRONES SUBCONSCIENTES
ESTRATEGIA TERAPÉUTICA PERSONALIZADA (ASIGNACIÓN DE TRATAMIENTOS)
PRONÓSTICO DE EVOLUCIÓN`;

const DEFAULT_CONCLUSION_PROMPT = `Genera una CONCLUSIÓN PARA EL PACIENTE (Uso externo):
Un mensaje cálido, empático y profesional dirigido directamente al paciente (Hola [Nombre]), explicando de forma comprensible lo que hemos detectado y cómo podemos ayudarle con nuestro enfoque, sin usar jerga excesivamente técnica, pero dándole esperanza y un plan claro. NO uses asteriscos ni guiones de markdown.`;

export const CoordinatorDashboard: React.FC<DashboardProps> = ({ profile, fullProfile, onProfileUpdate, onLogout, onEnterEditMode }) => {
  const [patient, setPatient] = useState<Partial<PatientData>>({
    nombre: '', edad: '', sexo: '', observaciones: '', telefono: '', email: ''
  });
  
  const [phonePrefix, setPhonePrefix] = useState('+34');
  const [phoneBody, setPhoneBody] = useState('');

  const [sendMethods, setSendMethods] = useState({
    email: true,
    whatsapp: false,
    sms: false
  });
  const [linkGenerated, setLinkGenerated] = useState<string | null>(null);
  const [registry, setRegistry] = useState<PatientData[]>([]);
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [lastGeneratedPin, setLastGeneratedPin] = useState<string | null>(null);
  const [lastGeneratedPatientId, setLastGeneratedPatientId] = useState<string | null>(null);

  // Estados para Modal de Envío de Email
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailModalData, setEmailModalData] = useState({ patientId: '', to: '', subject: '', body: '' });
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailModalError, setEmailModalError] = useState('');

  // Estados para filtros de fecha
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');

  const [selectedPatientResults, setSelectedPatientResults] = useState<PatientData | null>(null);
  const [selectedPatientConclusion, setSelectedPatientConclusion] = useState<PatientData | null>(null);
  
  const [selectedPatientDetails, setSelectedPatientDetails] = useState<PatientData | null>(null); 
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [tempPatientDetails, setTempPatientDetails] = useState<PatientData | null>(null);

  const [editingConclusion, setEditingConclusion] = useState('');
  const [editingAudio, setEditingAudio] = useState<string | undefined>(undefined);
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState<string | undefined>(undefined);
  
  useEffect(() => {
      if (editingAudio && editingAudio.startsWith('audio_ref_')) {
          DataService.resolveAudioRef(editingAudio).then(res => setResolvedAudioUrl(res || editingAudio));
      } else {
          setResolvedAudioUrl(editingAudio);
      }
  }, [editingAudio]);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<any>(null);
  const [isTestingAI, setIsTestingAI] = useState(false);
  const [globalConfig, setGlobalConfig] = useState<any>(null);
  const [tempConfig, setTempConfig] = useState<any>(null);
  const [showConfirmAccessCode, setShowConfirmAccessCode] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState('');

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showDeletedMode, setShowDeletedMode] = useState(false);
  const [selectedDeletedPatientIds, setSelectedDeletedPatientIds] = useState<string[]>([]);
  
  const toggleDeletedPatientSelection = (id: string) => {
    setSelectedDeletedPatientIds(prev =>
      prev.includes(id)
        ? prev.filter(item => item !== id)
        : [...prev, id]
    );
  };

  const clearDeletedPatientSelection = () => {
    setSelectedDeletedPatientIds([]);
  };

  const handleTestAI = async () => {
    setIsTestingAI(true);
    setAiTestResult(null);
    try {
      const result = await gemini.testConnection();
      setAiTestResult(result);
      triggerToast(result.ok ? "IA conectada correctamente." : "La prueba de IA ha fallado. Revisa el detalle.");
    } catch (e: any) {
      setAiTestResult({
        ok: false,
        errorName: e?.name || "UnexpectedError",
        errorMessage: e?.message || String(e)
      });
      triggerToast("Error inesperado probando IA.");
    } finally {
      setIsTestingAI(false);
    }
  };

  useEffect(() => {
    if (!showDeletedMode) {
      clearDeletedPatientSelection();
    }
  }, [showDeletedMode]);

  // VISTA AMPLIADA DE PACIENTES
  const [showPatientsExpandedView, setShowPatientsExpandedView] = useState(false);
  const [patientsSortDirection, setPatientsSortDirection] = useState<'asc' | 'desc'>('desc');
  const [patientsSortMode, setPatientsSortMode] = useState<
    'lastActivity' | 'alphabetical' | 'dateSent' | 'dateAnswered' | 'dateConclusionSent' | 'status'
  >('lastActivity');

  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicatePatientRecord, setDuplicatePatientRecord] = useState<PatientData | null>(null);
  const [pendingGenerateData, setPendingGenerateData] = useState<any>(null);
  
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

  const [pendingRequestsError, setPendingRequestsError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchPendingRequests = async (user: any) => {
      try {
        if (!user) {
          if (isMounted) setPendingRequests([]);
          return;
        }
        
        let token;
        try {
          token = await user.getIdToken();
        } catch (tokenErr) {
          console.error("Error getting id token:", tokenErr);
          if (isMounted) setPendingRequestsError("No se pudo obtener credencial de sesión");
          return;
        }

        const res = await fetch('/api/patient-requests', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (res.ok) {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const data = await res.json();
            if (isMounted) {
              setPendingRequests(data);
              setPendingRequestsError(null);
            }
          } else {
            const text = await res.text();
            console.warn("Received non-JSON response from /api/patient-requests:", text.substring(0, 300));
            if (isMounted) setPendingRequestsError("Respuesta inválida del servidor");
          }
        } else {
          const text = await res.text();
          console.error("Pending requests auth diagnostic", {
            hasCurrentUser: !!auth.currentUser,
            email: auth.currentUser?.email,
            uid: auth.currentUser?.uid,
            tokenObtained: !!token,
            status: res.status,
            responsePreview: text.substring(0, 300)
          });
          if (isMounted) setPendingRequestsError(`Error ${res.status}: no se pudieron cargar las peticiones`);
        }
      } catch (error) {
        console.error("Error fetching pending requests:", error);
        if (isMounted) setPendingRequestsError("Error de conexión al cargar peticiones");
      }
    };

    const unsubscribe = auth.onAuthStateChanged(user => {
      fetchPendingRequests(user);
    });
    
    // Poll every 5 minutes (300000 ms) para reducir carga
    const interval = setInterval(() => {
      fetchPendingRequests(auth.currentUser);
    }, 300000);

    return () => {
      isMounted = false;
      unsubscribe();
      clearInterval(interval);
    };
  }, []);
  const [showRequestsDropdown, setShowRequestsDropdown] = useState(false);
  const [selectedPendingRequestId, setSelectedPendingRequestId] = useState<string | null>(null);

  const statusLabels: Record<string, string> = {
      'all': 'Todos',
      'pending': 'PENDIENTE',
      'sent': 'ENVIADO',
      'viewed': 'VISTO',
      'completed': 'HECHO',
      'concluded': 'CONCLUIDO',
      'finalized': 'FINALIZADO'
  };

  useEffect(() => {
    // Audit Firestore config on mount
    import('../firebase-applet-config.json').then(config => {
      console.log("[CLIENT FIRESTORE CONFIG]", {
        projectId: config.projectId,
        firestoreDatabaseId: (config as any).firestoreDatabaseId,
        authDomain: config.authDomain
      });
    });

    const loadPatients = async () => {
      try {
        const config = await DataService.getGlobalConfig({
            accessCode: '66099',
            clinicalPrompt: DEFAULT_CLINICAL_PROMPT,
            conclusionPrompt: DEFAULT_CONCLUSION_PROMPT,
            questionnaireMessage: `Hola [Nombre],\n\nAquí tienes tu enlace directo para realizar el Cuestionario Espejo:\n[Link]\n\nIMPORTANTE: Tu clave de acceso personal para ver los resultados finales será: [PIN]\nPor favor, guárdala bien, ya que la necesitarás obligatoriamente más adelante para desbloquear la conclusión.\n\nGracias.`,
            conclusionMessage: `Hola [Nombre],\n\nYa están disponibles tus resultados del Cuestionario Espejo.\n\nPuedes acceder a ellos a través del siguiente enlace:\n[Link]\n\nIMPORTANTE: Se te pedirá la clave personal de acceso que se te entregó al iniciar el cuestionario ([PIN]).`,
            notificationEmails: profile.email
        } as any);
        
        // Migración automática: si el usuario tiene guardados los ejemplos antiguos, los sustituimos por las instrucciones reales
        if (config.clinicalPrompt === INTERNAL_CLINICAL_EXAMPLE) {
            config.clinicalPrompt = DEFAULT_CLINICAL_PROMPT;
        }
        if (config.conclusionPrompt === EXTERNAL_PATIENT_EXAMPLE) {
            config.conclusionPrompt = DEFAULT_CONCLUSION_PROMPT;
        }

        setGlobalConfig(config);
        setTempConfig(config);

        const normalizedEmail = profile.email.toLowerCase();
        console.log("[CLIENT PATIENT QUERY] Fetching patients for coordinator:", normalizedEmail);
        const patients = await DataService.getPatients(normalizedEmail);
        console.log("[CLIENT PATIENT QUERY] Results found:", patients.length);
        
        const sampleId = `sample-martin-${normalizedEmail.replace(/[@.]/g, '-')}`;
        
        let finalPatients = [...patients];
        
        if (!fullProfile?.samplePatientDeleted) {
          const sample: PatientData = {
            id: sampleId,
            nombre: 'Martín ejemplo',
            email: 'martin@ejemplo.com',
            edad: '34',
            sexo: 'Hombre',
            observaciones: 'Registro de ejemplo generado automáticamente. Este perfil muestra cómo se visualiza un paciente con todas las preguntas completadas.',
            telefono: '+34600123456',
            coordinatorEmail: profile.email,
            status: 'completed',
            dateSent: Date.now() + 1000000, // Future date to keep it at the top
            dateAnswered: Date.now() - 3600000,
            dateConclusionSent: Date.now() - 1800000,
            answers: {
                "1": "b", "1.1": "b", "2": "b", "2.2": "c", "3": "b", "3.3": "4",
                "4": "b", "4.4": "b", "5": "c", "6": "b", "7": "d", "8": "c",
                "9": "c", "10": "b", "11": "e", "12": "d"
            },
            conversationSummary: INTERNAL_CLINICAL_EXAMPLE,
            finalConclusion: EXTERNAL_PATIENT_EXAMPLE,
            conclusionViews: 0,
            accessPin: "1234"
          };

          const existingIdx = finalPatients.findIndex(p => p.id === sampleId);
          if (existingIdx === -1) {
            await DataService.savePatient(sample);
            finalPatients = [sample, ...finalPatients];
          } else {
            // Aseguramos que el ejemplo siempre tenga los datos completos y el estado correcto para mostrar los botones
            const existing = finalPatients[existingIdx];
            if (existing.status !== 'completed' && existing.status !== 'concluded' && existing.status !== 'finalized') {
                await DataService.updatePatient(sampleId, sample);
                finalPatients[existingIdx] = sample;
            }
          }
        }
        setRegistry(finalPatients);
      } catch (e) {
        console.error("Error cargando registros", e);
      }
    };
    loadPatients();
  }, [profile.email, fullProfile?.samplePatientDeleted]);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target?.result as string);
            // Ensure data has an ID or generate one
            const requestData = {
                ...data,
                id: data.id || `req-${Date.now()}`,
                timestamp: Date.now()
            };
            setPendingRequests(prev => [...prev, requestData]);
            triggerToast("Petición cargada correctamente");
        } catch (error) {
            console.error("Error parsing JSON:", error);
            triggerToast("Error al leer el archivo JSON");
        }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  const normalizeSexo = (value?: string) => {
      if (!value) return "";
      const normalized = value.toLowerCase().trim();
      if (["hombre", "male", "masculino"].includes(normalized)) return "Hombre";
      if (["mujer", "female", "femenino"].includes(normalized)) return "Mujer";
      if (["prefiero_no_definirme", "no_definido", "no definido", "prefiero no definirme"].includes(normalized)) return "prefiero_no_definirme";
      return "";
  };

  const splitPhone = (rawPhone?: string) => {
      const raw = String(rawPhone || "").trim();
      if (!raw) return { prefix: "+34", body: "" };

      const cleaned = raw.replace(/\s+/g, "");
      if (cleaned.startsWith("+34")) {
          return { prefix: "+34", body: cleaned.slice(3) };
      }

      const internationalMatch = cleaned.match(/^(\+\d{1,3})(\d+)$/);
      if (internationalMatch) {
          return { prefix: internationalMatch[1], body: internationalMatch[2] };
      }

      return { prefix: "+34", body: cleaned.replace(/\D/g, "") };
  };

  const selectPendingRequest = (req: any) => {
      let extraNotes = "";
      
      const pEdad = req.edad ?? req.rawSourcePayload?.edad ?? '';
      const pSexo = req.sexo ?? req.rawSourcePayload?.sexo ?? '';
      const pTelefono = req.telefono ?? req.rawSourcePayload?.telefono ?? '';
      const pChannels = req.preferredChannels ?? req.rawSourcePayload?.preferredChannels ?? null;
      const pAccessCode = req.proposedAccessCode ?? req.rawSourcePayload?.proposedAccessCode ?? undefined;

      if (req.source === "soybienestar") {
          extraNotes = "Solicitud recibida desde SoyBienestar. Contiene contexto previo de consulta guiada.\n";
          
          if (pChannels) {
              extraNotes += "Canal preferido solicitado:\n";
              extraNotes += `- Email: ${pChannels.email ? 'sí' : 'no'}\n`;
              extraNotes += `- WhatsApp: ${pChannels.whatsapp ? 'sí' : 'no'}\n`;
              extraNotes += `- SMS: ${pChannels.sms ? 'sí' : 'no'}\n`;
          }
          extraNotes += "\n";
      }

      setPatient({
          nombre: req.nombre || req.displayName || '',
          email: req.email || '',
          edad: pEdad ? String(pEdad) : '',
          sexo: normalizeSexo(pSexo),
          observaciones: extraNotes + (req.observaciones || req.notes || ''),
          telefono: pTelefono || '',
          source: req.source || "manual",
          sourceRequestId: req.id,
          soybienestarUid: req.soybienestarUid || null,
          soybienestarContext: req.soybienestarContext || null,
          proposedAccessCode: pAccessCode,
          preferredChannels: pChannels
      } as any);
      
      const phoneParts = splitPhone(pTelefono);
      setPhonePrefix(phoneParts.prefix);
      setPhoneBody(phoneParts.body);

      if (pChannels) {
          setSendMethods({
              email: !!pChannels.email,
              whatsapp: !!pChannels.whatsapp,
              sms: !!pChannels.sms
          });
      } else {
          setSendMethods({
              email: true,
              whatsapp: false,
              sms: false
          });
      }

      setSelectedPendingRequestId(req.id);
      setShowRequestsDropdown(false);
  };

  const deletePendingRequest = async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      try {
          const user = auth.currentUser;
          if (user) {
              const token = await user.getIdToken();
              await fetch(`/api/patient-requests/${id}`, { 
                  method: 'DELETE',
                  headers: { 'Authorization': `Bearer ${token}` }
              });
              setPendingRequests(prev => prev.filter(r => r.id !== id));
          }
      } catch (error) {
          console.error("Error deleting request:", error);
      }
  };

  const deleteRecord = async (id: string, previousStatus: string) => {
    if (!window.confirm("¿Estás seguro/a de que deseas enviar esta ficha a la papelera?\n\nNo se eliminará definitivamente. Podrás recuperarla desde Fichas borradas.")) return;
    
    const previousRegistry = registry;
    // Optimistic update
    const updated = registry.map(r => r.id === id ? { ...r, deletedAt: Date.now(), status: 'deleted' as const } : r);
    setRegistry(updated);
    try {
      console.log("[SOFT DELETE] starting", { id, previousStatus });
      await DataService.softDeletePatient(id, profile.email || fullProfile.email || "coordinator", previousStatus);
      console.log("[SOFT DELETE] success", { id });
      
      // Si es el paciente de ejemplo, marcamos en el perfil que ha sido borrado
      const sampleId = `sample-martin-${profile.email.replace(/[@.]/g, '-')}`;
      if (id === sampleId) {
          const update = { samplePatientDeleted: true };
          await DataService.updateUser(profile.email, update);
          onProfileUpdate(update);
      }
      
      triggerToast("Ficha enviada a la papelera. Puedes recuperarla desde Fichas borradas.");
    } catch (e) {
      console.error("[SOFT DELETE] failed", e);
      triggerToast("No se pudo enviar la ficha a la papelera. Revisa permisos o endpoint backend.");
      setRegistry(previousRegistry); // Revert optimistic update
    }
  };

  const restoreRecord = async (id: string) => {
      const record = registry.find(r => r.id === id);
      if (!record) return;
      
      setSelectedDeletedPatientIds(prev => prev.filter(item => item !== id));

      const previousRegistry = registry;
      const restoredStatus = record.previousStatusBeforeDelete || 'sent';
      const updated = registry.map(r => r.id === id ? { ...r, status: restoredStatus as any, deletedAt: null } : r);
      setRegistry(updated);
      try {
          await DataService.restorePatient(id, profile.email || fullProfile.email || "coordinator", restoredStatus);
          triggerToast("Ficha restaurada correctamente.");
      } catch (e) {
          console.error("Error restoring patient", e);
          triggerToast("Error al restaurar el registro");
          setRegistry(previousRegistry); // Revert optimistic update
      }
  };

  const permanentlyDeleteSelectedPatients = async () => {
    if (!showDeletedMode) return;
    if (selectedDeletedPatientIds.length === 0) return;

    const selectedRecords = registry.filter(r =>
      selectedDeletedPatientIds.includes(r.id) && r.status === 'deleted'
    );

    if (selectedRecords.length === 0) {
      triggerToast("No hay fichas borradas seleccionadas.");
      clearDeletedPatientSelection();
      return;
    }

    const confirmText = `Vas a eliminar definitivamente ${selectedRecords.length} ficha(s) de paciente.\n\nEsta acción no se puede deshacer.\n\n¿Deseas continuar?`;

    if (!window.confirm(confirmText)) return;

    const secondConfirm = window.confirm("Confirmación final: los datos seleccionados se borrarán definitivamente de la base de datos. ¿Confirmas el borrado permanente?");
    if (!secondConfirm) return;

    const previousRegistry = registry;

    try {
      await Promise.all(
        selectedRecords.map(record => DataService.permanentlyDeletePatient(record.id))
      );

      setRegistry(prev => prev.filter(r => !selectedRecords.some(deleted => deleted.id === r.id)));
      clearDeletedPatientSelection();
      triggerToast(`${selectedRecords.length} ficha(s) eliminada(s) definitivamente.`);
    } catch (e) {
      console.error("[PERMANENT DELETE] failed", e);
      setRegistry(previousRegistry);
      triggerToast("No se pudieron eliminar definitivamente las fichas seleccionadas. Revisa permisos o consola.");
    }
  };

  const changeStatus = async (id: string, direction: 'forward' | 'backward') => {
    const statusOrder: PatientData['status'][] = ['pending', 'sent', 'viewed', 'completed', 'concluded', 'finalized'];
    
    let newStatus: PatientData['status'] | null = null;
    
    const updated = registry.map(r => {
      if (r.id === id) {
        const currentIndex = statusOrder.indexOf(r.status);
        if (direction === 'forward' && currentIndex < statusOrder.length - 1) {
            newStatus = statusOrder[currentIndex + 1];
            return { ...r, status: newStatus };
        } else if (direction === 'backward' && currentIndex > 0) {
            newStatus = statusOrder[currentIndex - 1];
            return { ...r, status: newStatus };
        }
      }
      return r;
    });
    
    if (newStatus) {
        setRegistry(updated);
        try {
          await DataService.updatePatient(id, { status: newStatus });
        } catch (e) {
          console.error("Error al actualizar el estado", e);
        }
    }
  };

  const handleGenerateAndSend = async (isResend: boolean = false, forceAction?: 'replace' | 'new' | 'resend') => {
    if (!patient.nombre || !patient.email) {
      triggerToast("Nombre y Email son requeridos.");
      return;
    }
    if (isGenerating) return;
    
    setIsGenerating(true);
    const fullPhone = phoneBody ? `${phonePrefix}${phoneBody}`.trim() : '';
    const now = Date.now();
    
    const normalizedName = patient.nombre.trim().toLowerCase();
    const existingRecordsWithName = registry.filter(r => r.nombre.trim().toLowerCase() === normalizedName);
    let existingRecord = existingRecordsWithName.length > 0 ? existingRecordsWithName[0] : null;
    
    if (existingRecord && !forceAction) {
        const emailMatches = existingRecord.email.trim().toLowerCase() === patient.email.trim().toLowerCase();
        const phoneMatches = (existingRecord.telefono || '') === fullPhone;
        
        if (emailMatches && phoneMatches) {
            // EXACT MATCH
            setDuplicatePatientRecord(existingRecord);
            setPendingGenerateData({ isResend, fullPhone, now, matchType: 'exact' });
            setShowDuplicateModal(true);
            setIsGenerating(false);
            return;
        } else if (!isResend) {
            // PARTIAL MATCH (Same name, different contact) - Only if not resending
            setDuplicatePatientRecord(existingRecord);
            setPendingGenerateData({ isResend, fullPhone, now, matchType: 'partial' });
            setShowDuplicateModal(true);
            setIsGenerating(false);
            return;
        }
    }
    
    const pendingWindows: {
      whatsapp?: Window | null;
      sms?: Window | null;
    } = {};

    if (sendMethods.whatsapp && fullPhone) {
      pendingWindows.whatsapp = window.open('', '_blank');
    }

    if (sendMethods.sms && fullPhone) {
      pendingWindows.sms = window.open('', '_blank');
    }

    let finalName = patient.nombre.trim();
    let sessionToken = '';
    let dbPatientId = '';
    let accessPin = '';
    let isNewRecord = false;
    
    if (forceAction === 'new') {
        const baseName = patient.nombre.trim();
        let copyNum = 1;
        while (registry.some(r => r.nombre === `${baseName}(${copyNum})` || r.nombre === `${baseName} (${copyNum})`)) {
            copyNum++;
        }
        finalName = `${baseName}(${copyNum})`;
        isNewRecord = true;
    } else if (forceAction === 'replace') {
        existingRecord = duplicatePatientRecord;
        finalName = patient.nombre.trim();
        isNewRecord = true; // We want a NEW link/ID
    } else if (forceAction === 'resend') {
        existingRecord = duplicatePatientRecord;
        finalName = existingRecord!.nombre;
        isNewRecord = false; // Keep same ID/link
    } else {
        if (existingRecord) {
            isNewRecord = false;
        } else {
            isNewRecord = true;
        }
    }
    
    const proposedAccessCode =
      patient.proposedAccessCode ||
      (patient as any).rawSourcePayload?.proposedAccessCode ||
      "";

    const validProposed = proposedAccessCode && isValidNewAccessCode(proposedAccessCode) 
      ? normalizeAccessCode(proposedAccessCode) 
      : null;

    let previousAccessPin: string | undefined;
    let accessPinMigratedAt: number | undefined;

    if (isNewRecord) {
        accessPin = validProposed || generateAccessCode(4);
        dbPatientId = `patient_${now}_${Math.random().toString(36).slice(2, 8)}`;
        const payload = { 
          id: dbPatientId,
          nombre: finalName, 
          email: patient.email,
          telefono: fullPhone, 
          edad: patient.edad, 
          sexo: patient.sexo, 
          coordinatorEmail: profile.email,
          timestamp: now
        };
        sessionToken = safeBtoa(JSON.stringify(payload));
    } else {
        const existingValidPin = existingRecord!.accessPin && isValidNewAccessCode(existingRecord!.accessPin)
          ? normalizeAccessCode(existingRecord!.accessPin)
          : null;

        if (!existingValidPin && existingRecord!.accessPin) {
            previousAccessPin = normalizeAccessCode(existingRecord!.accessPin);
            accessPinMigratedAt = now;
        }

        accessPin = existingValidPin || validProposed || generateAccessCode(4);
        dbPatientId = existingRecord!.id;
        const payload = { 
          id: dbPatientId,
          nombre: finalName, 
          email: patient.email,
          telefono: fullPhone, 
          edad: patient.edad, 
          sexo: patient.sexo, 
          coordinatorEmail: profile.email,
          timestamp: now
        };
        sessionToken = safeBtoa(JSON.stringify(payload));
    }
    
    setLastGeneratedPin(accessPin);
    setLastGeneratedPatientId(dbPatientId);

    try {
        const baseUrl = window.location.origin + window.location.pathname;
        const url = `${baseUrl}#/session?p=${sessionToken}`;
        
        setLinkGenerated(url);
        
        let body = globalConfig?.questionnaireMessage || `Hola [Nombre],\n\nAquí tienes tu enlace directo para realizar el Cuestionario Espejo:\n[Link]\n\nIMPORTANTE: Tu clave de acceso personal para ver los resultados finales será: [PIN]\nPor favor, guárdala bien, ya que la necesitarás obligatoriamente más adelante para desbloquear la conclusión.\n\nGracias.`;
        
        body = body.replace(/\[Nombre\]/g, finalName.split(' ')[0])
                   .replace(/\[Link\]/g, url)
                   .replace(/\[PIN\]/g, accessPin.toUpperCase());

        if (isNewRecord) {
            // If we are replacing, delete the old record first (soft delete)
            if (forceAction === 'replace' && existingRecord) {
                await DataService.softDeletePatient(existingRecord.id, profile.email || "coordinator", existingRecord.status);
                setRegistry(prev => prev.filter(r => r.id !== existingRecord!.id));
            }

            const newRecord: PatientData = { 
              ...patient as PatientData, 
              nombre: finalName,
              telefono: fullPhone,
              id: dbPatientId, 
              coordinatorEmail: profile.email,
              status: 'sent', 
              dateSent: now,
              accessPin: accessPin,
              proposedAccessCode: proposedAccessCode || undefined,
              accessCodeFormat: "v2_4_alphanumeric" as const
            };
            
            setRegistry(prev => [...prev, newRecord]);
            await DataService.savePatient(newRecord);
        } else {
            const updatedRecord = { 
                ...existingRecord!, 
                dateSent: now, 
                status: 'sent' as const,
                email: patient.email,
                telefono: fullPhone,
                edad: patient.edad,
                sexo: patient.sexo,
                accessPin: accessPin,
                proposedAccessCode: proposedAccessCode || existingRecord!.proposedAccessCode,
                accessCodeFormat: "v2_4_alphanumeric" as const,
                ...(previousAccessPin && { previousAccessPin, accessPinMigratedAt }),
                source: patient.source || existingRecord!.source,
                sourceRequestId: patient.sourceRequestId || existingRecord!.sourceRequestId,
                soybienestarUid: patient.soybienestarUid || existingRecord!.soybienestarUid,
                soybienestarContext: patient.soybienestarContext || existingRecord!.soybienestarContext,
                preferredChannels: patient.preferredChannels || existingRecord!.preferredChannels
            };
            setRegistry(prev => prev.map(r => r.id === dbPatientId ? updatedRecord : r));
            await DataService.updatePatient(dbPatientId, { 
                dateSent: now, 
                status: 'sent',
                email: patient.email,
                telefono: fullPhone,
                edad: patient.edad,
                sexo: patient.sexo,
                accessPin: accessPin,
                proposedAccessCode: proposedAccessCode || existingRecord!.proposedAccessCode,
                ...(previousAccessPin && { previousAccessPin, accessPinMigratedAt }),
                source: patient.source || existingRecord!.source,
                sourceRequestId: patient.sourceRequestId || existingRecord!.sourceRequestId,
                soybienestarUid: patient.soybienestarUid || existingRecord!.soybienestarUid,
                soybienestarContext: patient.soybienestarContext || existingRecord!.soybienestarContext,
                preferredChannels: patient.preferredChannels || existingRecord!.preferredChannels
            });
        }

        let subject = isResend ? "Actualización Importante: Cuestionario Espejo" : "Tu enlace para el Cuestionario Espejo";
        
        const smsBody = `Hola ${finalName.split(' ')[0]}, enlace: ${url} . CLAVE DE ACCESO: ${accessPin.toUpperCase()} (Guárdala).`;

        if (sendMethods.email) {
            setEmailModalData({
                patientId: dbPatientId,
                to: patient.email || '',
                subject,
                body
            });
            setShowEmailModal(true);
        }

        if (sendMethods.whatsapp && fullPhone) {
            openWhatsAppComposer(fullPhone, body, pendingWindows.whatsapp);
        }

        if (sendMethods.sms && fullPhone) {
            openSmsComposer(fullPhone, smsBody, pendingWindows.sms);
        }

        if (isMobileDevice()) {
            navigator.clipboard.writeText(body).catch(() => {});
        }

        if (selectedPendingRequestId) {
            setPendingRequests(prev => prev.filter(r => r.id !== selectedPendingRequestId));
            try {
                const user = auth.currentUser;
                if (user) {
                    const token = await user.getIdToken();
                    await fetch(`/api/patient-requests/${selectedPendingRequestId}`, { 
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                }
            } catch (delErr) {
                console.error("Error al marcar como procesada la petición", delErr);
            }
            setSelectedPendingRequestId(null);
        }

        triggerToast(isResend ? "Cuestionario reenviado con PIN" : `Enlace generado. PIN: ${accessPin.toUpperCase()}`);
    } catch (e) {
        console.error(e);
        triggerToast("Error al generar el enlace");
    } finally {
        setIsGenerating(false);
        setShowDuplicateModal(false);
    }
  };

  const handleSendEmailInternal = async () => {
      setIsSendingEmail(true);
      setEmailModalError('');
      
      try {
          const user = auth.currentUser;
          if (!user) throw new Error("No autenticado");
          
          const token = await user.getIdToken();
          
          const res = await fetch("/api/send-questionnaire-email", {
              method: 'POST',
              headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}` 
              },
              body: JSON.stringify({
                  patientId: emailModalData.patientId,
                  to: emailModalData.to,
                  subject: emailModalData.subject,
                  body: emailModalData.body
              })
          });
          
          const data = await res.json();
          if (!res.ok) {
              throw new Error(data.error || "Error al enviar el email");
          }
          
          // Actualizar el local registry
          setRegistry(prev => prev.map(p => {
              if (p.id === emailModalData.patientId) {
                  return {
                      ...p,
                      status: 'sent',
                      dateSent: data.updatedFields?.dateSent || Date.now(),
                      lastQuestionnaireEmailSentAt: data.updatedFields?.lastQuestionnaireEmailSentAt || Date.now(),
                      lastQuestionnaireEmailSentTo: emailModalData.to,
                      lastQuestionnaireEmailSubject: emailModalData.subject,
                      lastQuestionnaireEmailStatus: 'sent'
                  };
              }
              return p;
          }));
          
          setShowEmailModal(false);
          triggerToast("Correo enviado correctamente");
          
      } catch (err: any) {
          console.error("Error sending email:", err);
          setEmailModalError(err.message || "Ocurrió un error al enviar el correo.");
      } finally {
          setIsSendingEmail(false);
      }
  };

  const handleResendFromDetails = () => {
      if (!selectedPatientDetails) return;
      
      const p = selectedPatientDetails;
      setPatient({
          nombre: p.nombre,
          email: p.email,
          edad: p.edad,
          sexo: p.sexo,
          telefono: p.telefono,
          observaciones: p.observaciones
      });
      
      if (p.telefono && p.telefono.length > 3) {
          setPhonePrefix(p.telefono.substring(0, 3));
          setPhoneBody(p.telefono.substring(3));
      }

      setSelectedPatientDetails(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => handleGenerateAndSend(true), 500);
  };

  const openResultsModal = (p: PatientData) => {
    setSelectedPatientResults(p);
  };

  const openConclusionModal = (p: PatientData) => {
    setSelectedPatientConclusion(p);
    setEditingConclusion(p.finalConclusion || "");
    setEditingAudio(p.audioConclusion);
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          if (file.size > 1572864) {
              triggerToast("El archivo de audio es demasiado grande. Por favor, usa un clip corto o comprimido (Max 1.5MB).");
              return;
          }
          const reader = new FileReader();
          reader.onload = (ev) => {
              setEditingAudio(ev.target?.result as string);
          };
          reader.readAsDataURL(file);
      }
  };

  const notifySoyBienestarDossierReady = async (patient: PatientData) => {
    if (patient.source !== "soybienestar" && !patient.soybienestarUid && !patient.sourceRequestId) return;
    if (!patient.finalConclusion) return;
    if (patient.status !== "concluded" && patient.status !== "finalized") return;
    try {
      const res = await fetch('/api/notify-soybienestar-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ patientId: patient.id, event: 'dossier_available' })
      });
      if (res.ok) {
        const data = await res.json();
        const syncStatus = data.success ? "ok" : (data.note === "Webhook not configured" ? "skipped" : "error");
        await DataService.updatePatient(patient.id, {
          lastSoyBienestarDossierSyncAt: Date.now(),
          lastSoyBienestarDossierSyncStatus: syncStatus
        });
      } else {
        console.error("Failed to notify dossier readiness, status:", res.status);
        await DataService.updatePatient(patient.id, {
          lastSoyBienestarDossierSyncAt: Date.now(),
          lastSoyBienestarDossierSyncStatus: "error"
        });
      }
    } catch (e) {
      console.error("Error notifying dossier readiness:", e);
      await DataService.updatePatient(patient.id, {
        lastSoyBienestarDossierSyncAt: Date.now(),
        lastSoyBienestarDossierSyncStatus: "error"
      });
    }
  };

  const handleSaveConclusion = async () => {
    if (!selectedPatientConclusion) return;
    const now = Date.now();
    const updatedPatient: PatientData = { 
        ...selectedPatientConclusion, 
        finalConclusion: editingConclusion,
        audioConclusion: editingAudio,
        dateConclusionSent: now,
        status: selectedPatientConclusion.status === "finalized" ? "finalized" : "concluded"
    };
    setRegistry(registry.map(r => r.id === updatedPatient.id ? updatedPatient : r));
    await DataService.updatePatient(updatedPatient.id, { 
        finalConclusion: editingConclusion, 
        audioConclusion: editingAudio || null,
        dateConclusionSent: now,
        status: updatedPatient.status
    });
    setSelectedPatientConclusion(updatedPatient);
    triggerToast("Conclusión y audio guardados correctamente");
    
    const isSoyBienestarPatient = updatedPatient.source === "soybienestar" || !!updatedPatient.soybienestarUid || !!updatedPatient.sourceRequestId;
    if (isSoyBienestarPatient) {
      await notifySoyBienestarDossierReady(updatedPatient);
    }
  };

  const handleEditDetails = () => {
      if (selectedPatientDetails) {
          const detailsToEdit = { ...selectedPatientDetails };
          if (detailsToEdit.conversationSummary) {
              detailsToEdit.conversationSummary = normalizeGeneratedClinicalReport(detailsToEdit.conversationSummary, globalConfig?.clinicalPrompt);
          }
          setTempPatientDetails(detailsToEdit);
          setIsEditingDetails(true);
      }
  };

  const handleCancelEditDetails = () => {
      setIsEditingDetails(false);
      setTempPatientDetails(null);
  };

  const handleSaveDetails = async () => {
      if (!tempPatientDetails) return;
      setRegistry(registry.map(r => r.id === tempPatientDetails.id ? tempPatientDetails : r));
      await DataService.updatePatient(tempPatientDetails.id, tempPatientDetails);
      setSelectedPatientDetails(tempPatientDetails);
      setIsEditingDetails(false);
      triggerToast("Ficha actualizada correctamente");
  };

  const getConclusionUrlAndBody = (p: PatientData) => {
    let baseUrl = globalConfig?.conclusionBaseUrl;
    if (baseUrl && !baseUrl.endsWith('/')) {
        baseUrl += '/';
    }
    const url = baseUrl ? `${baseUrl}#/conclusion?id=${encodeURIComponent(p.id)}` : `${window.location.origin + window.location.pathname}#/conclusion?id=${encodeURIComponent(p.id)}`;
    
    let body = globalConfig?.conclusionMessage || `Hola [Nombre],\n\nYa están disponibles tus resultados del Cuestionario Espejo.\n\nPuedes acceder a ellos a través del siguiente enlace:\n[Link]\n\nIMPORTANTE: Se te pedirá la clave personal de acceso que se te entregó al iniciar el cuestionario ([PIN]).`;
    
    body = body.replace(/\[Nombre\]/g, p.nombre.split(' ')[0])
               .replace(/\[Link\]/g, url)
               .replace(/\[PIN\]/g, p.accessPin ? p.accessPin.toUpperCase() : 'Consulta con tu coordinador');

    if (p.source === "soybienestar" || p.soybienestarUid) {
        body = `Hola ${p.nombre.split(' ')[0]},\n\nYa están disponibles tus resultados del Cuestionario Espejo.\n\nPuedes acceder a tus resultados desde el espacio personalizado de SoyBienestar cuando el equipo los active.\n\nGracias.`;
    }
               
    return { url, body };
  };

  const markAsConcluded = (id: string) => {
      const now = Date.now();
      setRegistry(registry.map(r => {
        if (r.id === id) {
            const updated = { ...r, status: 'concluded' as const, dateConclusionSent: now, conclusionViews: 0 };
            DataService.updatePatient(id, { status: 'concluded', dateConclusionSent: now, conclusionViews: 0 });
            notifySoyBienestarDossierReady(updated);
            return updated;
        }
        return r;
      }));
  };

  const handleSendConclusionLink = () => {
    if (!selectedPatientConclusion) return;
    const { url, body } = getConclusionUrlAndBody(selectedPatientConclusion);
    const subject = "Resultados y Conclusión - Cuestionario Espejo";
    
    openEmailComposer(selectedPatientConclusion.email || '', subject, body, null);
    
    markAsConcluded(selectedPatientConclusion.id);
    triggerToast("Gmail abierto y estado actualizado a Concluido");
  };

  const handleSendConclusionWhatsApp = () => {
    if (!selectedPatientConclusion || !selectedPatientConclusion.telefono) {
      triggerToast("El paciente no tiene teléfono registrado.");
      return;
    }
    const { body } = getConclusionUrlAndBody(selectedPatientConclusion);
    openWhatsAppComposer(selectedPatientConclusion.telefono, body, null);
    
    markAsConcluded(selectedPatientConclusion.id);
    triggerToast("WhatsApp abierto y estado actualizado a Concluido");
  };

  const handlePrintConclusion = () => {
    if (!selectedPatientConclusion) return;
    const p = selectedPatientConclusion;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      triggerToast("Por favor, permite las ventanas emergentes.");
      return;
    }

    const hasAudio = !!editingAudio;

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Conclusión Terapéutica - ${p.nombre}</title>
            <style>
                body { font-family: 'Helvetica', 'Arial', sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
                .header { border-bottom: 3px solid #7c3aed; padding-bottom: 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
                .logo-text { font-size: 28px; font-weight: bold; color: #1e3a8a; }
                .logo-sub { font-size: 14px; text-transform: uppercase; letter-spacing: 3px; color: #2563eb; }
                .section { margin-bottom: 30px; }
                .section-title { font-size: 14px; font-weight: 800; text-transform: uppercase; color: #64748b; letter-spacing: 1px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px; }
                .patient-data-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 10px; }
                .label { font-size: 9px; font-weight: bold; color: #94a3b8; text-transform: uppercase; margin-bottom: 2px; display: block; }
                .value { font-size: 13px; font-weight: bold; color: #0f172a; }
                .conclusion-box { background: #fdfaff; border: 1px solid #e9d5ff; padding: 25px; border-radius: 12px; white-space: pre-wrap; font-size: 14px; color: #4b5563; text-align: justify; }
                .audio-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 9px; font-weight: bold; }
                .audio-yes { background: #dcfce7; color: #166534; }
                .audio-no { background: #fee2e2; color: #991b1b; }
                .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px; text-align: center; font-size: 10px; color: #94a3b8; }
                @media print {
                    @page { margin: 0; }
                    body { margin: 1.6cm; padding: 0; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div class="logo-text">Cuestionario Espejo</div>
                    <div class="logo-sub">Naveguemos Juntos</div>
                </div>
                <div style="text-align: right; font-size: 12px; color: #64748b;">
                    CONCLUSIÓN TERAPÉUTICA
                </div>
            </div>

            <div class="section">
                <div class="section-title">Datos del Paciente</div>
                <div class="patient-data-grid">
                    <div>
                        <span class="label">Nombre Completo</span>
                        <span class="value">${p.nombre}</span>
                    </div>
                    <div>
                        <span class="label">Edad y Sexo</span>
                        <span class="value">${p.edad} años / ${p.sexo}</span>
                    </div>
                    <div>
                        <span class="label">Teléfono</span>
                        <span class="value">${p.telefono || 'N/A'}</span>
                    </div>
                </div>
                <div class="patient-data-grid">
                    <div>
                        <span class="label">Email</span>
                        <span class="value">${p.email}</span>
                    </div>
                    <div>
                        <span class="label">Clave de Acceso a la Conclusión</span>
                        <span class="value">${p.accessPin ? p.accessPin.toUpperCase() : 'N/A'}</span>
                    </div>
                    <div>
                        <span class="label">Audio Incluido</span>
                        <div class="audio-badge ${hasAudio ? 'audio-yes' : 'audio-no'}">
                            ${hasAudio ? 'SÍ, INCLUIDO' : 'NO INCLUIDO'}
                        </div>
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Informe de Conclusión</div>
                <div class="conclusion-box">${editingConclusion}</div>
            </div>
            
            <div class="footer">Impreso el: ${new Date().toLocaleDateString()}</div>
            <script>setTimeout(() => { window.print(); }, 500);</script>
        </body>
        </html>
    `;
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const downloadJSON = () => {
    if (!selectedPatientResults) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(selectedPatientResults, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `resultados_${selectedPatientResults.nombre.replace(/\s+/g, '_')}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handlePrintPatientFile = () => {
    if (!selectedPatientDetails) return;
    const p = selectedPatientDetails;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      triggerToast("Por favor, permite las ventanas emergentes.");
      return;
    }

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Ficha Clínica - ${p.nombre}</title>
            <style>
                body { font-family: 'Helvetica', 'Arial', sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
                .header { border-bottom: 3px solid #1e3a8a; padding-bottom: 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
                .logo-text { font-size: 28px; font-weight: bold; color: #1e3a8a; }
                .logo-sub { font-size: 14px; text-transform: uppercase; letter-spacing: 3px; color: #2563eb; }
                .section { margin-bottom: 30px; }
                .section-title { font-size: 14px; font-weight: 800; text-transform: uppercase; color: #64748b; letter-spacing: 1px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 20px; }
                .patient-data-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                .patient-data-table td { vertical-align: top; padding-right: 20px; padding-bottom: 20px; }
                .label { font-size: 10px; font-weight: bold; color: #94a3b8; text-transform: uppercase; margin-bottom: 5px; display: block; }
                .value { font-size: 14px; font-weight: bold; color: #0f172a; line-height: 1.4; word-break: break-word; }
                .observations-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 10px; font-style: italic; }
                .clinical-report { background: #f0f7ff; border-left: 5px solid #2563eb; padding: 30px; border-radius: 0 10px 10px 0; font-size: 14px; line-height: 1.8; text-align: justify; margin-top: 10px; }
                .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center; font-size: 10px; color: #94a3b8; }
                h4, h5 { page-break-after: avoid; break-after: avoid; }
                p { orphans: 4; widows: 4; }
                .print-section-block { page-break-inside: avoid; break-inside: avoid; }
                @media print {
                    .clinical-report { margin-top: 10px; }
                    .section { margin-bottom: 20px; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div class="logo-text">Cuestionario Espejo</div>
                    <div class="logo-sub">Naveguemos Juntos</div>
                </div>
                <div style="text-align: right; font-size: 12px; color: #64748b;">
                    EXPEDIENTE CLÍNICO<br>
                    ${new Date().toLocaleDateString()}
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">Datos del Paciente</div>
                <table class="patient-data-table">
                    <tr>
                        <td style="width: 33%;">
                            <span class="label">Nombre</span>
                            <span class="value">${p.nombre}</span>
                        </td>
                        <td style="width: 33%;">
                            <span class="label">Edad y Sexo</span>
                            <span class="value">${p.edad} años / ${p.sexo}</span>
                        </td>
                        <td style="width: 34%;">
                            <span class="label">Teléfono</span>
                            <span class="value">${p.telefono || 'N/A'}</span>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="2">
                            <span class="label">Email</span>
                            <span class="value">${p.email}</span>
                        </td>
                        <td>
                            <span class="label">Estado Actual</span>
                            <span class="value" style="text-transform: uppercase; color: #2563eb;">${p.status}</span>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <span class="label">Fecha de Alta</span>
                            <span class="value">${formatDate(p.dateSent)}</span>
                        </td>
                        <td>
                            <span class="label">Fecha Respuesta</span>
                            <span class="value">${formatDate(p.dateAnswered)}</span>
                        </td>
                        <td>
                             <span class="label">PIN ACCESO CONCLUSIÓN</span>
                             <span class="value" style="color: #2563eb;">${p.accessPin ? p.accessPin.toUpperCase() : 'N/A'}</span>
                        </td>
                    </tr>
                </table>
            </div>

            <div class="section">
                <div class="section-title">Observaciones Iniciales</div>
                <div class="observations-box">${getInitialObservationsForDisplay(p)}</div>
            </div>
            
            <div class="section">
                <div class="section-title">Valoración Clínica / Coaching (Uso Interno)</div>
                <div class="clinical-report">
                    ${p.conversationSummary ? 
                        (() => {
                            const blocks = formatGeneratedReportForDisplay(p.conversationSummary, globalConfig?.clinicalPrompt);
                            let outHtml = '';
                            let i = 0;
                            while (i < blocks.length) {
                                const block = blocks[i];
                                if (block.isTitle || block.isSubTitle) {
                                    let groupHtml = '';
                                    if (block.isTitle) {
                                        groupHtml += '<h4 style="font-size: 14px; font-weight: 800; text-transform: uppercase; color: #1e3a8a; border-bottom: 1px solid #1e3a8a; padding-bottom: 4px; margin-top: 22px; margin-bottom: 12px; page-break-after: avoid; break-after: avoid;">' + escapeHtml(block.text) + '</h4>';
                                    } else {
                                        groupHtml += '<h5 style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #92400e; margin-top: 16px; margin-bottom: 6px; page-break-after: avoid; break-after: avoid;">' + escapeHtml(block.text) + '</h5>';
                                    }
                                    
                                    if (i + 1 < blocks.length && !blocks[i+1].isTitle && !blocks[i+1].isSubTitle) {
                                        i++;
                                        groupHtml += '<p style="margin-bottom: 12px; white-space: pre-line; orphans: 4; widows: 4;">' + escapeHtml(blocks[i].text) + '</p>';
                                    }
                                    
                                    outHtml += '<div class="print-section-block" style="page-break-inside: avoid; break-inside: avoid;">' + groupHtml + '</div>';
                                } else {
                                    outHtml += '<p style="margin-bottom: 12px; white-space: pre-line; orphans: 4; widows: 4;">' + escapeHtml(block.text) + '</p>';
                                }
                                i++;
                            }
                            return outHtml;
                        })()
                    : (p.source === 'soybienestar' || p.directAccessCreated || p.soybienestarUid || p.sourceRequestId || (p as any).soybienestarContext || (p as any).preInformeSoyBienestar) ? 
                        '<div style="white-space: pre-line;">' + escapeHtml(buildSoyBienestarClinicalSummary(p)) + '</div>'
                    : "Pendiente de valoración técnica."}
                </div>
            </div>
            
            <div class="footer">Este documento es privado y contiene información sensible. Uso exclusivo profesional.</div>
            <script>setTimeout(() => { window.print(); }, 500);</script>
        </body>
        </html>
    `;
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handlePrintPatientResults = () => {
    if (!selectedPatientResults) return;
    const p = selectedPatientResults;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      triggerToast("Por favor, permite las ventanas emergentes.");
      return;
    }

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Resultados Cuestionario - ${p.nombre}</title>
            <style>
                body { font-family: 'Helvetica', 'Arial', sans-serif; padding: 40px; color: #1e293b; line-height: 1.5; }
                .header { border-bottom: 2px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; }
                .logo-text { font-size: 24px; font-weight: bold; color: #1e3a8a; }
                .patient-info { margin-bottom: 30px; background: #f1f5f9; padding: 20px; border-radius: 8px; display: grid; grid-template-cols: 1fr 1fr; gap: 10px; }
                .info-item { font-size: 13px; }
                .info-label { font-weight: bold; color: #64748b; margin-right: 5px; }
                .question-block { margin-bottom: 25px; page-break-inside: avoid; border-left: 3px solid #e2e8f0; padding-left: 15px; }
                .question-text { font-weight: bold; font-size: 14px; color: #0f172a; margin-bottom: 8px; }
                .answer-box { background: #eff6ff; padding: 10px 15px; border-radius: 4px; font-style: italic; color: #1e40af; border: 1px solid #dbeafe; }
                .footer { margin-top: 50px; text-align: center; font-size: 10px; color: #94a3b8; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo-text">Resultados Cuestionario Espejo</div>
                <div style="font-size: 12px; color: #2563eb; text-transform: uppercase; letter-spacing: 2px;">Naveguemos Juntos</div>
            </div>
            <div class="patient-info">
                <div class="info-item"><span class="info-label">Paciente:</span> ${p.nombre}</div>
                <div class="info-item"><span class="info-label">Fecha:</span> ${formatDate(p.dateAnswered)}</div>
                <div class="info-item"><span class="info-label">Edad / Sexo:</span> ${p.edad} / ${p.sexo}</div>
                <div class="info-item"><span class="info-label">Email:</span> ${p.email}</div>
            </div>
            <div class="content">
                ${QUESTIONS.map((q, idx) => {
                    const answerKey = p.answers?.[q.id];
                    const selectedOption = q.options.find(opt => opt.key === answerKey);
                    const answerText = q.isScale ? (answerKey || "N/A") : (selectedOption ? `${selectedOption.key.toUpperCase()}) ${selectedOption.text}` : "N/A");
                    return `
                        <div class="question-block">
                            <div class="question-text">${idx + 1}. ${q.scenario}</div>
                            <div class="answer-box">Respuesta: ${answerText}</div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="footer">Generado automáticamente por la plataforma Cuestionario Espejo.</div>
            <script>setTimeout(() => { window.print(); }, 500);</script>
        </body>
        </html>
    `;
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handleDownloadPDF = async () => {
    let questionsToPrint = await DataService.getQuestions();
    questionsToPrint = questionsToPrint.filter(q => !q.hidden);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      triggerToast("Por favor, permite las ventanas emergentes.");
      return;
    }

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Cuestionario Espejo - Documento</title>
            <style>
                body { font-family: 'Helvetica', 'Arial', sans-serif; padding: 40px; color: #1e293b; line-height: 1.5; }
                .header { border-bottom: 2px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; display: flex; align-items: center; justify-content: space-between; }
                .logo-text { font-size: 24px; font-weight: bold; color: #1e3a8a; }
                .logo-sub { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: #2563eb; }
                .question-container { margin-bottom: 25px; page-break-inside: avoid; }
                .question-title { font-size: 16px; font-weight: bold; margin-bottom: 10px; color: #0f172a; }
                .options-list { margin-left: 20px; }
                .option-item { margin-bottom: 8px; font-size: 14px; }
                .option-key { font-weight: bold; margin-right: 8px; color: #2563eb; }
                .scale-box { background: #f1f5f9; padding: 10px; border: 1px solid #cbd5e1; border-radius: 4px; font-style: italic; font-size: 13px; }
                .footer { margin-top: 50px; border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center; font-size: 10px; color: #94a3b8; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div class="logo-text">Cuestionario Espejo</div>
                    <div class="logo-sub">Naveguemos Juntos</div>
                </div>
                <div style="text-align: right; font-size: 12px; color: #64748b;">
                    Documento de Trabajo<br>
                    ${new Date().toLocaleDateString()}
                </div>
            </div>
            <div class="content">
                ${questionsToPrint.map((q, idx) => `
                    <div class="question-container">
                        <div class="question-title">${idx + 1}. ${q.scenario}</div>
                        <div class="options-list">
                            ${q.isScale ? 
                                `<div class="scale-box">Respuesta en Escala Numérica (${q.scaleRange?.min || 1} al ${q.scaleRange?.max || 5})</div>` 
                                : 
                                q.options.map(opt => `
                                    <div class="option-item">
                                        <span class="option-key">${opt.key.toUpperCase()})</span>
                                        ${opt.text}
                                    </div>
                                `).join('')
                            }
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="footer">Generado automáticamente por la plataforma Cuestionario Espejo.</div>
            <script>setTimeout(() => { window.print(); }, 500);</script>
        </body>
        </html>
    `;
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };
  
  const handleSaveSettings = async () => {
      try {
          const configToSave = { ...tempConfig };
          if (Array.isArray(configToSave.notificationEmails)) {
              configToSave.notificationEmails = configToSave.notificationEmails.filter((e: string) => e.trim() !== '');
          } else if (typeof configToSave.notificationEmails === 'string') {
              configToSave.notificationEmails = configToSave.notificationEmails.trim() !== '' ? [configToSave.notificationEmails] : [];
          }
          await DataService.saveGlobalConfig(configToSave);
          setGlobalConfig(configToSave);
          setTempConfig(configToSave);
          setShowSettingsModal(false);
          triggerToast("Ajustes guardados correctamente");
      } catch (e) {
          triggerToast("Error al guardar ajustes");
      }
  };

  const handleUpdateProfileName = async (newName: string) => {
      if (!fullProfile) return;
      try {
          await DataService.updateUser(fullProfile.email, { nombre: newName });
          onProfileUpdate({ nombre: newName });
          triggerToast("Nombre de perfil actualizado");
      } catch (e) {
          triggerToast("Error al actualizar nombre");
      }
  };

  const handleConfirmAccessCodeChange = () => {
      setTempConfig({ ...tempConfig, accessCode: newAccessCode });
      setShowConfirmAccessCode(false);
      setNewAccessCode('');
      triggerToast("Clave de acceso preparada para guardar");
  };

  const openPatientDetails = async (p: PatientData) => {
    let freshPatient = p;
    try {
      const fromDb = await DataService.getPatientById(p.id);
      if (fromDb) {
        freshPatient = { ...p, ...fromDb };
      }
    } catch (e) {
      console.error("[PATIENT DETAILS] Error refreshing patient", e);
    }

    setSelectedPatientDetails(freshPatient);
    const isSoyBienestar = freshPatient.source === "soybienestar" || freshPatient.directAccessCreated || freshPatient.soybienestarUid || freshPatient.sourceRequestId;
    if (isSoyBienestar && !freshPatient.therapistReviewedAt) {
      DataService.updatePatient(freshPatient.id, { 
        therapistReviewedAt: Date.now(), 
        therapistReviewedBy: profile?.email || 'coordinator' 
      }).catch(e => console.error("Error setting therapistReviewedAt", e));
      const updated = registry.map(r => r.id === freshPatient.id ? { ...r, therapistReviewedAt: Date.now() } : r);
      setRegistry(updated);
    }
  };

  const filteredRegistry = registry.filter(p => {
      // Filtrar según modo borrados
      if (showDeletedMode) {
          if (p.status !== 'deleted' && !p.deletedAt) return false;
      } else {
          if (p.status === 'deleted' || p.deletedAt) return false;
      }

      const matchesSearch = searchTerm === '' || 
          p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) || 
          p.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (p.telefono && p.telefono.includes(searchTerm));
      
      const matchesStatus = showDeletedMode 
          ? true 
          : (filterStatus === 'all' || p.status === filterStatus);
      
      // FILTRO DE FECHAS AÑADIDO
      const pDate = p.dateSent || 0;
      const startMs = dateStart ? new Date(dateStart).getTime() : 0;
      const endMs = dateEnd ? new Date(dateEnd).setHours(23,59,59,999) : Infinity;
      const matchesDate = pDate >= startMs && pDate <= endMs;

      return matchesSearch && matchesStatus && matchesDate;
  });

  const deletedCount = registry.filter(p => p.status === 'deleted' || !!p.deletedAt).length;

  const getPatientLastActivityAt = (p: PatientData) =>
    p.restoredAt ||
    p.deletedAt ||
    p.dateConclusionViewed ||
    p.dateConclusionSent ||
    p.dateAnswered ||
    p.directQuestionnaireUrlCreatedAt ||
    p.dateSent ||
    0;

  const sortPatients = (items: PatientData[]) => {
    const list = [...items];
    const direction = patientsSortDirection === 'asc' ? 1 : -1;
    switch (patientsSortMode) {
      case 'alphabetical':
        return list.sort((a, b) => direction * String(a.nombre || '').localeCompare(String(b.nombre || '')));
      case 'dateSent':
        return list.sort((a, b) => direction * ((a.dateSent || 0) - (b.dateSent || 0)));
      case 'dateAnswered':
        return list.sort((a, b) => direction * ((a.dateAnswered || 0) - (b.dateAnswered || 0)));
      case 'dateConclusionSent':
        return list.sort((a, b) => direction * ((a.dateConclusionSent || 0) - (b.dateConclusionSent || 0)));
      case 'status':
        return list.sort((a, b) => direction * String(a.status || '').localeCompare(String(b.status || '')));
      case 'lastActivity':
      default:
        return list.sort((a, b) => direction * (getPatientLastActivityAt(b) - getPatientLastActivityAt(a)));
    }
  };

  const expandedPatients = sortPatients(filteredRegistry);

  const recentRegistry = [...filteredRegistry]
    .sort((a, b) => getPatientLastActivityAt(b) - getPatientLastActivityAt(a))
    .slice(0, 3);

  return (
    <div className="min-h-screen overflow-y-auto relative">
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-cover bg-center -z-10" style={{backgroundImage: "url('https://images.unsplash.com/photo-1516550893923-42d28e5677af?q=80&w=2070&auto=format&fit=crop')"}}></div>

      {/* MODAL FICHA DE PACIENTE */}
      {selectedPatientDetails && (
          <div className="fixed inset-0 z-[230] bg-black/80 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-sm">
             <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 border-b flex justify-between items-center bg-blue-900 text-white">
                    <h2 className="text-2xl font-bold flex items-center gap-3">
                        <i className="fas fa-user-circle"></i> Ficha del Paciente {isEditingDetails && <span className="text-sm bg-amber-400 text-blue-900 px-2 py-1 rounded ml-2 font-bold">EDICIÓN</span>}
                    </h2>
                    <div className="flex gap-2">
                         {!isEditingDetails && (
                            <button onClick={handleEditDetails} className="text-blue-200 hover:text-white mr-4" title="Editar Ficha">
                                <i className="fas fa-edit text-xl"></i>
                            </button>
                         )}
                         <button onClick={() => { setSelectedPatientDetails(null); setIsEditingDetails(false); setTempPatientDetails(null); }} className="text-blue-200 hover:text-white text-2xl"><i className="fas fa-times"></i></button>
                    </div>
                </div>
                
                <div className="p-8 overflow-y-auto space-y-8">
                    {isEditingDetails && tempPatientDetails ? (
                         // MODO EDICIÓN
                         <div className="space-y-6">
                             <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 text-sm text-amber-800 mb-4">
                                <i className="fas fa-info-circle mr-2"></i> Estás editando la ficha. Recuerda guardar los cambios.
                             </div>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Nombre</label>
                                    <input className="w-full p-2 border rounded-lg bg-slate-50" value={tempPatientDetails.nombre} onChange={e => setTempPatientDetails({...tempPatientDetails, nombre: e.target.value})} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                                    <input className="w-full p-2 border rounded-lg bg-slate-50" value={tempPatientDetails.email} onChange={e => setTempPatientDetails({...tempPatientDetails, email: e.target.value})} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Teléfono</label>
                                    <input className="w-full p-2 border rounded-lg bg-slate-50" value={tempPatientDetails.telefono} onChange={e => setTempPatientDetails({...tempPatientDetails, telefono: e.target.value})} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Edad</label>
                                        <input className="w-full p-2 border rounded-lg bg-slate-50" value={tempPatientDetails.edad} onChange={e => setTempPatientDetails({...tempPatientDetails, edad: e.target.value})} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Sexo</label>
                                        <select className="w-full p-2 border rounded-lg bg-slate-50" value={tempPatientDetails.sexo} onChange={e => setTempPatientDetails({...tempPatientDetails, sexo: e.target.value})}>
                                            <option value="Mujer">Mujer</option>
                                            <option value="Hombre">Hombre</option>
                                            <option value="prefiero_no_definirme">Prefiero no definirme</option>
                                        </select>
                                    </div>
                                </div>
                             </div>
                             
                             <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase">Observaciones Iniciales</label>
                                <textarea className="w-full p-3 border rounded-lg bg-slate-50 h-24" value={tempPatientDetails.observaciones} onChange={e => setTempPatientDetails({...tempPatientDetails, observaciones: e.target.value})} />
                             </div>

                             <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase">Valoración Clínica / Coaching (Uso Interno)</label>
                                <textarea className="w-full p-4 border-2 border-slate-200 outline-none focus:border-blue-500 rounded-xl bg-slate-50 h-[65vh] min-h-[500px] text-base font-medium leading-relaxed resize-y text-slate-800" value={tempPatientDetails.conversationSummary} onChange={e => setTempPatientDetails({...tempPatientDetails, conversationSummary: e.target.value})} />
                             </div>
                         </div>
                    ) : (
                        // MODO VISUALIZACIÓN
                        <>
                            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                                <h3 className="text-sm font-black uppercase text-slate-400 tracking-widest mb-4 border-b pb-2">Datos del Expediente</h3>
                                <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                                    <div>
                                        <span className="block text-xs font-bold text-slate-500 uppercase">Nombre Completo</span>
                                        <span className="block text-lg font-bold text-slate-800">{selectedPatientDetails.nombre}</span>
                                    </div>
                                    <div>
                                        <span className="block text-xs font-bold text-slate-500 uppercase">Contacto</span>
                                        <span className="block text-base font-medium text-slate-800">{selectedPatientDetails.email}</span>
                                        <span className="block text-base font-medium text-slate-800">{selectedPatientDetails.telefono || 'N/A'}</span>
                                    </div>
                                    <div>
                                        <span className="block text-xs font-bold text-slate-500 uppercase">Edad / Sexo</span>
                                        <span className="block text-base font-medium text-slate-800">{selectedPatientDetails.edad} años / {selectedPatientDetails.sexo}</span>
                                    </div>
                                    <div>
                                        <span className="block text-xs font-bold text-slate-500 uppercase">Historial de Fechas</span>
                                        <div className="text-xs text-slate-600 space-y-1">
                                            <p><span className="font-bold">Envío:</span> {formatDate(selectedPatientDetails.dateSent)}</p>
                                            <p><span className="font-bold">Respuesta:</span> {formatDate(selectedPatientDetails.dateAnswered)}</p>
                                            {selectedPatientDetails.dateConclusionSent && <p><span className="font-bold text-green-600">Conclusión Enviada:</span> {formatDate(selectedPatientDetails.dateConclusionSent)}</p>}
                                            {selectedPatientDetails.dateConclusionViewed && <p><span className="font-bold text-blue-600">Conclusión Vista:</span> {formatDate(selectedPatientDetails.dateConclusionViewed)}</p>}
                                        </div>
                                    </div>
                                    <div className="col-span-2 mt-2">
                                        <span className="block text-xs font-bold text-slate-500 uppercase">PIN de Acceso</span>
                                        <span className="block text-xl font-bold text-blue-600 tracking-widest">{selectedPatientDetails.accessPin ? selectedPatientDetails.accessPin.toUpperCase() : "N/A"}</span>
                                    </div>
                                    <div className="col-span-2 mt-2">
                                        <span className="block text-xs font-bold text-slate-500 uppercase">Observaciones Iniciales</span>
                                        <div className="text-sm text-slate-700 bg-white p-3 rounded-lg border border-slate-100">
                                            {isSoyBienestarPatient(selectedPatientDetails) ? (
                                                <div className="font-medium text-amber-800 italic">
                                                    Origen SoyBienestar.<br/>
                                                    {(() => {
                                                        const hasQuestionnaireAnswers = selectedPatientDetails.answers && Object.keys(selectedPatientDetails.answers).length > 0;
                                                        const isQuestionnaireCompleted = selectedPatientDetails.status === "completed" || selectedPatientDetails.status === "concluded" || selectedPatientDetails.status === "finalized" || !!selectedPatientDetails.dateAnswered;
                                                        if (!hasQuestionnaireAnswers) return "Ficha generada con los datos iniciales de SoyBienestar, pendiente de respuestas del cuestionario.";
                                                        if (hasQuestionnaireAnswers && !isQuestionnaireCompleted) return "Ficha generada con datos de SoyBienestar y respuestas parciales del cuestionario.";
                                                        return "Ficha generada con datos de SoyBienestar y respuestas del Cuestionario Espejo.";
                                                    })()}<br/>
                                                    Estado: {selectedPatientDetails.status === 'completed' || selectedPatientDetails.status === 'concluded' || selectedPatientDetails.status === 'finalized' ? 'Completado' : 'Pendiente'}
                                                </div>
                                            ) : (
                                                <div className="italic">
                                                    {selectedPatientDetails.observaciones || "Sin observaciones registradas."}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-lg font-black text-blue-900 uppercase tracking-widest border-b pb-2 mb-4">Valoración Clínica / Coaching (Uso Interno)</h3>
                                <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed p-4 bg-blue-50/30 rounded-xl border border-blue-100">
                                    {selectedPatientDetails.conversationSummary ? (
                                        <div className="space-y-4">
                                          {formatGeneratedReportForDisplay(selectedPatientDetails.conversationSummary, globalConfig?.clinicalPrompt).map((block, index) => (
                                            block.isTitle ? (
                                              <h4 key={index} className="text-sm font-black uppercase tracking-widest text-blue-900 border-b border-blue-200 pb-1 mt-4">
                                                {block.text}
                                              </h4>
                                            ) : block.isSubTitle ? (
                                              <h5 key={index} className="text-xs font-black uppercase tracking-widest text-amber-700 mt-3 mb-1">
                                                {block.text}
                                              </h5>
                                            ) : (
                                              <p key={index} className="text-sm leading-relaxed text-slate-700 whitespace-pre-line">
                                                {block.text}
                                              </p>
                                            )
                                          ))}
                                        </div>
                                    ) : isSoyBienestarPatient(selectedPatientDetails) ? (
                                        <div className="whitespace-pre-line">{buildSoyBienestarClinicalSummary(selectedPatientDetails)}</div>
                                    ) : (
                                        <div className="whitespace-pre-line">Pendiente de valoración.</div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="p-6 border-t bg-slate-50 flex items-center gap-4">
                    {isEditingDetails ? (
                        <>
                             <Button onClick={handleSaveDetails} className="bg-green-600 hover:bg-green-700 shadow-green-200">
                                <i className="fas fa-save mr-2"></i> Guardar Cambios
                            </Button>
                            <Button onClick={handleCancelEditDetails} variant="outline" className="border-red-200 text-red-500 hover:bg-red-50">
                                Cancelar
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button onClick={handleResendFromDetails} variant="primary" className="mr-auto bg-blue-600 hover:bg-blue-700 shadow-blue-200">
                                <i className="fas fa-redo mr-2"></i> Reenviar Cuestionario
                            </Button>
                            <Button onClick={handlePrintPatientFile}><i className="fas fa-print mr-2"></i> Imprimir de Nuevo</Button>
                        </>
                    )}
                </div>
             </div>
          </div>
      )}

      {/* EMAIL MODAL */}
      {showEmailModal && (
          <div className="fixed inset-0 z-[200] bg-slate-900/40 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-slate-200 overflow-hidden flex flex-col">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2">
                          <i className="fas fa-envelope text-blue-500"></i> Enviar Enlace por Email
                      </h3>
                      <button onClick={() => setShowEmailModal(false)} className="text-slate-400 hover:text-slate-600">
                          <i className="fas fa-times"></i>
                      </button>
                  </div>
                  
                  <div className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
                      {emailModalError && (
                          <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100">
                              <i className="fas fa-exclamation-triangle mr-2"></i> {emailModalError}
                          </div>
                      )}
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Para</label>
                          <input 
                              type="email" 
                              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 transition-colors"
                              value={emailModalData.to}
                              onChange={(e) => setEmailModalData({...emailModalData, to: e.target.value})}
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Asunto</label>
                          <input 
                              type="text" 
                              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 transition-colors font-medium text-slate-700"
                              value={emailModalData.subject}
                              onChange={(e) => setEmailModalData({...emailModalData, subject: e.target.value})}
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Mensaje</label>
                          <textarea 
                              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 transition-colors h-48 resize-y whitespace-pre-wrap text-sm text-slate-700"
                              value={emailModalData.body}
                              onChange={(e) => setEmailModalData({...emailModalData, body: e.target.value})}
                          />
                      </div>
                  </div>
                  
                  <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                      <Button variant="outline" className="flex-1" onClick={() => setShowEmailModal(false)} disabled={isSendingEmail}>
                          Cancelar
                      </Button>
                      <Button className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed" onClick={handleSendEmailInternal} disabled={isSendingEmail}>
                          {isSendingEmail ? (
                              <><i className="fas fa-spinner fa-spin mr-2"></i> Enviando...</>
                          ) : (
                              <><i className="fas fa-paper-plane mr-2"></i> Enviar correo</>
                          )}
                      </Button>
                  </div>
              </div>
          </div>
      )}

      {/* DUPLICATE MODAL */}
      {showDuplicateModal && duplicatePatientRecord && (
          <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
              <Card className="w-full max-w-lg shadow-2xl">
                  <div className="flex justify-between items-center mb-6 border-b pb-4">
                      <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                          <i className="fas fa-exclamation-circle text-amber-500"></i> {pendingGenerateData?.matchType === 'exact' ? 'Datos ya Registrados' : 'Paciente Existente'}
                      </h3>
                      <button onClick={() => setShowDuplicateModal(false)} className="text-slate-400 hover:text-slate-600"><i className="fas fa-times text-xl"></i></button>
                  </div>
                  <div className="space-y-4 mb-8">
                      {pendingGenerateData?.matchType === 'exact' ? (
                          <p className="text-slate-600">
                              Los datos de <strong>{duplicatePatientRecord.nombre}</strong> ya están registrados en el sistema con el mismo email y teléfono.
                          </p>
                      ) : (
                          <p className="text-slate-600">
                              Ya existe un paciente registrado con el nombre <strong>{duplicatePatientRecord.nombre}</strong>, pero los datos de contacto no coinciden.
                          </p>
                      )}

                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm">
                          <p className="font-bold text-slate-700 mb-2">Datos Registrados:</p>
                          <p>Email: {duplicatePatientRecord.email}</p>
                          <p>Teléfono: {duplicatePatientRecord.telefono || 'N/A'}</p>
                      </div>

                      {pendingGenerateData?.matchType === 'partial' && (
                          <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 text-sm">
                              <p className="font-bold text-blue-800 mb-2">Nuevos Datos:</p>
                              <p>Email: {patient.email}</p>
                              <p>Teléfono: {pendingGenerateData?.fullPhone || 'N/A'}</p>
                          </div>
                      )}

                      <p className="text-sm font-medium text-slate-700 mt-4">
                          {pendingGenerateData?.matchType === 'exact' 
                            ? "¿Desea enviar nuevamente el cuestionario para continuación o enviar un enlace completamente nuevo para sustituir el anterior?"
                            : "¿Deseas sustituir los datos de contacto del paciente existente o crear un nuevo registro (copia)?"}
                      </p>
                  </div>
                  <div className="flex flex-col gap-3">
                      {pendingGenerateData?.matchType === 'exact' ? (
                          <>
                              <Button onClick={() => handleGenerateAndSend(pendingGenerateData?.isResend, 'replace')} className="w-full bg-blue-600 hover:bg-blue-700">
                                  <i className="fas fa-sync-alt mr-2"></i> Enviar Nuevo (Sustituir Anterior)
                              </Button>
                              <Button onClick={() => handleGenerateAndSend(pendingGenerateData?.isResend, 'resend')} variant="secondary" className="w-full">
                                  <i className="fas fa-redo mr-2"></i> Reenviar para Continuación
                              </Button>
                          </>
                      ) : (
                          <>
                              <Button onClick={() => handleGenerateAndSend(pendingGenerateData?.isResend, 'replace')} className="w-full bg-blue-600 hover:bg-blue-700">
                                  <i className="fas fa-sync-alt mr-2"></i> Sustituir Datos Existentes
                              </Button>
                              <Button onClick={() => handleGenerateAndSend(pendingGenerateData?.isResend, 'new')} variant="secondary" className="w-full">
                                  <i className="fas fa-plus-circle mr-2"></i> Crear Nuevo Registro (Copia)
                              </Button>
                          </>
                      )}
                      <Button onClick={() => setShowDuplicateModal(false)} variant="outline" className="w-full">
                          Cancelar
                      </Button>
                  </div>
              </Card>
          </div>
      )}

      {/* SEARCH MODAL */}
      {isSearchOpen && (
          <div className="fixed inset-0 z-[150] bg-black/60 flex items-start justify-center pt-24 p-4 backdrop-blur-sm animate-in fade-in">
              <Card className="w-full max-w-2xl">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-bold text-slate-800">Búsqueda Avanzada</h3>
                      <button onClick={() => setIsSearchOpen(false)}><i className="fas fa-times text-slate-400 hover:text-slate-600 text-xl"></i></button>
                  </div>
                  <div className="space-y-4">
                      <Input label="Buscar por nombre, email o teléfono" placeholder="Escribe para buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                      
                      {/* FILTRO DE FECHAS */}
                      <div>
                          <label className="block text-[11px] font-black uppercase text-slate-500 mb-2 tracking-widest">Fecha entre : ------- y ------- .</label>
                          <div className="flex gap-4">
                              <input 
                                  type="date" 
                                  className="flex-1 p-3 rounded-xl border-2 border-slate-100 bg-white text-sm font-bold text-slate-700 focus:border-blue-500 outline-none"
                                  value={dateStart}
                                  onChange={e => setDateStart(e.target.value)}
                              />
                              <input 
                                  type="date" 
                                  className="flex-1 p-3 rounded-xl border-2 border-slate-100 bg-white text-sm font-bold text-slate-700 focus:border-blue-500 outline-none"
                                  value={dateEnd}
                                  onChange={e => setDateEnd(e.target.value)}
                              />
                          </div>
                      </div>

                      <div>
                          <label className="block text-[11px] font-black uppercase text-slate-500 mb-2 tracking-widest">Filtrar por Estado</label>
                          <div className="flex flex-wrap gap-2">
                              {['all', 'pending', 'sent', 'viewed', 'completed', 'concluded', 'finalized'].map(status => {
                                  const tooltips: Record<string, string> = {
                                      all: "Mostrar todos los estados",
                                      pending: "Datos del paciente introducidos pendiente de envío del Cuestionario.",
                                      sent: "El enlace y clave se han enviado, pero aún no ha sido abierto por el paciente.",
                                      viewed: "El paciente ha entrado en el cuestionario pero aún no lo ha completado.",
                                      completed: "Se ha completado el cuestionario y queda pendiente de enviar la conclusión.",
                                      concluded: "Se le ha enviado al paciente la conclusión de su cuestionario.",
                                      finalized: "El cliente ha visto su conclusión, se da por finalizado este proceso."
                                  };
                                  return (
                                      <div key={status} className="relative group">
                                          <button 
                                            onClick={(e) => {
                                                // En móvil, el primer toque muestra el tooltip (que se maneja por hover/focus en CSS)
                                                // Si ya está activo (o no es táctil), aplica el filtro
                                                if (window.matchMedia("(hover: none)").matches) {
                                                    if (document.activeElement !== e.currentTarget) {
                                                        e.currentTarget.focus();
                                                        return;
                                                    }
                                                }
                                                setFilterStatus(status);
                                            }}
                                            className={`px-3 py-2 rounded-lg text-xs font-bold uppercase transition-colors focus:outline-none ${filterStatus === status ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 focus:bg-slate-200'}`}
                                          >
                                              {statusLabels[status]}
                                          </button>
                                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 text-white text-[10px] rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all z-50 pointer-events-none text-center leading-tight">
                                              {tooltips[status]}
                                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>
                      </div>
                  </div>
                  <div className="mt-6 flex justify-end">
                      <Button onClick={() => setIsSearchOpen(false)}>Ver Resultados ({filteredRegistry.length})</Button>
                  </div>
              </Card>
          </div>
      )}

      {/* MODAL RESULTADOS */}
      {selectedPatientResults && (
          <div className="fixed inset-0 z-[220] bg-black/80 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-sm">
             <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 border-b flex justify-between items-center bg-slate-50">
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                        <i className="fas fa-file-medical-alt text-blue-600"></i> Resultados del Paciente
                    </h2>
                    <button onClick={() => setSelectedPatientResults(null)} className="text-slate-400 hover:text-red-500 text-2xl"><i className="fas fa-times"></i></button>
                </div>
                
                <div className="p-8 overflow-y-auto space-y-8">
                    <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-xs uppercase text-slate-400 font-bold tracking-widest">Paciente</p>
                                <p className="text-xl font-bold text-slate-800">{selectedPatientResults.nombre}</p>
                            </div>
                             <div>
                                <p className="text-xs uppercase text-slate-400 font-bold tracking-widest">Email</p>
                                <p className="text-base font-medium text-slate-800">{selectedPatientResults.email}</p>
                            </div>
                             <div>
                                <p className="text-xs uppercase text-slate-400 font-bold tracking-widest">Edad / Sexo</p>
                                <p className="text-base font-medium text-slate-800">{selectedPatientResults.edad} años / {selectedPatientResults.sexo}</p>
                            </div>
                             <div>
                                <p className="text-xs uppercase text-slate-400 font-bold tracking-widest">Fecha Respuesta</p>
                                <p className="text-base font-medium text-slate-800">{formatDate(selectedPatientResults.dateAnswered)}</p>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest border-b pb-2 mb-4">Cuestionario Detallado</h3>
                        <div className="space-y-6">
                            {QUESTIONS.map((q, idx) => {
                                const answerKey = selectedPatientResults.answers?.[q.id];
                                const selectedOption = q.options.find(opt => opt.key === answerKey);
                                const answerText = q.isScale ? (answerKey || "Sin respuesta") : (selectedOption ? `${selectedOption.key.toUpperCase()}) ${selectedOption.text}` : "Sin respuesta");

                                return (
                                    <div key={q.id}>
                                        <div className="flex gap-2 mb-1">
                                            <span className="font-bold text-blue-600">{idx + 1}.</span>
                                            <p className="font-bold text-slate-700">{q.scenario}</p>
                                        </div>
                                        <div className="ml-6 p-3 bg-slate-50 rounded-lg border-l-4 border-blue-500">
                                            <span className="font-bold text-xs uppercase text-slate-400 mr-2">Respuesta:</span>
                                            <span className="font-medium text-slate-800 italic">{answerText}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t bg-slate-50 flex justify-end gap-4">
                    <Button variant="outline" onClick={downloadJSON}><i className="fas fa-code mr-2"></i> Exportar JSON</Button>
                    <Button onClick={handlePrintPatientResults}><i className="fas fa-print mr-2"></i> Imprimir / PDF</Button>
                </div>
             </div>
          </div>
      )}

      {/* MODAL CONCLUSIÓN */}
      {selectedPatientConclusion && (
          <div className="fixed inset-0 z-[220] bg-black/80 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-sm">
             <Card className="w-full max-w-3xl max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-6 border-b pb-4">
                    <h2 className="text-2xl font-bold text-slate-800"><i className="fas fa-brain text-purple-600 mr-2"></i> Gestión de Conclusión</h2>
                    <button onClick={() => setSelectedPatientConclusion(null)} className="text-slate-400 hover:text-red-500 text-2xl"><i className="fas fa-times"></i></button>
                </div>

                <div className="flex-1 overflow-y-auto mb-4 pr-2">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex gap-4 items-center">
                            <label className="cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl font-bold text-sm transition-colors border border-slate-200">
                                <i className="fas fa-microphone mr-2"></i> Subir MP3 Personal
                                <input type="file" accept="audio/*" onChange={handleAudioUpload} className="hidden" />
                            </label>
                            {editingAudio ? (
                                <div className="flex items-center gap-3">
                                    <span className="text-xs font-bold text-green-600"><i className="fas fa-check"></i> Audio cargado</span>
                                    {resolvedAudioUrl && <audio src={resolvedAudioUrl} controls className="h-8 w-48" />}
                                    <button onClick={() => setEditingAudio(undefined)} className="text-red-500 hover:text-red-700 text-xs font-bold" title="Eliminar audio"><i className="fas fa-trash"></i></button>
                                </div>
                            ) : <span className="text-xs text-slate-600 font-bold">Sin audio</span>}
                        </div>
                        
                        <button 
                            onClick={() => {
                                setSelectedPatientDetails(selectedPatientConclusion);
                                setSelectedPatientConclusion(null);
                            }}
                            className="bg-slate-50 hover:bg-slate-100 text-slate-600 px-4 py-2 rounded-xl font-bold text-sm transition-colors border border-slate-200 flex items-center justify-center"
                        >
                            <i className="fas fa-file-alt mr-2"></i> Ver Ficha del Paciente
                        </button>
                    </div>

                    <label className="block text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">Texto de la Conclusión</label>
                    <textarea 
                        className="w-full h-[36rem] p-4 rounded-xl border-2 border-slate-200 focus:border-purple-500 outline-none text-base leading-relaxed resize-none bg-white text-slate-700"
                        value={editingConclusion}
                        onChange={(e) => setEditingConclusion(e.target.value)}
                        placeholder="Pendiente de conclusión terapéutica. Puedes redactarla manualmente o esperar a la valoración automática si está disponible."
                    />
                </div>

                <div className="flex gap-3 pt-3 border-t">
                    <Button onClick={handleSaveConclusion} className="flex-1 h-10 py-0 bg-purple-600 hover:bg-purple-700 shadow-purple-200 text-sm flex items-center justify-center">
                        <i className="fas fa-save mr-2"></i> Guardar
                    </Button>
                    <button 
                        onClick={handlePrintConclusion} 
                        className="flex-1 h-10 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-sm transition-colors border border-slate-200 flex items-center justify-center"
                    >
                        <i className="fas fa-print mr-2"></i> Imprimir
                    </button>
                    <Button onClick={handleSendConclusionLink} variant="secondary" className="flex-1 h-10 py-0 bg-green-600 hover:bg-green-700 shadow-green-200 text-sm flex items-center justify-center">
                        <i className="fas fa-envelope mr-2"></i> Email
                    </Button>
                    <Button onClick={handleSendConclusionWhatsApp} variant="secondary" className="flex-1 h-10 py-0 bg-green-500 hover:bg-green-600 shadow-green-200 text-white text-sm flex items-center justify-center">
                        <i className="fab fa-whatsapp mr-2"></i> WhatsApp
                    </Button>
                </div>
             </Card>
          </div>
      )}

      <div className="max-w-6xl mx-auto py-10 px-6 md:px-8 animate-in fade-in duration-700 pb-32">
        <div className="flex justify-between items-center mb-10">
          <Logo />
          <div className="flex items-center gap-3">
              <button 
                onClick={() => setShowSettingsModal(true)} 
                className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-200 flex items-center justify-center transition-all shadow-sm"
                title="Ajustes"
              >
                  <i className="fas fa-cog text-lg"></i>
              </button>
              <Button variant="outline" className="text-sm font-bold" onClick={onLogout}>Cerrar Sesión</Button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5 space-y-8">
            <Card className="border-teal-100 border-2 shadow-xl bg-white/95">
              <h2 className="text-2xl font-bold mb-6 text-blue-900 border-b border-blue-50 pb-4">Perfil Conectado</h2>
              <div className="space-y-6">
                <div className="flex items-center gap-5 p-5 bg-gradient-to-br from-teal-50 to-white rounded-2xl border border-teal-100/50 shadow-sm">
                  <div className="w-16 h-16 bg-blue-900 text-white rounded-2xl flex items-center justify-center text-2xl font-black shadow-lg shadow-blue-900/20">
                    {profile.nombre.charAt(0)}
                  </div>
                  <div>
                    <p className="font-bold text-lg text-slate-800 leading-tight">{profile.nombre}</p>
                    <p className="text-sm text-teal-600 font-bold tracking-tight">{profile.email}</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                    <Button variant="outline" className="w-full text-sm font-bold py-4" onClick={onEnterEditMode}>
                        <i className="fas fa-edit mr-3"></i> Cuestionario (Modo Edición)
                    </Button>
                    <Button variant="outline" className="w-full text-sm font-bold py-3 bg-teal-50 border-teal-200 text-teal-800 hover:bg-teal-100" onClick={handleDownloadPDF}>
                        <i className="fas fa-file-pdf mr-3"></i> Descargar Preguntas (PDF)
                    </Button>
                </div>
              </div>

              <div className="mt-12">
                {showDeletedMode && selectedDeletedPatientIds.length > 0 && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-xl text-sm font-medium mb-4 flex justify-between items-center">
                        <span>{selectedDeletedPatientIds.length} ficha(s) seleccionada(s) para borrado definitivo.</span>
                    </div>
                )}
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-2">
                      <h3 className="font-black text-xs uppercase text-slate-400 tracking-widest">{showDeletedMode ? 'Fichas Borradas' : 'Actividad Reciente'}</h3>
                      
                      {showDeletedMode && (
                          <div className="flex items-center gap-2 ml-2 mr-2">
                              <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 cursor-pointer bg-slate-100 px-2 py-1 rounded">
                                  <input 
                                      type="checkbox" 
                                      className="rounded cursor-pointer border-slate-300 text-red-500 focus:ring-red-500"
                                      checked={recentRegistry.length > 0 && recentRegistry.filter(p => p.status === 'deleted').every(p => selectedDeletedPatientIds.includes(p.id))}
                                      onChange={(e) => {
                                          if (e.target.checked) {
                                              setSelectedDeletedPatientIds(recentRegistry.filter(p => p.status === 'deleted').map(p => p.id));
                                          } else {
                                              clearDeletedPatientSelection();
                                          }
                                      }}
                                  />
                                  <span>Todos</span>
                              </label>
                              <button
                                  onClick={permanentlyDeleteSelectedPatients}
                                  disabled={selectedDeletedPatientIds.length === 0}
                                  className={`h-6 px-2 rounded flex items-center justify-center transition-colors gap-1 ${
                                      selectedDeletedPatientIds.length > 0
                                          ? 'bg-red-100 text-red-600 hover:bg-red-200'
                                          : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                                  }`}
                                  title="Eliminar seleccionados"
                              >
                                  <i className="fas fa-trash-alt text-[10px]"></i>
                                  {selectedDeletedPatientIds.length > 0 && <span className="text-[10px] font-bold">({selectedDeletedPatientIds.length})</span>}
                              </button>
                          </div>
                      )}

                      <button onClick={() => setIsSearchOpen(!isSearchOpen)} className="w-6 h-6 rounded bg-slate-100 hover:bg-blue-100 text-slate-500 hover:text-blue-600 flex items-center justify-center transition-colors"><i className="fas fa-search text-xs"></i></button>
                  </div>
                  <span className="text-xs bg-slate-100 px-3 py-1 rounded-full text-slate-600 font-bold">{filteredRegistry.length > 3 ? `3 / ${filteredRegistry.length}` : filteredRegistry.length}</span>
                </div>
                  <div className="space-y-4">
                  {recentRegistry.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6 italic border-2 border-dashed border-slate-100 rounded-xl">{showDeletedMode ? 'No hay fichas borradas recientes.' : 'No hay registros recientes'}</p>
                  ) : (
                    recentRegistry.map((p) => {
                      const isSoyBienestar = p.source === 'soybienestar' || p.directAccessCreated || p.soybienestarUid || p.sourceRequestId;
                      const needsReview = isSoyBienestar && !p.therapistReviewedAt;
                      const displayName = p.nombre || (p as any).displayName || p.email || "Paciente sin nombre";
                      
                      return (
                      <div key={p.id} className={`group relative flex flex-col p-4 rounded-2xl border transition-all shadow-sm hover:shadow-md gap-3 ${needsReview ? 'border-amber-300 bg-amber-50/60' : 'bg-white border-slate-100 hover:border-teal-300'}`}>
                        <div className="flex justify-between items-start w-full">
                            <div className="flex flex-col overflow-hidden leading-tight">
                                <div className="flex items-center gap-2">
                                    {showDeletedMode && (
                                        <input 
                                            type="checkbox"
                                            checked={selectedDeletedPatientIds.includes(p.id)}
                                            onChange={(e) => { e.stopPropagation(); toggleDeletedPatientSelection(p.id); }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="rounded cursor-pointer border-slate-300 text-red-500 focus:ring-red-500 w-4 h-4"
                                            aria-label={`Seleccionar ${displayName} para borrado definitivo`}
                                        />
                                    )}
                                    <button onClick={() => openPatientDetails(p)} className="text-left text-sm font-bold text-blue-700 hover:text-blue-900 hover:underline truncate transition-colors block w-full">{displayName}</button>
                                </div>
                                {isSoyBienestar && (
                                    <span className="shrink-0 bg-blue-50 text-blue-600 px-2 py-0.5 mt-1 self-start rounded-md text-[9px] font-black tracking-widest uppercase border border-blue-100">SoyBienestar</span>
                                )}
                                <span className={`text-xs mt-1 font-bold truncate ${needsReview ? 'text-amber-600' : 'text-slate-400'}`}>{p.email}</span>
                            </div>
                            
                            <div className="flex items-center gap-1 shrink-0">
                            {showDeletedMode || p.status === 'deleted' ? (
                                <button 
                                    onClick={() => restoreRecord(p.id)}
                                    className="px-3 py-1.5 ml-1 text-xs font-bold text-teal-600 bg-teal-50 hover:bg-teal-100 rounded-lg transition-all flex items-center gap-2 uppercase tracking-wide border border-teal-200"
                                    title="Restaurar ficha"
                                >
                                    <i className="fas fa-undo"></i> Restaurar
                                </button>
                            ) : (
                                <>
                                    <button 
                                        onClick={() => changeStatus(p.id, 'backward')}
                                        disabled={p.status === 'pending'}
                                        className="text-slate-300 hover:text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed p-1 transition-colors"
                                        title="Retroceder estado"
                                    >
                                        <i className="fas fa-chevron-left text-xs"></i>
                                    </button>
                                    
                                    <div 
                                        className={`text-[10px] font-black uppercase tracking-tighter px-2 py-1.5 rounded-lg text-center min-w-[80px] ${
                                        p.status === 'completed' ? 'bg-teal-100 text-teal-800' : 
                                        p.status === 'pending' ? 'bg-amber-50 text-amber-700' : 
                                        p.status === 'sent' ? 'bg-indigo-50 text-indigo-700' : 
                                        p.status === 'viewed' ? 'bg-blue-50 text-blue-700' : 
                                        p.status === 'concluded' ? 'bg-purple-50 text-purple-700' : 
                                        p.status === 'finalized' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'
                                        }`}
                                    >
                                        {statusLabels[p.status]}
                                    </div>

                                    <button 
                                        onClick={() => changeStatus(p.id, 'forward')}
                                        disabled={p.status === 'finalized'}
                                        className="text-slate-300 hover:text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed p-1 transition-colors"
                                        title="Avanzar estado"
                                    >
                                        <i className="fas fa-chevron-right text-xs"></i>
                                    </button>
                                    
                                    <button 
                                        onClick={() => deleteRecord(p.id, p.status)}
                                        className="p-2 ml-1 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                    >
                                        <i className="fas fa-trash"></i>
                                    </button>
                                </>
                            )}
                            </div>
                        </div>

                        {(p.status === 'completed' || p.status === 'concluded' || p.status === 'finalized') && (
                            <div className="flex gap-2 pt-2 border-t border-slate-50">
                                <button onClick={() => openResultsModal(p)} className="flex-1 py-2.5 text-xs font-bold bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors flex items-center justify-center gap-2">
                                    <i className="fas fa-eye"></i> Ver
                                </button>
                                <button onClick={() => openConclusionModal(p)} className="flex-1 py-2.5 text-xs font-bold bg-purple-50 text-purple-600 rounded-xl hover:bg-purple-100 transition-colors flex items-center justify-center gap-2">
                                    <i className="fas fa-brain"></i> Conclusión
                                </button>
                            </div>
                        )}
                      </div>
                      );
                    })
                  )}
                </div>
                <div className="mt-6 flex justify-between items-center gap-3">
                    <button
                        onClick={() => setShowPatientsExpandedView(true)}
                        className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors border bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100"
                    >
                        <i className="fas fa-expand-alt mr-1.5"></i> Ampliar
                    </button>
                    <button 
                        onClick={() => {
                            const nextMode = !showDeletedMode;
                            setShowDeletedMode(nextMode);
                            setFilterStatus('all');
                        }} 
                        className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors border ${
                            showDeletedMode 
                            ? 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200' 
                            : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50 hover:text-slate-600'
                        }`}
                    >
                        {showDeletedMode ? 'Volver a inicio' : (
                            <><i className="fas fa-trash-alt mr-1.5"></i> Papelera {deletedCount > 0 ? `(${deletedCount})` : ''}</>
                        )}
                    </button>
                </div>
              </div>
            </Card>
          </div>

          <div className="lg:col-span-7">
            <Card className="shadow-xl bg-white/95 border-blue-50">
              <div className="flex items-center justify-between mb-10 border-b border-slate-100 pb-6">
                <h2 className="text-3xl font-bold text-blue-900">Preparar Nueva Sesión</h2>
                <div className="relative">
                    <button 
                        onClick={() => setShowRequestsDropdown(!showRequestsDropdown)}
                        className="flex items-center gap-2 text-xs font-black text-amber-600 bg-amber-50 hover:bg-amber-100 px-4 py-2 rounded-full uppercase tracking-widest transition-colors border border-amber-200"
                    >
                        Nuevas Peticiones
                        <span className="bg-amber-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">
                            {pendingRequests.length}
                        </span>
                        <i className={`fas fa-chevron-${showRequestsDropdown ? 'up' : 'down'} ml-1`}></i>
                    </button>
                    
                    {showRequestsDropdown && (
                        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 overflow-hidden">
                            <div className="p-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                                <span className="text-xs font-bold text-slate-500 uppercase">Peticiones Pendientes</span>
                                <label className="cursor-pointer text-blue-600 hover:text-blue-800 text-xs font-bold flex items-center gap-1">
                                    <i className="fas fa-upload"></i> Cargar .json
                                    <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
                                </label>
                            </div>
                            <div className="max-h-60 overflow-y-auto">
                                {pendingRequestsError && (
                                    <div className="p-3 text-xs text-red-600 bg-red-50 text-center border-b border-red-100">
                                        {pendingRequestsError}
                                    </div>
                                )}
                                {pendingRequests.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-slate-400 italic">No hay peticiones nuevas</div>
                                ) : (
                                    pendingRequests.map(req => (
                                        <div key={req.id} className="p-3 border-b border-slate-50 hover:bg-blue-50 flex justify-between items-center group cursor-pointer transition-colors" onClick={() => selectPendingRequest(req)}>
                                            <div className="flex flex-col overflow-hidden pr-2">
                                                <span className="text-sm font-bold text-slate-700 truncate">{req.nombre || req.displayName || 'Usuario ' + (req.source || '')}</span>
                                                <span className="text-xs text-slate-400 truncate">{req.email || 'Sin email'}</span>
                                            </div>
                                            <button 
                                                onClick={(e) => deletePendingRequest(e, req.id)}
                                                className="w-6 h-6 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                                            >
                                                <i className="fas fa-times text-xs"></i>
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
              </div>

              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                  <Input label="Nombre completo" placeholder="Ej: Maria Garcia" value={patient.nombre} onChange={e => setPatient({ ...patient, nombre: e.target.value })} />
                  <Input label="Email del paciente" type="email" placeholder="maria@ejemplo.com" value={patient.email} onChange={e => setPatient({ ...patient, email: e.target.value })} />
                  <Input label="Edad" type="number" placeholder="00" value={patient.edad} onChange={e => setPatient({ ...patient, edad: e.target.value })} />
                  
                  <div className="mb-4">
                    <label className="block text-[11px] font-black uppercase text-slate-500 mb-2 tracking-widest">Sexo</label>
                    <select 
                      className="w-full px-5 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 outline-none transition-all bg-white/60 backdrop-blur-md text-sm font-bold shadow-inner text-slate-700"
                      value={patient.sexo || ''}
                      onChange={e => setPatient({ ...patient, sexo: e.target.value })}
                    >
                        <option value="" disabled>Seleccionar...</option>
                        <option value="Mujer">Mujer</option>
                        <option value="Hombre">Hombre</option>
                        <option value="prefiero_no_definirme">Prefiero no definirme</option>
                    </select>
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-[11px] font-black uppercase text-slate-500 mb-2 tracking-widest">Teléfono / WhatsApp</label>
                  <div className="flex gap-2">
                      <input 
                        className="w-20 px-4 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 outline-none transition-all bg-white/60 backdrop-blur-md text-sm font-bold shadow-inner text-center"
                        value={phonePrefix}
                        onChange={e => setPhonePrefix(e.target.value)}
                      />
                      <input 
                        className="flex-1 px-5 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 outline-none transition-all bg-white/60 backdrop-blur-md text-sm font-bold shadow-inner"
                        placeholder="600123456"
                        type="tel"
                        value={phoneBody}
                        onChange={e => setPhoneBody(e.target.value)}
                      />
                  </div>
                </div>

                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Vías de Notificación Simultáneas</p>
                  <div className="flex flex-wrap gap-6">
                    <label className="flex items-center gap-3 cursor-pointer bg-white px-5 py-3 rounded-2xl border border-slate-200 hover:border-teal-400 transition-all shadow-sm">
                        <input 
                          type="checkbox" 
                          className="w-5 h-5 rounded text-teal-600 focus:ring-teal-500"
                          checked={sendMethods.email}
                          onChange={e => setSendMethods({...sendMethods, email: e.target.checked})}
                        />
                        <span className="text-sm font-bold text-slate-700 capitalize">Gmail / Correo</span>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer bg-white px-5 py-3 rounded-2xl border border-slate-200 hover:border-teal-400 transition-all shadow-sm">
                        <input 
                          type="checkbox" 
                          className="w-5 h-5 rounded text-teal-600 focus:ring-teal-500"
                          checked={sendMethods.whatsapp}
                          onChange={e => setSendMethods({...sendMethods, whatsapp: e.target.checked})}
                        />
                        <span className="text-sm font-bold text-slate-700 capitalize">Whatsapp</span>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer bg-white px-5 py-3 rounded-2xl border border-slate-200 hover:border-teal-400 transition-all shadow-sm">
                        <input 
                          type="checkbox" 
                          className="w-5 h-5 rounded text-teal-600 focus:ring-teal-500"
                          checked={sendMethods.sms}
                          onChange={e => setSendMethods({...sendMethods, sms: e.target.checked})}
                        />
                        <span className="text-sm font-bold text-slate-700 capitalize">SMS <span className="text-[10px] text-slate-400 font-normal normal-case">(Solo Móvil)</span></span>
                    </label>
                  </div>
                </div>

                <div className="pt-4">
                  <Button 
                    className="w-full py-5 text-xl font-bold" 
                    variant="secondary" 
                    onClick={() => handleGenerateAndSend(false)}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                        <><i className="fas fa-spinner fa-spin mr-3"></i> Generando...</>
                    ) : (
                        <><i className="fas fa-paper-plane mr-3"></i> Generar y Notificar</>
                    )}
                  </Button>
                </div>

                {linkGenerated && (
                  <div className="mt-10 p-8 bg-teal-50/50 rounded-3xl border border-teal-100 animate-in zoom-in-95 duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-xs font-black text-teal-600 uppercase tracking-widest">Enlace y PIN Generados</p>
                        <span className="text-lg font-black text-teal-700 bg-white px-4 py-1 rounded-xl border border-teal-200">PIN: {lastGeneratedPin?.toUpperCase()}</span>
                    </div>
                    
                    <div className="flex gap-2 p-1.5 bg-white rounded-2xl border border-teal-200/50 shadow-sm overflow-hidden mb-6">
                      <input readOnly value={linkGenerated} className="flex-1 bg-transparent px-4 py-3 text-sm font-mono text-teal-900 outline-none" />
                      <Button variant="primary" className="px-8 py-3 rounded-xl text-xs" onClick={() => {
                        navigator.clipboard.writeText(linkGenerated);
                        triggerToast("¡Enlace copiado!");
                      }}>
                        Copiar
                      </Button>
                    </div>

                    <div className="space-y-3">
                        <p className="text-[10px] text-slate-400 font-bold uppercase text-center mb-2">Re-enviar manualmente si fue bloqueado:</p>
                        <div className="flex flex-wrap gap-2 justify-center">
                            {sendMethods.email && (
                                <button 
                                    onClick={() => {
                                        const subject = "Tu enlace para el Cuestionario Espejo";
                                        const body = `Hola ${patient.nombre?.split(' ')[0] || ''},\n\nAquí tienes tu enlace directo:\n${linkGenerated}\n\nPIN: ${lastGeneratedPin?.toUpperCase()}`;
                                        setEmailModalData({
                                            patientId: lastGeneratedPatientId || '',
                                            to: patient.email || '',
                                            subject,
                                            body
                                        });
                                        setShowEmailModal(true);
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all"
                                >
                                    <i className="fas fa-envelope text-red-400"></i> Email
                                </button>
                            )}
                            {sendMethods.whatsapp && (
                                <button 
                                    onClick={() => {
                                        const body = `Hola ${patient.nombre.split(' ')[0]},\n\nAquí tienes tu enlace directo:\n${linkGenerated}\n\nPIN: ${lastGeneratedPin?.toUpperCase()}`;
                                        const fullPhone = phoneBody ? `${phonePrefix}${phoneBody}`.trim() : '';
                                        openWhatsAppComposer(fullPhone, body, null);
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all"
                                >
                                    <i className="fab fa-whatsapp text-green-500"></i> WhatsApp
                                </button>
                            )}
                            {sendMethods.sms && (
                                <button 
                                    onClick={() => {
                                        const fullPhone = phoneBody ? `${phonePrefix}${phoneBody}`.trim() : '';
                                        const body = `Hola ${patient.nombre.split(' ')[0]}, enlace: ${linkGenerated} . PIN: ${lastGeneratedPin?.toUpperCase()}`;
                                        openSmsComposer(fullPhone, body, null);
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all"
                                >
                                    <i className="fas fa-sms text-blue-400"></i> SMS
                                </button>
                            )}
                        </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
      <Toast message={toastMessage} visible={showToast} onHide={() => setShowToast(false)} />

      {/* MODAL AJUSTES */}
      {showSettingsModal && tempConfig && (
          <div className="fixed inset-0 z-[150] bg-black/80 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-sm">
              <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="p-6 border-b flex justify-between items-center bg-slate-800 text-white">
                      <h2 className="text-2xl font-bold flex items-center gap-3">
                          <i className="fas fa-cog"></i> Ajustes de la Aplicación
                      </h2>
                      <button onClick={() => setShowSettingsModal(false)} className="text-slate-300 hover:text-white text-2xl"><i className="fas fa-times"></i></button>
                  </div>

                  <div className="p-8 overflow-y-auto space-y-10">
                      
                      {/* --- AJUSTES NO SENSIBLES --- */}
                      <div className="mb-4 pb-2 border-b-2 border-slate-200">
                          <h2 className="text-xl font-black text-slate-800 uppercase tracking-widest">Ajustes Generales</h2>
                          <p className="text-sm text-slate-500">Configuración básica y textos visibles para los pacientes.</p>
                      </div>

                      {/* SECCIÓN PERFIL */}
                      <section className="space-y-4">
                          <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest border-b pb-2">Perfil del Coordinador</h3>
                          <div className="max-w-md space-y-4">
                              <Input 
                                  label="Nombre del Perfil" 
                                  value={fullProfile?.nombre || ''} 
                                  onChange={e => handleUpdateProfileName(e.target.value)} 
                              />
                              <div className="space-y-2">
                                  <label className="text-xs font-bold text-slate-500 uppercase block">Correos para recepción de avisos</label>
                                  {(Array.isArray(tempConfig.notificationEmails) ? (tempConfig.notificationEmails.length > 0 ? tempConfig.notificationEmails : ['']) : [tempConfig.notificationEmails || '']).map((email: string, idx: number, arr: string[]) => (
                                      <div key={idx} className="flex gap-2 items-center">
                                          <Input 
                                              label={`Correo ${idx + 1}`}
                                              placeholder="ejemplo@correo.com"
                                              value={email} 
                                              onChange={e => {
                                                  const newEmails = [...arr];
                                                  newEmails[idx] = e.target.value;
                                                  setTempConfig({...tempConfig, notificationEmails: newEmails});
                                              }} 
                                          />
                                          {idx === arr.length - 1 && (
                                              <button 
                                                  onClick={() => setTempConfig({...tempConfig, notificationEmails: [...arr, '']})}
                                                  className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-100 transition-colors flex-shrink-0"
                                                  title="Añadir otro correo"
                                              >
                                                  <i className="fas fa-plus"></i>
                                              </button>
                                          )}
                                      </div>
                                  ))}
                              </div>
                          </div>
                      </section>

                      {/* SECCIÓN URLs DE DESTINO */}
                      <section className="space-y-4">
                          <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest border-b pb-2">URLs de Destino</h3>
                          <div className="space-y-4">
                              <Input 
                                  label="URL Base para Conclusión (Opcional)" 
                                  placeholder="https://tudominio.com"
                                  value={tempConfig.conclusionBaseUrl || ''} 
                                  onChange={e => setTempConfig({...tempConfig, conclusionBaseUrl: e.target.value})} 
                              />
                              <p className="text-[10px] text-slate-400 italic -mt-3">Si se deja en blanco, se usará el dominio actual.</p>
                              
                              <Input 
                                  label="URL para Reservas (Botón 'Agendar Sesión')" 
                                  placeholder="https://example.com/reserva"
                                  value={tempConfig.bookingUrl || ''} 
                                  onChange={e => setTempConfig({...tempConfig, bookingUrl: e.target.value})} 
                              />
                              
                              <Input 
                                  label="URL de Información (Botón 'Saber Más')" 
                                  placeholder="https://example.com/terapias"
                                  value={tempConfig.therapiesInfoUrl || ''} 
                                  onChange={e => setTempConfig({...tempConfig, therapiesInfoUrl: e.target.value})} 
                              />
                          </div>
                      </section>

                      {/* SECCIÓN MENSAJES ADJUNTOS */}
                      <section className="space-y-6">
                          <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest border-b pb-2">Mensajes de Envío</h3>
                          
                          <div className="space-y-3">
                              <label className="text-xs font-bold text-slate-500 uppercase block">Mensaje de Enlace al Cuestionario</label>
                              <p className="text-[10px] text-slate-400 italic mb-1">Usa [Nombre], [Link] y [PIN] como variables.</p>
                              <textarea 
                                  className="w-full h-32 p-4 rounded-xl border-2 border-slate-100 focus:border-blue-500 outline-none text-sm bg-slate-50"
                                  value={tempConfig.questionnaireMessage}
                                  onChange={e => setTempConfig({...tempConfig, questionnaireMessage: e.target.value})}
                              />
                          </div>

                          <div className="space-y-3">
                              <label className="text-xs font-bold text-slate-500 uppercase block">Mensaje de Conclusión Final</label>
                              <p className="text-[10px] text-slate-400 italic mb-1">Usa [Nombre], [Link] y [PIN] como variables.</p>
                              <textarea 
                                  className="w-full h-32 p-4 rounded-xl border-2 border-slate-100 focus:border-blue-500 outline-none text-sm bg-slate-50"
                                  value={tempConfig.conclusionMessage}
                                  onChange={e => setTempConfig({...tempConfig, conclusionMessage: e.target.value})}
                              />
                          </div>
                      </section>

                      {/* --- AJUSTES SENSIBLES --- */}
                      {(!globalConfig?.authorizedEmails || globalConfig.authorizedEmails.split(',').map((e: string) => e.trim().toLowerCase()).includes(profile.email.toLowerCase())) && (
                          <div className="mt-12 pt-8 border-t-4 border-red-100">
                              <div className="mb-6 pb-2 border-b-2 border-red-200 flex items-center gap-3">
                                  <i className="fas fa-shield-alt text-red-500 text-2xl"></i>
                                  <div>
                                      <h2 className="text-xl font-black text-red-800 uppercase tracking-widest">Ajustes Sensibles</h2>
                                      <p className="text-sm text-red-600">Configuración crítica del sistema. Solo visible para administradores autorizados.</p>
                                  </div>
                              </div>

                              <div className="space-y-10">
                                  {/* SECCIÓN CORREOS AUTORIZADOS */}
                                  <section className="space-y-4">
                                      <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest border-b pb-2">Acceso a Ajustes Sensibles</h3>
                                      <div className="max-w-md">
                                          <Input 
                                              label="Correos Autorizados (separados por coma)" 
                                              placeholder="admin@ejemplo.com, otro@ejemplo.com"
                                              value={tempConfig.authorizedEmails || ''} 
                                              onChange={e => setTempConfig({...tempConfig, authorizedEmails: e.target.value})} 
                                          />
                                          <p className="text-[10px] text-slate-400 italic mt-1">Si se deja en blanco, cualquier coordinador podrá ver esta sección.</p>
                                      </div>
                                  </section>

                                  {/* SECCIÓN CLAVE DE ACCESO */}
                                  <section className="space-y-4">
                                      <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest border-b pb-2">Clave de Acceso General</h3>
                                      <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 flex items-start gap-3">
                                          <i className="fas fa-exclamation-triangle text-amber-500 mt-1"></i>
                                          <p className="text-sm text-amber-800">
                                              Esta clave condiciona el acceso inicial a la app. Su pérdida u olvido supone la imposibilidad de acceso, recuperación o cambio de clave.
                                          </p>
                                      </div>
                                      <div className="flex items-end gap-4 max-w-md">
                                          <div className="flex-1">
                                              <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Clave Actual: <span className="text-blue-600 ml-1">{tempConfig.accessCode}</span></label>
                                              <Input 
                                                  label="Nueva Clave"
                                                  placeholder="Nueva clave (5 dígitos)" 
                                                  maxLength={5} 
                                                  value={newAccessCode} 
                                                  onChange={e => setNewAccessCode(e.target.value.replace(/\D/g, ''))}
                                              />
                                          </div>
                                          <Button 
                                            onClick={() => setShowConfirmAccessCode(true)} 
                                            disabled={newAccessCode.length < 5}
                                            className="mb-1"
                                          >
                                              Cambiar
                                          </Button>
                                      </div>
                                  </section>

                                  {/* SECCIÓN PROMPTS IA */}
                                  <section className="space-y-6">
                                      <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest border-b pb-2">Instrucciones de IA (Prompts)</h3>
                                      
                                      <div className="space-y-3">
                                          <label className="text-xs font-bold text-slate-500 uppercase block">Prompt para Valoración Clínica (Interno)</label>
                                          <textarea 
                                              className="w-full h-48 p-4 rounded-xl border-2 border-slate-100 focus:border-blue-500 outline-none text-sm font-mono bg-slate-50"
                                              value={tempConfig.clinicalPrompt}
                                              onChange={e => setTempConfig({...tempConfig, clinicalPrompt: e.target.value})}
                                          />
                                          <div className="text-right text-xs text-slate-400">
                                              Prompt interno: {tempConfig.clinicalPrompt?.length || 0} caracteres
                                          </div>
                                      </div>

                                      <div className="space-y-3">
                                          <label className="text-xs font-bold text-slate-500 uppercase block">Prompt para Conclusión Final (Paciente)</label>
                                          <textarea 
                                              className="w-full h-48 p-4 rounded-xl border-2 border-slate-100 focus:border-blue-500 outline-none text-sm font-mono bg-slate-50"
                                              value={tempConfig.conclusionPrompt}
                                              onChange={e => setTempConfig({...tempConfig, conclusionPrompt: e.target.value})}
                                          />
                                          <div className="text-right text-xs text-slate-400">
                                              Prompt conclusión: {tempConfig.conclusionPrompt?.length || 0} caracteres
                                          </div>
                                      </div>
                                      
                                      <div className="mt-2 text-xs italic text-amber-600">
                                          Los cambios se aplican al pulsar Guardar Todos los Ajustes y se usarán en los próximos informes generados.
                                      </div>
                                  </section>

                                  {/* SECCIÓN PANEL INFORMATIVO IA */}
                                  <section className="space-y-6">
                                      <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest border-b pb-2">Estado de Proveedores IA (Panel Informativo)</h3>
                                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                          <p className="text-sm text-slate-600 mb-4">
                                              Este panel muestra el estado operativo de los motores de IA configurados. El sistema está preparado para utilizar un proveedor alternativo (fallback) si el principal falla o agota su cuota. <strong>No se muestran ni se guardan claves API aquí por seguridad.</strong>
                                          </p>
                                          
                                          <div className="flex items-center gap-3 mb-6">
                                              <label className="text-sm font-bold text-slate-700">Fallback Automático Activado:</label>
                                              <button 
                                                  onClick={() => setTempConfig({...tempConfig, aiFallbackEnabled: !tempConfig.aiFallbackEnabled})}
                                                  className={`w-12 h-6 rounded-full relative transition-colors ${tempConfig.aiFallbackEnabled ? 'bg-green-500' : 'bg-slate-300'}`}
                                              >
                                                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${tempConfig.aiFallbackEnabled ? 'left-7' : 'left-1'}`}></div>
                                              </button>
                                          </div>

                                          <div className="space-y-4">
                                              {[0, 1, 2].map((index) => {
                                                  const provider = tempConfig.aiProviders?.[index] || {
                                                      id: `slot-${index+1}`,
                                                      provider: index === 0 ? 'google' : 'none',
                                                      model: index === 0 ? 'gemini-3.1-pro-preview' : '',
                                                      enabled: index === 0,
                                                      priority: index + 1,
                                                      status: index === 0 ? 'active' : 'standby',
                                                      reportsGenerated: 0
                                                  };
                                                  
                                                  const getProviderVisualStatus = (providerKey: string, priority: number) => {
                                                      if (!aiTestResult) {
                                                        return priority === 1
                                                          ? { label: "SIN COMPROBAR", tone: "warning" }
                                                          : { label: "STANDBY", tone: "neutral" };
                                                      }

                                                      if (providerKey === "google") {
                                                        if (aiTestResult.ok) {
                                                          return { label: "OPERATIVO", tone: "success" };
                                                        }

                                                        if (aiTestResult.hasKey === false) {
                                                          return { label: "SIN CLAVE", tone: "error" };
                                                        }

                                                        return { label: "ERROR", tone: "error" };
                                                      }

                                                      return { label: "STANDBY", tone: "neutral" };
                                                  };
                                                  
                                                  const visualStatus = getProviderVisualStatus(provider.provider, provider.priority);
                                                  const displayedModel = (provider.provider === 'google' && aiTestResult?.model) ? aiTestResult.model : provider.model;
                                                  
                                                  const getBorderBgClasses = (tone: string) => {
                                                      if (tone === 'success') return 'border-green-400 bg-green-50';
                                                      if (tone === 'warning') return 'border-amber-400 bg-amber-50';
                                                      if (tone === 'error') return 'border-red-400 bg-red-50';
                                                      return 'border-slate-200 bg-white';
                                                  };
                                                  
                                                  const getBadgeClasses = (tone: string) => {
                                                      if (tone === 'success') return 'bg-green-200 text-green-800';
                                                      if (tone === 'warning') return 'bg-amber-200 text-amber-800';
                                                      if (tone === 'error') return 'bg-red-200 text-red-800';
                                                      return 'bg-slate-200 text-slate-600';
                                                  };
                                                  
                                                  return (
                                                      <div key={index} className={`p-4 rounded-xl border-2 ${getBorderBgClasses(visualStatus.tone)}`}>
                                                          <div className="flex justify-between items-start mb-2">
                                                              <div className="flex items-center gap-2">
                                                                  <span className="font-black text-slate-700">Prioridad {provider.priority}</span>
                                                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${getBadgeClasses(visualStatus.tone)}`}>
                                                                      {visualStatus.label}
                                                                  </span>
                                                              </div>
                                                              <div className="text-xs text-slate-500">
                                                                  Informes: <span className="font-bold">{provider.reportsGenerated}</span>
                                                              </div>
                                                          </div>
                                                          <div className="grid grid-cols-2 gap-4">
                                                              <div>
                                                                  <label className="text-[10px] font-bold text-slate-400 uppercase">Proveedor</label>
                                                                  <div className="text-sm font-bold text-slate-800">{provider.provider || 'No configurado'}</div>
                                                              </div>
                                                              <div>
                                                                  <label className="text-[10px] font-bold text-slate-400 uppercase">Modelo</label>
                                                                  <div className="text-sm font-mono text-slate-600">{displayedModel || '-'}</div>
                                                              </div>
                                                          </div>
                                                          {visualStatus.tone === 'error' && visualStatus.label === 'ERROR' && aiTestResult && !aiTestResult.ok && provider.provider === 'google' && (
                                                              <div className="mt-2 text-xs text-red-600 bg-red-100 p-2 rounded">
                                                                  <strong>Último error:</strong> {aiTestResult.errorName}
                                                              </div>
                                                          )}
                                                          {provider.status === 'failed' && provider.lastErrorCode && visualStatus.tone !== 'error' && (
                                                              <div className="mt-2 text-xs text-red-600 bg-red-100 p-2 rounded">
                                                                  <strong>Último error:</strong> {provider.lastErrorCode}
                                                              </div>
                                                          )}
                                                      </div>
                                                  );
                                              })}
                                          </div>

                                          <div className="mt-8 pt-6 border-t border-slate-200">
                                              <div className="flex items-center justify-between mb-4">
                                                  <div>
                                                      <h4 className="font-bold text-slate-800">Diagnóstico de Conexión</h4>
                                                      <p className="text-xs text-slate-500">Prueba la API Key y el Modelo sin datos de pacientes.</p>
                                                  </div>
                                                  <button 
                                                      onClick={handleTestAI} 
                                                      disabled={isTestingAI}
                                                      className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                                                  >
                                                      {isTestingAI ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-plug"></i>}
                                                      Probar IA
                                                  </button>
                                              </div>
                                              
                                              {aiTestResult && (
                                                  <div className={`p-4 rounded-xl border text-sm ${aiTestResult.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                                      <div className="flex items-center gap-2 mb-2 font-bold uppercase tracking-wider text-xs">
                                                        <span className={aiTestResult.ok ? 'text-green-700' : 'text-red-700'}>
                                                          Estado: {aiTestResult.ok ? 'OK' : 'ERROR'}
                                                        </span>
                                                      </div>
                                                      <div className="grid grid-cols-2 gap-2 text-xs mb-3 text-slate-700">
                                                          <div><span className="font-bold">Provider:</span> {aiTestResult.provider}</div>
                                                          <div><span className="font-bold">Model:</span> {aiTestResult.model}</div>
                                                          <div><span className="font-bold">Has Key:</span> {aiTestResult.hasKey ? 'Sí' : 'No'}</div>
                                                          <div><span className="font-bold">Key Source:</span> {aiTestResult.keySource}</div>
                                                      </div>
                                                      
                                                      {aiTestResult.ok && aiTestResult.preview && (
                                                          <div className="text-xs bg-white p-2 rounded border border-green-100 text-slate-600 font-mono">
                                                              <strong>Preview:</strong> {aiTestResult.preview}
                                                          </div>
                                                      )}
                                                      
                                                      {!aiTestResult.ok && (
                                                          <div className="text-xs bg-white p-2 rounded border border-red-100 text-red-600">
                                                              <strong>{aiTestResult.errorName}:</strong> {aiTestResult.errorMessage}
                                                          </div>
                                                      )}
                                                  </div>
                                              )}
                                          </div>
                                      </div>
                                  </section>
                              </div>
                          </div>
                      )}
                  </div>

                  <div className="p-6 border-t bg-slate-50 flex justify-end gap-4">
                      <Button variant="outline" onClick={() => setShowSettingsModal(false)}>Cancelar</Button>
                      <Button onClick={handleSaveSettings} className="bg-blue-600 hover:bg-blue-700">Guardar Todos los Ajustes</Button>
                  </div>
              </div>
          </div>
      )}

      {/* MODAL CONFIRMACIÓN CLAVE ACCESO */}
      {showConfirmAccessCode && (
          <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
              <Card className="w-full max-w-md shadow-2xl border-2 border-amber-200">
                  <div className="text-center space-y-4">
                      <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto text-2xl">
                          <i className="fas fa-exclamation-triangle"></i>
                      </div>
                      <h3 className="text-xl font-bold text-slate-800">¿Confirmar cambio de clave?</h3>
                      <p className="text-sm text-slate-600">
                          Estás a punto de cambiar la clave general de acceso a <span className="font-bold text-blue-600 text-lg">{newAccessCode}</span>.
                      </p>
                      <p className="text-xs text-red-500 font-bold">
                          RECUERDA: Si olvidas esta clave, no podrás acceder a la aplicación ni recuperarla.
                      </p>
                      <div className="flex gap-3 pt-4">
                          <Button onClick={() => setShowConfirmAccessCode(false)} variant="outline" className="flex-1">Cancelar</Button>
                          <Button onClick={handleConfirmAccessCodeChange} className="flex-1 bg-amber-500 hover:bg-amber-600">Confirmar Cambio</Button>
                      </div>
                  </div>
              </Card>
          </div>
      )}

      {/* VISTA AMPLIADA DE PACIENTES */}
      {showPatientsExpandedView && (
          <div className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-hidden">
              <div className="bg-slate-50 w-full max-w-7xl h-[92vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
                  <div className="p-6 border-b bg-white flex justify-between items-center z-10 shrink-0">
                      <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                          <i className="fas fa-users text-blue-600"></i> Gestión de pacientes
                      </h2>
                      <button onClick={() => setShowPatientsExpandedView(false)} className="text-slate-400 hover:text-red-500 text-2xl transition-colors">
                          <i className="fas fa-times"></i>
                      </button>
                  </div>
                  
                  <div className="p-6 border-b bg-white flex flex-wrap items-center gap-4 shrink-0 z-10">
                      {showDeletedMode && (
                          <div className="flex items-center gap-2">
                              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer p-2 rounded hover:bg-slate-50 transition-colors">
                                  <input 
                                      type="checkbox" 
                                      className="rounded text-red-500 focus:ring-red-400 focus:ring-offset-0 bg-slate-100 border-slate-300 w-4 h-4 cursor-pointer"
                                      checked={expandedPatients.length > 0 && expandedPatients.filter(p => p.status === 'deleted').every(p => selectedDeletedPatientIds.includes(p.id))}
                                      onChange={(e) => {
                                          if (e.target.checked) {
                                              const visibleDeletedIds = expandedPatients.filter(p => p.status === 'deleted').map(p => p.id);
                                              setSelectedDeletedPatientIds(visibleDeletedIds);
                                          } else {
                                              clearDeletedPatientSelection();
                                          }
                                      }}
                                  />
                                  <span className="hidden sm:inline font-bold text-slate-500">Todo visible</span>
                              </label>
                              <button
                                  onClick={permanentlyDeleteSelectedPatients}
                                  disabled={selectedDeletedPatientIds.length === 0}
                                  className={`px-3 py-2 text-sm font-bold rounded-xl transition-colors flex items-center gap-2 border ${
                                      selectedDeletedPatientIds.length > 0
                                          ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                          : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                                  }`}
                                  title="Eliminar seleccionados definitivamente"
                              >
                                  <i className="fas fa-trash-alt"></i>
                                  {selectedDeletedPatientIds.length > 0 && (
                                      <span className="hidden sm:inline">Eliminar ({selectedDeletedPatientIds.length})</span>
                                  )}
                              </button>
                          </div>
                      )}
                      
                      <div className="relative flex-1 min-w-[250px]">
                          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                          <input 
                              type="text" 
                              placeholder="Buscar por nombre, email o teléfono..." 
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all text-sm"
                          />
                      </div>
                      <select 
                          value={filterStatus}
                          onChange={(e) => setFilterStatus(e.target.value)}
                          className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 text-sm font-medium text-slate-700"
                          disabled={showDeletedMode}
                      >
                          <option value="all">Todos los estados</option>
                          <option value="pending">Pendientes</option>
                          <option value="sent">Enviados</option>
                          <option value="viewed">Vistos</option>
                          <option value="completed">Completados</option>
                          <option value="concluded">Concluidos</option>
                          <option value="finalized">Finalizados</option>
                      </select>

                      <div className="flex gap-2 items-center">
                          <select 
                              value={patientsSortMode} 
                              onChange={(e) => setPatientsSortMode(e.target.value as any)}
                              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 text-sm font-medium text-slate-700"
                          >
                              <option value="lastActivity">Última actividad</option>
                              <option value="alphabetical">Alfabético</option>
                              <option value="dateSent">Envío cuestionario</option>
                              <option value="dateAnswered">Cuestionario completado</option>
                              <option value="dateConclusionSent">Conclusión realizada</option>
                              <option value="status">Estado</option>
                          </select>
                          <button
                              onClick={() => setPatientsSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                              title={patientsSortDirection === 'asc' ? 'Orden ascendente' : 'Orden descendente'}
                              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors text-slate-600"
                          >
                              <i className={`fas ${patientsSortDirection === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down'}`}></i>
                          </button>
                      </div>

                      <button 
                          onClick={() => {
                              const nextMode = !showDeletedMode;
                              setShowDeletedMode(nextMode);
                              setFilterStatus('all');
                          }} 
                          className={`px-4 py-2 rounded-xl text-sm font-bold uppercase tracking-wider transition-colors border flex items-center gap-2 ${
                              showDeletedMode 
                              ? 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200' 
                              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700'
                          }`}
                      >
                          {showDeletedMode ? 'Volver a activos' : (
                              <><i className="fas fa-trash-alt"></i> Papelera {deletedCount > 0 ? `(${deletedCount})` : ''}</>
                          )}
                      </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                      {showDeletedMode && selectedDeletedPatientIds.length > 0 && (
                          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-xl text-sm font-medium mb-4 flex justify-between items-center">
                              <span>{selectedDeletedPatientIds.length} ficha(s) seleccionada(s) para borrado definitivo.</span>
                          </div>
                      )}
                      {expandedPatients.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                              <i className="fas fa-folder-open text-4xl mb-4"></i>
                              <p className="text-lg font-medium">{showDeletedMode ? 'La papelera está vacía' : 'No se encontraron pacientes'}</p>
                          </div>
                      ) : (
                          <div className="space-y-3">
                              {expandedPatients.map((p) => {
                                  const isSoyBienestar = p.source === 'soybienestar' || p.directAccessCreated || p.soybienestarUid || p.sourceRequestId;
                                  const needsReview = isSoyBienestar && !p.therapistReviewedAt;
                                  const displayName = p.nombre || (p as any).displayName || p.email || "Paciente sin nombre";
                                  
                                  return (
                                      <div key={p.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-all shadow-sm hover:shadow-md ${needsReview ? 'border-amber-300 bg-amber-50/60' : 'bg-white border-slate-200 hover:border-blue-200'}`}>
                                          <div className="flex-1 min-w-[200px]">
                                              <div className="flex items-center gap-2">
                                                  {showDeletedMode && (
                                                      <input 
                                                          type="checkbox"
                                                          checked={selectedDeletedPatientIds.includes(p.id)}
                                                          onChange={(e) => { e.stopPropagation(); toggleDeletedPatientSelection(p.id); }}
                                                          onClick={(e) => e.stopPropagation()}
                                                          className="rounded cursor-pointer border-slate-300 text-red-500 focus:ring-red-500 w-4 h-4 shrink-0"
                                                          aria-label={`Seleccionar ${displayName} para borrado definitivo`}
                                                      />
                                                  )}
                                                  <button onClick={() => openPatientDetails(p)} className="text-left text-base font-bold text-blue-700 hover:text-blue-900 hover:underline truncate transition-colors block w-full">{displayName}</button>
                                              </div>
                                              <div className="flex items-center gap-2 mt-1">
                                                <span className={`text-xs font-bold truncate ${needsReview ? 'text-amber-600' : 'text-slate-400'}`}>{p.email}</span>
                                                {isSoyBienestar && (
                                                    <span className="shrink-0 bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[9px] font-black tracking-widest uppercase border border-blue-100">SoyBienestar</span>
                                                )}
                                              </div>
                                          </div>
                                          
                                          <div className="hidden md:flex flex-col text-xs text-slate-500 w-[180px] shrink-0">
                                              <span>Registro: {p.dateSent ? formatDate(p.dateSent) : (p.directQuestionnaireUrlCreatedAt ? formatDate(p.directQuestionnaireUrlCreatedAt) : 'Pendiente')}</span>
                                              <span>Cuestionario: {p.dateAnswered ? formatDate(p.dateAnswered) : 'Pendiente'}</span>
                                              <span>Dosier: {p.dateConclusionSent ? formatDate(p.dateConclusionSent) : 'Pendiente'}</span>
                                          </div>

                                          <div className="w-[120px] shrink-0 flex flex-col items-center gap-1">
                                                <div className={`text-[10px] font-black uppercase tracking-tighter px-2 py-1 rounded w-full text-center ${
                                                    p.status === 'completed' ? 'bg-teal-100 text-teal-800' : 
                                                    p.status === 'pending' ? 'bg-amber-50 text-amber-700' : 
                                                    p.status === 'sent' ? 'bg-indigo-50 text-indigo-700' : 
                                                    p.status === 'viewed' ? 'bg-blue-50 text-blue-700' : 
                                                    p.status === 'concluded' ? 'bg-purple-50 text-purple-700' : 
                                                    p.status === 'finalized' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'
                                                }`}>
                                                    {statusLabels[p.status]}
                                                </div>
                                                {!(showDeletedMode || (p.status as any) === 'deleted') && (
                                                    <div className="flex gap-1 w-full mt-1">
                                                        <button 
                                                            onClick={() => changeStatus(p.id, 'backward')}
                                                            disabled={p.status === 'pending'}
                                                            className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed rounded py-1 transition-colors border border-slate-100"
                                                        >
                                                            <i className="fas fa-chevron-left text-[10px]"></i>
                                                        </button>
                                                        <button 
                                                            onClick={() => changeStatus(p.id, 'forward')}
                                                            disabled={p.status === 'finalized'}
                                                            className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed rounded py-1 transition-colors border border-slate-100"
                                                        >
                                                            <i className="fas fa-chevron-right text-[10px]"></i>
                                                        </button>
                                                    </div>
                                                )}
                                          </div>

                                          <div className="flex items-center gap-2 shrink-0 border-l pl-4 border-slate-100">
                                              {(p.status === 'completed' || p.status === 'concluded' || p.status === 'finalized') && !(showDeletedMode || (p.status as any) === 'deleted') && (
                                                  <>
                                                    <button onClick={() => openResultsModal(p)} className="px-3 py-2 text-xs font-bold bg-blue-50 text-blue-600 border border-blue-100 rounded-lg hover:bg-blue-100 transition-colors" title="Resultados">
                                                        <i className="fas fa-eye"></i>
                                                    </button>
                                                    <button onClick={() => openConclusionModal(p)} className="px-3 py-2 text-xs font-bold bg-purple-50 text-purple-600 border border-purple-100 rounded-lg hover:bg-purple-100 transition-colors" title="Conclusión">
                                                        <i className="fas fa-brain"></i>
                                                    </button>
                                                  </>
                                              )}
                                              
                                              {showDeletedMode || (p.status as any) === 'deleted' ? (
                                                  <button onClick={() => restoreRecord(p.id)} className="px-3 py-2 text-xs font-bold bg-teal-50 text-teal-600 border border-teal-100 rounded-lg hover:bg-teal-100 transition-colors flex items-center gap-2">
                                                      <i className="fas fa-undo"></i> Restaurar
                                                  </button>
                                              ) : (
                                                  <button onClick={() => deleteRecord(p.id, p.status)} className="px-3 py-2 text-xs font-bold bg-red-50 text-red-400 border border-red-50 rounded-lg hover:bg-red-100 hover:text-red-500 transition-colors">
                                                      <i className="fas fa-trash"></i>
                                                  </button>
                                              )}
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
