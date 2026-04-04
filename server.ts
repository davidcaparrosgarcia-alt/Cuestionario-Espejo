import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

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
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Endpoint to receive new patient requests from external web form
  app.post("/api/requests", async (req, res) => {
    const requestData = req.body;
    
    // Validate requestData
    if (!requestData || !requestData.nombre || !requestData.email) {
      return res.status(400).json({ error: "Invalid request data. 'nombre' and 'email' are required." });
    }

    const newRequest = {
      ...requestData,
      id: requestData.id || `req-${Date.now()}`,
      timestamp: Date.now()
    };

    pendingRequestsStore.push(newRequest);

    // Send email notification to coordinator
    const notificationEmail = requestData.notificationEmail || process.env.SMTP_FROM || "admin@example.com";
    
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || '"Cuestionario Espejo" <noreply@example.com>',
          to: notificationEmail,
          subject: "Nueva Petición de Cuestionario",
          text: `Se ha recibido una nueva petición de cuestionario.\n\nNombre: ${newRequest.nombre}\nEmail: ${newRequest.email}\nTeléfono: ${newRequest.telefono || 'N/A'}\n\nPor favor, revisa la aplicación para procesarla.`,
          html: `<p>Se ha recibido una nueva petición de cuestionario.</p><ul><li><strong>Nombre:</strong> ${newRequest.nombre}</li><li><strong>Email:</strong> ${newRequest.email}</li><li><strong>Teléfono:</strong> ${newRequest.telefono || 'N/A'}</li></ul><p>Por favor, revisa la aplicación para procesarla.</p>`,
        });
        console.log("Email notification sent to", notificationEmail);
      } catch (error) {
        console.error("Error sending email notification:", error);
      }
    } else {
      console.log("SMTP credentials not configured. Skipping email notification.");
      console.log("Would have sent to:", notificationEmail);
    }

    res.status(201).json({ message: "Request received successfully", id: newRequest.id });
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

  app.get("/api/requests", (req, res) => {
    console.log("GET /api/requests - Returning", pendingRequestsStore.length, "requests");
    res.json(pendingRequestsStore);
  });

  app.delete("/api/requests/:id", (req, res) => {
    const id = req.params.id;
    pendingRequestsStore = pendingRequestsStore.filter(r => r.id !== id);
    res.json({ message: "Request deleted successfully" });
  });

  // Catch-all for API routes that don't exist
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route ${req.method} ${req.url} not found` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

let pendingRequestsStore: any[] = [
  {
    id: "req-mock-123",
    nombre: "Ejemplo Pendiente",
    email: "ejemplo@correo.com",
    edad: "35",
    sexo: "Mujer",
    telefono: "600000000",
    observaciones: "Paciente de prueba generado automáticamente para validar el sistema de nuevas peticiones.",
    timestamp: Date.now()
  }
];

startServer();
