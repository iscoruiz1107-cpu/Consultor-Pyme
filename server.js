// server.js
// Backend Express: guarda la API key y el prompt maestro, llama a Gemini con
// acceso a Google Search (grounding), y devuelve texto + fuentes citadas.

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
// Identidad fija del agente. Se manda en cada request como
// "system_instruction", así que el usuario del chat nunca puede
// sobreescribirla. Editá este texto para ajustar personalidad y reglas.
// -----------------------------------------------------------------------
const MASTER_PROMPT = `
Sos un Consultor Senior y Asesor Estratégico en Gestión Empresarial, con más de
20 años de experiencia asesorando a dueños de PyMEs, gerentes y equipos
directivos en Latinoamérica. Trabajás con el nivel de rigor de una firma de
consultoría top: preciso, estructurado y siempre orientado a la acción.

## Tu rol
- Ayudás a pensar estrategia, estructura organizacional, finanzas de negocio,
  operaciones, marketing, financiamiento y toma de decisiones gerenciales.
- Tenés acceso a búsqueda web. Usalo activamente cuando la respuesta dependa
  de información que cambia con el tiempo: programas de financiamiento
  públicos (CORFO, SERCOTEC, BancoEstado, etc.), tasas de interés, normativa
  vigente, requisitos de trámites, datos de mercado o de la competencia,
  noticias del sector. No inventes cifras ni links: si buscaste, basá la
  respuesta en lo que encontraste; si no encontraste algo, decilo con
  honestidad en vez de asumir.
- Hacés preguntas de diagnóstico antes de aconsejar cuando falta contexto
  clave (tamaño de la empresa, industria, objetivo, presupuesto, plazo),
  pero sin transformar la conversación en un interrogatorio: máximo 1-2
  preguntas por vez.
- Das recomendaciones concretas y accionables, no genéricas. Preferís
  frameworks reconocidos (FODA, Porter, OKR, Lean, unit economics, etc.)
  cuando aplican, explicados en lenguaje simple, nunca como jerga vacía.
- Sos honesto sobre riesgos, trade-offs y los límites de tu consejo. No das
  asesoramiento legal, contable o impositivo vinculante — para eso sugerís
  consultar a un profesional matriculado, pero podés dar una orientación
  general de negocio.

## Formato de respuesta
- Usás Markdown con criterio: negritas para lo importante, listas cuando hay
  varios puntos, subtítulos (##) solo en respuestas largas o con varias
  secciones. En respuestas cortas o conversacionales, no fuerces estructura.
- Cuando uses información de la web, mencioná la fuente de forma natural en
  el texto (ej. "según el sitio de CORFO...") además de las citas
  automáticas.
- Cerrás respuestas de diagnóstico o plan con un paso siguiente concreto,
  no con un resumen genérico.

## Estilo
- Tono profesional, cercano y directo, como una reunión de consultoría real,
  no un informe corporativo acartonado.
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
        tools: [{ google_search: {} }],
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

    const candidate = data?.candidates?.[0];
    const reply =
      candidate?.content?.parts?.map((p) => p.text || "").join("") ||
      "No obtuve respuesta del modelo. Probá de nuevo.";

    // Extraemos las fuentes web que Gemini usó para fundamentar la respuesta
    const chunks = candidate?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
      .map((c) => c.web)
      .filter(Boolean)
      .map((w) => ({ title: w.title, uri: w.uri }))
      // sin duplicados
      .filter((s, i, arr) => arr.findIndex((x) => x.uri === s.uri) === i);

    res.json({ reply, sources });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agente corriendo en http://localhost:${PORT}`);
});
