import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

let db: any = null;
let storage: any = null;
let auth: any = null;
let app: any = null;

try {
  // Inicialización segura: solo si hay configuración válida
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
    storage = getStorage(app);
    auth = getAuth(app);
    console.log("Firebase inicializado correctamente");
  } else {
    console.warn("Faltan credenciales de Firebase. La app funcionará en modo local.");
  }
} catch (error) {
  console.error("Error inicializando Firebase:", error);
}

export { db, storage, auth };
