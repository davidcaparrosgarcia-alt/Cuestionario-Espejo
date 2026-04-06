
import { GoogleGenAI, Type } from "@google/genai";

export class GeminiService {
  async summarizeSession(patient: any, answers: any, transcript: string): Promise<string> {
      // Mantener por compatibilidad si se usa en otro lado, aunque lo ideal es usar generateFullReport
      const res = await this.generateFullReport(patient, answers, transcript);
      return res.internalReport;
  }

  async generateFullReport(patient: any, answers: any, transcript: string, clinicalPrompt?: string, conclusionPrompt?: string): Promise<{ internalReport: string, externalConclusion: string }> {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const defaultClinicalPrompt = `
        Actúa como un psicoterapeuta experto especializado en reprogramación mental, PNL y Coach Emocional de alto nivel.
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
        PRONÓSTICO DE EVOLUCIÓN
      `;

      const defaultConclusionPrompt = `
        Genera una CONCLUSIÓN PARA EL PACIENTE (Uso externo):
        Un mensaje cálido, empático y profesional dirigido directamente al paciente (Hola [Nombre]), explicando de forma comprensible lo que hemos detectado y cómo podemos ayudarle con nuestro enfoque, sin usar jerga excesivamente técnica, pero dándole esperanza y un plan claro. NO uses asteriscos ni guiones de markdown.
      `;

      const finalClinicalPrompt = (clinicalPrompt || defaultClinicalPrompt).replace(/\[Nombre\]/g, patient.nombre);
      const finalConclusionPrompt = (conclusionPrompt || defaultConclusionPrompt).replace(/\[Nombre\]/g, patient.nombre?.split(' ')[0] || 'Paciente');

      const prompt = `
        DATOS DEL PACIENTE:
        Nombre: ${patient.nombre}
        Edad: ${patient.edad}
        Respuestas al cuestionario: ${JSON.stringify(answers)}
        Transcripción de la interacción: ${transcript}
        
        INSTRUCCIONES PARA EL INFORME TÉCNICO:
        ${finalClinicalPrompt}
        
        INSTRUCCIONES PARA LA CONCLUSIÓN DEL PACIENTE:
        ${finalConclusionPrompt}
      `;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
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
      const data = JSON.parse(text);
      return {
          internalReport: data.internalReport || "No se pudo generar la valoración automática.",
          externalConclusion: data.externalConclusion || "No se pudo generar la conclusión para el paciente."
      };
    } catch (e) {
      console.error("Error generating full report:", e);
      return {
          internalReport: "Error de conexión con el motor de análisis clínico.",
          externalConclusion: "Error de conexión con el motor de análisis clínico."
      };
    }
  }
}

export const gemini = new GeminiService();
