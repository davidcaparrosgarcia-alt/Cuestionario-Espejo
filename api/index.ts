import express from "express";
import nodemailer from "nodemailer";
import admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";

// Initialize Firebase Admin
let firebaseConfig: any = {};
try {
  firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
} catch (e) {
  console.log("No local firebase-applet-config.json found");
}

const dbId = process.env.FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || "(default)";
const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;

const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;

if (!admin.apps.length) {
  try {
    const credential = (FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) 
      ? admin.credential.cert({
          projectId: projectId,
          clientEmail: FIREBASE_CLIENT_EMAIL,
          privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
      : admin.credential.applicationDefault();

    admin.initializeApp({
      credential,
      projectId: projectId,
    });
    console.log(`Firebase Admin initialized successfully in project ${projectId}.`);
  } catch (error) {
    console.error("Failed to initialize Firebase Admin:", error);
  }
}

const FRONTEND_AUTH_PROJECT_ID = firebaseConfig.projectId || "gen-lang-client-0082734692";
const FRONTEND_AUTH_APP_NAME = "frontend-auth-verifier";

function getFrontendAuthApp() {
  const existing = admin.apps.find(app => app?.name === FRONTEND_AUTH_APP_NAME);
  if (existing) return existing;

  const mainApp = admin.app();

  return admin.initializeApp(
    {
      credential: mainApp.options.credential,
      projectId: FRONTEND_AUTH_PROJECT_ID,
    },
    FRONTEND_AUTH_APP_NAME
  );
}

const frontendAuthApp = getFrontendAuthApp();

const db = getFirestore(admin.app(), dbId);

async function getNotificationRecipients(requestData: any): Promise<string[]> {
  const recipients = new Set<string>();

  try {
    const settingsDoc = await db.collection("config").doc("global_config").get();
    if (settingsDoc.exists) {
      const data = settingsDoc.data();
      if (data && Array.isArray(data.notificationEmails)) {
        data.notificationEmails.forEach((email: string) => {
          if (email && typeof email === 'string' && email.includes('@')) {
            recipients.add(email.trim());
          }
        });
      } else if (data && typeof data.notificationEmails === 'string' && data.notificationEmails.includes('@')) {
        recipients.add(data.notificationEmails.trim());
      }
    }
  } catch (error) {
    console.error("Error reading diagnostic settings:", error instanceof Error ? error.message : "Unknown error");
  }

  if (process.env.NOTIFICATION_EMAILS) {
    const envEmails = process.env.NOTIFICATION_EMAILS.split(',');
    envEmails.forEach(email => {
      const trimmed = email.trim();
      if (trimmed && trimmed.includes('@')) {
        recipients.add(trimmed);
      }
    });
  }

  if (recipients.size === 0 && process.env.SMTP_FROM) {
    const match = process.env.SMTP_FROM.match(/<([^>]+)>/);
    const email = match ? match[1] : process.env.SMTP_FROM;
    if (email && email.includes('@')) {
      recipients.add(email.trim());
    }
  }

  if (recipients.size === 0 && requestData.notificationEmail && typeof requestData.notificationEmail === 'string' && requestData.notificationEmail.includes('@')) {
    recipients.add(requestData.notificationEmail.trim());
  }

  return Array.from(recipients);
}

const app = express();

app.use(express.json({ limit: "100kb" }));

// Middleware to verify Firebase Auth token for coordinator routes
const requireCoordinatorAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.error("Coordinator auth failed", {
      reason: "missing_authorization_header",
      projectId
    });
    return res.status(401).json({ error: "No autorizado", reason: "missing_authorization_header" });
  }
  const token = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth(frontendAuthApp).verifyIdToken(token);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error("Coordinator auth failed", {
      reason: "invalid_firebase_token",
      message: error instanceof Error ? error.message : String(error),
      backendProjectId: projectId,
      frontendAuthProjectId: FRONTEND_AUTH_PROJECT_ID
    });
    res.status(401).json({ error: "No autorizado", reason: "invalid_firebase_token" });
  }
};

// Configure Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.ethereal.email",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_PORT === "465",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function resolveDefaultCoordinatorEmail() {
  if (process.env.DEFAULT_COORDINATOR_EMAIL && process.env.DEFAULT_COORDINATOR_EMAIL.includes("@")) {
    return process.env.DEFAULT_COORDINATOR_EMAIL.trim().toLowerCase();
  }
  if (process.env.NOTIFICATION_EMAILS) {
    const first = process.env.NOTIFICATION_EMAILS
      .split(",")
      .map(e => e.trim().toLowerCase())
      .find(e => e.includes("@"));
    if (first) return first;
  }
  return "cuestionarioespejo@gmail.com";
}

// API routes FIRST
app.get("/api/health", async (req, res) => {
  let firestoreCheck = "not_run";
  let firestoreError = undefined;
  let diagnosticWriteResult = undefined;
  
  let patientRequestsTotalCount = undefined;
  let patientRequestsPendingCount = undefined;
  let patientsTotalCount = undefined;
  let patientsDirectSoybienestarCount = undefined;
  let latestPatientRequestPreview = undefined;
  let latestDirectPatientPreview = undefined;

  const resolvedProjectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
  const resolvedDbId = process.env.FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || "(default)";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  const frontendProjectId = firebaseConfig.projectId || null;
  const frontendDbId = firebaseConfig.firestoreDatabaseId || "(default)";
  const backendProjectId = resolvedProjectId || null;
  const backendDbId = resolvedDbId || "(default)";

  const firestoreMismatchWarning = 
    (backendProjectId !== frontendProjectId) || (backendDbId !== frontendDbId);

  const firestoreMismatchDetails = {
    backendProjectId,
    frontendProjectId,
    backendDbId,
    frontendDbId,
    firebaseProjectIdEnv: process.env.FIREBASE_PROJECT_ID || null,
    firestoreDatabaseIdEnv: process.env.FIRESTORE_DATABASE_ID || null
  };

  if (req.query.checkFirestore === '1') {
    try {
      // Diagnostic write/read
      const diagRef = db.collection("diagnosticBridgeChecks").doc("latest");
      const diagData = {
        timestamp: Date.now(),
        serverTime: new Date().toISOString(),
        projectId: resolvedProjectId,
        dbId: resolvedDbId,
        nodeEnv: process.env.NODE_ENV || "unknown"
      };
      await diagRef.set(diagData);
      const readBack = await diagRef.get();
      
      // Collection counts and previews
      const reqSnap = await db.collection("patientRequests").limit(20).get();
      patientRequestsTotalCount = reqSnap.size;
      patientRequestsPendingCount = 0;
      let latestReqDoc: any = null;
      let latestReqTime = 0;

      reqSnap.forEach(doc => {
        const data = doc.data();
        if (data.status === "pending") patientRequestsPendingCount!++;
        if ((data.createdAt || 0) > latestReqTime) {
          latestReqTime = data.createdAt;
          latestReqDoc = { id: doc.id, ...data };
        }
      });

      if (latestReqDoc) {
        latestPatientRequestPreview = {
          id: latestReqDoc.id,
          source: latestReqDoc.source,
          status: latestReqDoc.status,
          createdAt: latestReqDoc.createdAt
        };
      }

      const patSnap = await db.collection("patients").limit(20).get();
      patientsTotalCount = patSnap.size;
      patientsDirectSoybienestarCount = 0;
      let latestDirectDoc: any = null;
      let latestDirectTime = 0;

      patSnap.forEach(doc => {
        const data = doc.data();
        const isDirect = data.source === "soybienestar" || data.directAccessCreated === true;
        if (isDirect) patientsDirectSoybienestarCount!++;
        
        if (isDirect && (data.createdAt || data.timestamp || 0) > latestDirectTime) {
          latestDirectTime = data.createdAt || data.timestamp;
          latestDirectDoc = { id: doc.id, ...data };
        }
      });

      if (latestDirectDoc) {
        latestDirectPatientPreview = {
          id: latestDirectDoc.id,
          nombre: latestDirectDoc.nombre,
          source: latestDirectDoc.source,
          createdAt: latestDirectTime
        };
      }

      firestoreCheck = "ok";
      diagnosticWriteResult = {
        path: "diagnosticBridgeChecks/latest",
        success: true,
        readBack: readBack.exists,
        intendedProject: resolvedProjectId,
        intendedDbId: resolvedDbId
      };
    } catch (e: any) {
      firestoreCheck = "error";
      firestoreError = {
        message: e.message || String(e),
        code: e.code,
      };
    }
  }

  const clientEmailProjectHint = clientEmail ? (clientEmail.match(/@(.+?)\.iam/)?.[1] || "unknown") : null;

  res.json({ 
    status: "ok",
    backendProjectId,
    backendDbId,
    frontendProjectId,
    frontendDbId,
    firestoreMismatchWarning,
    firestoreMismatchDetails,
    backendAdmin: {
      adminInitialized: !!admin.apps.length,
      adminProjectId: admin.apps.length ? admin.app().options.projectId : null,
      dbId: resolvedDbId,
      firebaseProjectIdEnv: process.env.FIREBASE_PROJECT_ID || null,
      firestoreDatabaseIdEnv: process.env.FIRESTORE_DATABASE_ID || null,
      clientEmailProjectHint: clientEmailProjectHint,
      firebaseConfigProjectId: firebaseConfig.projectId,
      firebaseConfigFirestoreDatabaseId: firebaseConfig.firestoreDatabaseId
    },
    frontendConfig: {
      projectId: firebaseConfig.projectId,
      firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
      authDomain: firebaseConfig.authDomain
    },
    defaultCoordinatorEmailConfigured: !!(process.env.DEFAULT_COORDINATOR_EMAIL || process.env.NOTIFICATION_EMAILS),
    resolvedCoordinatorEmailPreview: resolveDefaultCoordinatorEmail(),
    testWrites: diagnosticWriteResult,
    firestoreCheck,
    firestoreError,
    patientRequestsTotalCount,
    patientRequestsPendingCount,
    patientsTotalCount,
    patientsDirectSoybienestarCount,
    latestPatientRequestPreview,
    latestDirectPatientPreview,
    bridgeSecretConfigured: !!process.env.QUESTIONNAIRE_BRIDGE_SECRET,
    smtpConfigured: !!process.env.SMTP_USER && !!process.env.SMTP_PASS,
    appPublicUrlEnv: process.env.APP_PUBLIC_URL || null,
    time: new Date().toISOString()
  });
});

app.post("/api/debug-direct-patient-roundtrip", async (req, res) => {
  try {
    const bridgeSecret = process.env.SOYBIENESTAR_BRIDGE_SECRET || process.env.QUESTIONNAIRE_BRIDGE_SECRET || process.env.BRIDGE_SECRET;
    if (req.headers['x-bridge-secret'] !== bridgeSecret) {
      return res.status(401).json({ error: "No autorizado" });
    }
    if (req.headers['x-debug-bridge'] !== 'true') {
      return res.status(400).json({ error: "Solo para debug" });
    }

    const now = Date.now();
    const dbPatientId = `debug_roundtrip_${now}`;
    const accessPin = generateAccessCode(4);
    
    const resolvedProjectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
    const resolvedDbId = process.env.FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || "(default)";
    const frontendProjectId = firebaseConfig.projectId || null;
    const frontendDbId = firebaseConfig.firestoreDatabaseId || "(default)";

    const patientData = {
      id: dbPatientId,
      coordinatorEmail: resolveDefaultCoordinatorEmail(),
      nombre: "Debug Roundtrip",
      email: "debug-roundtrip@soybienestar.test",
      status: "sent",
      dateSent: now,
      accessPin,
      source: "debug-roundtrip",
      debugOnly: true,
      createdAt: now,
      directAccessCreated: true,
      accessCodeFormat: "v2_4_alphanumeric" as const
    };

    await db.collection("patients").doc(dbPatientId).set(patientData);
    
    // Read back immediately
    const snap = await db.collection("patients").doc(dbPatientId).get();

    let baseUrl = process.env.APP_PUBLIC_URL || "https://cuestionario-espejo.vercel.app";
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    
    const payload = { id: dbPatientId, timestamp: now };
    const sessionToken = safeBtoa(JSON.stringify(payload));

    const firestoreMismatchWarning = 
      (resolvedProjectId !== frontendProjectId) || (resolvedDbId !== frontendDbId);

    res.json({
      success: true,
      patientId: dbPatientId,
      accessPin,
      questionnaireUrl: `${baseUrl}#/session?p=${encodeURIComponent(sessionToken)}`,
      adminReadBack: snap.exists,
      backendProjectId: resolvedProjectId,
      backendDbId: resolvedDbId,
      frontendProjectId,
      frontendDbId,
      firestoreMismatchWarning
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const ACCESS_CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

function normalizeAccessCode(code: string) {
  return String(code || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4);
}

function isValidNewAccessCode(code: string) {
  return /^[a-z0-9]{4}$/.test(normalizeAccessCode(code));
}

function isValidLegacyAccessCode(code: string) {
  return /^[a-z0-9]{4,6}$/.test(normalizeAccessCode(code));
}

function generateAccessCode(length = 4) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ACCESS_CODE_CHARS[Math.floor(Math.random() * ACCESS_CODE_CHARS.length)];
  }
  return code;
}

const safeBtoa = (str: string) => {
  return Buffer.from(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
      function toSolidBytes(match, p1) {
          return String.fromCharCode(Number('0x' + p1));
      })).toString('base64');
};

app.post("/api/direct-questionnaire-link", async (req, res) => {
  try {
    const bridgeSecret = process.env.SOYBIENESTAR_BRIDGE_SECRET || process.env.QUESTIONNAIRE_BRIDGE_SECRET || process.env.BRIDGE_SECRET;
    if (!bridgeSecret) {
      return res.status(500).json({ error: "Configuracion incompleta: falta secreto de bridge." });
    }
    if (req.headers['x-bridge-secret'] !== bridgeSecret) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const {
      requestId,
      soybienestarUid,
      nombre,
      email,
      telefono,
      edad,
      sexo,
      preferredChannels,
      soybienestarContext
    } = req.body;

    const proposedAccessCode = req.body.proposedAccessCode 
        ? normalizeAccessCode(req.body.proposedAccessCode) 
        : null;

    if (!email && !nombre) {
      return res.status(400).json({ error: "Nombre o Email es requerido." });
    }

    const resolvedCoordinatorEmail = resolveDefaultCoordinatorEmail();

    const now = Date.now();
    const validProposed = proposedAccessCode && /^[a-z0-9]{4}$/.test(proposedAccessCode) ? proposedAccessCode : null;

    // --- BÚSQUEDA DE PACIENTE EXISTENTE ---
    let existingPatientDoc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;
    let existingPatientData: any = null;

    // 1. PRIMERA BÚSQUEDA: soybienestarUid
    if (soybienestarUid) {
      const snap = await db.collection("patients")
        .where("soybienestarUid", "==", soybienestarUid)
        .get();
      const docs = snap.docs.filter(d => d.data().status !== "deleted");
      if (docs.length > 0) {
        docs.sort((a, b) => (b.data().timestamp || b.data().dateSent || 0) - (a.data().timestamp || a.data().dateSent || 0));
        if (docs.length > 1) {
          console.warn(`[Warning] Se encontraron multiples pacientes activos para soybienestarUid. Reutilizando el mas reciente (ID: ${docs[0].id.slice(0, 12)}...).`);
        }
        existingPatientDoc = docs[0];
        existingPatientData = docs[0].data();
      }
    }

    // 2. SEGUNDA BÚSQUEDA: sourceRequestId / requestId / req.body.id
    const targetRequestId = requestId || req.body.id || req.body.sourceRequestId;
    if (!existingPatientDoc && targetRequestId) {
      const snap = await db.collection("patients")
        .where("sourceRequestId", "==", targetRequestId)
        .get();
      const docs = snap.docs.filter(d => d.data().status !== "deleted");
      if (docs.length > 0) {
        docs.sort((a, b) => (b.data().timestamp || b.data().dateSent || 0) - (a.data().timestamp || a.data().dateSent || 0));
        existingPatientDoc = docs[0];
        existingPatientData = docs[0].data();
      }
    }

    // 3. TERCERA BÚSQUEDA: email (solo si esta vinculado a SoyBienestar)
    if (!existingPatientDoc && email) {
      const snap = await db.collection("patients")
        .where("email", "==", email)
        .get();
      const docs = snap.docs.filter(d => {
        const data = d.data();
        if (data.status === "deleted") return false;
        const isSoybienestarLinked = data.source === "soybienestar" ||
          data.directAccessCreated === true ||
          Boolean(data.soybienestarUid) ||
          Boolean(data.sourceRequestId);
        return isSoybienestarLinked;
      });
      if (docs.length > 0) {
        docs.sort((a, b) => (b.data().timestamp || b.data().dateSent || 0) - (a.data().timestamp || a.data().dateSent || 0));
        existingPatientDoc = docs[0];
        existingPatientData = docs[0].data();
      }
    }

    let dbPatientId: string;
    let accessPin: string;
    let isNewPatient = false;

    if (existingPatientDoc && existingPatientData) {
      dbPatientId = existingPatientDoc.id;
      accessPin = existingPatientData.accessPin || validProposed || generateAccessCode(4);
    } else {
      isNewPatient = true;
      accessPin = validProposed || generateAccessCode(4);
      dbPatientId = `patient_${now}_${Math.random().toString(36).slice(2, 8)}`;
    }

    const payload = {
      id: dbPatientId,
      timestamp: now
    };
    const sessionToken = safeBtoa(JSON.stringify(payload));

    let baseUrl = process.env.APP_PUBLIC_URL || "https://cuestionario-espejo.vercel.app";
    if (!baseUrl.endsWith('/')) {
        baseUrl += '/';
    }
    const questionnaireUrl = `${baseUrl}#/session?p=${encodeURIComponent(sessionToken)}`;

    // Comprobar peticion pendiente en patientRequests
    let wasConvertedFromPending = false;
    if (targetRequestId) {
      try {
        const reqRef = db.collection("patientRequests").doc(targetRequestId);
        const reqDoc = await reqRef.get();
        if (reqDoc.exists && reqDoc.data()?.status === "pending") {
          await reqRef.set({
            status: "processed",
            processedAt: now,
            linkedPatientId: dbPatientId,
            processingReason: "converted_to_direct"
          }, { merge: true });
          wasConvertedFromPending = true;
        }
      } catch (err) {
        console.error("Error al procesar peticion pendiente de paciente:", err);
      }
    }

    if (isNewPatient) {
      const patientData = {
        id: dbPatientId,
        coordinatorEmail: resolvedCoordinatorEmail,
        nombre: nombre || "Usuario SoyBienestar",
        email: email || null,
        telefono: telefono || null,
        edad: edad || null,
        sexo: sexo || null,
        observaciones: "Generado directamente por SoyBienestar",
        status: "sent",
        dateSent: now,
        accessPin,
        proposedAccessCode: validProposed,
        source: "soybienestar",
        sourceRequestId: targetRequestId || null,
        soybienestarUid: soybienestarUid || null,
        soybienestarContext: soybienestarContext || null,
        preferredChannels: preferredChannels || null,
        directAccessCreated: true,
        directQuestionnaireUrlCreatedAt: now,
        questionnaireUrl: questionnaireUrl,
        accessCodeFormat: "v2_4_alphanumeric" as const,
        preInformeSoyBienestar: soybienestarContext || req.body.source === 'soybienestar' ? `=== PRE-INFORME SOYBIENESTAR ===
Nombre: ${nombre || 'No especificado'}
Email: ${email || 'No especificado'}
Edad: ${edad || 'No especificada'}
Sexo: ${sexo || 'No especificado'}
Origen: Solicitud desde SoyBienestar
Estado: Pendiente de completar cuestionario

Contexto disponible:
${soybienestarContext ? JSON.stringify(soybienestarContext, null, 2) : 'No hay datos de contexto adicionales.'}` : null
      };

      Object.keys(patientData).forEach(key => {
         if ((patientData as any)[key] === undefined) {
           delete (patientData as any)[key];
         }
      });

      await db.collection("patients").doc(dbPatientId).set(patientData);
    } else {
      // Paciente existente: actualizar metadatos sin sobreescribir respuestas, status, dateAnswered, etc.
      const updatePayload: any = {
        source: "soybienestar",
        directAccessCreated: true,
        questionnaireUrl,
        accessCodeFormat: "v2_4_alphanumeric"
      };

      if (soybienestarUid) updatePayload.soybienestarUid = soybienestarUid;
      if (targetRequestId) updatePayload.sourceRequestId = targetRequestId;
      if (soybienestarContext) updatePayload.soybienestarContext = soybienestarContext;
      if (preferredChannels) updatePayload.preferredChannels = preferredChannels;
      if (nombre) updatePayload.nombre = nombre;
      if (email) updatePayload.email = email;
      if (telefono) updatePayload.telefono = telefono;
      if (edad) updatePayload.edad = edad;
      if (sexo) updatePayload.sexo = sexo;
      if (accessPin) updatePayload.accessPin = accessPin;
      if (validProposed) updatePayload.proposedAccessCode = validProposed;
      if (!existingPatientData.directQuestionnaireUrlCreatedAt) {
        updatePayload.directQuestionnaireUrlCreatedAt = now;
      }

      await db.collection("patients").doc(dbPatientId).set(updatePayload, { merge: true });
    }

    // --- AVISO INTERNO POR EMAIL ---
    const notificationAlreadySent = Boolean(existingPatientData?.directAccessNotificationSentAt);
    const shouldSendNotification = isNewPatient || wasConvertedFromPending || !notificationAlreadySent;

    if (shouldSendNotification) {
      try {
        const recipients = await getNotificationRecipients({ notificationEmail: resolvedCoordinatorEmail });
        if (recipients.length > 0) {
          const fromAddress = process.env.SMTP_FROM || '"Cuestionario Espejo - SoyBienestar" <soybienestar.es@gmail.com>';
          const dateStr = new Date(now).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
          const emailSubject = "Cuestionario Espejo - Acceso directo desde SoyBienestar";
          const emailText = `Un usuario de SoyBienestar ha accedido directamente al Cuestionario Espejo.

Paciente: ${nombre || existingPatientData?.nombre || 'No especificado'}
Email: ${email || existingPatientData?.email || 'No especificado'}
Teléfono: ${telefono || existingPatientData?.telefono || 'No especificado'}
Edad: ${edad || existingPatientData?.edad || 'No especificada'}
Sexo: ${sexo || existingPatientData?.sexo || 'No especificado'}
Origen: SoyBienestar - acceso directo
Estado: Cuestionario preparado para iniciar/continuar
Fecha: ${dateStr}`;

          await transporter.sendMail({
            from: fromAddress,
            to: recipients.join(', '),
            subject: emailSubject,
            text: emailText
          });

          await db.collection("patients").doc(dbPatientId).set({
            directAccessNotificationSentAt: now
          }, { merge: true });
        }
      } catch (emailError) {
        console.error("Error al enviar aviso interno de acceso directo:", emailError);
      }
    }

    res.json({
      success: true,
      patientId: dbPatientId,
      coordinatorEmail: resolvedCoordinatorEmail,
      questionnaireUrl,
      accessCode: accessPin
    });

  } catch (error) {
    console.error("Error in /api/direct-questionnaire-link:", error);
    res.status(500).json({ error: "Error al generar enlace directo." });
  }
});

const buildCleanSoyBienestarContextForAI = (patientData: any) => {
  const ctx = patientData?.soybienestarContext || {};
  const internal = ctx.latestInternalTherapistReport || {};
  const visible = ctx.latestVisibleOrientationReport || {};
  const feedback = ctx.reportFeedback || {};

  return {
    motivo_principal: internal.motivo_principal || ctx.latestClinicalConclusion || ctx.consultationConclusion || "",
    estado_emocional: internal.estado_emocional_predominante || null,
    duracion_y_evolucion: internal.duracion_y_evolucion || "",
    impacto_funcional: internal.impacto_funcional || null,
    contexto_desencadenantes: internal.contexto_y_posibles_desencadenantes || "",
    hipotesis_no_diagnostica: internal.hipotesis_de_trabajo_no_diagnostica || "",
    resumen_derivacion: internal.resumen_para_derivacion || ctx.globalUserSummary || "",
    informacion_faltante: internal.informacion_faltante_relevante || [],
    recursos_sugeridos: internal.recursos_iniciales_sugeridos || visible.recursos_iniciales_liberados || "",
    feedback_usuario: {
      agree: ctx.latestReportFeedbackAgrees,
      label: ctx.latestReportFeedbackLabel,
      comment: ctx.latestReportFeedbackComment || feedback.comment || ""
    },
    orientacion_visible: {
      lo_que_parece_pesar_mas: visible.lo_que_parece_pesar_mas || "",
      impacto_en_tu_dia_a_dia: visible.impacto_en_tu_dia_a_dia || "",
      siguiente_paso: visible.siguiente_paso || ""
    }
  };
};

app.post("/api/generate-patient-report", async (req, res) => {
  try {
    const { patientId, accessPin } = req.body;

    if (!patientId || typeof patientId !== "string" || !patientId.trim()) {
      return res.status(400).json({ success: false, error: "Identificador de paciente requerido." });
    }

    const patientRef = db.collection("patients").doc(patientId.trim());
    const patientDoc = await patientRef.get();

    if (!patientDoc.exists) {
      return res.status(404).json({ success: false, error: "Paciente no encontrado." });
    }

    const patientData = patientDoc.data() || {};

    if (patientData.status === "deleted") {
      return res.status(403).json({ success: false, error: "Paciente eliminado." });
    }

    // Normalizar y comprobar accessPin
    const normalizedReceivedPin = normalizeAccessCode(accessPin || "");
    const storedPinCandidate = patientData.accessPin || patientData.proposedAccessCode || patientData.personalAccessCode || "";
    const normalizedStoredPin = normalizeAccessCode(storedPinCandidate);

    if (!normalizedReceivedPin || !normalizedStoredPin || normalizedReceivedPin !== normalizedStoredPin) {
      console.warn(`[SECURITY] Fallo de validación de PIN para paciente ${patientId.slice(0, 10)}...`);
      return res.status(401).json({ success: false, error: "Clave de acceso no válida." });
    }

    // Verificar respuestas
    const answers = patientData.answers || {};
    const answerCount = Object.keys(answers).length;
    if (answerCount === 0) {
      return res.status(400).json({ success: false, error: "No hay respuestas disponibles para generar la valoración." });
    }

    // Comprobar clave Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[GEMINI BACKEND] Falta GEMINI_API_KEY en variables de entorno de servidor.");
      return res.status(500).json({ success: false, error: "Configuración de servidor incompleta: falta GEMINI_API_KEY." });
    }

    const activeModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    // Recuperar prompts configurables desde config/global_config
    let clinicalPrompt = "";
    let conclusionPrompt = "";

    try {
      const configDoc = await db.collection("config").doc("global_config").get();
      if (configDoc.exists) {
        const configData = configDoc.data() || {};
        if (typeof configData.clinicalPrompt === "string" && configData.clinicalPrompt.trim().length > 0) {
          clinicalPrompt = configData.clinicalPrompt.trim();
        }
        if (typeof configData.conclusionPrompt === "string" && configData.conclusionPrompt.trim().length > 0) {
          conclusionPrompt = configData.conclusionPrompt.trim();
        }
      }
    } catch (cfgErr) {
      console.error("[GEMINI BACKEND] Error al leer config/global_config:", cfgErr);
    }

    const defaultClinicalPrompt = `Actúa como un psicoterapeuta experto especializado en reprogramación mental, PNL y Coach Emocional de alto nivel.
Debes analizar los resultados de una sesión del "Cuestionario Espejo".

NUESTRO ARSENAL TERAPÉUTICO (Úsalo para recomendar tratamientos específicos):
1. REPROGRAMACIÓN SUBCONSCIENTE: Uso de PNL e Hipnosis (presentada como "reestructuración del subconsciente") para destraumatizar y cambiar patrones en 2-3 semanas.
2. MEDITACIÓN NEUROPLÁSTICA: Técnica "Satanama" (mantra + movimiento dedos) para abrir nuevos caminos neuronales y meditaciones canalizadas personalizadas.
3. GESTIÓN ENERGÉTICA (PRANAYAMA): Respiración en cuadrado para el estrés cotidiano y Respiración Holotrópica (Breathwork) para liberar traumas profundos (DMT natural).
4. TRABAJO DE PROFUNDIDAD: Terapia del Niño Interior y sanación de patrones Transgeneracionales (padres/abuelos).
5. HÁBITOS DE AUTOCONSCIENCIA: Ejercicio del espejo (conexión emocional) y auditoría de pensamientos (convertir negativos en positivos).

Debes generar un INFORME TÉCNICO (Uso interno para el especialista):
Redacta en párrafos claros, fluidos y profesionales. Títulos en MAYÚSCULAS. NO uses asteriscos ni guiones de markdown.
Estructura:
VALORACIÓN DEL ESTADO EMOCIONAL PROFUNDO
DINÁMICA DE PENSAMIENTO Y PATRONES SUBCONSCIENTES
ESTRATEGIA TERAPÉUTICA PERSONALIZADA (ASIGNACIÓN DE TRATAMIENTOS)
PRONÓSTICO DE EVOLUCIÓN`;

    const defaultConclusionPrompt = `Genera una CONCLUSIÓN PARA EL PACIENTE (Uso externo):
Un mensaje cálido, empático y profesional dirigido directamente al paciente (Hola [Nombre]), explicando de forma comprensible lo que hemos detectado y cómo podemos ayudarle con nuestro enfoque, sin usar jerga excesivamente técnica, pero dándole esperanza y un plan claro. NO uses asteriscos ni guiones de markdown.`;

    const rawClinicalPrompt = clinicalPrompt || defaultClinicalPrompt;
    const rawConclusionPrompt = conclusionPrompt || defaultConclusionPrompt;

    const patientName = patientData.nombre || 'Paciente';
    const patientFirstName = patientName.split(' ')[0] || 'Paciente';

    const finalClinicalPrompt = rawClinicalPrompt.replace(/\[Nombre\]/g, patientName).replace(/\{\{nombre\}\}/gi, patientFirstName);
    const finalConclusionPrompt = rawConclusionPrompt.replace(/\[Nombre\]/g, patientFirstName).replace(/\{\{nombre\}\}/gi, patientFirstName);

    const prompt = `
REGLA DE INTEGRACIÓN DE DATOS:
Si hay contexto de SoyBienestar y respuestas del Cuestionario Espejo, integra ambas fuentes.
SoyBienestar es la historia inicial y el Cuestionario Espejo es la ampliación estructurada.
No bases toda la valoración en SoyBienestar si existen respuestas del cuestionario.
Menciona patrones concretos observados en las respuestas.
No incluyas JSON, claves técnicas ni nombres de campos internos.
No inventes datos no presentes.

DATOS DEL PACIENTE:
Nombre: ${patientName}
Edad: ${patientData.edad || 'Desconocida'}
Sexo: ${patientData.sexo || 'Desconocido'}
${patientData.soybienestarContext ? `Contexto clínico previo de SoyBienestar:\n${JSON.stringify(buildCleanSoyBienestarContextForAI(patientData), null, 2)}` : ''}
${patientData.preInformeSoyBienestar ? `Pre-informe de origen:\n${patientData.preInformeSoyBienestar}` : ''}
Respuestas al cuestionario: ${JSON.stringify(answers)}

INSTRUCCIONES PARA EL INFORME TÉCNICO:
${finalClinicalPrompt}

INSTRUCCIONES PARA LA CONCLUSIÓN DEL PACIENTE:
${finalConclusionPrompt}
`;

    console.log("[GEMINI BACKEND CALL]", {
      patientId: patientId.slice(0, 12),
      model: activeModel,
      hasCustomClinicalPrompt: !!clinicalPrompt,
      hasCustomConclusionPrompt: !!conclusionPrompt,
      answerCount
    });

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: activeModel,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            internalReport: { type: Type.STRING, description: "El informe técnico para uso interno" },
            externalConclusion: { type: Type.STRING, description: "La conclusión empática para el paciente" }
          },
          required: ["internalReport", "externalConclusion"]
        }
      }
    });

    const text = response.text || "{}";
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch (pErr) {
      console.error("[GEMINI BACKEND] Error parseando respuesta JSON de Gemini:", pErr, text);
    }

    const internalReport = typeof data.internalReport === "string" ? data.internalReport.trim() : "";
    const externalConclusion = typeof data.externalConclusion === "string" ? data.externalConclusion.trim() : "";

    if (!internalReport || !externalConclusion) {
      console.error("[GEMINI BACKEND] Gemini devolvió campos vacíos o inválidos:", data);
      return res.status(500).json({
        success: false,
        error: "Error en la generación con IA: la respuesta no contiene la estructura requerida."
      });
    }

    const now = Date.now();
    // Guardado en Firestore Admin
    await patientRef.set({
      conversationSummary: internalReport,
      finalConclusion: externalConclusion,
      aiGeneratedAt: now,
      aiInputAnswerCount: answerCount,
      aiInputHadSoyBienestarContext: !!patientData.soybienestarContext,
      aiModel: activeModel,
      aiProvider: "google"
    }, { merge: true });

    console.log(`[GEMINI BACKEND] Informe guardado con éxito para el paciente ${patientId.slice(0, 12)}...`);

    // Enviar correo de aviso interno si no se ha enviado aún
    if (!patientData.completionNotificationSentAt) {
      try {
        const recipients = await getNotificationRecipients({ notificationEmail: patientData.coordinatorEmail });
        if (recipients.length > 0 && process.env.SMTP_USER && process.env.SMTP_PASS) {
          const fromAddress = process.env.SMTP_FROM || '"Cuestionario Espejo" <soybienestar.es@gmail.com>';
          const dateStr = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
          await transporter.sendMail({
            from: fromAddress,
            to: recipients.join(', '),
            subject: "Cuestionario Espejo completado - pendiente de revisión",
            text: `Un usuario ha completado el Cuestionario Espejo.

Paciente: ${patientData.nombre || 'No especificado'}
Email: ${patientData.email || 'No especificado'}
Origen: ${patientData.source || 'SoyBienestar'}
Estado: Cuestionario completado. Valoración automática generada y pendiente de revisión/dosier.
Fecha: ${dateStr}`
          });

          await patientRef.set({
            completionNotificationSentAt: now
          }, { merge: true });

          console.log("[SMTP NOTICE] Correo interno de cuestionario completado enviado a", recipients.length, "destinatarios.");
        }
      } catch (smtpErr) {
        console.error("Error al enviar notificación SMTP de cuestionario completado (no bloqueante):", smtpErr);
      }
    }

    return res.json({
      success: true,
      internalReport,
      externalConclusion
    });

  } catch (error: any) {
    console.error("Error in POST /api/generate-patient-report:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Error interno al generar el informe con Gemini."
    });
  }
});

app.post("/api/resend-questionnaire-link", async (req, res) => {
  try {
    const bridgeSecret = process.env.SOYBIENESTAR_BRIDGE_SECRET || process.env.QUESTIONNAIRE_BRIDGE_SECRET || process.env.BRIDGE_SECRET;
    if (!bridgeSecret) {
      return res.status(500).json({ error: "Configuracion incompleta: falta secreto de bridge." });
    }
    if (req.headers['x-bridge-secret'] !== bridgeSecret) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const { soybienestarUid, sourceRequestId, email, patientId } = req.body;

    if (!soybienestarUid && !sourceRequestId && !email && !patientId) {
       return res.status(400).json({ error: "Se requiere al menos un identificador (soybienestarUid, sourceRequestId, email, patientId)." });
    }

    let foundPatient: any = null;
    let foundDocId: string | null = null;

    if (patientId) {
      const docSnap = await db.collection("patients").doc(patientId).get();
      if (docSnap.exists) {
        foundPatient = docSnap.data();
        foundDocId = docSnap.id;
      }
    }

    if (!foundPatient && soybienestarUid) {
      const snap = await db.collection("patients").where("soybienestarUid", "==", soybienestarUid).limit(10).get();
      if (!snap.empty) {
        snap.forEach(doc => {
           const data = doc.data();
           if (data.status !== "deleted" && (data.source === "soybienestar" || data.directAccessCreated || data.soybienestarUid || data.sourceRequestId)) {
              if (!foundPatient || (data.dateSent || data.directQuestionnaireUrlCreatedAt || 0) > (foundPatient.dateSent || foundPatient.directQuestionnaireUrlCreatedAt || 0)) {
                  foundPatient = data;
                  foundDocId = doc.id;
              }
           }
        });
      }
    }

    if (!foundPatient && sourceRequestId) {
      const snap = await db.collection("patients").where("sourceRequestId", "==", sourceRequestId).limit(10).get();
      if (!snap.empty) {
        snap.forEach(doc => {
           const data = doc.data();
           if (data.status !== "deleted" && (data.source === "soybienestar" || data.directAccessCreated || data.soybienestarUid || data.sourceRequestId)) {
              if (!foundPatient || (data.dateSent || data.directQuestionnaireUrlCreatedAt || 0) > (foundPatient.dateSent || foundPatient.directQuestionnaireUrlCreatedAt || 0)) {
                  foundPatient = data;
                  foundDocId = doc.id;
              }
           }
        });
      }
    }
    
    if (!foundPatient && email) {
      const snap = await db.collection("patients").where("email", "==", email).limit(10).get();
      if (!snap.empty) {
        snap.forEach(doc => {
           const data = doc.data();
           if (data.status !== "deleted" && (data.source === "soybienestar" || data.directAccessCreated || data.soybienestarUid || data.sourceRequestId)) {
              if (!foundPatient || (data.dateSent || data.directQuestionnaireUrlCreatedAt || 0) > (foundPatient.dateSent || foundPatient.directQuestionnaireUrlCreatedAt || 0)) {
                  foundPatient = data;
                  foundDocId = doc.id;
              }
           }
        });
      }
    }

    if (foundPatient && foundPatient.status === "deleted") {
       foundPatient = null;
    }
    
    if (foundPatient && !(foundPatient.source === "soybienestar" || foundPatient.directAccessCreated || foundPatient.soybienestarUid || foundPatient.sourceRequestId)) {
       foundPatient = null; 
    }

    if (!foundPatient) {
       return res.status(200).json({ success: false, reason: "not_found_or_deleted" });
    }

    let qUrl = foundPatient.questionnaireUrl;
    if (!qUrl) {
       const timestamp = foundPatient.dateSent || foundPatient.directQuestionnaireUrlCreatedAt || Date.now();
       const payload = { id: foundPatient.id || foundDocId, timestamp };
       const sessionToken = safeBtoa(JSON.stringify(payload));
       
       let baseUrl = process.env.APP_PUBLIC_URL || "https://cuestionario-espejo.vercel.app";
       if (!baseUrl.endsWith('/')) { baseUrl += '/'; }
       qUrl = `${baseUrl}#/session?p=${encodeURIComponent(sessionToken)}`;

       await db.collection("patients").doc(foundPatient.id || foundDocId!).update({ questionnaireUrl: qUrl });
    }

    if (foundPatient.status === "completed" || foundPatient.status === "concluded" || foundPatient.status === "finalized") {
      return res.json({
        success: false,
        reason: "already_completed",
        message: "Este cuestionario ya consta como completado o concluido."
      });
    }

    const resendRequestedAt = Date.now();
    await db.collection("patients").doc(foundPatient.id || foundDocId!).set({
      status: "pending",
      resendRequested: true,
      resendRequestedAt,
      resendRequestedBy: "soybienestar",
      resendRequestedReason: "user_requested_resend_from_soybienestar",
      questionnaireUrl: qUrl,
      accessPin: foundPatient.accessPin,
      lastSoyBienestarResendRequestAt: resendRequestedAt
    }, { merge: true });

    res.json({
       success: true,
       action: "resend_requested",
       questionnaireUrl: qUrl,
       accessCode: foundPatient.accessPin,
       patientId: foundPatient.id || foundDocId,
       status: "pending",
       message: "La solicitud de reenvío ha sido registrada para que el terapeuta envíe el cuestionario por los medios solicitados."
    });

  } catch (error) {
     console.error("Error in /api/resend-questionnaire-link:", error);
     res.status(500).json({ error: "Error al reenviar enlace." });
  }
});

// Endpoint to receive new patient requests from external web form
app.post("/api/patient-requests", async (req, res) => {
  try {
    const secret = process.env.QUESTIONNAIRE_BRIDGE_SECRET;
    if (!secret || req.headers['x-bridge-secret'] !== secret) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const requestData = req.body;
    
    // Validate requestData minimal required fields
    if (!requestData || !requestData.email || !requestData.source) {
      return res.status(400).json({ error: "Invalid request data. 'email' and 'source' are required." });
    }

    let finalNombre = requestData.nombre || requestData.displayName;
    if (!finalNombre) finalNombre = "Usuario SoyBienestar";
    let finalDisplayName = requestData.displayName || requestData.nombre;
    if (!finalDisplayName) finalDisplayName = "Usuario SoyBienestar";

    const preferredChannels = requestData.preferredChannels || { email: true, whatsapp: false, sms: false };
    
    if (preferredChannels.whatsapp || preferredChannels.sms) {
      if (!requestData.telefono) {
        return res.status(400).json({ error: "Telefono is required if whatsapp or sms channels are preferred" });
      }
    }

    const docId = requestData.id || `req_${Date.now()}`;

    const newRequest: any = {
      id: docId,
      source: requestData.source,
      sourcePath: requestData.sourcePath || null,
      soybienestarUid: requestData.soybienestarUid || null,
      displayName: finalDisplayName,
      nombre: finalNombre,
      email: requestData.email,
      telefono: requestData.telefono || null,
      edad: requestData.edad || null,
      sexo: requestData.sexo || null,
      proposedAccessCode: requestData.proposedAccessCode ? normalizeAccessCode(requestData.proposedAccessCode) : null,
      preferredChannels: {
        email: !!preferredChannels.email,
        whatsapp: !!preferredChannels.whatsapp,
        sms: !!preferredChannels.sms
      },
      hasDoneConsultation: !!requestData.hasDoneConsultation,
      status: "pending",
      createdAt: requestData.createdAt || Date.now(),
      processedAt: null,
      linkedPatientId: null,
      notes: requestData.notes || "Solicitud procedente de SoyBienestar",
      soybienestarContext: requestData.soybienestarContext || {},
      rawSourcePayload: { ...requestData }
    };

    // Sanitize undefined fields
    Object.keys(newRequest).forEach(key => {
      if (newRequest[key] === undefined) {
        delete newRequest[key];
      }
    });

    console.log("Attempting to save patient request", {
      docId,
      source: newRequest.source,
      hasEmail: !!newRequest.email,
      hasContext: !!newRequest.soybienestarContext,
      dbId
    });

    await db.collection("patientRequests").doc(docId).set(newRequest);

    console.log("Patient request saved successfully", { docId });

    // Send email notification to coordinator(s)
    const notificationRecipients = await getNotificationRecipients(requestData);
    
    if (process.env.SMTP_USER && process.env.SMTP_PASS && notificationRecipients.length > 0) {
      try {
        const appUrl = process.env.APP_PUBLIC_URL || "https://cuestionario-espejo.vercel.app";
        const textContent = `Origen: ${newRequest.source || 'SoyBienestar'}
Nombre: ${newRequest.nombre}
Email: ${newRequest.email}
Teléfono: ${newRequest.telefono || 'N/A'}
${newRequest.rawSourcePayload?.edad ? `Edad: ${newRequest.rawSourcePayload.edad}\n` : ''}${newRequest.rawSourcePayload?.sexo ? `Sexo: ${newRequest.rawSourcePayload.sexo}\n` : ''}Canales solicitados:
- Email: ${newRequest.preferredChannels?.email ? 'sí' : 'no'}
- WhatsApp: ${newRequest.preferredChannels?.whatsapp ? 'sí' : 'no'}
- SMS: ${newRequest.preferredChannels?.sms ? 'sí' : 'no'}

Accede al panel:
${appUrl}`;

        const htmlContent = `<p><strong>Origen:</strong> ${newRequest.source || 'SoyBienestar'}</p>
<ul>
  <li><strong>Nombre:</strong> ${newRequest.nombre}</li>
  <li><strong>Email:</strong> ${newRequest.email}</li>
  <li><strong>Teléfono:</strong> ${newRequest.telefono || 'N/A'}</li>
  ${newRequest.rawSourcePayload?.edad ? `<li><strong>Edad:</strong> ${newRequest.rawSourcePayload.edad}</li>` : ''}
  ${newRequest.rawSourcePayload?.sexo ? `<li><strong>Sexo:</strong> ${newRequest.rawSourcePayload.sexo}</li>` : ''}
</ul>
<p><strong>Canales solicitados:</strong></p>
<ul>
  <li>Email: ${newRequest.preferredChannels?.email ? 'sí' : 'no'}</li>
  <li>WhatsApp: ${newRequest.preferredChannels?.whatsapp ? 'sí' : 'no'}</li>
  <li>SMS: ${newRequest.preferredChannels?.sms ? 'sí' : 'no'}</li>
</ul>
<p><a href="${appUrl}" target="_blank" rel="noopener noreferrer">Abrir Cuestionario Espejo</a></p>`;

        await transporter.sendMail({
          from: process.env.SMTP_FROM || '"Cuestionario Espejo" <noreply@example.com>',
          to: notificationRecipients.join(","),
          subject: "Nueva petición pendiente de Cuestionario Espejo",
          text: textContent,
          html: htmlContent,
        });
        console.log("Email notification sent to", notificationRecipients.length, "recipients");
      } catch (error) {
        console.error("Error sending email notification:", error instanceof Error ? error.message : "Unknown error");
      }
    } else {
      console.log("SMTP not configured or no recipients. Skipping email notification.");
    }

    res.status(201).json({ message: "Request received successfully", id: docId });
  } catch (e) {
    console.error("Error processing POST /api/patient-requests:", {
      name: e instanceof Error ? e.name : "Unknown",
      message: e instanceof Error ? e.message : String(e),
      code: (e as any)?.code,
      stack: e instanceof Error ? e.stack : undefined
    });

    if (req.headers['x-debug-bridge'] === 'true') {
      res.status(500).json({ 
        error: "Internal server error",
        debug: {
          name: e instanceof Error ? e.name : "Unknown",
          message: e instanceof Error ? e.message : String(e),
          code: (e as any)?.code
        }
      });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.post("/api/send-notification", async (req, res) => {
  const { email, requestData } = req.body;
  
  if (!email || !requestData) {
    return res.status(400).json({ error: "Missing email or requestData" });
  }

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"Cuestionario Espejo" <noreply@example.com>',
        to: email,
        subject: "Nueva Petición de Cuestionario",
        text: `Se ha recibido una nueva petición de cuestionario.\n\nNombre: ${requestData.nombre}\nEmail: ${requestData.email}\nTeléfono: ${requestData.telefono || 'N/A'}\n\nPor favor, revisa la aplicación para procesarla.`,
        html: `<p>Se ha recibido una nueva petición de cuestionario.</p><ul><li><strong>Nombre:</strong> ${requestData.nombre}</li><li><strong>Email:</strong> ${requestData.email}</li><li><strong>Teléfono:</strong> ${requestData.telefono || 'N/A'}</li></ul><p>Por favor, revisa la aplicación para procesarla.</p>`,
      });
      console.log("Email notification sent to", email);
      res.json({ success: true });
    } catch (error) {
      console.error("Error sending email notification:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  } else {
    console.log("SMTP credentials not configured. Skipping email notification.");
    res.json({ success: true, note: "SMTP not configured" });
  }
});

app.get("/api/patient-requests", requireCoordinatorAuth, async (req, res) => {
  try {
    const snapshot = await db.collection("patientRequests").where("status", "==", "pending").get();
    const results: any[] = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      let observations = data.notes || "";
      if (data.soybienestarContext && Object.keys(data.soybienestarContext).length > 0) {
        observations = `Contexto recibido desde SoyBienestar. Revise el resumen interno antes de enviar el cuestionario.\n${observations}`;
      }
      
      results.push({
        ...data,
        observaciones: observations,
        // Support legacy timestamp field if dashboard expects it (it was timestamp, we use createdAt)
        timestamp: data.createdAt || Date.now()
      });
    });
    
    results.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    console.log("GET /api/patient-requests diagnostic", {
      dbId,
      returnedCount: results.length,
      pendingCount: results.length
    });
    
    console.log("GET /api/patient-requests - Returning", results.length, "pending requests");
    res.json(results);
  } catch (e: any) {
    console.error("Error fetching patient requests:", {
      name: e instanceof Error ? e.name : "Unknown",
      message: e instanceof Error ? e.message : String(e),
      code: e?.code
    });
    
    // In development mode without explicit credentials, Firebase Admin won't have permission to access Firestore
    if (process.env.NODE_ENV !== 'production' && !process.env.FIREBASE_PRIVATE_KEY && e.code === 7) {
      console.log("Providing mock data for development mode because Firebase Admin lacks IAM permissions");
      return res.json([
        {
          id: "mock_req_1",
          source: "soybienestar",
          status: "pending",
          nombre: "Usuario de Prueba (AI Studio)",
          email: "prueba@soybienestar.com",
          telefono: "+34600000000",
          preferredChannels: { email: true, whatsapp: true },
          createdAt: Date.now() - 3600000,
          observaciones: "Esta es una solicitud simulada generada porque no se ha configurado FIREBASE_PRIVATE_KEY en los secretos del entorno de desarrollo.",
          soybienestarContext: { theme: "Ansiedad" }
        }
      ]);
    }
    
    if (req.headers['x-debug-bridge'] === 'true' || process.env.NODE_ENV !== 'production') {
      return res.status(500).json({ 
        error: "Internal server error",
        details: e instanceof Error ? e.message : String(e),
        endpoint: "/api/patient-requests",
        collection: "patientRequests",
        firebaseAdminReady: !!admin.apps.length,
        projectId: admin.apps.length ? admin.app().options.projectId : null
      });
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/patient-requests/:id", requireCoordinatorAuth, async (req, res) => {
  const id = req.params.id;
  try {
    // In development mode without explicit credentials, Firebase Admin won't have permission to access Firestore
    if (process.env.NODE_ENV !== 'production' && !process.env.FIREBASE_PRIVATE_KEY && id.startsWith('mock_')) {
      console.log("Simulating mock request deletion");
      return res.json({ message: "Mock request processed successfully" });
    }

    await db.collection("patientRequests").doc(id).update({
      status: "processed",
      processedAt: Date.now()
    });
    res.json({ message: "Request processed successfully" });
  } catch (e: any) {
    console.error(`Error processing request ${id}:`, e);
    // Fallback: if document doesn't exist or permission denied. 
    // We will pretend it was deleted safely to mimic previous behavior
    if (e.code === 7 && process.env.NODE_ENV !== 'production' && !process.env.FIREBASE_PRIVATE_KEY) {
      return res.status(200).json({ message: "Mock deletion due to lack of IAM permissions" });
    }
    res.status(200).json({ message: "Request processed (with warnings)" });
  }
});

async function notifySoyBienestarFromPatient(db: any, id: string, data: any, event: string, overrideStatus?: string) {
  const isDirect = data.source === "soybienestar" || data.soybienestarUid || data.sourceRequestId || data.directAccessCreated;
  if (!isDirect) {
    return { status: "skipped", reason: "not_soybienestar" };
  }

  const webhookUrl = process.env.SOYBIENESTAR_WEBHOOK_URL;
  const bridgeSecret = process.env.SOYBIENESTAR_BRIDGE_SECRET;

  if (!webhookUrl || !bridgeSecret) {
    try {
      await db.collection("patients").doc(id).update({
        lastSoyBienestarStatusSyncAt: Date.now(),
        lastSoyBienestarStatusSyncEvent: event,
        lastSoyBienestarStatusSyncStatus: "skipped"
      });
    } catch (e) {
      console.error("[SoyBienestar] Error updating skipped status in Firestore:", e);
    }
    return { status: "skipped", reason: "missing_config" };
  }

  const accessCodeForSoyBienestar =
    data.accessPin ||
    data.proposedAccessCode ||
    data.personalAccessCode ||
    null;

  const payload: any = {
    event,
    soybienestarUid: data.soybienestarUid || null,
    sourceRequestId: data.sourceRequestId || null,
    linkedQuestionnairePatientId: id,
    email: data.email || null,
    telefono: data.telefono || null,
    status: overrideStatus || data.status || null,
    occurredAt: Date.now(),
    accessCode: accessCodeForSoyBienestar,
    accessPin: accessCodeForSoyBienestar,
    accessPinProvidedBySoyBienestar: !!data.proposedAccessCode
  };

  if (event === "dossier_available") {
    payload.dossier = {
      finalConclusion: data.finalConclusion || null,
      conversationSummary: data.conversationSummary || null,
      audioConclusion: data.conclusionAudio || data.audioConclusion || null,
      dateConclusionSent: data.dateConclusionSent || null
    };
  }

  try {
    const headers: any = {
      "Content-Type": "application/json",
      "x-bridge-secret": bridgeSecret
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`[SoyBienestar] HTTP ${response.status}`, await response.text());
      await db.collection("patients").doc(id).update({
        lastSoyBienestarStatusSyncAt: Date.now(),
        lastSoyBienestarStatusSyncEvent: event,
        lastSoyBienestarStatusSyncStatus: "error"
      });
      return { status: "error", code: response.status };
    }
    
    await db.collection("patients").doc(id).update({
      lastSoyBienestarStatusSyncAt: Date.now(),
      lastSoyBienestarStatusSyncEvent: event,
      lastSoyBienestarStatusSyncStatus: "ok"
    });
    return { status: "ok" };
  } catch (e) {
    console.error(`[SoyBienestar] Exception notifying ${event}:`, e);
    await db.collection("patients").doc(id).update({
      lastSoyBienestarStatusSyncAt: Date.now(),
      lastSoyBienestarStatusSyncEvent: event,
      lastSoyBienestarStatusSyncStatus: "error"
    });
    return { status: "error", error: e };
  }
}

app.post("/api/patients/:id/soft-delete", requireCoordinatorAuth, async (req, res) => {
  const id = req.params.id;
  const previousStatus = req.body.previousStatus;
  const coordinatorEmail = ((req as any).user?.email || "").toLowerCase();

  try {
    const docRef = db.collection("patients").doc(id);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, error: "Paciente no encontrado" });
    }

    const data = docSnap.data();
    if (data?.coordinatorEmail && data.coordinatorEmail.toLowerCase() !== coordinatorEmail) {
      return res.status(403).json({ success: false, error: "Acceso denegado: este paciente pertenece a otro coordinador" });
    }

    const deletedAt = Date.now();
    await docRef.update({
      deletedAt,
      deletedBy: coordinatorEmail || "coordinator",
      deletedReason: null,
      previousStatusBeforeDelete: previousStatus || data?.status || "sent",
      status: "deleted"
    });

    let soyBienestarSyncResult = null;
    // Notifier a SoyBienestar fallos no bloquean la eliminación
    if (data && (data.source === "soybienestar" || data.soybienestarUid || data.sourceRequestId || data.directAccessCreated)) {
       try {
         // Esperar el resultado de la sincronización sin que un fallo bloquee el proceso
         soyBienestarSyncResult = await notifySoyBienestarFromPatient(db, id, data, "questionnaire_deleted", "deleted");
       } catch (e) {
         console.error("[SOFT DELETE] Error calling notifySoyBienestarFromPatient:", e);
         soyBienestarSyncResult = { status: "error", error: String(e) };
       }
    }

    res.json({
      success: true,
      id,
      deletedAt,
      soyBienestarSyncResult
    });
  } catch (e: any) {
    console.error(`Error soft-deleting patient ${id}:`, e);
    res.status(500).json({ success: false, error: e.message || "Error al enviar ficha a papelera" });
  }
});

app.post("/api/patients/:id/restore", requireCoordinatorAuth, async (req, res) => {
  const id = req.params.id;
  const coordinatorEmail = ((req as any).user?.email || "").toLowerCase();

  try {
    const docRef = db.collection("patients").doc(id);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, error: "Paciente no encontrado" });
    }

    const data = docSnap.data();
    if (data?.coordinatorEmail && data.coordinatorEmail.toLowerCase() !== coordinatorEmail) {
      return res.status(403).json({ success: false, error: "Acceso denegado: este paciente pertenece a otro coordinador" });
    }

    const restoredStatus = data?.previousStatusBeforeDelete || "sent";

    await docRef.update({
      status: restoredStatus,
      restoredAt: Date.now(),
      restoredBy: coordinatorEmail || "coordinator",
      deletedAt: FieldValue.delete(),
      deletedBy: FieldValue.delete(),
      deletedReason: FieldValue.delete(),
      previousStatusBeforeDelete: FieldValue.delete()
    });

    res.json({ success: true, id, restoredStatus });
  } catch (e: any) {
    console.error(`Error restoring patient ${id}:`, e);
    res.status(500).json({ success: false, error: e.message || "Error al restaurar ficha" });
  }
});

app.post("/api/send-questionnaire-email", requireCoordinatorAuth, async (req: any, res) => {
  try {
    const { patientId, to, subject, body } = req.body;

    if (!patientId || !to || !subject || !body) {
      return res.status(400).json({ error: "Faltan campos obligatorios (patientId, to, subject, body)" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return res.status(400).json({ error: "Email inválido" });
    }

    const patientRef = db.collection("patients").doc(patientId);
    const patientDoc = await patientRef.get();

    if (!patientDoc.exists) {
      return res.status(404).json({ error: "Paciente no encontrado" });
    }

    const patientData = patientDoc.data();
    const coordinatorEmail = (req.user?.email || "").toLowerCase();
    
    if (patientData?.coordinatorEmail && patientData.coordinatorEmail.toLowerCase() !== coordinatorEmail) {
      return res.status(403).json({ error: "No tienes permiso para modificar este paciente" });
    }

    function escapeEmailHtml(value: string) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    const htmlBody = escapeEmailHtml(body).replace(/\n/g, "<br>");
    const fromAddress = process.env.SMTP_FROM || '"Cuestionario Espejo - SoyBienestar" <soybienestar.es@gmail.com>';

    await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text: body,
      html: htmlBody,
    });

    const updatePayload = {
      lastQuestionnaireEmailSentAt: Date.now(),
      lastQuestionnaireEmailSentTo: to,
      lastQuestionnaireEmailSubject: subject,
      lastQuestionnaireEmailStatus: "sent",
      lastQuestionnaireEmailSentBy: req.user?.email || req.user?.uid || "coordinator",
      status: "sent",
      dateSent: Date.now()
    };

    await patientRef.update(updatePayload);

    res.json({ success: true, updatedFields: updatePayload });
  } catch (error: any) {
    console.error("Error enviando email del cuestionario:", error);
    res.status(500).json({ success: false, error: error.message || "Error al enviar el email" });
  }
});

// Legacy endpoint. Prefer /api/notify-soybienestar-status
app.post("/api/notify-dossier", requireCoordinatorAuth, async (req, res) => {
  const patient = req.body.patient;
  if (!patient || !patient.id) {
    return res.status(400).json({ error: "Missing patient data" });
  }

  const webhookUrl = process.env.SOYBIENESTAR_WEBHOOK_URL;
  const bridgeSecret = process.env.SOYBIENESTAR_BRIDGE_SECRET;

  if (!webhookUrl || !bridgeSecret) {
    console.log("[SoyBienestar] Webhook o bridge secret no configurado. Skipping dossier notification.");
    return res.json({ success: true, note: "Webhook not configured" });
  }

  const accessCodeForSoyBienestar =
    patient.accessPin ||
    patient.proposedAccessCode ||
    patient.personalAccessCode ||
    null;

  const payload = {
    event: "dossier_available",
    soybienestarUid: patient.soybienestarUid || null,
    sourceRequestId: patient.sourceRequestId || null,
    linkedQuestionnairePatientId: patient.id,
    email: patient.email,
    telefono: patient.telefono || null,
    accessCode: accessCodeForSoyBienestar,
    accessPin: accessCodeForSoyBienestar,
    accessPinProvidedBySoyBienestar: !!patient.proposedAccessCode,
    status: patient.status,
    occurredAt: Date.now(),
    dossier: {
      finalConclusion: patient.finalConclusion || "",
      conversationSummary: patient.conversationSummary || "",
      audioConclusion: patient.conclusionAudio || patient.audioConclusion || null,
      dateConclusionSent: patient.dateConclusionSent || null
    }
  };

  try {
    const headers: any = {
      "Content-Type": "application/json"
    };

    if (bridgeSecret) {
      headers["x-bridge-secret"] = bridgeSecret;
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`[SoyBienestar] Webhook devolvió estado ${response.status}`, await response.text());
      // No fallar la petición completa para no romper el guardado del paciente
      return res.json({ success: false, note: `Webhook devolvió HTTP ${response.status}` });
    }

    console.log(`[SoyBienestar] Webhook informado correctamente para paciente ${patient.id}.`);
    return res.json({ success: true });
  } catch (e) {
    console.error("[SoyBienestar] Error al enviar dossier via webhook:", e);
    // Retornamos HTTP 200 porque es un proceso en background y no debe romper el dashboard
    return res.json({ success: false, note: "Error de conexión con webhook", error: String(e) });
  }
});

app.post("/api/notify-soybienestar-status", async (req, res) => {
  try {
    const { patientId, event } = req.body;
    if (!patientId || !event) {
      return res.status(400).json({ error: "Faltan datos patientId o event" });
    }

    const allowedEvents = ['questionnaire_started', 'questionnaire_completed', 'dossier_available', 'questionnaire_deleted'];
    if (!allowedEvents.includes(event)) {
      return res.status(400).json({ error: "Evento no soportado" });
    }

    const patientDoc = await db.collection("patients").doc(patientId).get();
    if (!patientDoc.exists) {
      return res.status(404).json({ error: "Paciente no encontrado" });
    }

    const patient = patientDoc.data()!;
    const isDirect = patient.source === "soybienestar" || patient.soybienestarUid || patient.sourceRequestId;
    
    if (!isDirect) {
      return res.json({ success: true, note: "El paciente no procede de SoyBienestar" });
    }

    const webhookUrl = process.env.SOYBIENESTAR_WEBHOOK_URL;
    const bridgeSecret = process.env.SOYBIENESTAR_BRIDGE_SECRET;

    if (!webhookUrl || !bridgeSecret) {
      console.log("[SoyBienestar] Webhook o bridge secret no configurado. Skipping status notification.");
      return res.json({ success: false, note: "Webhook not configured" });
    }

    const accessCodeForSoyBienestar =
      patient.accessPin ||
      patient.proposedAccessCode ||
      patient.personalAccessCode ||
      null;

    const payload: any = {
      event,
      soybienestarUid: patient.soybienestarUid || null,
      sourceRequestId: patient.sourceRequestId || null,
      linkedQuestionnairePatientId: patient.id,
      email: patient.email || null,
      telefono: patient.telefono || null,
      status: patient.status,
      occurredAt: Date.now(),
      accessCode: accessCodeForSoyBienestar,
      accessPin: accessCodeForSoyBienestar,
      accessPinProvidedBySoyBienestar: !!patient.proposedAccessCode
    };

    if (event === "dossier_available") {
      payload.dossier = {
        finalConclusion: patient.finalConclusion || null,
        conversationSummary: patient.conversationSummary || null,
        audioConclusion: patient.conclusionAudio || patient.audioConclusion || null,
        dateConclusionSent: patient.dateConclusionSent || null
      };
    }

    const headers: any = {
      "Content-Type": "application/json",
      "x-bridge-secret": bridgeSecret
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`[SoyBienestar] Webhook HTTP ${response.status}`, await response.text());
      return res.status(500).json({ error: `Webhook error ${response.status}` });
    }

    const syncInfo = {
      lastSoyBienestarStatusSyncAt: Date.now(),
      lastSoyBienestarStatusSyncEvent: event,
      lastSoyBienestarStatusSyncStatus: "ok"
    };

    await db.collection("patients").doc(patientId).update(syncInfo);

    return res.json({ success: true, syncInfo });

  } catch (error: any) {
    console.error("[SoyBienestar] Error en notify-soybienestar-status:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Catch-all for API routes that don't exist
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `API route ${req.method} ${req.url} not found` });
});

export default app;
