const admin = require('firebase-admin');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithCustomToken } = require('firebase/auth');
const { getFirestore, doc, setDoc } = require('firebase/firestore');
const config = require('./firebase-applet-config.json');

async function runTest() {
  try {
    console.log('Initializing Admin SDK...');
    admin.initializeApp();
    
    console.log('Generating custom token...');
    const customToken = await admin.auth().createCustomToken('7D079IDPnkcvJxB8sNSEbLKS1EY2', {
      email: 'davidcaparrosgarcia@gmail.com'
    });
    
    console.log('Initializing Client SDK...');
    const app = initializeApp(config);
    const auth = getAuth(app);
    const db = getFirestore(app, config.firestoreDatabaseId);
    
    console.log('Signing in with custom token...');
    await signInWithCustomToken(auth, customToken);
    
    console.log('Testing write to audios collection...');
    const audioId = `test_audio_${Date.now()}`;
    await setDoc(doc(db, 'audios', audioId), { data: 'test_base64_data' });
    
    console.log('✅ Write successful!');
    
    console.log('Testing write to patients collection...');
    const patientId = `test_patient_${Date.now()}`;
    await setDoc(doc(db, 'patients', patientId), { 
      id: patientId,
      coordinatorEmail: 'davidcaparrosgarcia@gmail.com',
      nombre: 'Test Patient'
    });
    console.log('✅ Write to patients successful!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runTest();
