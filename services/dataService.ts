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

const isBase64Audio = (str: any) => typeof str === 'string' && str.startsWith('data:audio/');
const isAudioRef = (str: any) => typeof str === 'string' && str.startsWith('audio_ref_');

/**
 * Servicio unificado de datos.
 */
export const DataService = {
  _globalConfigCache: null as GlobalConfig | null,
  _globalConfigPromise: null as Promise<GlobalConfig> | null,
  _userCache: {} as Record<string, AuthUser>,
  _userPromises: {} as Record<string, Promise<AuthUser | null>>,
  _patientsCache: {} as Record<string, { data: PatientData[], timestamp: number }>,
  _patientsPromises: {} as Record<string, Promise<PatientData[]>>,
  _patientByIdCache: {} as Record<string, { data: PatientData, timestamp: number }>,
  _patientByIdPromises: {} as Record<string, Promise<PatientData | null>>,
  _questionsCache: null as Question[] | null,
  _questionsPromise: null as Promise<Question[]> | null,
  
  async migrateActiveQuestionnaireAudios() {
    if (!db) return { error: "No DB connection" };
    console.log("[MIGRATION] Starting manual migration of active questionnaire audios...");
    
    try {
      const docRef = doc(db, 'questionnaires', 'active');
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        console.log("[MIGRATION] No active questionnaire found.");
        return { error: "No active questionnaire" };
      }

      const data = docSnap.data();
      if (!data.questions || !Array.isArray(data.questions)) {
        console.log("[MIGRATION] No questions array found in document.");
        return { error: "No questions array" };
      }

      // Copia profunda para trabajar
      const processedQuestions = JSON.parse(JSON.stringify(data.questions));
      const audioPromises: Promise<void>[] = [];
      let detectedAudios = 0;
      let createdDocs = 0;

      const processAudioField = (obj: any, field: string) => {
        if (obj && obj[field]) {
          if (typeof obj[field] === 'string') {
            if (isBase64Audio(obj[field])) {
              detectedAudios++;
              const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              const val = obj[field];
              obj[field] = audioId;
              audioPromises.push(
                setDoc(doc(db!, 'audios', audioId), { data: val }).then(() => { createdDocs++; })
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
                  setDoc(doc(db!, 'audios', audioId), { data: val }).then(() => { createdDocs++; })
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

      console.log(`[MIGRATION] Detected ${detectedAudios} Base64 audios. Waiting for uploads...`);
      await Promise.all(audioPromises);
      console.log(`[MIGRATION] Uploaded ${createdDocs} audio documents.`);

      if (detectedAudios > 0) {
        await setDoc(doc(db, 'questionnaires', 'active'), { questions: processedQuestions });
        console.log("[MIGRATION] Successfully updated questionnaires/active with references.");
      } else {
        console.log("[MIGRATION] No Base64 audios found. No changes made to questionnaires/active.");
      }

      return {
        detectedAudios,
        createdDocs,
        updatedQuestionnaire: detectedAudios > 0
      };
    } catch (error) {
      console.error("[MIGRATION] Error during migration:", error);
      return { error: String(error) };
    }
  },

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
    if (this._questionsCache) {
        console.log("[CACHE] Usando cache para questions");
        return this._questionsCache;
    }

    if (this._questionsPromise) {
        console.log("[CACHE] Esperando promesa en curso para questions");
        return this._questionsPromise;
    }

    console.log("[FIRESTORE] Leyendo questionnaires/active");
    this._questionsPromise = (async () => {
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

        this._questionsCache = questions;
        return questions;
    })();

    try {
        const result = await this._questionsPromise;
        return result;
    } finally {
        this._questionsPromise = null;
    }
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
      this._questionsCache = null; // Invalidate cache
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async getGlobalConfig(defaultConfig: GlobalConfig): Promise<GlobalConfig> {
      if (this._globalConfigCache) {
          console.log("[CACHE] Usando cache para global_config");
          return { ...defaultConfig, ...this._globalConfigCache };
      }
      
      if (this._globalConfigPromise) {
          console.log("[CACHE] Esperando promesa en curso para global_config");
          const res = await this._globalConfigPromise;
          return { ...defaultConfig, ...res };
      }
      
      console.log("[FIRESTORE] Leyendo config/global_config");
      
      this._globalConfigPromise = (async () => {
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
                      
                      this._globalConfigCache = config;
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
      })();
      
      try {
          const result = await this._globalConfigPromise;
          return result;
      } finally {
          this._globalConfigPromise = null;
      }
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
      this._globalConfigCache = null; // Invalidate cache
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  // --- Usuarios (Coordinadores) ---
  async getUser(email: string): Promise<AuthUser | null> {
    if (!db) return null;
    const emailKey = email.toLowerCase();
    if (this._userCache[emailKey]) {
        console.log(`[CACHE] Usando cache para user: ${emailKey}`);
        return this._userCache[emailKey];
    }
    
    if (this._userPromises[emailKey]) {
        console.log(`[CACHE] Esperando promesa en curso para user: ${emailKey}`);
        return this._userPromises[emailKey];
    }
    
    console.log(`[FIRESTORE] Leyendo user: ${emailKey}`);
    const path = `users/${emailKey}`;
    
    this._userPromises[emailKey] = (async () => {
        try {
          const docRef = doc(db, 'users', emailKey);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
              const data = docSnap.data() as AuthUser;
              this._userCache[emailKey] = data;
              return data;
          }
          return null;
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, path);
          return null;
        }
    })();
    
    try {
        const result = await this._userPromises[emailKey];
        return result;
    } finally {
        delete this._userPromises[emailKey];
    }
  },

  async saveUser(user: AuthUser) {
    if (!db) return;
    const emailKey = user.email.toLowerCase();
    const path = `users/${emailKey}`;
    try {
      await setDoc(doc(db, 'users', emailKey), user);
      this._userCache[emailKey] = user;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async updateUser(email: string, data: Partial<AuthUser>) {
    if (!db) return;
    const emailKey = email.toLowerCase();
    const path = `users/${emailKey}`;
    try {
      await updateDoc(doc(db, 'users', emailKey), data);
      if (this._userCache[emailKey]) {
          this._userCache[emailKey] = { ...this._userCache[emailKey], ...data };
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  // --- Pacientes ---
  async getPatients(coordinatorEmail: string): Promise<PatientData[]> {
    if (!db) return [];
    
    // Cache de 30 segundos para patients
    const cacheEntry = this._patientsCache[coordinatorEmail];
    if (cacheEntry && (Date.now() - cacheEntry.timestamp < 30000)) {
        console.log(`[CACHE] Usando cache para patients de: ${coordinatorEmail}`);
        return cacheEntry.data;
    }
    
    if (this._patientsPromises[coordinatorEmail]) {
        console.log(`[CACHE] Esperando promesa en curso para patients de: ${coordinatorEmail}`);
        return this._patientsPromises[coordinatorEmail];
    }
    
    console.log(`[FIRESTORE] Listando patients de: ${coordinatorEmail}`);
    const path = 'patients';
    
    this._patientsPromises[coordinatorEmail] = (async () => {
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
          
          this._patientsCache[coordinatorEmail] = { data: patients, timestamp: Date.now() };
          return patients;
        } catch (error) {
          handleFirestoreError(error, OperationType.LIST, path);
          return [];
        }
    })();
    
    try {
        const result = await this._patientsPromises[coordinatorEmail];
        return result;
    } finally {
        delete this._patientsPromises[coordinatorEmail];
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
      // Invalidate cache
      if (patient.coordinatorEmail) {
          delete this._patientsCache[patient.coordinatorEmail];
      }
      delete this._patientByIdCache[patient.id];
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
      this._patientsCache = {}; // Invalidate all patient caches
      delete this._patientByIdCache[patientId];
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async deletePatient(patientId: string) {
    if (!db) return;
    const path = `patients/${patientId}`;
    try {
      await deleteDoc(doc(db, 'patients', patientId));
      this._patientsCache = {}; // Invalidate all patient caches
      delete this._patientByIdCache[patientId];
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async getPatientById(patientId: string): Promise<PatientData | null> {
    if (!db) return null;
    
    // Cache de 30 segundos para patientById
    const cacheEntry = this._patientByIdCache[patientId];
    if (cacheEntry && (Date.now() - cacheEntry.timestamp < 30000)) {
        console.log(`[CACHE] Usando cache para patientById: ${patientId}`);
        return cacheEntry.data;
    }
    
    if (this._patientByIdPromises[patientId]) {
        console.log(`[CACHE] Esperando promesa en curso para patientById: ${patientId}`);
        return this._patientByIdPromises[patientId];
    }
    
    console.log(`[FIRESTORE] Leyendo patientById: ${patientId}`);
    const path = `patients/${patientId}`;
    
    this._patientByIdPromises[patientId] = (async () => {
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
            this._patientByIdCache[patientId] = { data: patient, timestamp: Date.now() };
            return patient;
          }
          return null;
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, path);
          return null;
        }
    })();
    
    try {
        const result = await this._patientByIdPromises[patientId];
        return result;
    } finally {
        delete this._patientByIdPromises[patientId];
    }
  }
};

// Exponer DataService globalmente para permitir la migración manual desde la consola
if (typeof window !== 'undefined') {
  (window as any).DataService = DataService;
}
