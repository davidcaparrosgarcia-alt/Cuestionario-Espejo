import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import fs from 'fs';

// Load Firebase config
const configPath = './firebase-applet-config.json';
if (!fs.existsSync(configPath)) {
  console.error("firebase-applet-config.json not found.");
  process.exit(1);
}

const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const isBase64Audio = (str: any) => typeof str === 'string' && str.startsWith('data:');

async function migrate() {
  console.log("Starting migration of questionnaires/active...");
  
  try {
    const docRef = doc(db, 'questionnaires', 'active');
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      console.log("No active questionnaire found.");
      return;
    }
    
    const data = docSnap.data();
    if (!data.questions || !Array.isArray(data.questions)) {
      console.log("No questions array found in active questionnaire.");
      return;
    }
    
    const questions = data.questions;
    let detectedAudios = 0;
    let createdDocs = 0;
    const audioPromises: Promise<void>[] = [];
    
    const processAudioField = (obj: any, field: string) => {
      if (obj && obj[field]) {
        if (typeof obj[field] === 'string') {
          if (isBase64Audio(obj[field])) {
            detectedAudios++;
            const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            const val = obj[field];
            obj[field] = audioId;
            audioPromises.push(
              setDoc(doc(db, 'audios', audioId), { data: val }).then(() => { createdDocs++; })
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
                setDoc(doc(db, 'audios', audioId), { data: val }).then(() => { createdDocs++; })
              );
            }
          }
        }
      }
    };

    for (const q of questions) {
      processAudioField(q, 'audio');
      processAudioField(q, 'postOptionsAudio');
      if (q.options) {
        for (const opt of q.options) {
          processAudioField(opt, 'audio');
        }
      }
    }
    
    console.log(`Found ${detectedAudios} Base64 audios in questions.`);
    
    if (detectedAudios > 0) {
      console.log("Saving audios to 'audios' collection...");
      await Promise.all(audioPromises);
      console.log(`Created ${createdDocs} documents in 'audios' collection.`);
      
      console.log("Updating questionnaires/active...");
      await setDoc(docRef, { questions });
      console.log("questionnaires/active updated successfully.");
    } else {
      console.log("No Base64 audios found in questions. No migration needed.");
    }
    
    // Check global config
    console.log("\nChecking config/global_config...");
    const configRef = doc(db, 'config', 'global_config');
    const configSnap = await getDoc(configRef);
    
    if (configSnap.exists()) {
      const configData = configSnap.data();
      let configAudios = 0;
      let configCreated = 0;
      const configPromises: Promise<void>[] = [];
      
      const processConfigAudio = (obj: any, field: string) => {
        if (obj && obj[field]) {
          if (typeof obj[field] === 'string') {
            if (isBase64Audio(obj[field])) {
              configAudios++;
              const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              const val = obj[field];
              obj[field] = audioId;
              configPromises.push(
                setDoc(doc(db, 'audios', audioId), { data: val }).then(() => { configCreated++; })
              );
            }
          } else if (typeof obj[field] === 'object') {
            for (const key of Object.keys(obj[field])) {
              const val = obj[field][key];
              if (isBase64Audio(val)) {
                configAudios++;
                const audioId = `audio_ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                obj[field][key] = audioId;
                configPromises.push(
                  setDoc(doc(db, 'audios', audioId), { data: val }).then(() => { configCreated++; })
                );
              }
            }
          }
        }
      };
      
      processConfigAudio(configData, 'welcomeAudio');
      processConfigAudio(configData, 'nameQuestionAudio');
      processConfigAudio(configData, 'startAudio');
      processConfigAudio(configData, 'finishAudio');
      processConfigAudio(configData, 'afterSendAudio');
      
      console.log(`Found ${configAudios} Base64 audios in global config.`);
      
      if (configAudios > 0) {
        console.log("Saving config audios to 'audios' collection...");
        await Promise.all(configPromises);
        console.log(`Created ${configCreated} documents in 'audios' collection.`);
        
        console.log("Updating config/global_config...");
        await setDoc(configRef, configData);
        console.log("config/global_config updated successfully.");
      } else {
        console.log("No Base64 audios found in global config. No migration needed.");
      }
    }
    
    // Final verification
    console.log("\nVerifying questionnaires/active...");
    const verifySnap = await getDoc(docRef);
    if (verifySnap.exists()) {
      const vData = verifySnap.data();
      let remainingBase64 = 0;
      let refCount = 0;
      
      const countFields = (obj: any, field: string) => {
        if (obj && obj[field]) {
          if (typeof obj[field] === 'string') {
            if (isBase64Audio(obj[field])) remainingBase64++;
            else if (obj[field].startsWith('audio_ref_')) refCount++;
          } else if (typeof obj[field] === 'object') {
            for (const key of Object.keys(obj[field])) {
              const val = obj[field][key];
              if (isBase64Audio(val)) remainingBase64++;
              else if (typeof val === 'string' && val.startsWith('audio_ref_')) refCount++;
            }
          }
        }
      };
      
      for (const q of vData.questions || []) {
        countFields(q, 'audio');
        countFields(q, 'postOptionsAudio');
        if (q.options) {
          for (const opt of q.options) {
            countFields(opt, 'audio');
          }
        }
      }
      
      console.log(`Verification complete: ${remainingBase64} Base64 audios remaining, ${refCount} audio_ref_... references found.`);
    }
    
  } catch (error) {
    console.error("Migration failed:", error);
  }
  
  process.exit(0);
}

migrate();
