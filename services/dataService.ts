import { db, auth } from './firebase';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  getDocs, 
  query, 
  where, 
  deleteDoc,
  getDocFromServer
} from 'firebase/firestore';
import { QUESTIONS as INITIAL_QUESTIONS } from '../constants';
import { Question, GlobalConfig, PatientData, AuthUser } from '../types';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`[Firestore Error] Op: ${operationType}, Path: ${path} | Details:`, errorMessage);
  
  // Solo lanzamos el error si es una operación de escritura (para que el UI lo capture)
  // Para lecturas, solo logueamos para no romper el flujo inicial
  if (operationType === OperationType.WRITE || 
      operationType === OperationType.CREATE || 
      operationType === OperationType.UPDATE || 
      operationType === OperationType.DELETE) {
    throw error instanceof Error ? error : new Error(errorMessage);
  }
}

const isBase64Audio = (str: any) => typeof str === 'string' && str.startsWith('data:');
const isAudioRef = (str: any) => typeof str === 'string' && str.startsWith('audio_ref_');

/**
 * Servicio unificado de datos.
 */
export const DataService = {
  
  async testConnection() {
    if (!db) return;
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error("Please check your Firebase configuration.");
      }
    }
  },

  async getQuestions(): Promise<Question[]> {
    let questions: Question[] = [];

    if (db) {
      const path = 'questionnaires/active';
      try {
        const docRef = doc(db, 'questionnaires', 'active');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.questions && Array.isArray(data.questions)) {
             questions = data.questions.map((q: any, idx: number) => ({
                 ...q,
                 index: idx,
                 scenario: q.text || q.scenario || "Pregunta sin texto",
                 id: q.id ? String(q.id) : `legacy_${idx}`
             }));

             // Resolver referencias de audio
             const resolveAudioField = async (obj: any, field: string) => {
               if (obj && obj[field]) {
                 if (typeof obj[field] === 'string') {
                   if (isAudioRef(obj[field])) {
                     try {
                       const audioDoc = await getDoc(doc(db!, 'audios', obj[field]));
                       if (audioDoc.exists()) {
                         obj[field] = audioDoc.data().data;
                       } else {
                         obj[field] = undefined;
                       }
                     } catch (e) {
                       console.error("Error loading audio ref", obj[field], e);
                     }
                   }
                 } else if (typeof obj[field] === 'object') {
                   for (const key of Object.keys(obj[field])) {
                     const val = obj[field][key];
                     if (isAudioRef(val)) {
                       try {
                         const audioDoc = await getDoc(doc(db!, 'audios', val));
                         if (audioDoc.exists()) {
                           obj[field][key] = audioDoc.data().data;
                         } else {
                           obj[field][key] = undefined;
                         }
                       } catch (e) {
                         console.error("Error loading audio ref", val, e);
                       }
                     }
                   }
                 }
               }
             };

             const resolvePromises: Promise<void>[] = [];
             for (const q of questions) {
               resolvePromises.push(resolveAudioField(q, 'audio'));
               resolvePromises.push(resolveAudioField(q, 'postOptionsAudio'));
               if (q.options) {
                 for (const opt of q.options) {
                   resolvePromises.push(resolveAudioField(opt, 'audio'));
                 }
               }
             }
             await Promise.all(resolvePromises);
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      }
    }

    if (questions.length === 0) {
      try {
        const local = localStorage.getItem('radar_custom_questions');
        if (local) questions = JSON.parse(local);
      } catch (e) {}
    }

    if (!questions || questions.length === 0) {
      questions = INITIAL_QUESTIONS.map((q, idx) => ({ ...q, index: idx }));
    }

    return questions;
  },

  async saveQuestions(questions: Question[]) {
    if (!db) return;
    const path = 'questionnaires/active';
    try {
      // Copia profunda para no mutar el estado de la UI
      const processedQuestions = JSON.parse(JSON.stringify(questions));
      const audioPromises: Promise<void>[] = [];
      let detectedAudios = 0;

      const processAudioField = (obj: any, field: string) => {
        if (obj && obj[field]) {
          if (typeof obj[field] === 'string') {
            if (isBase64Audio(obj[field])) {
              detectedAudios++;
              const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              const val = obj[field];
              obj[field] = audioId;
              audioPromises.push(
                setDoc(doc(db!, 'audios', audioId), { data: val })
              );
            }
          } else if (typeof obj[field] === 'object') {
            for (const key of Object.keys(obj[field])) {
              const val = obj[field][key];
              if (isBase64Audio(val)) {
                detectedAudios++;
                const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                obj[field][key] = audioId;
                audioPromises.push(
                  setDoc(doc(db!, 'audios', audioId), { data: val })
                );
              }
            }
          }
        }
      };

      for (const q of processedQuestions) {
        processAudioField(q, 'audio');
        processAudioField(q, 'postOptionsAudio');
        if (q.options) {
          for (const opt of q.options) {
            processAudioField(opt, 'audio');
          }
        }
      }

      console.log(`[TEST LOG] Audios detectados antes de guardar: ${detectedAudios}`);
      console.log(`[TEST LOG] Intentando hacer ${audioPromises.length} setDoc a 'audios'`);

      // Esperar a que todos los audios se guarden individualmente
      try {
        await Promise.all(audioPromises);
        console.log(`[TEST LOG] Promise.all(audioPromises) terminó correctamente.`);
      } catch (audioError) {
        console.error("[TEST LOG] Error en Promise.all(audioPromises):", audioError);
        handleFirestoreError(audioError, OperationType.WRITE, 'audios');
        return;
      }

      const questionsString = JSON.stringify(processedQuestions);
      console.log(`[TEST LOG] Tamaño aproximado de processedQuestions: ${questionsString.length} caracteres`);

      // Guardar el cuestionario con las referencias (mucho más ligero)
      await setDoc(doc(db, 'questionnaires', 'active'), { questions: processedQuestions });
      console.log(`[TEST LOG] Cuestionario guardado exitosamente en questionnaires/active`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async getGlobalConfig(defaultConfig: GlobalConfig): Promise<GlobalConfig> {
      let config = { ...defaultConfig };
      let foundRemote = false;

      if (db) {
          const path = 'config/global_config';
          try {
              const docRef = doc(db, 'config', 'global_config');
              const docSnap = await getDoc(docRef);
              if (docSnap.exists()) {
                  config = { ...config, ...docSnap.data() };
                  foundRemote = true;

                  // Resolver referencias de audio en la configuración
                  const resolveAudioField = async (obj: any, field: string) => {
                    if (obj && obj[field]) {
                      if (typeof obj[field] === 'string') {
                        if (isAudioRef(obj[field])) {
                          try {
                            const audioDoc = await getDoc(doc(db!, 'audios', obj[field]));
                            if (audioDoc.exists()) {
                              obj[field] = audioDoc.data().data;
                            } else {
                              obj[field] = undefined;
                            }
                          } catch (e) {
                            console.error("Error loading audio ref in config", obj[field], e);
                          }
                        }
                      } else if (typeof obj[field] === 'object') {
                        for (const key of Object.keys(obj[field])) {
                          const val = obj[field][key];
                          if (isAudioRef(val)) {
                            try {
                              const audioDoc = await getDoc(doc(db!, 'audios', val));
                              if (audioDoc.exists()) {
                                obj[field][key] = audioDoc.data().data;
                              } else {
                                obj[field][key] = undefined;
                              }
                            } catch (e) {
                              console.error("Error loading audio ref in config", val, e);
                            }
                          }
                        }
                      }
                    }
                  };

                  const resolvePromises: Promise<void>[] = [
                    resolveAudioField(config, 'welcomeAudio'),
                    resolveAudioField(config, 'nameQuestionAudio'),
                    resolveAudioField(config, 'startAudio'),
                    resolveAudioField(config, 'finishAudio'),
                    resolveAudioField(config, 'afterSendAudio')
                  ];
                  await Promise.all(resolvePromises);
              }
          } catch (error) {
              handleFirestoreError(error, OperationType.GET, path);
          }
      }

      if (!foundRemote) {
          try {
            const local = localStorage.getItem('radar_global_config');
            if (local) config = { ...config, ...JSON.parse(local) };
          } catch (e) {}
      }

      return config;
  },

  async saveGlobalConfig(config: GlobalConfig) {
    if (!db) return;
    const path = 'config/global_config';
    try {
      const processedConfig = JSON.parse(JSON.stringify(config));
      const audioPromises: Promise<void>[] = [];

      const processAudioField = (obj: any, field: string) => {
        if (obj && obj[field]) {
          if (typeof obj[field] === 'string') {
            if (isBase64Audio(obj[field])) {
              const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              const val = obj[field];
              obj[field] = audioId;
              audioPromises.push(
                setDoc(doc(db!, 'audios', audioId), { data: val })
              );
            }
          } else if (typeof obj[field] === 'object') {
            for (const key of Object.keys(obj[field])) {
              const val = obj[field][key];
              if (isBase64Audio(val)) {
                const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                obj[field][key] = audioId;
                audioPromises.push(
                  setDoc(doc(db!, 'audios', audioId), { data: val })
                );
              }
            }
          }
        }
      };

      processAudioField(processedConfig, 'welcomeAudio');
      processAudioField(processedConfig, 'nameQuestionAudio');
      processAudioField(processedConfig, 'startAudio');
      processAudioField(processedConfig, 'finishAudio');
      processAudioField(processedConfig, 'afterSendAudio');

      await Promise.all(audioPromises);

      await setDoc(doc(db, 'config', 'global_config'), processedConfig);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  // --- Usuarios (Coordinadores) ---
  async getUser(email: string): Promise<AuthUser | null> {
    if (!db) return null;
    const path = `users/${email.toLowerCase()}`;
    try {
      const docRef = doc(db, 'users', email.toLowerCase());
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? docSnap.data() as AuthUser : null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return null;
    }
  },

  async saveUser(user: AuthUser) {
    if (!db) return;
    const path = `users/${user.email.toLowerCase()}`;
    try {
      await setDoc(doc(db, 'users', user.email.toLowerCase()), user);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async updateUser(email: string, data: Partial<AuthUser>) {
    if (!db) return;
    const path = `users/${email.toLowerCase()}`;
    try {
      await updateDoc(doc(db, 'users', email.toLowerCase()), data);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  // --- Pacientes ---
  async getPatients(coordinatorEmail: string): Promise<PatientData[]> {
    if (!db) return [];
    const path = 'patients';
    try {
      const q = query(collection(db, 'patients'), where('coordinatorEmail', '==', coordinatorEmail));
      const querySnapshot = await getDocs(q);
      const patients: PatientData[] = [];
      
      const resolvePromises: Promise<void>[] = [];
      
      querySnapshot.forEach((docSnap) => {
        const patient = docSnap.data() as PatientData;
        patients.push(patient);
        
        if (isAudioRef(patient.audioConclusion)) {
          resolvePromises.push((async () => {
            try {
              const audioDoc = await getDoc(doc(db!, 'audios', patient.audioConclusion!));
              if (audioDoc.exists()) {
                patient.audioConclusion = audioDoc.data().data;
              } else {
                patient.audioConclusion = undefined;
              }
            } catch (e) {
              console.error("Error loading audioConclusion ref", patient.audioConclusion, e);
            }
          })());
        }
      });
      
      await Promise.all(resolvePromises);
      return patients;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  async savePatient(patient: PatientData) {
    if (!db) return;
    const path = `patients/${patient.id}`;
    try {
      const processedPatient = JSON.parse(JSON.stringify(patient));

      if (isBase64Audio(processedPatient.audioConclusion)) {
        const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const audioData = processedPatient.audioConclusion;
        processedPatient.audioConclusion = audioId;
        await setDoc(doc(db, 'audios', audioId), { data: audioData });
      }

      await setDoc(doc(db, 'patients', patient.id), processedPatient);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async updatePatient(patientId: string, data: Partial<PatientData>) {
    if (!db) return;
    const path = `patients/${patientId}`;
    try {
      const processedData = JSON.parse(JSON.stringify(data));

      if (isBase64Audio(processedData.audioConclusion)) {
        const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const audioData = processedData.audioConclusion;
        processedData.audioConclusion = audioId;
        await setDoc(doc(db, 'audios', audioId), { data: audioData });
      }

      await updateDoc(doc(db, 'patients', patientId), processedData);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async deletePatient(patientId: string) {
    if (!db) return;
    const path = `patients/${patientId}`;
    try {
      await deleteDoc(doc(db, 'patients', patientId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async getPatientById(patientId: string): Promise<PatientData | null> {
    if (!db) return null;
    const path = `patients/${patientId}`;
    try {
      const docRef = doc(db, 'patients', patientId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const patient = docSnap.data() as PatientData;
        if (isAudioRef(patient.audioConclusion)) {
          try {
            const audioDoc = await getDoc(doc(db, 'audios', patient.audioConclusion));
            if (audioDoc.exists()) {
              patient.audioConclusion = audioDoc.data().data;
            } else {
              patient.audioConclusion = undefined;
            }
          } catch (e) {
            console.error("Error loading audioConclusion ref", patient.audioConclusion, e);
          }
        }
        return patient;
      }
      return null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return null;
    }
  }
};
