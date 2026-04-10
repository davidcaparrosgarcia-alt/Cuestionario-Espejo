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

const FirestoreDebug = {
  stats: {
    operations: {} as Record<string, number>,
    paths: {} as Record<string, number>,
    total: 0
  },
  verbose: false,
  startTime: Date.now(),
  lastReset: Date.now(),

  log(operation: string, path: string) {
    this.stats.total++;
    this.stats.operations[operation] = (this.stats.operations[operation] || 0) + 1;
    this.stats.paths[path] = (this.stats.paths[path] || 0) + 1;

    if (this.verbose) {
      console.log(`[FS-DEBUG] ${operation.toUpperCase()} ${path}`);
    }
  },

  report() {
    console.log("=== Firestore Operations Debug Report ===");
    console.log(`Note: This is an approximate client-side counter, not official Google quota.`);
    console.log(`Start Time: ${new Date(this.startTime).toISOString()}`);
    console.log(`Last Reset: ${new Date(this.lastReset).toISOString()}`);
    console.log(`Total Operations: ${this.stats.total}`);
    console.log("\n--- By Operation ---");
    console.table(this.stats.operations);
    console.log("\n--- By Path ---");
    console.table(this.stats.paths);
    console.log("=========================================");
  },

  reset() {
    this.stats = { operations: {}, paths: {}, total: 0 };
    this.lastReset = Date.now();
    console.log("[FS-DEBUG] Counters reset.");
  },

  getStats() {
    return this.stats;
  },

  enableVerbose() {
    this.verbose = true;
    console.log("[FS-DEBUG] Verbose mode ENABLED.");
  },

  disableVerbose() {
    this.verbose = false;
    console.log("[FS-DEBUG] Verbose mode DISABLED.");
  }
};

if (typeof window !== 'undefined') {
  (window as any).FirestoreDebug = FirestoreDebug;
}

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
  _audioRegistry: {} as Record<string, { ref: string, base64: string }>,

  _getAudioRef(logicalKey: string, currentBase64: string): string | null {
    const entry = this._audioRegistry[logicalKey];
    if (entry && entry.base64 === currentBase64) {
      return entry.ref;
    }
    return null;
  },

  _updateAudioRegistry(logicalKey: string, ref: string, base64: string) {
    this._audioRegistry[logicalKey] = { ref, base64 };
  },

  async _addAudioUsage(audioRef: string, logicalKey: string) {
    if (!isAudioRef(audioRef) || !db) return;
    try {
      const docRef = doc(db, 'audios', audioRef);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        const isLegacy = data.usedBy === undefined;
        const usedBy = data.usedBy || {};
        
        if (!usedBy[logicalKey]) {
          usedBy[logicalKey] = true;
          const updateData: any = { usedBy };
          if (isLegacy) {
            updateData.legacy = true;
          }
          await updateDoc(docRef, updateData);
          console.log(`[AUDIO-REFS] Added logicalKey to usedBy: ${logicalKey} -> ${audioRef}`);
        }
      }
    } catch (e) {
      console.error("[AUDIO-REFS] Error adding usage", e);
    }
  },

  async _removeAudioUsage(audioRef: string, logicalKey: string) {
    if (!isAudioRef(audioRef) || !db) return;
    try {
      const docRef = doc(db, 'audios', audioRef);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        const usedBy = data.usedBy;
        
        if (usedBy && usedBy[logicalKey]) {
          delete usedBy[logicalKey];
          console.log(`[AUDIO-REFS] Removed logicalKey from usedBy: ${logicalKey} -> ${audioRef}`);
          
          if (Object.keys(usedBy).length === 0) {
            console.log(`[AUDIO-CLEANUP] Deleted orphan ref with empty usedBy: ${audioRef}`);
            await deleteDoc(docRef);
            // Remove from registry
            for (const key of Object.keys(this._audioRegistry)) {
              if (this._audioRegistry[key].ref === audioRef) {
                delete this._audioRegistry[key];
              }
            }
          } else {
            await updateDoc(docRef, { usedBy });
          }
        } else if (!usedBy || data.legacy) {
          // Si es legacy y no tiene usedBy, o si se está eliminando y no estaba en usedBy,
          // asumimos que es huérfano porque ya no hacemos escaneos globales.
          console.log(`[AUDIO-CLEANUP] Deleted legacy orphan ref: ${audioRef}`);
          await deleteDoc(docRef);
          // Remove from registry
          for (const key of Object.keys(this._audioRegistry)) {
            if (this._audioRegistry[key].ref === audioRef) {
              delete this._audioRegistry[key];
            }
          }
        }
      }
    } catch (e) {
      console.error("[AUDIO-REFS] Error removing usage", e);
    }
  },

  async _syncAudioRefs(oldMappings: Record<string, string>, newMappings: Record<string, string>) {
    const promises: Promise<void>[] = [];

    // Find removed or changed mappings
    for (const [logicalKey, oldRef] of Object.entries(oldMappings)) {
      if (newMappings[logicalKey] !== oldRef) {
        promises.push(this._removeAudioUsage(oldRef, logicalKey));
      }
    }

    // Find added or changed mappings
    for (const [logicalKey, newRef] of Object.entries(newMappings)) {
      if (oldMappings[logicalKey] !== newRef) {
        promises.push(this._addAudioUsage(newRef, logicalKey));
      }
    }

    await Promise.all(promises);
  },

  _extractQuestionAudioRefs(questions: any[]): Record<string, string> {
    const refs: Record<string, string> = {};
    for (let qIdx = 0; qIdx < questions.length; qIdx++) {
      const q = questions[qIdx];
      const qId = q.id || `legacy_${qIdx}`;
      
      const extractField = (obj: any, field: string, baseKey: string) => {
        if (obj && obj[field]) {
          if (typeof obj[field] === 'string' && isAudioRef(obj[field])) {
            refs[baseKey] = obj[field];
          } else if (typeof obj[field] === 'object') {
            for (const key of Object.keys(obj[field])) {
              const val = obj[field][key];
              if (isAudioRef(val)) {
                refs[`${baseKey}:${key}`] = val;
              }
            }
          }
        }
      };

      extractField(q, 'audio', `question:${qId}:audio`);
      extractField(q, 'postOptionsAudio', `question:${qId}:postOptionsAudio`);
      if (q.options) {
        for (let oIdx = 0; oIdx < q.options.length; oIdx++) {
          const opt = q.options[oIdx];
          const optId = opt.key || `opt_${oIdx}`;
          extractField(opt, 'audio', `question:${qId}:option:${optId}:audio`);
        }
      }
    }
    return refs;
  },

  _extractGlobalConfigAudioRefs(config: any): Record<string, string> {
    const refs: Record<string, string> = {};
    const extractField = (obj: any, field: string, baseKey: string) => {
      if (obj && obj[field]) {
        if (typeof obj[field] === 'string' && isAudioRef(obj[field])) {
          refs[baseKey] = obj[field];
        } else if (typeof obj[field] === 'object') {
          for (const key of Object.keys(obj[field])) {
            const val = obj[field][key];
            if (isAudioRef(val)) {
              refs[`${baseKey}:${key}`] = val;
            }
          }
        }
      }
    };

    extractField(config, 'welcomeAudio', 'globalConfig:welcomeAudio');
    extractField(config, 'nameQuestionAudio', 'globalConfig:nameQuestionAudio');
    extractField(config, 'startAudio', 'globalConfig:startAudio');
    extractField(config, 'finishAudio', 'globalConfig:finishAudio');
    extractField(config, 'afterSendAudio', 'globalConfig:afterSendAudio');
    return refs;
  },

  _extractPatientAudioRefs(patient: any): Record<string, string> {
    const refs: Record<string, string> = {};
    if (patient && patient.audioConclusion) {
      if (typeof patient.audioConclusion === 'string' && isAudioRef(patient.audioConclusion)) {
        refs[`patient:${patient.id}:audioConclusion`] = patient.audioConclusion;
      } else if (typeof patient.audioConclusion === 'object') {
        for (const key of Object.keys(patient.audioConclusion)) {
          const val = patient.audioConclusion[key];
          if (isAudioRef(val)) {
            refs[`patient:${patient.id}:audioConclusion:${key}`] = val;
          }
        }
      }
    }
    return refs;
  },

  async resolveAudioRef(ref: string): Promise<string | undefined> {
    if (!isAudioRef(ref)) return ref; // Ya es base64 o undefined
    
    // Buscar en caché local primero
    const entries = Object.values(this._audioRegistry) as Array<{ ref: string, base64: string }>;
    const entry = entries.find(e => e.ref === ref);
    if (entry) return entry.base64;

    if (!db) return undefined;

    try {
      FirestoreDebug.log('get', 'audios/' + ref);
      const audioDoc = await getDoc(doc(db, 'audios', ref));
      if (audioDoc.exists()) {
        const base64 = audioDoc.data().data;
        // Guardamos en registro con una clave genérica para evitar futuras lecturas del mismo ref
        this._updateAudioRegistry(`resolved_${ref}`, ref, base64);
        return base64;
      }
    } catch (e) {
      console.error("Error resolving audio ref", ref, e);
    }
    return undefined;
  },
  
  async migrateActiveQuestionnaireAudios() {
    if (!db) return { error: "No DB connection" };
    console.log("[MIGRATION] Starting manual migration of active questionnaire audios...");
    
    try {
      const docRef = doc(db, 'questionnaires', 'active');
      FirestoreDebug.log('get', 'questionnaires/active');
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
                (async () => {
                  FirestoreDebug.log('write', 'audios/' + audioId);
                  await setDoc(doc(db!, 'audios', audioId), { data: val });
                  createdDocs++;
                })()
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
                  (async () => {
                    FirestoreDebug.log('write', 'audios/' + audioId);
                    await setDoc(doc(db!, 'audios', audioId), { data: val });
                    createdDocs++;
                  })()
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
        FirestoreDebug.log('write', 'questionnaires/active');
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
      FirestoreDebug.log('get', 'test/connection');
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
            FirestoreDebug.log('get', 'questionnaires/active');
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

                 // Resolver referencias de audio de forma diferida (ya no se hace aquí)
                 // La UI (PatientInterface) se encargará de resolverlas on-demand usando resolveAudioRef
                 // Esto reduce drásticamente las lecturas a Firestore al abrir el editor o iniciar sesión
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
      // 1. Obtener referencias antiguas antes de guardar
      const oldDoc = await getDoc(doc(db, 'questionnaires', 'active'));
      const oldMappings = oldDoc.exists() && oldDoc.data().questions 
        ? this._extractQuestionAudioRefs(oldDoc.data().questions) 
        : {};

      // Copia profunda para no mutar el estado de la UI
      const processedQuestions = JSON.parse(JSON.stringify(questions));
      const audioPromises: Promise<void>[] = [];
      let detectedAudios = 0;
      let reusedAudios = 0;
      let newAudiosUploaded = 0;

      const newAudiosInOperation: Record<string, string> = {};

      const processAudioField = (obj: any, field: string, baseKey: string) => {
        if (obj && obj[field]) {
          if (typeof obj[field] === 'string') {
            const val = obj[field];
            if (isAudioRef(val)) return;
            if (isBase64Audio(val)) {
              detectedAudios++;
              const existingRef = this._getAudioRef(baseKey, val);
              if (existingRef) {
                console.log(`[AUDIO-PERSIST] Reusing existing ref for ${baseKey} -> ${existingRef}`);
                obj[field] = existingRef;
                reusedAudios++;
                return;
              }
              
              if (newAudiosInOperation[val]) {
                obj[field] = newAudiosInOperation[val];
                return;
              }

              const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              console.log(`[AUDIO-PERSIST] Uploading NEW audio for ${baseKey} -> ${audioId}`);
              obj[field] = audioId;
              newAudiosInOperation[val] = audioId;
              newAudiosUploaded++;
              this._updateAudioRegistry(baseKey, audioId, val);
              
              audioPromises.push(
                (async () => {
                  FirestoreDebug.log('write', 'audios/' + audioId);
                  await setDoc(doc(db!, 'audios', audioId), { data: val, usedBy: {} });
                })()
              );
            }
          } else if (typeof obj[field] === 'object') {
            for (const key of Object.keys(obj[field])) {
              const val = obj[field][key];
              const variantKey = `${baseKey}:${key}`;
              if (isAudioRef(val)) continue;
              if (isBase64Audio(val)) {
                detectedAudios++;
                const existingRef = this._getAudioRef(variantKey, val);
                if (existingRef) {
                  console.log(`[AUDIO-PERSIST] Reusing existing ref for ${variantKey} -> ${existingRef}`);
                  obj[field][key] = existingRef;
                  reusedAudios++;
                  continue;
                }
                
                if (newAudiosInOperation[val]) {
                  obj[field][key] = newAudiosInOperation[val];
                  continue;
                }

                const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                console.log(`[AUDIO-PERSIST] Uploading NEW audio for ${variantKey} -> ${audioId}`);
                obj[field][key] = audioId;
                newAudiosInOperation[val] = audioId;
                newAudiosUploaded++;
                this._updateAudioRegistry(variantKey, audioId, val);
                
                audioPromises.push(
                  (async () => {
                    FirestoreDebug.log('write', 'audios/' + audioId);
                    await setDoc(doc(db!, 'audios', audioId), { data: val, usedBy: {} });
                  })()
                );
              }
            }
          }
        }
      };

      for (let qIdx = 0; qIdx < processedQuestions.length; qIdx++) {
        const q = processedQuestions[qIdx];
        const qId = q.id || `legacy_${qIdx}`;
        processAudioField(q, 'audio', `question:${qId}:audio`);
        processAudioField(q, 'postOptionsAudio', `question:${qId}:postOptionsAudio`);
        if (q.options) {
          for (let oIdx = 0; oIdx < q.options.length; oIdx++) {
            const opt = q.options[oIdx];
            const optId = opt.key || `opt_${oIdx}`;
            processAudioField(opt, 'audio', `question:${qId}:option:${optId}:audio`);
          }
        }
      }

      console.log(`[AUDIO-PERSIST] Total audios detected: ${detectedAudios}`);
      console.log(`[AUDIO-PERSIST] Reused: ${reusedAudios}, New uploads: ${newAudiosUploaded}`);

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
      FirestoreDebug.log('write', 'questionnaires/active');
      await setDoc(doc(db, 'questionnaires', 'active'), { questions: processedQuestions });
      console.log(`[TEST LOG] Cuestionario guardado exitosamente en questionnaires/active`);
      this._questionsCache = null; // Invalidate cache

      // 2. Limpiar audios huérfanos y sincronizar referencias
      const newMappings = this._extractQuestionAudioRefs(processedQuestions);
      await this._syncAudioRefs(oldMappings, newMappings);

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
                  FirestoreDebug.log('get', 'config/global_config');
                  const docSnap = await getDoc(docRef);
                  if (docSnap.exists()) {
                      config = { ...config, ...docSnap.data() };
                      foundRemote = true;

                      // Hidratación diferida: no resolvemos los audios aquí
                      // La UI (PatientInterface) se encargará de resolverlas on-demand
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
      // 1. Obtener referencias antiguas antes de guardar
      const oldDoc = await getDoc(doc(db, 'config', 'global_config'));
      const oldMappings = oldDoc.exists() 
        ? this._extractGlobalConfigAudioRefs(oldDoc.data()) 
        : {};

      const processedConfig = JSON.parse(JSON.stringify(config));
      const audioPromises: Promise<void>[] = [];
      let reusedAudios = 0;
      let newAudiosUploaded = 0;

      const newAudiosInOperation: Record<string, string> = {};

      const processAudioField = (obj: any, field: string, baseKey: string) => {
        if (obj && obj[field]) {
          if (typeof obj[field] === 'string') {
            const val = obj[field];
            if (isAudioRef(val)) return;
            if (isBase64Audio(val)) {
              const existingRef = this._getAudioRef(baseKey, val);
              if (existingRef) {
                console.log(`[AUDIO-PERSIST] Reusing existing ref for ${baseKey} -> ${existingRef}`);
                obj[field] = existingRef;
                reusedAudios++;
                return;
              }
              
              if (newAudiosInOperation[val]) {
                obj[field] = newAudiosInOperation[val];
                return;
              }

              const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              console.log(`[AUDIO-PERSIST] Uploading NEW audio for ${baseKey} -> ${audioId}`);
              obj[field] = audioId;
              newAudiosInOperation[val] = audioId;
              newAudiosUploaded++;
              this._updateAudioRegistry(baseKey, audioId, val);
              
              audioPromises.push(
                (async () => {
                  FirestoreDebug.log('write', 'audios/' + audioId);
                  await setDoc(doc(db!, 'audios', audioId), { data: val, usedBy: {} });
                })()
              );
            }
          } else if (typeof obj[field] === 'object') {
            for (const key of Object.keys(obj[field])) {
              const val = obj[field][key];
              const variantKey = `${baseKey}:${key}`;
              if (isAudioRef(val)) continue;
              if (isBase64Audio(val)) {
                const existingRef = this._getAudioRef(variantKey, val);
                if (existingRef) {
                  console.log(`[AUDIO-PERSIST] Reusing existing ref for ${variantKey} -> ${existingRef}`);
                  obj[field][key] = existingRef;
                  reusedAudios++;
                  continue;
                }
                
                if (newAudiosInOperation[val]) {
                  obj[field][key] = newAudiosInOperation[val];
                  continue;
                }

                const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                console.log(`[AUDIO-PERSIST] Uploading NEW audio for ${variantKey} -> ${audioId}`);
                obj[field][key] = audioId;
                newAudiosInOperation[val] = audioId;
                newAudiosUploaded++;
                this._updateAudioRegistry(variantKey, audioId, val);
                
                audioPromises.push(
                  (async () => {
                    FirestoreDebug.log('write', 'audios/' + audioId);
                    await setDoc(doc(db!, 'audios', audioId), { data: val, usedBy: {} });
                  })()
                );
              }
            }
          }
        }
      };

      processAudioField(processedConfig, 'welcomeAudio', 'globalConfig:welcomeAudio');
      processAudioField(processedConfig, 'nameQuestionAudio', 'globalConfig:nameQuestionAudio');
      processAudioField(processedConfig, 'startAudio', 'globalConfig:startAudio');
      processAudioField(processedConfig, 'finishAudio', 'globalConfig:finishAudio');
      processAudioField(processedConfig, 'afterSendAudio', 'globalConfig:afterSendAudio');

      console.log(`[AUDIO-PERSIST] GlobalConfig - Reused: ${reusedAudios}, New uploads: ${newAudiosUploaded}`);

      await Promise.all(audioPromises);

      FirestoreDebug.log('write', 'config/global_config');
      await setDoc(doc(db, 'config', 'global_config'), processedConfig);
      this._globalConfigCache = null; // Invalidate cache

      // 2. Limpiar audios huérfanos y sincronizar referencias
      const newMappings = this._extractGlobalConfigAudioRefs(processedConfig);
      await this._syncAudioRefs(oldMappings, newMappings);

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
          FirestoreDebug.log('get', 'users/' + emailKey);
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
      FirestoreDebug.log('write', 'users/' + emailKey);
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
      FirestoreDebug.log('update', 'users/' + emailKey);
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
          FirestoreDebug.log('list', 'patients');
          const q = query(collection(db, 'patients'), where('coordinatorEmail', '==', coordinatorEmail));
          const querySnapshot = await getDocs(q);
          const patients: PatientData[] = [];
          
          querySnapshot.forEach((docSnap) => {
            const patient = docSnap.data() as PatientData;
            patients.push(patient);
            
            // Hidratación diferida: no resolvemos el audioConclusion aquí para evitar N lecturas
            // La UI (CoordinatorDashboard) solo necesita saber si existe (truthy)
          });
          
          // await Promise.all(resolvePromises);
          
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
      // 1. Obtener referencia antigua antes de guardar
      const oldDoc = await getDoc(doc(db, 'patients', patient.id));
      const oldMappings = oldDoc.exists() 
        ? this._extractPatientAudioRefs(oldDoc.data()) 
        : {};

      const processedPatient = JSON.parse(JSON.stringify(patient));
      const baseKey = `patient:${patient.id}:audioConclusion`;
      const val = processedPatient.audioConclusion;

      if (isBase64Audio(val)) {
        const existingRef = this._getAudioRef(baseKey, val);
        if (existingRef) {
          console.log(`[AUDIO-PERSIST] Reusing existing ref for ${baseKey} -> ${existingRef}`);
          processedPatient.audioConclusion = existingRef;
        } else {
          const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          console.log(`[AUDIO-PERSIST] Uploading NEW audio for ${baseKey} -> ${audioId}`);
          processedPatient.audioConclusion = audioId;
          this._updateAudioRegistry(baseKey, audioId, val);
          FirestoreDebug.log('write', 'audios/' + audioId);
          await setDoc(doc(db, 'audios', audioId), { data: val, usedBy: {} });
        }
      }

      FirestoreDebug.log('write', 'patients/' + patient.id);
      await setDoc(doc(db, 'patients', patient.id), processedPatient);
      // Invalidate cache
      if (patient.coordinatorEmail) {
          delete this._patientsCache[patient.coordinatorEmail];
      }
      delete this._patientByIdCache[patient.id];

      // 2. Limpiar audio huérfano y sincronizar referencias
      const newMappings = this._extractPatientAudioRefs(processedPatient);
      await this._syncAudioRefs(oldMappings, newMappings);

    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async updatePatient(patientId: string, data: Partial<PatientData>) {
    if (!db) return;
    const path = `patients/${patientId}`;
    try {
      // 1. Obtener referencia antigua antes de guardar
      const oldDoc = await getDoc(doc(db, 'patients', patientId));
      const oldMappings = oldDoc.exists() 
        ? this._extractPatientAudioRefs(oldDoc.data()) 
        : {};

      const processedData = JSON.parse(JSON.stringify(data));
      const baseKey = `patient:${patientId}:audioConclusion`;
      const val = processedData.audioConclusion;

      if (isBase64Audio(val)) {
        const existingRef = this._getAudioRef(baseKey, val);
        if (existingRef) {
          console.log(`[AUDIO-PERSIST] Reusing existing ref for ${baseKey} -> ${existingRef}`);
          processedData.audioConclusion = existingRef;
        } else {
          const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          console.log(`[AUDIO-PERSIST] Uploading NEW audio for ${baseKey} -> ${audioId}`);
          processedData.audioConclusion = audioId;
          this._updateAudioRegistry(baseKey, audioId, val);
          FirestoreDebug.log('write', 'audios/' + audioId);
          await setDoc(doc(db, 'audios', audioId), { data: val, usedBy: {} });
        }
      }

      FirestoreDebug.log('update', 'patients/' + patientId);
      await updateDoc(doc(db, 'patients', patientId), processedData);
      this._patientsCache = {}; // Invalidate all patient caches
      delete this._patientByIdCache[patientId];

      // 2. Limpiar audio huérfano y sincronizar referencias
      // Note: updatePatient only updates partial data, so we need to merge with old data to get full new mappings
      const newDocData = oldDoc.exists() ? { ...oldDoc.data(), ...processedData } : processedData;
      const newMappings = this._extractPatientAudioRefs(newDocData);
      await this._syncAudioRefs(oldMappings, newMappings);

    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async deletePatient(patientId: string) {
    if (!db) return;
    const path = `patients/${patientId}`;
    try {
      // 1. Obtener referencia antigua antes de borrar
      const oldDoc = await getDoc(doc(db, 'patients', patientId));
      const oldMappings = oldDoc.exists() 
        ? this._extractPatientAudioRefs(oldDoc.data()) 
        : {};

      FirestoreDebug.log('delete', 'patients/' + patientId);
      await deleteDoc(doc(db, 'patients', patientId));
      this._patientsCache = {}; // Invalidate all patient caches
      delete this._patientByIdCache[patientId];

      // 2. Limpiar audio huérfano y sincronizar referencias
      await this._syncAudioRefs(oldMappings, {});

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
          FirestoreDebug.log('get', 'patients/' + patientId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const patient = docSnap.data() as PatientData;
            if (isAudioRef(patient.audioConclusion)) {
              const ref = patient.audioConclusion;
              const baseKey = `patient:${patientId}:audioConclusion`;
              try {
                FirestoreDebug.log('get', 'audios/' + ref);
                const audioDoc = await getDoc(doc(db, 'audios', ref));
                if (audioDoc.exists()) {
                  const base64 = audioDoc.data().data;
                  patient.audioConclusion = base64;
                  this._updateAudioRegistry(baseKey, ref, base64);
                } else {
                  patient.audioConclusion = undefined;
                }
              } catch (e) {
                console.error("Error loading audioConclusion ref", ref, e);
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
