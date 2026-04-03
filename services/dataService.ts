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
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData.map((provider: any) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

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
             questions = data.questions.map((q: any) => ({
                 ...q,
                 scenario: q.text || q.scenario || "Pregunta sin texto",
                 options: q.answers || q.options || [],
                 id: q.id ? String(q.id) : Date.now().toString()
             }));
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
      questions = INITIAL_QUESTIONS;
    }

    return questions;
  },

  async saveQuestions(questions: Question[]) {
    if (!db) return;
    const path = 'questionnaires/active';
    try {
      await setDoc(doc(db, 'questionnaires', 'active'), { questions });
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
      await setDoc(doc(db, 'config', 'global_config'), config);
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
      querySnapshot.forEach((doc) => {
        patients.push(doc.data() as PatientData);
      });
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
      await setDoc(doc(db, 'patients', patient.id), patient);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async updatePatient(patientId: string, data: Partial<PatientData>) {
    if (!db) return;
    const path = `patients/${patientId}`;
    try {
      await updateDoc(doc(db, 'patients', patientId), data);
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
      return docSnap.exists() ? docSnap.data() as PatientData : null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return null;
    }
  }
};
