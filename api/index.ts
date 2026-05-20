import express from "express";
import nodemailer from "nodemailer";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

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
    await admin.auth(frontendAuthApp).verifyIdToken(token);
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
    const accessPin = validProposed || generateAccessCode(4);
    const dbPatientId = `patient_${now}_${Math.random().toString(36).slice(2, 8)}`;
    
    const payload = {
      id: dbPatientId,
      timestamp: now
    };
    const sessionToken = safeBtoa(JSON.stringify(payload));

    const patientData = {
      id: dbPatientId,
      coordinatorEmail: resolvedCoordinatorEmail,
      nombre: nombre || "Usuario SoyBienestar",
      email: email || null,
      telefono: telefono || null,
      edad: edad || null,
      sexo: sexo || null,
      observaciones: "Generado directamente por SoyBienestar",
      status: "sent", // Equivalent enough for them to start answering
      dateSent: now,
      accessPin,
      proposedAccessCode: validProposed,
      source: "soybienestar",
      sourceRequestId: requestId || null,
      soybienestarUid: soybienestarUid || null,
      soybienestarContext: soybienestarContext || null,
      preferredChannels: preferredChannels || null,
      directAccessCreated: true,
      directQuestionnaireUrlCreatedAt: now,
      accessCodeFormat: "v2_4_alphanumeric" as const
    };

    // Sanitize undefined
    Object.keys(patientData).forEach(key => {
       if ((patientData as any)[key] === undefined) {
         delete (patientData as any)[key];
       }
    });

    await db.collection("patients").doc(dbPatientId).set(patientData);

    let baseUrl = process.env.APP_PUBLIC_URL || "https://cuestionario-espejo.vercel.app";
    if (!baseUrl.endsWith('/')) {
        baseUrl += '/';
    }
    const questionnaireUrl = `${baseUrl}#/session?p=${encodeURIComponent(sessionToken)}`;

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

  const payload = {
    event: "dossier_available",
    soybienestarUid: patient.soybienestarUid || null,
    sourceRequestId: patient.sourceRequestId || null,
    linkedQuestionnairePatientId: patient.id,
    email: patient.email,
    telefono: patient.telefono || null,
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

// Catch-all for API routes that don't exist
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `API route ${req.method} ${req.url} not found` });
});

export default app;
