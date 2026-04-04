const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, doc, setDoc } = require('firebase/firestore');
const fs = require('fs');

const configPath = './firebase-applet-config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app, config.firestoreDatabaseId);

async function runTest() {
    try {
        console.log("Authenticating...");
        // We need a valid user. The user's email is davidcaparrosgarcia@gmail.com
        // But we don't have the password.
        // Can we sign in anonymously?
        const { signInAnonymously } = require('firebase/auth');
        const userCredential = await signInAnonymously(auth);
        console.log("Authenticated anonymously as:", userCredential.user.uid);

        console.log("Attempting to write to audios collection...");
        const testAudioId = `test_audio_${Date.now()}`;
        await setDoc(doc(db, 'audios', testAudioId), { data: 'test' });
        console.log("✅ Write successful!");
        
        process.exit(0);
    } catch (error) {
        console.error("❌ Test failed:");
        console.error(error);
        process.exit(1);
    }
}

runTest();
