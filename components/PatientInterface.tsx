
import React, { useState, useEffect, useRef } from 'react';
import { Card, Button, Logo, ProgressBar, Toast } from './UI';
import { QUESTIONS as INITIAL_QUESTIONS } from '../constants';
import { gemini } from '../services/gemini';
import { DataService } from '../services/dataService'; // Importamos el servicio
import { PatientData, Voice, Question, GlobalConfig, DualAudio } from '../types';
import { pipeline, env } from '@huggingface/transformers';

// Configuración de Transformers.js para STT local
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriberInstance: any = null;

const getTranscriber = async () => {
    if (!transcriberInstance) {
        transcriberInstance = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
            quantized: false,
            device: 'wasm'
        } as any);
    }
    return transcriberInstance;
};

interface PatientInterfaceProps {
  patientData: Partial<PatientData>;
  isEditorMode?: boolean;
  onExitEditor?: () => void;
}

const DEFAULT_CONFIG: GlobalConfig = {
  welcomeText: "Hola soy el Radar que ahora te va a guiar a través de situaciones cotidianas que nos ayudarán a conocer mejor tu estado. Tus respuestas deben ser reflexionadas y sinceras.",
  welcomeAudio: {},
  nameQuestionText: "¿Cómo te llamas? Por favor, dime tu nombre para confirmar que eres tú.",
  nameQuestionAudio: {},
  startText: "Bienvenido {{nombre}}. Vamos a comenzar este viaje como tu primer acto terapéutico.",
  startAudio: {},
  finishText: "Tus respuestas y la valoración del Cuestionario espejo están listas para ser enviadas.",
  finishAudio: {},
  afterSendText: "Envio realizado {{nombre}}, analizaremos tus respuesta y te responderemos en breve.",
  afterSendAudio: {},
  defaultVoiceMode: Voice.FEMALE,
  femaleVoiceVariant: 1,
  maleVoiceVariant: 1,
  defaultTheme: 'light',
  backgrounds: []
};

const FALLBACK_TEXTURE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"; // Transparent pixel fallback

const BACKGROUNDS = {
  intro: "https://images.unsplash.com/photo-1516550893923-42d28e5677af?q=80&w=2070&auto=format&fit=crop",        
  verification: "https://images.unsplash.com/photo-1516550893923-42d28e5677af?q=80&w=2070&auto=format&fit=crop", 
  general: "https://images.unsplash.com/photo-1516550893923-42d28e5677af?q=80&w=2070&auto=format&fit=crop"       
};

// Aumentado a 800ms para asegurar que el navegador no corte el inicio (problema de palabras comidas)
const AUDIO_START_DELAY = 800;

const ChatBubble: React.FC<{ msg: { text: string, sender: string }, isDarkMode: boolean }> = ({ msg, isDarkMode }) => (
  <div className={`flex ${msg.sender === 'ia' ? 'justify-start' : 'justify-end'} animate-in fade-in slide-in-from-bottom-2 mb-4`}>
    <div className={`max-w-[85%] px-6 py-4 rounded-2xl text-base font-medium leading-relaxed shadow-md border backdrop-blur-sm ${
      msg.sender === 'ia' 
        ? (isDarkMode ? 'bg-[#1e293b]/90 text-blue-100 border-white/10' : 'bg-white/95 text-slate-800 border-blue-100') + ' rounded-tl-none' 
        : (isDarkMode ? 'bg-blue-600/90 text-white border-blue-500' : 'bg-blue-600 text-white border-blue-500') + ' rounded-tr-none'
    }`}>
      {msg.text}
    </div>
  </div>
);

const CompassBackground = ({ isDarkMode }: { isDarkMode: boolean }) => (
  <svg 
    viewBox="0 0 500 500" 
    className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[140%] md:w-[90%] max-w-[900px] pointer-events-none select-none transition-colors duration-500 ${isDarkMode ? 'text-blue-300 opacity-10' : 'text-[#b49b67] opacity-15'}`}
    style={{ mixBlendMode: isDarkMode ? 'overlay' : 'multiply' }}
  >
    <circle cx="250" cy="250" r="240" fill="none" stroke="currentColor" strokeWidth="1" />
    <circle cx="250" cy="250" r="235" fill="none" stroke="currentColor" strokeWidth="0.5" />
    <circle cx="250" cy="250" r="220" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1 3" />
    <path d="M250 20 L280 220 L480 250 L280 280 L250 480 L220 280 L20 250 L220 220 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M250 20 L250 480 M20 250 L480 250" stroke="currentColor" strokeWidth="0.5" />
    <path d="M250 20 L280 220 L250 250 Z" fill="currentColor" fillOpacity="0.1" />
    <path d="M480 250 L280 280 L250 250 Z" fill="currentColor" fillOpacity="0.1" />
    <path d="M250 480 L220 280 L250 250 Z" fill="currentColor" fillOpacity="0.1" />
    <path d="M20 250 L220 220 L250 250 Z" fill="currentColor" fillOpacity="0.1" />
    <path d="M380 120 L270 230 M380 380 L270 270 M120 380 L230 270 M120 120 L230 230" stroke="currentColor" strokeWidth="1" />
    <text x="250" y="70" textAnchor="middle" fill="currentColor" fontSize="32" fontFamily="serif" fontWeight="bold">N</text>
    <text x="250" y="450" textAnchor="middle" fill="currentColor" fontSize="32" fontFamily="serif" fontWeight="bold">S</text>
    <text x="440" y="260" textAnchor="middle" fill="currentColor" fontSize="32" fontFamily="serif" fontWeight="bold">E</text>
    <text x="60" y="260" textAnchor="middle" fill="currentColor" fontSize="32" fontFamily="serif" fontWeight="bold">O</text>
  </svg>
);

/**
 * Crea una copia profunda de un objeto o array eliminando cualquier string que sea Base64 (data:...)
 * para evitar saturar la cuota de localStorage.
 */
const sanitizeForLocalCache = (data: any): any => {
    if (!data) return data;
    
    if (Array.isArray(data)) {
        return data.map(item => sanitizeForLocalCache(item));
    }
    
    if (typeof data === 'object' && data !== null) {
        const sanitized: any = {};
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                const value = data[key];
                // Si es un string y empieza con data: (Base64), lo eliminamos de la copia local
                if (typeof value === 'string' && value.startsWith('data:')) {
                    // No incluimos esta propiedad en la copia saneada para ahorrar espacio
                    continue;
                } else if (typeof value === 'object' && value !== null) {
                    sanitized[key] = sanitizeForLocalCache(value);
                } else {
                    sanitized[key] = value;
                }
            }
        }
        return sanitized;
    }
    
    return data;
};

export const PatientInterface: React.FC<PatientInterfaceProps> = ({ patientData: initialPatientData, isEditorMode, onExitEditor }) => {
  const [currentPatientData, setCurrentPatientData] = useState(initialPatientData);

  // Inicialización con localStorage/Defaults para evitar parpadeos
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig>(() => {
    try {
        const saved = localStorage.getItem('radar_global_config');
        if (!saved) return DEFAULT_CONFIG;
        const parsed = JSON.parse(saved);
        // Validación básica: si no es un objeto, ignorar
        if (!parsed || typeof parsed !== 'object') return DEFAULT_CONFIG;
        return parsed;
    } catch(e) {
        console.warn("Error al cargar radar_global_config de localStorage:", e);
        return DEFAULT_CONFIG;
    }
  });

  const [questions, setQuestions] = useState<Question[]>(() => {
    try {
        const saved = localStorage.getItem('radar_custom_questions');
        if (!saved) return INITIAL_QUESTIONS;
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed) || parsed.length === 0) return INITIAL_QUESTIONS;
        return parsed;
    } catch(e) {
        console.warn("Error al cargar radar_custom_questions de localStorage:", e);
        return INITIAL_QUESTIONS;
    }
  });

  // Efecto para hidratar datos desde Firebase (si está disponible) sin bloquear la UI
  useEffect(() => {
    const fetchData = async () => {
        const remoteQuestions = await DataService.getQuestions();
        if (remoteQuestions && remoteQuestions.length > 0) {
            // Comprobamos si hay cambios reales antes de actualizar para evitar re-renders innecesarios
            setQuestions(prev => {
                if (JSON.stringify(prev) !== JSON.stringify(remoteQuestions)) {
                    return remoteQuestions;
                }
                return prev;
            });
        }

        const remoteConfig = await DataService.getGlobalConfig(DEFAULT_CONFIG);
        setGlobalConfig(prev => {
             if (JSON.stringify(prev) !== JSON.stringify(remoteConfig)) {
                 return remoteConfig;
             }
             return prev;
        });

        // Hidratar datos del paciente y progreso
        if (currentPatientData.id && !isEditorMode) {
            try {
                const fullPatient = await DataService.getPatientById(currentPatientData.id);
                if (fullPatient) {
                    setCurrentPatientData(fullPatient);
                    
                    if (fullPatient.status === 'completed') {
                        setStep('locked');
                        return;
                    }
                    
                    if (fullPatient.status === 'concluded' || fullPatient.status === 'finalized') {
                        setStep('pin_validation');
                        return;
                    }

                    if (fullPatient.answers) {
                        setAnswers(fullPatient.answers);
                        // Si ya tiene respuestas pero no ha terminado, restauramos el índice
                        const answeredCount = Object.keys(fullPatient.answers).length;
                        if (answeredCount > 0 && answeredCount < questions.length) {
                            setCurrentQuestionIndex(answeredCount);
                        }
                    }
                }
            } catch (e) {
                console.error("Error fetching full patient data", e);
            }
        }
    };
    fetchData();
  }, [currentPatientData.id, isEditorMode]);
  
  const [step, setStep] = useState<'intro' | 'pin_validation' | 'verification' | 'questionnaire' | 'finish' | 'locked' | 'conclusion_view'>('intro');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  
  const [voice, setVoice] = useState<Voice>(globalConfig.defaultVoiceMode);
  
  const [transcript, setTranscript] = useState<{ text: string, sender: 'ia' | 'user' }[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pinInput, setPinInput] = useState('');
  
  const [clinicalReport, setClinicalReport] = useState<string>('');
  const [finalConclusion, setFinalConclusion] = useState<string>('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [hasSentResults, setHasSentResults] = useState(false);
  const sequenceIdRef = useRef<number>(0);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [sttMessage, setSttMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string, visible: boolean } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [inputValue, setInputValue] = useState('');
  
  const [isInteractionLocked, setIsInteractionLocked] = useState(false);
  
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  const showToast = (message: string) => {
    setToast({ message, visible: true });
  };

  const hideToast = () => {
    setToast(prev => prev ? { ...prev, visible: false } : null);
  };

  // --- Audio Preloading ---
  const preloadedAudiosRef = useRef<Record<string, HTMLAudioElement>>({});

  const preloadAudio = (url: string) => {
    if (!url || preloadedAudiosRef.current[url]) return;
    const audio = new Audio(url);
    audio.preload = 'auto';
    preloadedAudiosRef.current[url] = audio;
  };

  useEffect(() => {
    // Preload next question audio
    const nextIdx = currentQuestionIndex + 1;
    if (nextIdx < questions.length) {
      const nextQ = questions[nextIdx];
      const urls = [
        nextQ.audio?.female, nextQ.audio?.female2,
        nextQ.audio?.male, nextQ.audio?.male2,
        nextQ.postOptionsAudio?.female, nextQ.postOptionsAudio?.female2,
        nextQ.postOptionsAudio?.male, nextQ.postOptionsAudio?.male2
      ].filter(Boolean) as string[];
      
      nextQ.options.forEach(opt => {
        if (opt.audio?.female) urls.push(opt.audio.female);
        if (opt.audio?.female2) urls.push(opt.audio.female2);
        if (opt.audio?.male) urls.push(opt.audio.male);
        if (opt.audio?.male2) urls.push(opt.audio.male2);
      });

      urls.forEach(preloadAudio);
    }
  }, [currentQuestionIndex, questions]);

  // --- Lógica STT Local ---
  const handleMicClick = async () => {
      if (isRecording) return; // Si ya graba, ignorar

      try {
          // 1. Cargar modelo si es necesario
          if (!transcriberInstance) {
              setIsLoadingModel(true);
              setSttMessage("Cargando modelo de voz...");
              await getTranscriber();
              setIsLoadingModel(false);
              setSttMessage(null);
          }

          // 2. Iniciar grabación
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          
          let options: MediaRecorderOptions = {};
          if (MediaRecorder.isTypeSupported('audio/webm')) {
              options = { mimeType: 'audio/webm' };
          } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
              options = { mimeType: 'audio/mp4' };
          }
          
          const mediaRecorder = new MediaRecorder(stream, options);
          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];

          mediaRecorder.ondataavailable = (event) => {
              if (event.data.size > 0) {
                  audioChunksRef.current.push(event.data);
              }
          };

          mediaRecorder.onstop = async () => {
              setSttMessage("Procesando audio...");
              
              try {
                  const mimeType = audioChunksRef.current[0]?.type || mediaRecorder.mimeType || 'audio/webm';
                  const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                  const arrayBuffer = await audioBlob.arrayBuffer();
                  
                  // Decodificación robusta compatible con Safari/Chrome
                  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                  const audioContext = new AudioContextClass();
                  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                  
                  // Remuestreo a 16kHz (requerido por Whisper) usando OfflineAudioContext
                  const length = Math.max(1, Math.ceil(audioBuffer.duration * 16000));
                  const offlineContext = new OfflineAudioContext(1, length, 16000);
                  const source = offlineContext.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(offlineContext.destination);
                  source.start(0);
                  const resampled = await offlineContext.startRendering();
                  const audioData = resampled.getChannelData(0); // Float32Array a 16kHz

                  if (audioData.length === 0) {
                      throw new Error("No se detectó audio");
                  }

                  // Transcribir (forzando idioma español para mayor precisión)
                  const transcriber = await getTranscriber();
                  const output = await transcriber(audioData, { language: 'spanish', task: 'transcribe' });
                  const text = Array.isArray(output) ? output[0]?.text : output.text;
                  
                  if (!text) {
                      setSttMessage("No te he entendido");
                      setTimeout(() => setSttMessage(null), 3000);
                      return;
                  }

                  // Limpiar texto y mapear palabras a números
                  let cleanText = text.toUpperCase();
                  const wordToNumber: Record<string, string> = {
                      'UNO': '1', 'UN': '1', 'DOS': '2', 'TRES': '3', 'CUATRO': '4', 'CINCO': '5'
                  };
                  
                  Object.keys(wordToNumber).forEach(word => {
                      const regex = new RegExp(`\\b${word}\\b`, 'g');
                      cleanText = cleanText.replace(regex, wordToNumber[word]);
                  });
                  
                  cleanText = cleanText.replace(/[\s.,!?]/g, '');
                  
                  // Mapear a opciones válidas
                  const validOptions = ['A', 'B', 'C', 'D', '1', '2', '3', '4', '5'];
                  let matchedOption = null;
                  
                  for (const opt of validOptions) {
                      if (cleanText.includes(opt)) {
                          matchedOption = opt;
                          break;
                      }
                  }

                  if (matchedOption && visibleOptions.includes(matchedOption.toLowerCase())) {
                      setSttMessage(null);
                      handleAnswer(matchedOption.toLowerCase());
                  } else {
                      setSttMessage(`Entendido: "${text}". Opción no válida.`);
                      setTimeout(() => setSttMessage(null), 3000);
                  }
              } catch (err: any) {
                  console.error("Error procesando audio:", err);
                  setSttMessage("Error: " + (err.message || "al procesar"));
                  setTimeout(() => setSttMessage(null), 4000);
              } finally {
                  // Liberar micro
                  stream.getTracks().forEach(track => track.stop());
              }
          };

          mediaRecorder.start();
          setIsRecording(true);
          setSttMessage("Escuchando...");

          // Detener a los 3 segundos
          setTimeout(() => {
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                  mediaRecorderRef.current.stop();
                  setIsRecording(false);
              }
          }, 3000);

      } catch (error: any) {
          console.error("Error con el micrófono o modelo:", error);
          setIsLoadingModel(false);
          setIsRecording(false);
          setSttMessage("Error: " + (error.message || "micrófono"));
          setTimeout(() => setSttMessage(null), 4000);
      }
  };
  // ------------------------
  const [isEditingGlobal, setIsEditingGlobal] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
        const saved = localStorage.getItem('radar_global_config');
        if (!saved) return true;
        const config = JSON.parse(saved);
        return config && config.defaultTheme === 'dark';
    } catch(e) {
        return true;
    }
  });

  useEffect(() => {
     if (globalConfig.defaultTheme) {
         setIsDarkMode(globalConfig.defaultTheme === 'dark');
     }
  }, [globalConfig.defaultTheme]);
  const [visibleOptions, setVisibleOptions] = useState<string[]>([]);
  const [verificationAttempts, setVerificationAttempts] = useState(0);
  
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  const pinInputRef = useRef<HTMLInputElement>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionCardRef = useRef<HTMLDivElement>(null);
  const speechTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patientDataRef = useRef(currentPatientData);

  useEffect(() => {
    if (step === 'pin_validation') {
        setPinInput('');
        if (pinInputRef.current) {
            pinInputRef.current.focus();
        }
    }
  }, [step]);

  // AUTOMATIZACIÓN DE ESTADO: VISTO (viewed)
  useEffect(() => {
      if (!isEditorMode && currentPatientData.id && (currentPatientData.status === 'pending' || currentPatientData.status === 'sent')) {
          DataService.updatePatient(currentPatientData.id, { status: 'viewed' })
            .then(() => {
              setCurrentPatientData(prev => ({ ...prev, status: 'viewed' }));
            })
            .catch(e => {
              console.error("Error updating viewed status", e);
            });
      }
  }, [currentPatientData.id, isEditorMode]);
  
  useEffect(() => {
    const checkMobile = () => {
       const ua = navigator.userAgent.toLowerCase();
       const isAndroid = ua.includes('android');
       const isIOS = /iphone|ipad|ipod/.test(ua);
       
       const isTouch = (typeof window !== 'undefined' && window.matchMedia) 
            ? window.matchMedia("(any-pointer: coarse)").matches 
            : false;
            
       const isSmallScreen = window.innerWidth < 1024;
       
       setIsMobileDevice(!!(isAndroid || isIOS || (isTouch && isSmallScreen)));
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!isEditorMode && currentPatientData.id) {
        const completedKey = `radar_completed_${currentPatientData.id}`;
        if (localStorage.getItem(completedKey) === 'true') {
            setStep('locked');
        }
    }
  }, [currentPatientData.id, isEditorMode]);

  const processText = (text: string) => {
    if (!text) return "";
    const data = patientDataRef.current;
    
    const name = data.nombre?.split(' ')[0] || 'amigo/a';
    let processed = text.replace(/{{nombre}}/gi, name);

    const rawSex = (data.sexo || '').toLowerCase().trim();
    const isFemale = rawSex === 'mujer' || rawSex === 'femenino' || rawSex === 'f' || rawSex.includes('mujer');
    const genderVowel = isFemale ? 'a' : 'o';
    
    processed = processed.replace(/@/g, genderVowel);

    return processed;
  };

  useEffect(() => {
    setVoice(globalConfig.defaultVoiceMode);
  }, [globalConfig.defaultVoiceMode]);

  useEffect(() => {
    const loadVoices = () => { window.speechSynthesis.getVoices(); };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    
    return () => {
      stopAudio();
    };
  }, []);

  useEffect(() => {
    if (step === 'finish' && !clinicalReport && !isEditorMode && !hasSentResults) {
      generateClinicalReport();
      const finalText = processText(globalConfig.finishText);
      playOrSpeak(finalText, globalConfig.finishAudio);
      addMessage(finalText, 'ia');
    }
  }, [step]);

  // FIX: Scroll effect now triggers on transcript updates to ensure visibility during chat flow
  useEffect(() => {
    if (step === 'questionnaire') {
       window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (step === 'verification') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  }, [currentQuestionIndex, step, transcript]);

  useEffect(() => {
    if (visibleOptions.length > 0) {
       const lastKey = visibleOptions[visibleOptions.length - 1];
       const el = document.getElementById(`opt-${lastKey}`);
       if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
       }
    }
  }, [visibleOptions]);

  const getCurrentBackground = () => {
    if (globalConfig.backgrounds && globalConfig.backgrounds.length > 0) {
        return globalConfig.backgrounds[0];
    }
    switch (step) {
      case 'intro': return BACKGROUNDS.intro;
      case 'verification': return BACKGROUNDS.verification;
      default: return BACKGROUNDS.general;
    }
  };

  const generateClinicalReport = async () => {
    setIsGeneratingReport(true);
    const context = transcript.map(t => `${t.sender}: ${t.text}`).join('\n');
    const reportData = await gemini.generateFullReport(
        currentPatientData, 
        answers, 
        context,
        globalConfig.clinicalPrompt,
        globalConfig.conclusionPrompt
    );
    setClinicalReport(reportData.internalReport);
    setFinalConclusion(reportData.externalConclusion);
    setIsGeneratingReport(false);
  };

  const handleSendResults = async () => {
    // Actualizar fecha de respuesta
    const now = Date.now();
    const updatedData = { ...currentPatientData, dateAnswered: now, status: 'completed' as const };
    setCurrentPatientData(updatedData);

    // AUTOMATIZACIÓN DE ESTADO: HECHO (completed)
    if (currentPatientData.id) {
        try {
            await DataService.updatePatient(currentPatientData.id, { 
                dateAnswered: now, 
                status: 'completed',
                answers: answers,
                conversationSummary: clinicalReport,
                finalConclusion: finalConclusion
            });
        } catch(e) {
            console.error("Error saving results to Firebase", e);
        }
    }

    sendResultsToCoordinator();
    setHasSentResults(true);
    
    if (!isEditorMode && currentPatientData.id) {
        localStorage.setItem(`radar_completed_${currentPatientData.id}`, 'true');
    }
    
    const afterSendMsg = processText(globalConfig.afterSendText);
    addMessage(afterSendMsg, 'ia');
    await playOrSpeak(afterSendMsg, globalConfig.afterSendAudio);
  };

  const sendResultsToCoordinator = () => {
    if (!currentPatientData.coordinatorEmail && !isEditorMode) {
      showToast("No se ha encontrado el email del coordinador.");
      return;
    }
    const email = currentPatientData.coordinatorEmail || 'cuestionarioespejo@gmail.com';
    const subject = `RESULTADOS: ${currentPatientData.nombre || 'Paciente'} - Cuestionario Espejo`;
    const body = `INFORME DE SESIÓN - CUESTIONARIO ESPEJO\nPACIENTE: ${currentPatientData.nombre || 'N/A'}\nEDAD: ${currentPatientData.edad || 'N/A'}\n\nVALORACIÓN IA:\n${clinicalReport}\n\nRESPUESTAS:\n${Object.entries(answers).map(([qid, ans]) => `P${qid}: ${ans}`).join('\n')}`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const pendingResolvesRef = useRef<(() => void)[]>([]);

  const stopAudio = () => {
    // Limpiar timeout pendiente para evitar que arranque un audio antiguo
    if (speechTimeoutRef.current) {
        clearTimeout(speechTimeoutRef.current);
        speechTimeoutRef.current = null;
    }
    
    window.speechSynthesis.cancel();
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    setIsSpeaking(false);

    // Resolver cualquier promesa pendiente para evitar bloqueos
    pendingResolvesRef.current.forEach(resolve => resolve());
    pendingResolvesRef.current = [];
  };

  const playOrSpeak = async (text: string, audioData?: DualAudio): Promise<void> => {
    stopAudio(); // Cancelar cualquier audio previo inmediatamente

    if (voice === Voice.NONE || !text || text.trim() === '') {
        return new Promise(resolve => setTimeout(resolve, 1500));
    }

    setIsSpeaking(true);

    return new Promise((resolve) => {
      pendingResolvesRef.current.push(resolve);

      // Usar timeout para esperar a que el navegador procese el 'stopAudio' y el DOM se estabilice
      if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);

      speechTimeoutRef.current = setTimeout(() => {
          let customUrl;
          if (voice === Voice.MALE) {
              customUrl = globalConfig.maleVoiceVariant === 2 ? (audioData?.male2 || audioData?.male) : audioData?.male;
          } else {
              customUrl = globalConfig.femaleVoiceVariant === 2 ? (audioData?.female2 || audioData?.female) : audioData?.female;
          }

          if (customUrl) {
            let audio = preloadedAudiosRef.current[customUrl];
            if (!audio) {
              audio = new Audio(customUrl);
            }
            currentAudioRef.current = audio;
            audio.onended = () => {
              setIsSpeaking(false);
              currentAudioRef.current = null;
              pendingResolvesRef.current = pendingResolvesRef.current.filter(r => r !== resolve);
              resolve();
            };
            audio.onerror = () => {
              console.warn("Error reproduciendo audio custom, usando voz nativa");
              speakNative(text, () => {
                  pendingResolvesRef.current = pendingResolvesRef.current.filter(r => r !== resolve);
                  resolve();
              });
            };
            audio.play().catch(() => speakNative(text, () => {
                pendingResolvesRef.current = pendingResolvesRef.current.filter(r => r !== resolve);
                resolve();
            }));
            return;
          }

          speakNative(text, () => {
              pendingResolvesRef.current = pendingResolvesRef.current.filter(r => r !== resolve);
              resolve();
          });
      }, AUDIO_START_DELAY);
    });
  };

  const speakNative = (text: string, onEnd: () => void) => {
    // Asegurarse de que no hay nada sonando
    window.speechSynthesis.cancel();

    if (!text || text.trim() === '') {
        setIsSpeaking(false);
        onEnd();
        return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    // Prevent garbage collection bug in some browsers
    (window as any)._currentUtterance = utterance;
    
    utterance.lang = 'es-ES';
    
    const voices = window.speechSynthesis.getVoices();
    const esVoices = voices.filter(v => v.lang.toLowerCase().includes('es'));
    
    const ua = navigator.userAgent.toLowerCase();
    const isAndroid = ua.includes('android');
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isMobile = isAndroid || isIOS;

    if (esVoices.length > 0) {
        const targetVoice = esVoices.find(v => 
           (v.name.includes('Google') && (v.name.includes('Mexico') || v.name.includes('Argentina') || v.name.includes('es-419'))) ||
           v.name.includes('Paulina') || 
           v.name.includes('Sabina') ||
           v.name.includes('Elena')
        ) || esVoices.find(v => 
            v.name.toLowerCase().includes('female') || 
            v.name.toLowerCase().includes('mujer')
        ) || esVoices.find(v => v.name.includes('Google')) || esVoices[0];

        utterance.voice = targetVoice;
        
        if (!isMobile) {
             if (voice === Voice.FEMALE) {
                 utterance.pitch = 1.6; 
                 utterance.rate = 0.9;
             } else {
                 utterance.pitch = 0.8; 
                 utterance.rate = 0.9; 
             }
        } else {
             if (voice === Voice.FEMALE) {
                 utterance.pitch = isAndroid ? 1.0 : 1.0; 
                 utterance.rate = isAndroid ? 1.0 : 0.9;
             } else {
                 // Voz calmada (Android) - AJUSTADO A 0.85
                 utterance.pitch = isAndroid ? 0.85 : 1.0;
                 utterance.rate = isAndroid ? 0.90 : 0.9;
             }
        }
    }

    utterance.onend = () => { setIsSpeaking(false); onEnd(); };
    utterance.onerror = () => { setIsSpeaking(false); onEnd(); };
    
    window.speechSynthesis.speak(utterance);
  };

  const requestExit = () => {
    setShowExitConfirm(true);
  };

  const confirmExit = () => {
    sequenceIdRef.current++;
    setShowExitConfirm(false);
    stopAudio();
    if (isEditorMode && onExitEditor) {
      onExitEditor();
    } else {
      setStep('intro');
      setTranscript([]);
      setAnswers({});
      setCurrentQuestionIndex(0);
      setVerificationAttempts(0);
      setInputValue('');
      setClinicalReport('');
      setIsGeneratingReport(false);
      setHasSentResults(false);
    }
  };

  const handleBack = () => {
    stopAudio();
    if (currentQuestionIndex > 0) {
      const prevIdx = currentQuestionIndex - 1;
      setCurrentQuestionIndex(prevIdx);
      setTranscript(t => t.slice(0, -1)); 
      loadQuestion(prevIdx);
    }
  };

  const handleEditorNavigation = (direction: 'prev' | 'next') => {
      sequenceIdRef.current++;
      stopAudio();
      setIsInteractionLocked(false);
      const newIndex = direction === 'next' ? currentQuestionIndex + 1 : currentQuestionIndex - 1;
      
      if (newIndex >= 0 && newIndex < questions.length) {
          setCurrentQuestionIndex(newIndex);
          // Forzar carga inmediata sin audio
          setVisibleOptions([]);
          const q = questions[newIndex];
          if (q) {
              // Mostrar todo inmediatamente para edición rápida
              if (!q.isScale) {
                  setVisibleOptions(q.options.map(o => o.key));
              }
          }
      }
  };

  const playQuestionSequence = async (q: Question, index: number) => {
    const seqId = ++sequenceIdRef.current;
    setIsInteractionLocked(true); 
    setVisibleOptions([]);

    const scenarioText = processText(q.speechScript || q.scenario);
    await playOrSpeak(scenarioText, q.audio);
    if (seqId !== sequenceIdRef.current) return;

    if (q.isScale) {
        setIsInteractionLocked(false);
        return;
    }

    for (const opt of q.options) {
      setVisibleOptions(prev => [...prev, opt.key]); 
      const textToRead = `Opción ${opt.key}... ${processText(opt.text)}`;
      await playOrSpeak(textToRead, opt.audio);
      if (seqId !== sequenceIdRef.current) return;
    }

    if (index === 0) {
      const defaultPostText = "¿Con cuál de estas situaciones te sientes más identificado?";
      const postText = q.postOptionsText !== undefined ? q.postOptionsText : defaultPostText;
      if (postText.trim() !== '') {
          await playOrSpeak(postText, q.postOptionsAudio);
          if (seqId !== sequenceIdRef.current) return;
      }
    }
    
    setIsInteractionLocked(false); 
  };

  const [isStarting, setIsStarting] = useState(false);

  const startSession = async () => {
    if (isStarting) return;
    
    // Transición visual inmediata
    if (isEditorMode) {
        setStep('verification');
    } else {
        setStep('pin_validation');
    }

    setIsStarting(true);

    // Usamos setTimeout para permitir que el navegador realice el re-render del cambio de step
    setTimeout(async () => {
        try {
            if (isEditorMode) {
                const welcome = processText(globalConfig.welcomeText);
                if (welcome) {
                    addMessage(welcome, 'ia');
                    await playOrSpeak(welcome, globalConfig.welcomeAudio);
                }
                
                const nameQ = processText(globalConfig.nameQuestionText);
                if (nameQ) {
                    addMessage(nameQ, 'ia');
                    await playOrSpeak(nameQ, globalConfig.nameQuestionAudio);
                } else {
                    proceedToQuestionnaire();
                }
            } else {
                const welcome = processText(globalConfig.welcomeText);
                if (welcome) {
                    addMessage(welcome, 'ia');
                    playOrSpeak(welcome, globalConfig.welcomeAudio);
                }
            }
        } finally {
            setIsStarting(false);
        }
    }, 0);
  };

  const handlePinSubmit = () => {
    if (pinInput === currentPatientData.accessPin || isEditorMode) {
        if (currentPatientData.status === 'concluded' || currentPatientData.status === 'finalized') {
            setStep('conclusion_view');
            
            // AUTOMATIZACIÓN DE ESTADO: VISTO (viewed) o FINALIZADO (finalized)
            if (currentPatientData.id && currentPatientData.status === 'concluded') {
                DataService.updatePatient(currentPatientData.id, {
                    status: 'finalized',
                    dateConclusionViewed: Date.now(),
                    conclusionViews: (currentPatientData.conclusionViews || 0) + 1
                }).catch(e => console.error("Error updating status to finalized", e));
            } else if (currentPatientData.id && currentPatientData.status === 'finalized') {
                DataService.updatePatient(currentPatientData.id, {
                    dateConclusionViewed: Date.now(),
                    conclusionViews: (currentPatientData.conclusionViews || 0) + 1
                }).catch(e => console.error("Error updating conclusion views", e));
            }
        } else {
            const nameQ = processText(globalConfig.nameQuestionText);
            if (nameQ) {
                setStep('verification');
                addMessage(nameQ, 'ia');
                playOrSpeak(nameQ, globalConfig.nameQuestionAudio);
            } else {
                proceedToQuestionnaire();
            }
        }
    } else {
        addMessage("El código de acceso es incorrecto. Por favor, inténtalo de nuevo.", 'ia');
        playOrSpeak("El código de acceso es incorrecto. Por favor, inténtalo de nuevo.");
        setPinInput('');
    }
  };

  const handleVerification = async (nameInput: string) => {
    stopAudio();
    const inputClean = nameInput.trim();
    addMessage(nameInput, 'user');
    
    if (verificationAttempts === 0) {
        const nameToMatch = isEditorMode ? "Coordinador" : (currentPatientData.nombre || "");
        const inputLower = inputClean.toLowerCase();
        const expectedLower = nameToMatch.split(' ')[0].toLowerCase();

        if (inputLower.includes(expectedLower) || expectedLower.includes(inputLower) || isEditorMode) {
            const updatedData = { ...currentPatientData, nombre: inputClean };
            setCurrentPatientData(updatedData);
            patientDataRef.current = updatedData;
            
            proceedToQuestionnaire();
        } else {
            const mismatchMsg = `El nombre no coincide con nuestros registros (${currentPatientData.nombre}). Por favor, escribe el nombre completo.`;
            setVerificationAttempts(1);
            addMessage(mismatchMsg, 'ia');
            await playOrSpeak(mismatchMsg);
        }
    } else {
        const updatedData = { ...currentPatientData, nombre: inputClean };
        setCurrentPatientData(updatedData);
        patientDataRef.current = updatedData;

        const acceptedMsg = `Entendido, actualizamos tu ficha como "${inputClean}".`;
        addMessage(acceptedMsg, 'ia');
        await playOrSpeak(acceptedMsg);
        setTimeout(proceedToQuestionnaire, 500);
    }
  };

  const proceedToQuestionnaire = async () => {
    stopAudio();
    setStep('questionnaire');
    
    const startMsg = processText(globalConfig.startText);
    if (startMsg) {
        addMessage(startMsg, 'ia');
        await playOrSpeak(startMsg, globalConfig.startAudio);
    }

    loadQuestion(0);
  };

  const loadQuestion = async (index: number) => {
    const q = questions[index];
    setVisibleOptions([]); 
    
    if (!q) {
      setStep('finish');
      return;
    }
    playQuestionSequence(q, index);
  };

  const handleAnswer = async (key: string) => {
    if (isInteractionLocked) return; 
    stopAudio();
    const q = questions[currentQuestionIndex];
    const newAnswers = { ...answers, [q.id]: key };
    setAnswers(newAnswers);
    addMessage(`Seleccionado: ${key.toUpperCase()}`, 'user');
    
    // Guardado incremental en Firestore
    if (currentPatientData.id && !isEditorMode) {
        DataService.updatePatient(currentPatientData.id, { answers: newAnswers })
            .catch(e => console.error("Error saving incremental progress", e));
    }

    const nextIdx = currentQuestionIndex + 1;
    setCurrentQuestionIndex(nextIdx);
    loadQuestion(nextIdx);
  };

  const addMessage = (text: string, sender: 'ia' | 'user') => {
    setTranscript(prev => [...prev, { text, sender }]);
  };
  
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, field: string, subIndex?: number, gender: 'male' | 'female' | 'male2' | 'female2' = 'female') => {
    const file = e.target.files?.[0];
    if (file) {
      if (field === 'background') {
          const reader = new FileReader();
          reader.onload = (event) => {
              const img = new Image();
              img.onload = () => {
                  const canvas = document.createElement('canvas');
                  let width = img.width;
                  let height = img.height;
                  const MAX_WIDTH = 1280;
                  const MAX_HEIGHT = 720;

                  if (width > height) {
                      if (width > MAX_WIDTH) {
                          height *= MAX_WIDTH / width;
                          width = MAX_WIDTH;
                      }
                  } else {
                      if (height > MAX_HEIGHT) {
                          width *= MAX_HEIGHT / height;
                          height = MAX_HEIGHT;
                      }
                  }
                  canvas.width = width;
                  canvas.height = height;
                  const ctx = canvas.getContext('2d');
                  ctx?.drawImage(img, 0, 0, width, height);
                  
                  const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                  
                  const newConfig = { ...globalConfig };
                  const currentBackgrounds = globalConfig.backgrounds || [];
                  const newBackgrounds = [dataUrl, ...currentBackgrounds].slice(0, 2);
                  newConfig.backgrounds = newBackgrounds;
                  setGlobalConfig(newConfig);
              };
              img.src = event.target?.result as string;
          };
          reader.readAsDataURL(file);
          return;
      }

      if (file.size > 1.5 * 1024 * 1024) {
          showToast("El archivo de audio es demasiado grande. Por favor, usa un archivo de menos de 1.5MB.");
          return;
      }

      const reader = new FileReader();
      reader.onload = (event) => { 
        const result = event.target?.result as string;
        if (isEditingGlobal) {
           const newConfig = { ...globalConfig };
           if (field === 'welcome') newConfig.welcomeAudio = { ...newConfig.welcomeAudio, [gender]: result };
           if (field === 'name') newConfig.nameQuestionAudio = { ...newConfig.nameQuestionAudio, [gender]: result };
           if (field === 'start') newConfig.startAudio = { ...newConfig.startAudio, [gender]: result };
           if (field === 'finish') newConfig.finishAudio = { ...newConfig.finishAudio, [gender]: result };
           if (field === 'afterSend') newConfig.afterSendAudio = { ...newConfig.afterSendAudio, [gender]: result };
           
           setGlobalConfig(newConfig);
        } else if (editingQuestion) {
           if (field === 'scenario') {
              const audio = editingQuestion.audio || {};
              setEditingQuestion({ ...editingQuestion, audio: { ...audio, [gender]: result } }); 
           } else if (field === 'postOptions') {
              const audio = editingQuestion.postOptionsAudio || {};
              setEditingQuestion({ ...editingQuestion, postOptionsAudio: { ...audio, [gender]: result } }); 
           } else if (field === 'option' && typeof subIndex === 'number') {
              const newOptions = [...editingQuestion.options];
              const optAudio = newOptions[subIndex].audio || {};
              newOptions[subIndex].audio = { ...optAudio, [gender]: result };
              setEditingQuestion({ ...editingQuestion, options: newOptions });
           }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const saveGlobalChanges = async () => {
    try {
        setIsStarting(true); // Reutilizamos el estado de carga
        await DataService.saveGlobalConfig(globalConfig);
        
        // Saneamos la copia para localStorage para evitar errores de cuota
        try {
            const sanitized = sanitizeForLocalCache(globalConfig);
            localStorage.setItem('radar_global_config', JSON.stringify(sanitized));
        } catch (lsError) {
            console.warn("Error al guardar radar_global_config en localStorage (cuota excedida):", lsError);
        }

        setIsEditingGlobal(false);
        showToast("Configuración global guardada con éxito.");
    } catch (error) {
        console.error("Error saving global config:", error);
        showToast("Error al guardar la configuración. Por favor, inténtalo de nuevo.");
    } finally {
        setIsStarting(false);
    }
  };

  const handleCreateQuestion = () => {
    const newId = Date.now().toString();
    const newQuestion: Question = {
        id: newId,
        scenario: 'Escribe aquí la nueva situación...',
        options: [
            { key: 'a', text: 'Opción A' },
            { key: 'b', text: 'Opción B' }
        ]
    };
    setEditingQuestion(newQuestion);
  };

  const handleDeleteQuestion = async () => {
    if (!editingQuestion) return;
    if (confirm("¿Estás seguro de que quieres eliminar esta pregunta? Esta acción no se puede deshacer.")) {
        const updated = questions.filter(q => q.id !== editingQuestion.id);
        setQuestions(updated);
        await DataService.saveQuestions(updated);
        setEditingQuestion(null);
        if (currentQuestionIndex >= updated.length) {
            setCurrentQuestionIndex(Math.max(0, updated.length - 1));
        }
    }
  };

  const saveQuestionChanges = async () => {
    if (!editingQuestion) return;
    
    try {
        setIsStarting(true);
        // Check if it exists
        const exists = questions.some(q => q.id === editingQuestion.id);
        let updated;
        
        if (exists) {
            updated = questions.map(q => q.id === editingQuestion.id ? editingQuestion : q);
        } else {
            updated = [...questions, editingQuestion];
        }
        
        setQuestions(updated);
        
        // Saneamos la copia para localStorage para evitar errores de cuota
        try {
            const sanitized = sanitizeForLocalCache(updated);
            localStorage.setItem('radar_custom_questions', JSON.stringify(sanitized));
        } catch (lsError) {
            console.warn("Error al guardar radar_custom_questions en localStorage (cuota excedida):", lsError);
        }

        await DataService.saveQuestions(updated);
        setEditingQuestion(null);
        showToast("Pregunta guardada con éxito.");
    } catch (error) {
        console.error("Error saving question:", error);
        showToast("Error al guardar la pregunta. Por favor, inténtalo de nuevo.");
    } finally {
        setIsStarting(false);
    }
  };

  const handleAddOption = () => {
    if (!editingQuestion) return;
    const currentOpts = editingQuestion.options || [];
    let nextKey = 'a';
    if (currentOpts.length > 0) {
        const lastKey = currentOpts[currentOpts.length - 1].key;
        nextKey = String.fromCharCode(lastKey.charCodeAt(0) + 1);
    }
    const newOpt = { key: nextKey, text: '' };
    setEditingQuestion({ ...editingQuestion, options: [...currentOpts, newOpt] });
  };

  const handleRemoveLastOption = () => {
    if (!editingQuestion || !editingQuestion.options || editingQuestion.options.length === 0) return;
    const newOpts = [...editingQuestion.options];
    newOpts.pop();
    setEditingQuestion({ ...editingQuestion, options: newOpts });
  };

  const AudioUploadButton = ({ label, hasAudio, onChange, onDelete }: { label: string, hasAudio: boolean, onChange: (e: any) => void, onDelete?: () => void }) => (
    <div className="flex items-center gap-2">
      <label className={`cursor-pointer px-3 py-2 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-2 border ${hasAudio ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'}`}>
         <i className={`fas ${hasAudio ? 'fa-check' : 'fa-microphone'}`}></i> {label}
         <input type="file" accept="audio/*" className="hidden" onChange={onChange} />
      </label>
      {hasAudio && onDelete && (
        <button 
          onClick={onDelete} 
          className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 flex items-center justify-center transition-all"
          title="Eliminar audio"
        >
          <i className="fas fa-trash text-xs"></i>
        </button>
      )}
    </div>
  );

  const containerClasses = isDarkMode ? "bg-[#0f172a] text-blue-50" : "bg-[#faf9f6] text-slate-800";
  const cardClasses = isDarkMode 
    ? "bg-[#1e293b]/80 border-white/10 text-blue-50 shadow-black/50" 
    : "bg-white/80 border-white/60 text-slate-800 shadow-blue-900/5";
  const headerClasses = isDarkMode ? "bg-[#0f172a]/30 border-white/5" : "bg-white/20 border-blue-100/30";
  const buttonClasses = isDarkMode 
    ? "bg-white/10 hover:bg-white/20 text-blue-300 hover:text-white border-white/10 border" 
    : "bg-white hover:bg-red-50 text-slate-500 hover:text-red-500 border border-slate-200 shadow-sm";

  return (
    <div className={`min-h-screen flex flex-col transition-all duration-700 relative overflow-hidden ${containerClasses}`}>
      {/* Rest of the component remains the same */}
      
      {isEditorMode && step === 'questionnaire' && (
        <>
            <button onClick={() => handleEditorNavigation('prev')} disabled={currentQuestionIndex === 0} className="fixed left-4 top-1/2 -translate-y-1/2 z-50 w-12 h-12 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/80 disabled:opacity-30 transition-all">
                <i className="fas fa-chevron-left"></i>
            </button>
            <button onClick={() => handleEditorNavigation('next')} disabled={currentQuestionIndex === questions.length - 1} className="fixed right-4 top-1/2 -translate-y-1/2 z-50 w-12 h-12 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/80 disabled:opacity-30 transition-all">
                <i className="fas fa-chevron-right"></i>
            </button>
        </>
      )}

      <div className="fixed inset-0 z-0 bg-cover bg-center transition-all duration-1000 no-print"
        style={{ 
          backgroundImage: `url('${getCurrentBackground()}')`,
          backgroundPosition: 'center',
          filter: isDarkMode ? 'brightness(0.5) hue-rotate(210deg) saturate(1.2)' : 'brightness(1.05) contrast(0.95)',
        }}>
        <div className={`absolute inset-0 transition-opacity duration-700 ${isDarkMode ? 'bg-[#0f172a]/60 mix-blend-multiply' : 'bg-white/40'}`}></div>
        <CompassBackground isDarkMode={isDarkMode} />
      </div>
      
      <header className={`border-b p-4 sticky top-0 z-50 shadow-sm transition-colors duration-500 no-print ${headerClasses}`}>
        <div className="max-w-xl mx-auto flex flex-wrap justify-between items-center gap-4 relative">
          <Logo size="sm" isDark={isDarkMode} />

          {/* Botón de cierre para móviles (posición absoluta alineada con título) - Solo visible en móvil vertical (portrait) */}
          {(step === 'questionnaire' || step === 'verification' || isEditorMode) && (
              <button 
                type="button"
                onClick={() => setShowExitConfirm(true)}
                className={`lg:hidden landscape:hidden absolute top-4 right-2 w-10 h-10 flex items-center justify-center rounded-full transition-all group z-[90] cursor-pointer ${buttonClasses}`}
                title="Salir / Abandonar"
              >
                <i className="fas fa-times text-lg"></i>
              </button>
          )}
          
          <div className="flex flex-wrap items-center gap-4 justify-end ml-auto"> 
             <div className={`flex rounded-2xl p-1 border ${isDarkMode ? 'bg-black/20 border-white/10' : 'bg-blue-50/50 border-blue-100'}`}>
                <button onClick={() => setVoice(Voice.FEMALE)} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all ${voice === Voice.FEMALE ? 'bg-blue-600 text-white shadow-lg' : isDarkMode ? 'text-blue-300' : 'text-blue-800'}`}>
                    {isMobileDevice ? 'Voz clara' : 'Mujer'}
                </button>
                <button onClick={() => setVoice(Voice.MALE)} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all ${voice === Voice.MALE ? 'bg-blue-600 text-white shadow-lg' : isDarkMode ? 'text-blue-300' : 'text-blue-800'}`}>
                    {isMobileDevice ? 'Voz calmada' : 'Hombre'}
                </button>
                <button onClick={() => { setVoice(Voice.NONE); stopAudio(); }} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all ${voice === Voice.NONE ? 'bg-blue-900 text-white shadow-lg' : isDarkMode ? 'text-blue-300' : 'text-blue-800'}`}>
                    Silencio
                </button>
             </div>

             {/* Botón de cierre para escritorio y móvil horizontal (dentro del flujo flex) */}
             {(step === 'questionnaire' || step === 'verification' || isEditorMode) && (
              <button 
                type="button"
                onClick={() => setShowExitConfirm(true)}
                className={`hidden lg:flex landscape:flex w-12 h-12 items-center justify-center rounded-full transition-all group shrink-0 relative z-[90] cursor-pointer ${buttonClasses}`}
                title="Salir / Abandonar"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 pt-8 pb-32 overflow-visible relative z-10 no-print">
        {step === 'locked' ? (
             <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 text-center animate-in zoom-in-95">
                <div className="w-24 h-24 bg-gray-200 text-gray-500 rounded-full flex items-center justify-center text-4xl mb-6 shadow-inner">
                    <i className="fas fa-lock"></i>
                </div>
                <h2 className="text-3xl font-bold text-gray-700 mb-4 font-friendly">Cuestionario Completado</h2>
                <p className="text-gray-500 max-w-md mx-auto">Este enlace ya ha sido utilizado para realizar el cuestionario. Gracias por tu participación.</p>
             </div>
        ) : (
        <>
            {step === 'questionnaire' && <div className="mb-8"><ProgressBar current={currentQuestionIndex + 1} total={questions.length} /></div>}

            <div className="mb-6 space-y-6">
            {(step === 'verification' || step === 'pin_validation') && (
                <div className="space-y-4 pb-4">
                    {transcript.map((msg, i) => <ChatBubble key={i} msg={msg} isDarkMode={isDarkMode} />)}
                </div>
            )}

            {step === 'questionnaire' && questions[currentQuestionIndex] ? (
                <div ref={questionCardRef} className={`p-8 md:p-10 pt-12 rounded-[2.5rem] relative border backdrop-blur-xl shadow-xl animate-in fade-in duration-700 ${cardClasses}`}>
                <div className="flex justify-between items-center mb-6">
                    <span className={`text-xs font-black uppercase tracking-[0.3em] block opacity-70 ${isDarkMode ? 'text-blue-300' : 'text-blue-800'}`}>Reflexión del Momento</span>
                    
                    {currentQuestionIndex > 0 && (
                    <button 
                        onClick={handleBack} 
                        disabled={isInteractionLocked}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-30 ${isDarkMode ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        title="Pregunta anterior"
                    >
                        <i className="fas fa-arrow-left text-base"></i>
                    </button>
                    )}
                </div>

                <h2 className="text-2xl md:text-3xl font-friendly font-bold leading-snug drop-shadow-sm">{processText(questions[currentQuestionIndex].scenario)}</h2>
                {isEditorMode && (
                    <button onClick={() => setEditingQuestion(questions[currentQuestionIndex])} className="absolute -bottom-4 -right-4 bg-blue-600 text-white w-12 h-12 rounded-full flex items-center justify-center shadow-2xl border-4 border-white"><i className="fas fa-edit text-lg"></i></button>
                )}
                </div>
            ) : step === 'finish' ? (
                <div className={`text-center py-16 rounded-[3rem] border shadow-2xl backdrop-blur-xl ${cardClasses}`}>
                <div className="mb-10"><div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-4xl mx-auto mb-6 animate-in zoom-in duration-500 shadow-xl"><i className="fas fa-check"></i></div><h2 className={`text-3xl font-bold mb-3 font-friendly ${isDarkMode ? 'text-blue-200' : 'text-blue-800'}`}>¡Gracias {currentPatientData.nombre?.split(' ')[0]}!</h2></div>
                
                {isGeneratingReport ? (
                    <div className="flex flex-col items-center gap-6 py-8"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div><p className="text-sm font-black uppercase text-blue-600 animate-pulse tracking-widest">Generando Informe Terapéutico...</p></div>
                ) : hasSentResults ? (
                    <div className="px-8 pb-8 animate-in slide-in-from-bottom-4">
                        <p className={`text-base font-bold mb-8 leading-relaxed ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{processText(globalConfig.afterSendText)}</p>
                        <Button onClick={requestExit} variant="outline" className={`w-full border-blue-600 text-blue-600 hover:bg-blue-50 ${isDarkMode ? 'border-white/20 text-white hover:bg-white/10' : ''}`}>Finalizar</Button>
                    </div>
                ) : (
                    <div className="px-8 pb-8 animate-in slide-in-from-bottom-4">
                        <p className={`text-base font-bold mb-8 leading-relaxed ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{processText(globalConfig.finishText)}</p>
                        <Button onClick={handleSendResults} className="w-full py-5 text-xl shadow-xl shadow-green-600/20 bg-green-600 hover:bg-green-700"><i className="fas fa-paper-plane mr-3"></i> Enviar Resultados</Button>
                    </div>
                )}
                
                {isEditorMode && (
                    <div className="mt-6 mx-8 flex gap-4">
                        <Button onClick={handleCreateQuestion} className={`flex-1 shadow-lg bg-indigo-600 hover:bg-indigo-700`}>Nueva Pregunta</Button>
                        <Button onClick={requestExit} variant="outline" className={`flex-1 ${isDarkMode ? 'border-white/20 text-white hover:bg-white/10' : ''}`}>Salir del Editor</Button>
                    </div>
                )}
                </div>
            ) : step === 'pin_validation' ? (
                <div className={`max-w-md mx-auto p-10 rounded-[3rem] border shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-500 ${cardClasses}`}>
                    <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-8 text-3xl shadow-lg">
                        <i className="fas fa-key"></i>
                    </div>
                    <h3 className={`text-3xl font-bold mb-3 text-center font-friendly ${isDarkMode ? 'text-blue-200' : 'text-blue-900'}`}>Código de Acceso</h3>
                    <p className={`text-sm mb-10 text-center font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Introduce el código de 4 dígitos para validar tu identidad.</p>
                    
                    <input 
                        ref={pinInputRef}
                        type="text" 
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={4}
                        autoComplete="off"
                        className={`w-full text-center tracking-[0.8em] text-5xl py-8 rounded-[2rem] border-2 outline-none transition-all mb-10 font-black ${isDarkMode ? 'bg-black/20 border-white/10 text-white focus:border-blue-500' : 'bg-white border-blue-200 focus:border-blue-500 text-blue-900'}`}
                        value={pinInput}
                        onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                        onKeyPress={e => e.key === 'Enter' && pinInput.length === 4 && handlePinSubmit()}
                    />
                    
                    <Button 
                        onClick={handlePinSubmit} 
                        disabled={pinInput.length !== 4}
                        className="w-full py-5 text-xl rounded-2xl shadow-xl"
                    >
                        Entrar al Cuestionario
                    </Button>
                </div>
            ) : step === 'conclusion_view' ? (
                <div className={`py-12 px-8 rounded-[3rem] border shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-500 ${cardClasses}`}>
                    <div className="w-20 h-20 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-6 shadow-lg">
                        <i className="fas fa-brain"></i>
                    </div>
                    <h2 className={`text-3xl font-bold mb-8 text-center font-friendly ${isDarkMode ? 'text-purple-200' : 'text-purple-900'}`}>Tu Conclusión</h2>
                    
                    {currentPatientData.audioConclusion && (
                        <div className="mb-8 flex justify-center">
                            <audio controls className="w-full max-w-md" src={currentPatientData.audioConclusion} />
                        </div>
                    )}
                    
                    <div className={`prose max-w-none leading-relaxed whitespace-pre-line p-6 rounded-2xl border ${isDarkMode ? 'bg-black/20 border-white/10 text-slate-300' : 'bg-white/50 border-purple-100 text-slate-700'}`}>
                        {currentPatientData.finalConclusion || "Tu terapeuta está preparando la conclusión. Por favor, vuelve más tarde."}
                    </div>
                    
                    <div className="mt-10 flex justify-center">
                        <Button onClick={() => window.location.reload()} variant="outline" className={`px-8 py-3 ${isDarkMode ? 'border-white/20 text-white hover:bg-white/10' : 'border-purple-200 text-purple-700 hover:bg-purple-50'}`}>
                            Cerrar
                        </Button>
                    </div>
                </div>
            ) : step === 'intro' ? (
                <div className="min-h-[60vh] flex flex-col items-center justify-center gap-10 animate-in zoom-in-95 duration-700">
                <Button onClick={startSession} className="scale-125 px-12 py-8 shadow-2xl animate-pulse rounded-[3rem] text-xl font-black tracking-wide bg-blue-600 hover:bg-blue-700 text-white border-4 border-white/30">Empezar Cuestionario</Button>
                {isEditorMode && (
                    <div className="flex flex-col gap-4 w-full max-w-sm px-4">
                        <button onClick={() => setIsEditingGlobal(true)} className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-colors shadow-lg border backdrop-blur-md justify-center ${isDarkMode ? 'bg-black/40 text-white border-white/20 hover:bg-white/10' : 'bg-white/80 text-blue-900 border-blue-100 hover:bg-white'}`}><i className="fas fa-cog"></i> Configurar Mensajes y Voces</button>
                        <button onClick={handleCreateQuestion} className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-colors shadow-lg border backdrop-blur-md justify-center ${isDarkMode ? 'bg-indigo-900/80 text-white border-white/20 hover:bg-indigo-900' : 'bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-700'}`}><i className="fas fa-plus"></i> Nueva Pregunta</button>
                    </div>
                )}
                </div>
            ) : null}
            </div>

            {step === 'questionnaire' && questions[currentQuestionIndex] && (
            <div className="space-y-4 no-print">
                {questions[currentQuestionIndex].isScale && questions[currentQuestionIndex].scaleRange ? (
                    <div className="animate-in slide-in-from-bottom-4">
                        <div className={`p-1 rounded-2xl border-2 ${isDarkMode ? 'bg-white/5 border-white/20' : 'bg-white border-blue-100'}`}>
                            <select 
                                className={`w-full p-4 rounded-xl text-lg font-bold bg-transparent outline-none ${isDarkMode ? 'text-white' : 'text-blue-900'}`}
                                onChange={(e) => handleAnswer(e.target.value)}
                                defaultValue=""
                            >
                                <option value="" disabled>Selecciona un valor ({questions[currentQuestionIndex].scaleRange.min} - {questions[currentQuestionIndex].scaleRange.max})</option>
                                {Array.from({length: (questions[currentQuestionIndex].scaleRange.max - questions[currentQuestionIndex].scaleRange.min + 1)}, (_, i) => i + questions[currentQuestionIndex].scaleRange.min).map(val => (
                                    <option key={val} value={val} className="text-black">{val}</option>
                                ))}
                            </select>
                        </div>
                        <p className={`text-center text-xs mt-3 font-bold uppercase tracking-widest ${isDarkMode ? 'text-blue-300' : 'text-blue-400'}`}>Selecciona una opción para continuar</p>
                    </div>
                ) : (
                    questions[currentQuestionIndex].options.map((opt, idx) => (
                        visibleOptions.includes(opt.key) && (
                            <button 
                            key={opt.key} 
                            id={`opt-${opt.key}`}
                            disabled={isInteractionLocked}
                            onClick={() => handleAnswer(opt.key)} 
                            className={`w-full text-left p-6 rounded-2xl border-2 transition-all shadow-md active:scale-[0.98] animate-option flex items-start gap-5 backdrop-blur-lg ${
                                isInteractionLocked ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:border-blue-400'
                            } ${isDarkMode ? 'bg-[#1e293b]/60 border-white/5 hover:bg-white/10' : 'bg-white/80 border-white hover:bg-white'}`}
                            >
                            <span className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shadow-sm ${isDarkMode ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-600'}`}>{opt.key.toUpperCase()}</span>
                            <span className={`font-bold leading-relaxed text-lg md:text-xl ${isDarkMode ? 'text-blue-50' : 'text-slate-800'}`}>{processText(opt.text)}</span>
                            </button>
                        )
                    ))
                )}
            </div>
            )}
        </>
        )}
      </div>

      {(step === 'verification' || step === 'questionnaire') && (
        <footer 
            className="fixed bottom-0 left-0 right-0 p-4 border-t z-50 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] no-print bg-cover bg-center"
            style={{ 
                backgroundImage: "url('assets/fondomicrofono.webp')",
            }}
        >
          {/* Overlay para legibilidad */}
          <div className={`absolute inset-0 ${isDarkMode ? 'bg-[#0f172a]/30 mix-blend-multiply' : 'bg-white/20'}`}></div>
          
          <div className="max-w-xl mx-auto flex flex-col items-center relative z-10">
            {step === 'verification' && (
              <div className="flex gap-3 w-full max-w-md animate-in slide-in-from-bottom-6 mb-4">
                <input type="text" placeholder="Escribe aquí..." className={`flex-1 px-6 py-4 rounded-2xl border-2 outline-none font-bold transition-all text-lg shadow-inner ${isDarkMode ? 'bg-black/30 border-white/10 text-white focus:border-blue-500' : 'bg-white/90 border-blue-100 focus:border-blue-500 text-slate-800'}`} value={inputValue} onChange={e => setInputValue(e.target.value)} onKeyPress={e => e.key === 'Enter' && inputValue && (handleVerification(inputValue), setInputValue(''))} />
                <Button onClick={() => { if(inputValue) { handleVerification(inputValue); setInputValue(''); } }} className="px-8 text-lg">Enviar</Button>
              </div>
            )}
            
            {sttMessage && (
                <div className="absolute -top-12 bg-black/80 text-white px-4 py-2 rounded-full text-sm font-bold animate-in fade-in slide-in-from-bottom-2">
                    {isLoadingModel ? <i className="fas fa-spinner fa-spin mr-2"></i> : null}
                    {sttMessage}
                </div>
            )}

            <div className="flex items-center gap-8 pb-2">
              <button onClick={() => setIsDarkMode(!isDarkMode)} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all border backdrop-blur-md ${isDarkMode ? 'bg-white/10 border-white/20 text-yellow-300 hover:bg-white/20' : 'bg-white border-white/40 text-indigo-900 hover:bg-indigo-50 shadow-lg'}`}><i className={`fas ${isDarkMode ? 'fa-sun' : 'fa-moon'} text-xl`}></i></button>
              
              <button disabled={voice === Voice.NONE || isLoadingModel} className={`w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all ${isRecording ? 'bg-red-500 animate-pulse scale-110 shadow-red-500/50' : 'bg-gradient-to-br from-blue-500 to-blue-700 hover:scale-105 shadow-blue-600/40' } text-white disabled:opacity-30 border-4 border-white`} onClick={handleMicClick}><i className={`fas ${isLoadingModel ? 'fa-spinner fa-spin' : isRecording ? 'fa-stop' : 'fa-microphone'} text-3xl`}></i></button>
              <div className="flex gap-1.5 items-end h-8 min-w-[40px]">{isSpeaking && [1,2,3].map(i => <div key={i} className="w-1.5 bg-blue-500 rounded-full animate-wave" style={{height: '60%', animationDelay: `${i*0.1}s`}}></div>)}</div>
            </div>
          </div>
        </footer>
      )}
      
      {/* Modals remain the same */}
      {toast && <Toast message={toast.message} visible={toast.visible} onHide={hideToast} />}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
           <Card className="max-w-sm w-full text-center space-y-6 bg-white shadow-2xl scale-100">
             <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto text-2xl"><i className="fas fa-exclamation-triangle"></i></div>
             <div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">¿Abandonar Sesión?</h3>
                <p className="text-slate-500 text-sm">Todo tu progreso actual se perderá si sales ahora.</p>
             </div>
             <div className="grid grid-cols-2 gap-4">
                <Button variant="danger" onClick={confirmExit}>Sí, Salir</Button>
                <Button variant="outline" onClick={() => setShowExitConfirm(false)}>Cancelar</Button>
             </div>
           </Card>
        </div>
      )}
       
       {isEditingGlobal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 no-print">
           <div className="w-full max-w-4xl p-6 md:p-8 bg-[#0f172a] text-blue-50 border border-white/10 overflow-y-auto max-h-[90vh] rounded-[2.5rem] shadow-2xl">
              <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                <h3 className="text-2xl font-bold font-friendly flex items-center gap-3"><i className="fas fa-cog text-blue-500"></i> Configuración Global</h3>
                <button onClick={() => setIsEditingGlobal(false)} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center"><i className="fas fa-times"></i></button>
              </div>
              
              <div className="space-y-8">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                        <label className="block text-[10px] font-black uppercase text-blue-400 mb-4">Voz por Defecto al Iniciar</label>
                        <div className="flex flex-wrap gap-6 mb-4">
                            <div className="flex flex-col gap-2">
                                <button onClick={() => setGlobalConfig({...globalConfig, defaultVoiceMode: Voice.FEMALE})} className={`px-6 py-2 rounded-xl text-xs font-bold uppercase transition-all ${globalConfig.defaultVoiceMode === Voice.FEMALE ? 'bg-blue-600 text-white shadow-lg' : 'bg-white/10 text-slate-400'}`}>Mujer</button>
                                <div className="flex justify-center gap-2">
                                    <button onClick={() => setGlobalConfig({...globalConfig, femaleVoiceVariant: 1})} className={`w-8 h-8 rounded-full text-[10px] font-bold transition-all ${globalConfig.femaleVoiceVariant !== 2 ? 'bg-blue-500 text-white' : 'bg-white/10 text-slate-400'}`}>1</button>
                                    <button onClick={() => setGlobalConfig({...globalConfig, femaleVoiceVariant: 2})} className={`w-8 h-8 rounded-full text-[10px] font-bold transition-all ${globalConfig.femaleVoiceVariant === 2 ? 'bg-blue-500 text-white' : 'bg-white/10 text-slate-400'}`}>2</button>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <button onClick={() => setGlobalConfig({...globalConfig, defaultVoiceMode: Voice.MALE})} className={`px-6 py-2 rounded-xl text-xs font-bold uppercase transition-all ${globalConfig.defaultVoiceMode === Voice.MALE ? 'bg-blue-600 text-white shadow-lg' : 'bg-white/10 text-slate-400'}`}>Hombre</button>
                                <div className="flex justify-center gap-2">
                                    <button onClick={() => setGlobalConfig({...globalConfig, maleVoiceVariant: 1})} className={`w-8 h-8 rounded-full text-[10px] font-bold transition-all ${globalConfig.maleVoiceVariant !== 2 ? 'bg-blue-500 text-white' : 'bg-white/10 text-slate-400'}`}>1</button>
                                    <button onClick={() => setGlobalConfig({...globalConfig, maleVoiceVariant: 2})} className={`w-8 h-8 rounded-full text-[10px] font-bold transition-all ${globalConfig.maleVoiceVariant === 2 ? 'bg-blue-500 text-white' : 'bg-white/10 text-slate-400'}`}>2</button>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <button onClick={() => setGlobalConfig({...globalConfig, defaultVoiceMode: Voice.NONE})} className={`px-6 py-2 rounded-xl text-xs font-bold uppercase transition-all ${globalConfig.defaultVoiceMode === Voice.NONE ? 'bg-blue-900 text-white shadow-lg' : 'bg-white/10 text-slate-400'}`}>Silencio</button>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                        <label className="block text-[10px] font-black uppercase text-blue-400 mb-4">Modo de Visión por Defecto</label>
                        <div className="flex gap-4">
                            {['light', 'dark'].map(t => (
                            <button key={t} onClick={() => setGlobalConfig({...globalConfig, defaultTheme: t as any})} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase ${globalConfig.defaultTheme === t ? 'bg-blue-600 text-white' : 'bg-white/10 text-slate-400'}`}>{t === 'light' ? 'Diurno' : 'Nocturno'}</button>
                            ))}
                        </div>
                    </div>
                 </div>

                 <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                      <div className="flex justify-between items-center mb-4">
                          <label className="block text-[10px] font-black uppercase text-blue-400">Fondo del Cuestionario</label>
                          <label className="cursor-pointer px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all flex items-center gap-2">
                              <i className="fas fa-upload"></i> Subir Nuevo Fondo
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, 'background')} />
                          </label>
                      </div>
                      <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-xl text-xs text-blue-200 mb-6">
                          <i className="fas fa-info-circle mr-2"></i> 
                          <strong>Información:</strong> Aceptamos formatos JPG, PNG y WebP. Tamaño máximo recomendado: 2MB. 
                          Se mantendrán los dos últimos fondos subidos para que puedas alternar o recuperar el anterior.
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                          {globalConfig.backgrounds && globalConfig.backgrounds.map((bg, idx) => (
                              <div key={idx} className="relative group">
                                  <div className="aspect-video rounded-xl overflow-hidden border-2 border-white/10 group-hover:border-blue-500 transition-all">
                                      <img src={bg} alt={`Fondo ${idx === 0 ? 'Actual' : 'Anterior'}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  </div>
                                  <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded text-[8px] font-black uppercase text-white">
                                      {idx === 0 ? 'Último Subido' : 'Anterior'}
                                  </div>
                                  <button 
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          const bgs = globalConfig.backgrounds!.filter((_, i) => i !== idx);
                                          setGlobalConfig({...globalConfig, backgrounds: bgs});
                                      }}
                                      className="absolute top-2 right-2 w-6 h-6 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center text-xs z-10 shadow-lg"
                                      title="Eliminar fondo"
                                  >
                                      <i className="fas fa-times"></i>
                                  </button>
                                  {idx > 0 && (
                                      <button 
                                        onClick={() => {
                                            const bgs = [...globalConfig.backgrounds!];
                                            const temp = bgs[0];
                                            bgs[0] = bgs[idx];
                                            bgs[idx] = temp;
                                            setGlobalConfig({...globalConfig, backgrounds: bgs});
                                        }}
                                        className="absolute inset-0 bg-blue-600/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all rounded-xl text-white font-bold text-xs"
                                      >
                                          Usar este fondo
                                      </button>
                                  )}
                              </div>
                          ))}
                      </div>
                 </div>

                 <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-xl text-xs text-blue-200 mb-4">
                    <i className="fas fa-info-circle mr-2"></i> Tip: Usa <strong>{'{{nombre}}'}</strong> para el nombre y <strong>@</strong> para el género (a/o).
                 </div>

                 {[{id: 'welcome', label: '1. Mensaje de Bienvenida (Intro)'}, {id: 'name', label: '2. Pregunta por el Nombre'}, {id: 'start', label: '3. Mensaje Inicio Cuestionario'}, {id: 'finish', label: '4. Mensaje Final (Antes de Enviar)'}, {id: 'afterSend', label: '5. Mensaje Post-Envío'}].map((section) => (
                    <div key={section.id} className="space-y-4 border-t border-white/10 pt-4">
                       <label className="block text-sm font-bold text-indigo-300">{section.label}</label>
                       <textarea className="w-full bg-white/5 border-2 border-white/10 rounded-xl p-3 text-sm font-medium outline-none focus:border-blue-500 text-white" value={(globalConfig as any)[`${section.id}Text`]} onChange={e => setGlobalConfig({...globalConfig, [`${section.id}Text`]: e.target.value})} rows={3} />
                       <div className="flex flex-wrap gap-4">
                          <AudioUploadButton label="Audio Mujer 1" hasAudio={!!(globalConfig as any)[`${section.id}Audio`]?.female} onChange={(e) => handleFileUpload(e, section.id, undefined, 'female')} />
                          <AudioUploadButton label="Audio Mujer 2" hasAudio={!!(globalConfig as any)[`${section.id}Audio`]?.female2} onChange={(e) => handleFileUpload(e, section.id, undefined, 'female2')} />
                          <AudioUploadButton label="Audio Hombre 1" hasAudio={!!(globalConfig as any)[`${section.id}Audio`]?.male} onChange={(e) => handleFileUpload(e, section.id, undefined, 'male')} />
                          <AudioUploadButton label="Audio Hombre 2" hasAudio={!!(globalConfig as any)[`${section.id}Audio`]?.male2} onChange={(e) => handleFileUpload(e, section.id, undefined, 'male2')} />
                       </div>
                    </div>
                 ))}
              </div>
              <div className="flex gap-4 mt-8 pt-6 border-t border-white/10">
                 <Button onClick={saveGlobalChanges} className="flex-1" disabled={isStarting}>
                    {isStarting ? <><i className="fas fa-spinner fa-spin mr-2"></i> Guardando...</> : 'Guardar Configuración'}
                 </Button>
                 <Button variant="outline" onClick={() => setIsEditingGlobal(false)} className="flex-1 border-white/20 text-white hover:bg-white/5" disabled={isStarting}>Cancelar</Button>
              </div>
            </div>
         </div>
      )}

      {editingQuestion && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 no-print">
          <div className="w-full max-w-6xl p-6 md:p-8 shadow-2xl border border-white/10 bg-[#0f172a] text-blue-50 overflow-y-auto max-h-[95vh] rounded-[2.5rem]">
            <div className="flex justify-between items-center mb-4 border-b pb-4 border-white/10">
              <h3 className="text-2xl font-bold font-friendly flex items-center gap-4"><i className="fas fa-edit text-blue-500"></i> Editar Pregunta</h3>
              <div className="flex gap-2">
                  <button onClick={handleDeleteQuestion} className="px-4 py-2 rounded-lg bg-red-900/50 hover:bg-red-800 text-red-200 text-xs font-bold transition-colors flex items-center gap-2"><i className="fas fa-trash"></i> Eliminar Pregunta</button>
                  <button onClick={() => setEditingQuestion(null)} className="w-10 h-10 rounded-full bg-white/5 hover:bg-red-900/50 hover:text-red-400 transition-colors flex items-center justify-center"><i className="fas fa-times text-xl"></i></button>
              </div>
            </div>
            
            <div className="bg-blue-900/20 p-4 rounded-xl border border-blue-500/20 mb-6 flex items-start gap-3">
               <i className="fas fa-info-circle mt-1 text-blue-400"></i>
               <p className="text-sm text-blue-200 leading-relaxed font-medium"><strong>Editor Completo Activo:</strong> Puedes editar todos los textos y subir audios duales. Los cambios se guardan localmente para este navegador.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-5 space-y-6">
                <div>
                  <label className="block text-[10px] font-black uppercase text-blue-400 mb-2">Escenario (Usa {'{{nombre}}'} o @)</label>
                  <textarea className="w-full border-2 border-white/10 bg-white/5 p-4 rounded-2xl text-sm font-black min-h-[160px] outline-none focus:border-blue-500 text-white leading-relaxed" value={editingQuestion.scenario} onChange={e => setEditingQuestion({...editingQuestion, scenario: e.target.value})} />
                  <div className="flex flex-wrap gap-4 mt-3">
                     <AudioUploadButton label="Audio Escenario (Mujer 1)" hasAudio={!!editingQuestion.audio?.female} onChange={(e) => handleFileUpload(e, 'scenario', undefined, 'female')} />
                     <AudioUploadButton label="Audio Escenario (Mujer 2)" hasAudio={!!editingQuestion.audio?.female2} onChange={(e) => handleFileUpload(e, 'scenario', undefined, 'female2')} />
                     <AudioUploadButton label="Audio Escenario (Hombre 1)" hasAudio={!!editingQuestion.audio?.male} onChange={(e) => handleFileUpload(e, 'scenario', undefined, 'male')} />
                     <AudioUploadButton label="Audio Escenario (Hombre 2)" hasAudio={!!editingQuestion.audio?.male2} onChange={(e) => handleFileUpload(e, 'scenario', undefined, 'male2')} />
                  </div>
                </div>

                {questions.length > 0 && questions[0].id === editingQuestion.id && (
                  <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                    <label className="block text-[10px] font-black uppercase text-blue-400 mb-2">Mensaje tras opciones (Solo 1ª Pregunta)</label>
                    <textarea 
                      className="w-full border-2 border-white/10 bg-black/20 p-3 rounded-xl text-sm font-black min-h-[80px] outline-none focus:border-blue-500 text-white leading-relaxed" 
                      placeholder="¿Con cuál de estas situaciones te sientes más identificado?"
                      value={editingQuestion.postOptionsText || ''} 
                      onChange={e => setEditingQuestion({...editingQuestion, postOptionsText: e.target.value})} 
                    />
                    <div className="flex flex-wrap gap-4 mt-3">
                       <AudioUploadButton label="Audio Mensaje (Mujer 1)" hasAudio={!!editingQuestion.postOptionsAudio?.female} onChange={(e) => handleFileUpload(e, 'postOptions', undefined, 'female')} />
                       <AudioUploadButton label="Audio Mensaje (Mujer 2)" hasAudio={!!editingQuestion.postOptionsAudio?.female2} onChange={(e) => handleFileUpload(e, 'postOptions', undefined, 'female2')} />
                       <AudioUploadButton label="Audio Mensaje (Hombre 1)" hasAudio={!!editingQuestion.postOptionsAudio?.male} onChange={(e) => handleFileUpload(e, 'postOptions', undefined, 'male')} />
                       <AudioUploadButton label="Audio Mensaje (Hombre 2)" hasAudio={!!editingQuestion.postOptionsAudio?.male2} onChange={(e) => handleFileUpload(e, 'postOptions', undefined, 'male2')} />
                    </div>
                  </div>
                )}

                <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                   <div className="flex justify-between items-center">
                       <label className="block text-[10px] font-black uppercase text-blue-400">Tipo de Respuesta</label>
                       <button 
                         onClick={() => setEditingQuestion({
                             ...editingQuestion, 
                             isScale: !editingQuestion.isScale,
                             scaleRange: !editingQuestion.isScale ? { min: 1, max: 5 } : undefined
                         })}
                         className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${!!editingQuestion.isScale ? 'bg-blue-600 text-white' : 'bg-white/10 text-slate-400 hover:bg-white/20'}`}
                       >
                         {!!editingQuestion.isScale ? 'Numérica (Desplegable)' : 'Opciones Texto'}
                       </button>
                    </div>
                </div>
              </div>
              
              <div className="lg:col-span-7 space-y-4">
                  <label className="block text-[10px] font-black uppercase text-blue-400 mb-2">Configuración de Respuestas</label>
                  {!!editingQuestion.isScale ? (
                        <div className="bg-white/5 p-6 rounded-xl border border-white/10 space-y-4 h-full">
                            <p className="text-sm text-slate-300">Configura el rango numérico para el desplegable.</p>
                            <div className="flex gap-6 items-center">
                                <div>
                                    <label className="block text-[10px] mb-2 uppercase font-bold text-slate-400">Valor Mínimo</label>
                                    <input type="number" className="w-24 bg-black/20 border border-white/20 rounded-xl p-3 text-center text-lg font-bold" value={editingQuestion.scaleRange?.min ?? 1} onChange={e => setEditingQuestion({...editingQuestion, scaleRange: { min: parseInt(e.target.value), max: editingQuestion.scaleRange?.max || 5 }})} />
                                </div>
                                <div className="h-0.5 w-8 bg-white/10"></div>
                                <div>
                                    <label className="block text-[10px] mb-2 uppercase font-bold text-slate-400">Valor Máximo</label>
                                    <input type="number" className="w-24 bg-black/20 border border-white/20 rounded-xl p-3 text-center text-lg font-bold" value={editingQuestion.scaleRange?.max ?? 5} onChange={e => setEditingQuestion({...editingQuestion, scaleRange: { min: editingQuestion.scaleRange?.min || 1, max: parseInt(e.target.value) }})} />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                            {editingQuestion.options.map((opt, idx) => (
                                <div key={opt.key} className="bg-white/5 p-4 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                                    <div className="flex gap-3 mb-3">
                                        <span className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-black text-xs shrink-0">{opt.key.toUpperCase()}</span>
                                        <input className="flex-1 border-2 border-white/10 bg-transparent px-3 py-1 rounded-lg text-sm text-white focus:border-blue-500 outline-none transition-all" value={opt.text} onChange={e => { const opts = [...editingQuestion.options]; opts[idx].text = e.target.value; setEditingQuestion({...editingQuestion, options: opts}); }} />
                                    </div>
                                    <div className="flex flex-wrap gap-3 pl-11">
                                        <AudioUploadButton label="Audio Opción (M1)" hasAudio={!!opt.audio?.female} onChange={(e) => handleFileUpload(e, 'option', idx, 'female')} />
                                        <AudioUploadButton label="Audio Opción (M2)" hasAudio={!!opt.audio?.female2} onChange={(e) => handleFileUpload(e, 'option', idx, 'female2')} />
                                        <AudioUploadButton label="Audio Opción (H1)" hasAudio={!!opt.audio?.male} onChange={(e) => handleFileUpload(e, 'option', idx, 'male')} />
                                        <AudioUploadButton label="Audio Opción (H2)" hasAudio={!!opt.audio?.male2} onChange={(e) => handleFileUpload(e, 'option', idx, 'male2')} />
                                    </div>
                                </div>
                            ))}
                            <div className="flex gap-2 mt-4 pt-2 border-t border-white/5">
                                <Button className="flex-1 py-3 text-xs" onClick={handleAddOption} variant="secondary"><i className="fas fa-plus mr-2"></i> Añadir Opción</Button>
                                <Button className="w-14 py-3 text-xs bg-red-900/50 hover:bg-red-900 text-red-200" onClick={handleRemoveLastOption}><i className="fas fa-trash"></i></Button>
                            </div>
                        </div>
                    )}
              </div>
            </div>
            <div className="flex gap-4 pt-6 border-t border-white/10 mt-6">
              <Button className="flex-1 py-4 text-lg" onClick={saveQuestionChanges} disabled={isStarting}>
                {isStarting ? <><i className="fas fa-spinner fa-spin mr-2"></i> Guardando...</> : 'Guardar Cambios'}
              </Button>
              <Button variant="outline" className="flex-1 py-4 border-white/20 text-white font-black hover:bg-white/5" onClick={() => setEditingQuestion(null)} disabled={isStarting}>Cancelar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
