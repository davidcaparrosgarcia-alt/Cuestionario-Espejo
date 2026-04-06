
import React, { useState, useEffect } from 'react';
import { Card, Button, Input, Logo, Toast } from './UI';
import { PatientData, CoordinatorProfile, AuthUser } from '../types';
import { QUESTIONS } from '../constants';
import { DataService } from '../services/dataService';

interface DashboardProps {
  profile: CoordinatorProfile;
  fullProfile: AuthUser | null;
  onProfileUpdate: (data: Partial<AuthUser>) => void;
  onLogout: () => void;
  onEnterEditMode: () => void;
}

const safeBtoa = (str: string) => {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
      function toSolidBytes(match, p1) {
          return String.fromCharCode(parseInt(p1, 16));
  }));
};

const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Pendiente';
    return new Date(timestamp).toLocaleDateString() + ' ' + new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
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
  
  // Estados para Ajustes
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [globalConfig, setGlobalConfig] = useState<any>(null);
  const [tempConfig, setTempConfig] = useState<any>(null);
  const [showConfirmAccessCode, setShowConfirmAccessCode] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState('');

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicatePatientRecord, setDuplicatePatientRecord] = useState<PatientData | null>(null);
  const [pendingGenerateData, setPendingGenerateData] = useState<any>(null);
  
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

  useEffect(() => {
    const fetchPendingRequests = async () => {
      try {
        const res = await fetch('/api/requests');
        if (res.ok) {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const data = await res.json();
            setPendingRequests(data);
          } else {
            console.warn("Received non-JSON response from /api/requests");
          }
        } else {
          console.error(`Error fetching pending requests: ${res.status} ${res.statusText}`);
        }
      } catch (error) {
        console.error("Error fetching pending requests:", error);
      }
    };
    fetchPendingRequests();
    
    // Poll every 30 seconds
    const interval = setInterval(fetchPendingRequests, 30000);
    return () => clearInterval(interval);
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
    const loadPatients = async () => {
      try {
        const config = await DataService.getGlobalConfig({
            accessCode: '66099',
            clinicalPrompt: DEFAULT_CLINICAL_PROMPT,
            conclusionPrompt: DEFAULT_CONCLUSION_PROMPT,
            questionnaireMessage: `Hola [Nombre],\n\nAquí tienes tu enlace directo para realizar el Cuestionario Espejo:\n[Link]\n\nIMPORTANTE: Tu clave de acceso personal para ver los resultados finales será: [PIN]\nPor favor, guárdala bien, ya que la necesitarás obligatoriamente más adelante para desbloquear la conclusión.\n\nGracias.`,
            conclusionMessage: `Hola [Nombre],\n\nYa están disponibles tus resultados del Cuestionario Espejo.\n\nPuedes acceder a ellos a través del siguiente enlace:\n[Link]\n\nIMPORTANTE: Se te pedirá la clave numérica de 4 dígitos que se te entregó al iniciar el cuestionario ([PIN]).`,
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

        const patients = await DataService.getPatients(profile.email);
        const sampleId = `sample-martin-${profile.email.replace(/[@.]/g, '-')}`;
        
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

  const selectPendingRequest = (req: any) => {
      setPatient({
          nombre: req.nombre || '',
          email: req.email || '',
          edad: req.edad || '',
          sexo: req.sexo || '',
          observaciones: req.observaciones || '',
          telefono: req.telefono || ''
      });
      if (req.phonePrefix) setPhonePrefix(req.phonePrefix);
      setSelectedPendingRequestId(req.id);
      setShowRequestsDropdown(false);
  };

  const deletePendingRequest = async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      try {
          await fetch(`/api/requests/${id}`, { method: 'DELETE' });
          setPendingRequests(prev => prev.filter(r => r.id !== id));
      } catch (error) {
          console.error("Error deleting request:", error);
      }
  };

  const deleteRecord = async (id: string) => {
    const updated = registry.filter(r => r.id !== id);
    setRegistry(updated);
    try {
      await DataService.deletePatient(id);
      
      // Si es el paciente de ejemplo, marcamos en el perfil que ha sido borrado
      const sampleId = `sample-martin-${profile.email.replace(/[@.]/g, '-')}`;
      if (id === sampleId) {
          const update = { samplePatientDeleted: true };
          await DataService.updateUser(profile.email, update);
          onProfileUpdate(update);
      }
      
      triggerToast("Registro eliminado correctamente");
    } catch (e) {
      triggerToast("Error al eliminar el registro");
    }
  };

  const toggleStatus = async (id: string) => {
    let newStatus: 'pending' | 'sent' = 'pending';
    const updated = registry.map(r => {
      if (r.id === id) {
        if (r.status === 'pending') {
            newStatus = 'sent';
            return { ...r, status: 'sent' as const };
        } else if (r.status === 'sent') {
            newStatus = 'pending';
            return { ...r, status: 'pending' as const };
        }
      }
      return r;
    });
    
    setRegistry(updated);
    try {
      await DataService.updatePatient(id, { status: newStatus });
      triggerToast(`Estado actualizado a ${newStatus.toUpperCase()}`);
    } catch (e) {
      triggerToast("Error al actualizar el estado");
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
    
    let finalName = patient.nombre.trim();
    let idEncoded = '';
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
    
    if (isNewRecord) {
        accessPin = Math.floor(1000 + Math.random() * 9000).toString();
        const payload = { 
          nombre: finalName, 
          email: patient.email,
          telefono: fullPhone, 
          edad: patient.edad, 
          sexo: patient.sexo, 
          coordinatorEmail: profile.email,
          timestamp: now
        };
        idEncoded = safeBtoa(JSON.stringify(payload));
    } else {
        accessPin = existingRecord!.accessPin || Math.floor(1000 + Math.random() * 9000).toString();
        idEncoded = existingRecord!.id;
    }
    
    setLastGeneratedPin(accessPin);

    try {
        const baseUrl = window.location.origin + window.location.pathname;
        const url = `${baseUrl}#/session?p=${idEncoded}`;
        
        setLinkGenerated(url);
        
        let body = globalConfig?.questionnaireMessage || `Hola [Nombre],\n\nAquí tienes tu enlace directo para realizar el Cuestionario Espejo:\n[Link]\n\nIMPORTANTE: Tu clave de acceso personal para ver los resultados finales será: [PIN]\nPor favor, guárdala bien, ya que la necesitarás obligatoriamente más adelante para desbloquear la conclusión.\n\nGracias.`;
        
        body = body.replace(/\[Nombre\]/g, finalName.split(' ')[0])
                   .replace(/\[Link\]/g, url)
                   .replace(/\[PIN\]/g, accessPin);

        if (isNewRecord) {
            // If we are replacing, delete the old record first
            if (forceAction === 'replace' && existingRecord) {
                await DataService.deletePatient(existingRecord.id);
                setRegistry(prev => prev.filter(r => r.id !== existingRecord!.id));
            }

            const newRecord: PatientData = { 
              ...patient as PatientData, 
              nombre: finalName,
              telefono: fullPhone,
              id: idEncoded, 
              coordinatorEmail: profile.email,
              status: 'pending', 
              dateSent: now,
              accessPin: accessPin
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
                sexo: patient.sexo
            };
            setRegistry(prev => prev.map(r => r.id === idEncoded ? updatedRecord : r));
            await DataService.updatePatient(idEncoded, { 
                dateSent: now, 
                status: 'sent',
                email: patient.email,
                telefono: fullPhone,
                edad: patient.edad,
                sexo: patient.sexo
            });
        }

        let subject = isResend ? "Actualización Importante: Cuestionario Espejo" : "Tu enlace para el Cuestionario Espejo";
        
        const smsBody = `Hola ${finalName.split(' ')[0]}, enlace: ${url} . CLAVE DE ACCESO: ${accessPin} (Guárdala).`;

        if (sendMethods.email) {
            const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(patient.email || '')}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.open(gmailUrl, '_blank');
        }

        if (sendMethods.whatsapp && fullPhone) {
            const cleanPhone = fullPhone.replace(/\D/g, '');
            window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`, '_blank');
        }

        if (sendMethods.sms && fullPhone) {
            window.open(`sms:${fullPhone}?body=${encodeURIComponent(smsBody)}`, '_blank');
        }

        if (selectedPendingRequestId) {
            setPendingRequests(prev => prev.filter(r => r.id !== selectedPendingRequestId));
            setSelectedPendingRequestId(null);
        }

        triggerToast(isResend ? "Cuestionario reenviado con PIN" : `Enlace generado. PIN: ${accessPin}`);
    } catch (e) {
        console.error(e);
        triggerToast("Error al generar el enlace");
    } finally {
        setIsGenerating(false);
        setShowDuplicateModal(false);
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
    setEditingConclusion(p.finalConclusion || EXTERNAL_PATIENT_EXAMPLE);
    setEditingAudio(p.audioConclusion);
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          if (file.size > 700000) {
              triggerToast("El archivo de audio es demasiado grande. Por favor, usa un clip corto o comprimido (Max 700KB).");
              return;
          }
          const reader = new FileReader();
          reader.onload = (ev) => {
              setEditingAudio(ev.target?.result as string);
          };
          reader.readAsDataURL(file);
      }
  };

  const handleSaveConclusion = async () => {
    if (!selectedPatientConclusion) return;
    const updatedPatient = { 
        ...selectedPatientConclusion, 
        finalConclusion: editingConclusion,
        audioConclusion: editingAudio 
    };
    setRegistry(registry.map(r => r.id === updatedPatient.id ? updatedPatient : r));
    await DataService.updatePatient(updatedPatient.id, { 
        finalConclusion: editingConclusion, 
        audioConclusion: editingAudio 
    });
    setSelectedPatientConclusion(updatedPatient);
    triggerToast("Conclusión y audio guardados correctamente");
  };

  const handleEditDetails = () => {
      if (selectedPatientDetails) {
          setTempPatientDetails(selectedPatientDetails);
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
    const baseUrl = window.location.origin + window.location.pathname;
    const url = `${baseUrl}#/conclusion?id=${encodeURIComponent(p.id)}`;
    
    let body = globalConfig?.conclusionMessage || `Hola [Nombre],\n\nYa están disponibles tus resultados del Cuestionario Espejo.\n\nPuedes acceder a ellos a través del siguiente enlace:\n[Link]\n\nIMPORTANTE: Se te pedirá la clave numérica de 4 dígitos que se te entregó al iniciar el cuestionario ([PIN]).`;
    
    body = body.replace(/\[Nombre\]/g, p.nombre.split(' ')[0])
               .replace(/\[Link\]/g, url)
               .replace(/\[PIN\]/g, p.accessPin || 'Consulta con tu coordinador');
               
    return { url, body };
  };

  const markAsConcluded = (id: string) => {
      const now = Date.now();
      setRegistry(registry.map(r => {
        if (r.id === id) {
            const updated = { ...r, status: 'concluded' as const, dateConclusionSent: now, conclusionViews: 0 };
            DataService.updatePatient(id, { status: 'concluded', dateConclusionSent: now, conclusionViews: 0 });
            return updated;
        }
        return r;
      }));
  };

  const handleSendConclusionLink = () => {
    if (!selectedPatientConclusion) return;
    const { url, body } = getConclusionUrlAndBody(selectedPatientConclusion);
    const subject = "Resultados y Conclusión - Cuestionario Espejo";
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(selectedPatientConclusion.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');
    
    markAsConcluded(selectedPatientConclusion.id);
    triggerToast("Gmail abierto y estado actualizado a Concluido");
  };

  const handleSendConclusionWhatsApp = () => {
    if (!selectedPatientConclusion || !selectedPatientConclusion.telefono) {
      triggerToast("El paciente no tiene teléfono registrado.");
      return;
    }
    const { body } = getConclusionUrlAndBody(selectedPatientConclusion);
    const cleanPhone = selectedPatientConclusion.telefono.replace(/\D/g, '');
    
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`, '_blank');
    
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
                        <span class="value">${p.accessPin || 'N/A'}</span>
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
                .value { font-size: 14px; font-weight: bold; color: #0f172a; line-height: 1.4; }
                .observations-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 10px; font-style: italic; }
                .clinical-report { background: #f0f7ff; border-left: 5px solid #2563eb; padding: 30px; border-radius: 0 10px 10px 0; white-space: pre-wrap; font-size: 14px; line-height: 1.8; text-align: justify; margin-top: 10px; }
                .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center; font-size: 10px; color: #94a3b8; }
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
                        <td style="width: 33%;">
                            <span class="label">Teléfono</span>
                            <span class="value">${p.telefono || 'N/A'}</span>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <span class="label">Email</span>
                            <span class="value">${p.email}</span>
                        </td>
                        <td>
                             <span class="label">PIN ACCESO CONCLUSIÓN</span>
                             <span class="value" style="color: #2563eb;">${p.accessPin || 'N/A'}</span>
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
                            <span class="label">ID Registro</span>
                            <span class="value" style="font-size: 10px; font-family: monospace;">${p.id.substring(0, 12)}...</span>
                        </td>
                    </tr>
                </table>
            </div>

            <div class="section">
                <div class="section-title">Observaciones Iniciales</div>
                <div class="observations-box">${p.observaciones || "Sin observaciones."}</div>
            </div>
            
            <div class="section">
                <div class="section-title">Valoración Clínica / Coaching (Uso Interno)</div>
                <div class="clinical-report">${p.conversationSummary || "Pendiente de valoración técnica."}</div>
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

  const filteredRegistry = registry.filter(p => {
      const matchesSearch = searchTerm === '' || 
          p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) || 
          p.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (p.telefono && p.telefono.includes(searchTerm));
      
      const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
      
      // FILTRO DE FECHAS AÑADIDO
      const pDate = p.dateSent || 0;
      const startMs = dateStart ? new Date(dateStart).getTime() : 0;
      const endMs = dateEnd ? new Date(dateEnd).setHours(23,59,59,999) : Infinity;
      const matchesDate = pDate >= startMs && pDate <= endMs;

      return matchesSearch && matchesStatus && matchesDate;
  });

  return (
    <div className="min-h-screen overflow-y-auto relative">
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-cover bg-center -z-10" style={{backgroundImage: "url('https://images.unsplash.com/photo-1516550893923-42d28e5677af?q=80&w=2070&auto=format&fit=crop')"}}></div>

      {/* MODAL FICHA DE PACIENTE */}
      {selectedPatientDetails && (
          <div className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-sm">
             <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
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
                                        </select>
                                    </div>
                                </div>
                             </div>
                             
                             <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase">Observaciones Iniciales</label>
                                <textarea className="w-full p-3 border rounded-lg bg-slate-50 h-24" value={tempPatientDetails.observaciones} onChange={e => setTempPatientDetails({...tempPatientDetails, observaciones: e.target.value})} />
                             </div>

                             <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase">Valoración Clínica / Coaching (Uso Interno)</label>
                                <textarea className="w-full p-3 border rounded-lg bg-slate-50 h-64 font-medium leading-relaxed" value={tempPatientDetails.conversationSummary} onChange={e => setTempPatientDetails({...tempPatientDetails, conversationSummary: e.target.value})} />
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
                                        <span className="block text-xl font-bold text-blue-600 tracking-widest">{selectedPatientDetails.accessPin || "N/A"}</span>
                                    </div>
                                    <div className="col-span-2 mt-2">
                                        <span className="block text-xs font-bold text-slate-500 uppercase">Observaciones Iniciales</span>
                                        <p className="text-sm text-slate-700 bg-white p-3 rounded-lg border border-slate-100 italic">
                                            {selectedPatientDetails.observaciones || "Sin observaciones registradas."}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-lg font-black text-blue-900 uppercase tracking-widest border-b pb-2 mb-4">Valoración Clínica / Coaching (Uso Interno)</h3>
                                <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed whitespace-pre-line p-4 bg-blue-50/30 rounded-xl border border-blue-100">
                                    {selectedPatientDetails.conversationSummary || "Pendiente de valoración."}
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
                              {['all', 'pending', 'sent', 'viewed', 'completed', 'concluded', 'finalized'].map(status => (
                                  <button 
                                    key={status}
                                    onClick={() => setFilterStatus(status)}
                                    className={`px-3 py-2 rounded-lg text-xs font-bold uppercase transition-colors ${filterStatus === status ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                  >
                                      {statusLabels[status]}
                                  </button>
                              ))}
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
          <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-sm">
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
          <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-sm">
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
                            {editingAudio ? <span className="text-xs font-bold text-green-600"><i className="fas fa-check"></i> Audio cargado</span> : <span className="text-xs text-slate-600 font-bold">Sin audio</span>}
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
                        placeholder="Escribe aquí la conclusión terapéutica detallada..."
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
          <div className="lg:col-span-4 space-y-8">
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
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-2">
                      <h3 className="font-black text-xs uppercase text-slate-400 tracking-widest">Actividad Reciente</h3>
                      <button onClick={() => setIsSearchOpen(true)} className="w-6 h-6 rounded bg-slate-100 hover:bg-blue-100 text-slate-500 hover:text-blue-600 flex items-center justify-center transition-colors"><i className="fas fa-search text-xs"></i></button>
                  </div>
                  <span className="text-xs bg-slate-100 px-3 py-1 rounded-full text-slate-600 font-bold">{filteredRegistry.length}</span>
                </div>
                  <div className="space-y-4">
                  {filteredRegistry.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6 italic border-2 border-dashed border-slate-100 rounded-xl">No hay registros</p>
                  ) : (
                    [...filteredRegistry].sort((a, b) => (b.dateSent || 0) - (a.dateSent || 0)).map((p) => (
                      <div key={p.id} className="group relative flex flex-col p-4 bg-white rounded-2xl border border-slate-100 hover:border-teal-300 transition-all shadow-sm hover:shadow-md gap-3">
                        <div className="flex justify-between items-start w-full">
                            <div className="flex flex-col overflow-hidden">
                            <button onClick={() => setSelectedPatientDetails(p)} className="text-left text-sm font-bold text-blue-700 hover:text-blue-900 hover:underline truncate mb-0.5 transition-colors">{p.nombre}</button>
                            <span className="text-xs text-slate-400 font-bold truncate">{p.email}</span>
                            </div>
                            
                            <div className="flex items-center gap-2 shrink-0">
                            <button 
                                onClick={() => toggleStatus(p.id)}
                                className={`text-[10px] font-black uppercase tracking-tighter px-2 py-1.5 rounded-lg transition-colors cursor-pointer hover:scale-105 active:scale-95 ${
                                p.status === 'completed' ? 'bg-teal-100 text-teal-800' : 
                                p.status === 'pending' ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 
                                p.status === 'sent' ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 
                                p.status === 'viewed' ? 'bg-blue-50 text-blue-700' : 
                                p.status === 'concluded' ? 'bg-purple-50 text-purple-700' : 
                                p.status === 'finalized' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'
                                }`}
                                title="Clic para cambiar estado (Pendiente <-> Enviado)"
                            >
                                {statusLabels[p.status]}
                            </button>
                            
                            <button 
                                onClick={() => deleteRecord(p.id)}
                                className="p-2 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            >
                                <i className="fas fa-trash"></i>
                            </button>
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
                    ))
                  )}
                </div>
              </div>
            </Card>
          </div>

          <div className="lg:col-span-8">
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
                                {pendingRequests.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-slate-400 italic">No hay peticiones nuevas</div>
                                ) : (
                                    pendingRequests.map(req => (
                                        <div key={req.id} className="p-3 border-b border-slate-50 hover:bg-blue-50 flex justify-between items-center group cursor-pointer transition-colors" onClick={() => selectPendingRequest(req)}>
                                            <div className="flex flex-col overflow-hidden pr-2">
                                                <span className="text-sm font-bold text-slate-700 truncate">{req.nombre || 'Sin nombre'}</span>
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
                        <span className="text-lg font-black text-teal-700 bg-white px-4 py-1 rounded-xl border border-teal-200">PIN: {lastGeneratedPin}</span>
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
                                        const body = `Hola ${patient.nombre.split(' ')[0]},\n\nAquí tienes tu enlace directo:\n${linkGenerated}\n\nPIN: ${lastGeneratedPin}`;
                                        window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(patient.email || '')}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all"
                                >
                                    <i className="fas fa-envelope text-red-400"></i> Gmail
                                </button>
                            )}
                            {sendMethods.whatsapp && (
                                <button 
                                    onClick={() => {
                                        const body = `Hola ${patient.nombre.split(' ')[0]},\n\nAquí tienes tu enlace directo:\n${linkGenerated}\n\nPIN: ${lastGeneratedPin}`;
                                        const fullPhone = phoneBody ? `${phonePrefix}${phoneBody}`.trim() : '';
                                        const cleanPhone = fullPhone.replace(/\D/g, '');
                                        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`, '_blank');
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
                                        const body = `Hola ${patient.nombre.split(' ')[0]}, enlace: ${linkGenerated} . PIN: ${lastGeneratedPin}`;
                                        window.open(`sms:${fullPhone}?body=${encodeURIComponent(body)}`, '_blank');
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
                          </div>

                          <div className="space-y-3">
                              <label className="text-xs font-bold text-slate-500 uppercase block">Prompt para Conclusión Final (Paciente)</label>
                              <textarea 
                                  className="w-full h-48 p-4 rounded-xl border-2 border-slate-100 focus:border-blue-500 outline-none text-sm font-mono bg-slate-50"
                                  value={tempConfig.conclusionPrompt}
                                  onChange={e => setTempConfig({...tempConfig, conclusionPrompt: e.target.value})}
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
    </div>
  );
};
