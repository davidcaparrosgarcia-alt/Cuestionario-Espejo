import { GoogleGenAI, Type } from "@google/genai";

const MODEL = "gemini-3.5-flash-lite";

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function countWords(text: string): number {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/).length : 0;
}

export default async function handler(req: any, res: any) {
  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ error: "Not found" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: "GEMINI_API_KEY is not configured in Preview." });
  }

  try {
    const body = req.body || {};
    const firstName = asTrimmedString(body.firstName) || "Paciente";
    const therapistClinicalGuidance = asTrimmedString(body.therapistClinicalGuidance);
    const currentClinicalFile = asTrimmedString(body.currentClinicalFile);
    const preInformeSoyBienestar = asTrimmedString(body.preInformeSoyBienestar);
    const conclusionPrompt = asTrimmedString(body.conclusionPrompt);
    const soybienestarContext = body.soybienestarContext ?? null;
    const semanticAnswers = Array.isArray(body.semanticAnswers) ? body.semanticAnswers : [];

    if (!conclusionPrompt) {
      return res.status(400).json({ success: false, error: "conclusionPrompt is required." });
    }

    if (conclusionPrompt.length > 40000 || therapistClinicalGuidance.length > 20000 || currentClinicalFile.length > 20000) {
      return res.status(413).json({ success: false, error: "Prompt lab payload is too large." });
    }

    const finalConclusionPrompt = conclusionPrompt
      .replace(/\[Nombre\]/g, firstName)
      .replace(/\{\{nombre\}\}/gi, firstName);

    const prompt = `
FUENTES PARA LA CONCLUSIÓN:
${therapistClinicalGuidance ? `PRIORIDAD 1 — APORTACIONES PROFESIONALES DE LA TERAPEUTA:\n${therapistClinicalGuidance}` : ""}
${currentClinicalFile && currentClinicalFile !== therapistClinicalGuidance ? `PRIORIDAD 2 — FICHA CLÍNICA ACTUAL REVISADA:\n${currentClinicalFile}` : ""}

INFORMACIÓN SECUNDARIA DE APOYO Y CONTRASTE:
${soybienestarContext ? `Contexto clínico previo de SoyBienestar:\n${JSON.stringify(soybienestarContext, null, 2)}` : ""}
${preInformeSoyBienestar ? `Pre-informe de origen:\n${preInformeSoyBienestar}` : ""}
Respuestas interpretadas del Cuestionario Espejo:
${JSON.stringify(semanticAnswers, null, 2)}

INSTRUCCIONES CONFIGURABLES PARA LA CONCLUSIÓN:
${finalConclusionPrompt}
`;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            externalConclusion: { type: Type.STRING, description: "La conclusión para el paciente" }
          },
          required: ["externalConclusion"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    const externalConclusion = asTrimmedString(parsed.externalConclusion);
    if (!externalConclusion) {
      return res.status(502).json({ success: false, error: "Gemini returned no externalConclusion." });
    }

    return res.status(200).json({
      success: true,
      aiModel: MODEL,
      externalConclusion,
      wordCount: countWords(externalConclusion),
      inputAudit: {
        therapistGuidanceIncluded: Boolean(therapistClinicalGuidance),
        currentClinicalFileIncluded: Boolean(currentClinicalFile && currentClinicalFile !== therapistClinicalGuidance),
        soybienestarContextIncluded: Boolean(soybienestarContext),
        preInformeIncluded: Boolean(preInformeSoyBienestar),
        semanticAnswerCount: semanticAnswers.length,
        promptLength: prompt.length
      }
    });
  } catch (error: any) {
    const message = error?.message || String(error);
    const status = /RESOURCE_EXHAUSTED|429|rate limit/i.test(message) ? 429 : 500;
    return res.status(status).json({
      success: false,
      error: status === 429 ? "RATE_LIMITED" : "PROMPT_LAB_FAILED",
      detail: message
    });
  }
}
