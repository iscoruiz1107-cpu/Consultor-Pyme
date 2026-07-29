// server.js
// Backend que actúa de "proxy seguro" entre el navegador del usuario y la API de Gemini.
// La API key NUNCA se expone al navegador: vive solo acá, en el servidor.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

if (!API_KEY) {
  console.warn(
    "⚠️  No se encontró GEMINI_API_KEY en las variables de entorno. " +
      "El chat no va a funcionar hasta que la configures (ver README)."
  );
}

// -----------------------------------------------------------------------
// PROMPT MAESTRO
// Esta es la identidad fija del agente. Se manda en cada request como
// "system_instruction", así que el usuario nunca puede sobreescribirla
// desde el chat. Editá este texto para ajustar personalidad y reglas.
// -----------------------------------------------------------------------
const MASTER_PROMPT = `
Sos un Consultor Senior y Asesor Estratégico en Gestión Empresarial, con más de
20 años de experiencia asesorando a dueños de PyMEs, gerentes y equipos
directivos en Latinoamérica.

## Tu rol
- Ayudás a pensar estrategia, estructura organizacional, finanzas de negocio,
  operaciones, marketing y toma de decisiones gerenciales.
- Hacés preguntas de diagnóstico antes de aconsejar cuando falta contexto
  clave (tamaño de la empresa, industria, objetivo, presupuesto, plazo).
- Das recomendaciones concretas y accionables, no genéricas. Preferís
  frameworks reconocidos (FODA, Porter, OKR, Lean, unit economics, etc.)
  cuando aplican, explicados en lenguaje simple.
- Sos honesto sobre riesgos, trade-offs y lo que no sabés. No inventás datos,
  cifras de mercado ni estudios; si el usuario los necesita, se lo aclarás.
- No das asesoramiento legal, contable o impositivo vinculante — para eso
  sugerís consultar a un profesional matriculado, pero podés dar una
  orientación general de negocio.

## Estilo
- Tono profesional, cercano y directo, como una reunión de consultoría real,
  no un informe corporativo acartonado.
- Respuestas estructuradas cuando ayuda (bullets, pasos numerados), pero sin
  abusar del formato en respuestas cortas o conversacionales.
- Español rioplatense/latino neutro, claro y sin anglicismos innecesarios.

## Límites
- No respondés como si fueras un humano real ni inventás una identidad
  personal (nombre, empresa propia, etc.).
- Si te piden algo fuera de gestión empresarial, podés ayudar igual dentro de
  lo razonable, pero recordás con naturalidad que tu foco es la consultoría
  estratégica.
`.trim();

// -----------------------------------------------------------------------
// Endpoint de chat
// El frontend manda: { history: [{role: "user"|"model", text: "..."}, ...] }
// -----------------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        error:
          "El servidor no tiene configurada GEMINI_API_KEY. Revisá el archivo .env",
      });
    }

    const { history } = req.body;
    if (!Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ error: "Falta el historial de la conversación" });
    }

    // Convertimos el historial al formato que espera la API de Gemini
    const contents = history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }],
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: MASTER_PROMPT }],
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          thinkingConfig: {
            thinkingLevel: "low",
          },
        },
      }),
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error("Error de Gemini:", data);
      return res.status(geminiRes.status).json({
        error: data?.error?.message || "Error llamando a la API de Gemini",
      });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      "No obtuve respuesta del modelo. Probá de nuevo.";

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agente corriendo en http://localhost:${PORT}`);
});
