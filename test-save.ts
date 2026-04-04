import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

async function test() {
  try {
    console.log('Signing in...');
    await signInWithEmailAndPassword(auth, 'davidcaparrosgarcia@gmail.com', 'testpassword'); // I don't have the password, so this won't work.
  } catch (e) {
    console.error(e);
  }
}
test();
