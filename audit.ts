import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

// Read config
const configRaw = fs.readFileSync('./firebase-applet-config.json', 'utf-8');
const firebaseConfig = JSON.parse(configRaw);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function runAudit() {
  console.log("Starting audit...");
  
  // 1. Fetch questionnaires/active
  const qDoc = await getDoc(doc(db, 'questionnaires', 'active'));
  const qData = qDoc.data();
  const questions = qData?.questions || [];
  
  console.log(`1. Total questions found: ${questions.length}`);
  
  if (questions.length > 0) {
    console.log("Sample of first question's audio field:");
    console.log(JSON.stringify(questions[0].audio, null, 2));
    if (questions[0].options && questions[0].options.length > 0) {
      console.log("Sample of first option's audio field:");
      console.log(JSON.stringify(questions[0].options[0].audio, null, 2));
    }
  }
  
  // 2. Extract audio_ref_...
  const audioRefs = new Set<string>();
  
  questions.forEach((q: any, index: number) => {
    if (q.audio) {
      Object.values(q.audio).forEach((val: any) => {
        if (typeof val === 'string' && val.startsWith('audio_ref_')) {
          audioRefs.add(val);
        }
      });
    }
    if (q.postOptionsAudio) {
      Object.values(q.postOptionsAudio).forEach((val: any) => {
        if (typeof val === 'string' && val.startsWith('audio_ref_')) {
          audioRefs.add(val);
        }
      });
    }
    if (q.options && Array.isArray(q.options)) {
      q.options.forEach((opt: any) => {
        if (opt.audio) {
          Object.values(opt.audio).forEach((val: any) => {
            if (typeof val === 'string' && val.startsWith('audio_ref_')) {
              audioRefs.add(val);
            }
          });
        }
      });
    }
  });
  
  console.log(`2. Total audio_ref_... found in questionnaires/active: ${audioRefs.size}`);
  
  // 3. Fetch all audios
  const existingAudios = new Set<string>();
  try {
    const audiosSnapshot = await getDocs(collection(db, 'audios'));
    audiosSnapshot.forEach(doc => {
      existingAudios.add(doc.id);
    });
    console.log(`Total documents in 'audios' collection: ${existingAudios.size}`);
  } catch (e: any) {
    console.log(`Error fetching 'audios' collection: ${e.message}`);
    console.log("Attempting to fetch individual documents based on refs instead...");
    
    for (const ref of Array.from(audioRefs)) {
      try {
        const audioDoc = await getDoc(doc(db, 'audios', ref));
        if (audioDoc.exists()) {
          existingAudios.add(ref);
        }
      } catch (err: any) {
        console.log(`Error fetching audio doc ${ref}: ${err.message}`);
      }
    }
    console.log(`Total documents successfully fetched individually: ${existingAudios.size}`);
  }
  
  // 4. Compare
  let validCount = 0;
  const missingRefs: string[] = [];
  
  audioRefs.forEach(ref => {
    if (existingAudios.has(ref)) {
      validCount++;
    } else {
      missingRefs.push(ref);
    }
  });
  
  console.log(`3. References that exist in 'audios': ${validCount}`);
  console.log(`4. References missing in 'audios': ${missingRefs.length}`);
  
  // 5. Find orphans (only if we could list the collection)
  let orphanCount = 0;
  existingAudios.forEach(audioId => {
    if (!audioRefs.has(audioId)) {
      orphanCount++;
    }
  });
  
  console.log(`5. Orphaned documents in 'audios' (if collection listed): ${orphanCount}`);
  
  // 6. List broken references with context
  console.log(`\n6. Broken references details:`);
  if (missingRefs.length === 0) {
    console.log("No broken references found.");
  } else {
    questions.forEach((q: any, index: number) => {
      let brokenInQ: string[] = [];
      
      if (q.audio) {
        Object.entries(q.audio).forEach(([gender, val]: [string, any]) => {
          if (typeof val === 'string' && missingRefs.includes(val)) {
            brokenInQ.push(`Main Audio (${gender}): ${val}`);
          }
        });
      }
      
      if (q.postOptionsAudio) {
        Object.entries(q.postOptionsAudio).forEach(([gender, val]: [string, any]) => {
          if (typeof val === 'string' && missingRefs.includes(val)) {
            brokenInQ.push(`Post Options Audio (${gender}): ${val}`);
          }
        });
      }
      
      if (q.options && Array.isArray(q.options)) {
        q.options.forEach((opt: any, optIndex: number) => {
          if (opt.audio) {
            Object.entries(opt.audio).forEach(([gender, val]: [string, any]) => {
              if (typeof val === 'string' && missingRefs.includes(val)) {
                brokenInQ.push(`Option ${optIndex + 1} (${gender}): ${val}`);
              }
            });
          }
        });
      }
      
      if (brokenInQ.length > 0) {
        console.log(`- Question ID: ${q.id} (Index ${index})`);
        brokenInQ.forEach(b => console.log(`  -> ${b}`));
      }
    });
  }
  
  console.log("\nAudit completed.");
  process.exit(0);
}

runAudit().catch(console.error);
