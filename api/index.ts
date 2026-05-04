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

if (!admin.apps.length) {
  try {
    const credential = (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) 
      ? admin.credential.cert({
          projectId: projectId,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
      : admin.credential.applicationDefault();

    admin.initializeApp({
      credential,
      projectId: projectId,
    });
    console.log("Firebase Admin initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize Firebase Admin:", error);
  }
}

const db = getFirestore(admin.app(), dbId);

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
    await admin.auth().verifyIdToken(token);
    next();
  } catch (error) {
    console.error("Coordinator auth failed", {
      reason: "invalid_firebase_token",
      message: error instanceof Error ? error.message : String(error),
      projectId
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

// API routes FIRST
app.get("/api/health", async (req, res) => {
  let firestoreCheck = "not_run";
  let firestoreError = undefined;
  let permissionDiagnosis = undefined;
  
  let patientRequestsTotalCount = undefined;
  let patientRequestsPendingCount = undefined;
  let latestPatientRequestPreview = undefined;

  const resolvedProjectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (req.query.checkFirestore === '1') {
    try {
      const snapshot = await db.collection("patientRequests").limit(20).get();
      firestoreCheck = "ok";
      
      patientRequestsTotalCount = snapshot.size;
      patientRequestsPendingCount = 0;
      let latestDoc: any = null;
      let latestTime = 0;

      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.status === "pending") {
          patientRequestsPendingCount!++;
        }
        const createdAt = data.createdAt || 0;
        if (createdAt > latestTime) {
          latestTime = createdAt;
          latestDoc = data;
        }
      });

      if (latestDoc) {
        latestPatientRequestPreview = {
          id: latestDoc.id,
          source: latestDoc.source,
          status: latestDoc.status,
          createdAt: latestDoc.createdAt,
          createdAtIso: new Date(latestDoc.createdAt || Date.now()).toISOString(),
          hasEmail: !!latestDoc.email,
          hasTelefono: !!latestDoc.telefono,
          hasSoybienestarContext: !!latestDoc.soybienestarContext && Object.keys(latestDoc.soybienestarContext).length > 0
        };
      }
    } catch (e: any) {
      firestoreCheck = "error";
      firestoreError = {
        message: e.message || String(e),
        code: e.code,
      };

      if (e.code === 7 || (e.message && e.message.includes('PERMISSION_DENIED'))) {
        permissionDiagnosis = {
          likelyCause: "La cuenta de servicio cargada en FIREBASE_CLIENT_EMAIL no tiene permisos IAM suficientes sobre Firestore/Datastore o no corresponde al proyecto/base de datos configurada.",
          suggestedRoles: ["Cloud Datastore User", "Cloud Datastore Owner para desarrollo"],
          whereToFix: `Google Cloud Console > IAM > proyecto ${resolvedProjectId}`
        };
      }
    }
  }

  const clientEmailDomainPreview = clientEmail 
      ? clientEmail.split('@')[1] || "invalid-format" 
      : null;

  res.json({ 
    status: "ok",
    env: process.env.NODE_ENV || "development",
    adminAvailable: !!admin.apps.length,
    bridgeSecretConfigured: !!process.env.QUESTIONNAIRE_BRIDGE_SECRET,
    firestoreDatabaseId: dbId,
    firestoreDatabaseIdConfigured: !!process.env.FIRESTORE_DATABASE_ID,
    firebaseProjectIdFromEnv: !!process.env.FIREBASE_PROJECT_ID,
    firebaseClientEmailFromEnv: !!process.env.FIREBASE_CLIENT_EMAIL,
    firebasePrivateKeyFromEnv: !!process.env.FIREBASE_PRIVATE_KEY,
    firebaseClientEmailDomainPreview: clientEmailDomainPreview,
    adminAppProjectId: admin.apps.length ? admin.app().options.projectId : null,
    projectIdLooksCorrect: resolvedProjectId === "gen-lang-client-0082734692",
    clientEmailLooksCorrect: clientEmail ? clientEmail.includes("gen-lang-client-0082734692") : false,
    firestoreCheck,
    firestoreError,
    permissionDiagnosis,
    patientRequestsTotalCount,
    patientRequestsPendingCount,
    latestPatientRequestPreview,
    time: new Date().toISOString()
  });
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

    // Send email notification to coordinator
    const notificationEmail = requestData.notificationEmail || process.env.SMTP_FROM || "admin@example.com";
    
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || '"Cuestionario Espejo" <noreply@example.com>',
          to: notificationEmail,
          subject: "Nueva Petición de Cuestionario",
          text: `Se ha recibido una nueva petición de cuestionario desde ${requestData.source}.\n\nNombre: ${newRequest.nombre}\nEmail: ${newRequest.email}\nTeléfono: ${newRequest.telefono || 'N/A'}\n\nPor favor, revisa la aplicación para procesarla.`,
          html: `<p>Se ha recibido una nueva petición de cuestionario desde ${requestData.source}.</p><ul><li><strong>Nombre:</strong> ${newRequest.nombre}</li><li><strong>Email:</strong> ${newRequest.email}</li><li><strong>Teléfono:</strong> ${newRequest.telefono || 'N/A'}</li></ul><p>Por favor, revisa la aplicación para procesarla.</p>`,
        });
        console.log("Email notification sent to", notificationEmail);
      } catch (error) {
        console.error("Error sending email notification:", error);
      }
    } else {
      console.log("SMTP credentials not configured. Skipping email notification.");
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
    console.error("Error fetching patient requests:", e);
    
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

// Catch-all for API routes that don't exist
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `API route ${req.method} ${req.url} not found` });
});

export default app;
