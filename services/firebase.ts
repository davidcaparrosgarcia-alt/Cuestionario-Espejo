import { initializeApp, getApps, getApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore, initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

let db: any = null;
let storage: any = null;
let auth: any = null;
let app: any = null;

const E2E_PROJECT_ID = 'demo-ce-patient-harness';
const isE2EFirebaseEmulator = import.meta.env.VITE_E2E_FIREBASE_EMULATOR === 'true';

const requireLocalE2EEndpoint = (name: string, hostValue: string | undefined, portValue: string | undefined) => {
  const host = String(hostValue || '').trim();
  const port = Number(portValue);

  if (!['localhost', '127.0.0.1'].includes(host) || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`E2E SAFETY ABORT: ${name} requires an explicit localhost/127.0.0.1 host and valid port.`);
  }

  return { host, port };
};

if (isE2EFirebaseEmulator) {
  const browserHost = window.location.hostname;
  if (!['localhost', '127.0.0.1'].includes(browserHost)) {
    throw new Error('E2E SAFETY ABORT: browser origin is not local.');
  }

  const e2eConfig = {
    projectId: E2E_PROJECT_ID,
    apiKey: 'synthetic-test-key',
    authDomain: `${E2E_PROJECT_ID}.localhost`,
    storageBucket: `${E2E_PROJECT_ID}.invalid`,
    appId: 'synthetic-test-app'
  };
  const firestoreEndpoint = requireLocalE2EEndpoint(
    'Firestore Emulator',
    import.meta.env.VITE_E2E_FIRESTORE_HOST,
    import.meta.env.VITE_E2E_FIRESTORE_PORT
  );
  const authEndpoint = requireLocalE2EEndpoint(
    'Auth Emulator',
    import.meta.env.VITE_E2E_AUTH_HOST,
    import.meta.env.VITE_E2E_AUTH_PORT
  );

  if (e2eConfig.projectId !== E2E_PROJECT_ID) {
    throw new Error('E2E SAFETY ABORT: unexpected synthetic Firebase projectId.');
  }

  app = !getApps().length ? initializeApp(e2eConfig) : getApp();
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
  connectFirestoreEmulator(db, firestoreEndpoint.host, firestoreEndpoint.port);
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: true });
  storage = getStorage(app);

  (window as any).__CE_E2E_FIREBASE_RUNTIME__ = Object.freeze({
    projectId: app.options.projectId,
    firestore: firestoreEndpoint,
    auth: authEndpoint
  });
  console.log('Firebase E2E inicializado exclusivamente contra emuladores locales');
} else {

  try {
    // Inicialización segura: solo si hay configuración válida
    if (firebaseConfig.apiKey && firebaseConfig.projectId) {
      app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

      try {
        db = initializeFirestore(app, {
          experimentalForceLongPolling: true
        }, (firebaseConfig as any).firestoreDatabaseId);
      } catch (e) {
        // Si ya estaba inicializado, obtenemos la instancia
        db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
      }

      storage = getStorage(app);
      auth = getAuth(app);
      console.log("Firebase inicializado correctamente");
    } else {
      console.warn("Faltan credenciales de Firebase. La app funcionará en modo local.");
    }
  } catch (error) {
    console.error("Error inicializando Firebase:", error);
  }
}

export { db, storage, auth };
