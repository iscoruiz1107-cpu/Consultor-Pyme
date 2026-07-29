// server.js
// Backend Express: guarda la API key y el prompt maestro, llama a Gemini con
// acceso a Google Search (grounding) y a archivos adjuntos (PDF/Excel/CSV/
// imágenes), y devuelve texto + fuentes citadas.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import * as XLSX from "xlsx";

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
- El usuario puede adjuntar archivos: PDF, planillas de Excel/CSV o imágenes
  (fotos de balances, capturas de pantalla, gráficos, etc.). Cuando haya un
  archivo adjunto, analizalo a fondo antes de responder: extraé los datos y
  cifras relevantes, identificá tendencias, riesgos u oportunidades, y
  fundamentá tu diagnóstico en lo que realmente ves en el archivo, nunca en
  suposiciones. Si el archivo es ilegible, está incompleto o le falta
  contexto para conclusiones firmes, decilo explícitamente.
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
- Cuando compares cifras o presentes datos tabulares (de un archivo adjunto
  o de la conversación), usá una tabla en Markdown en vez de describir los
  números en un párrafo.
- Cuando una serie de datos numéricos se entienda mucho mejor con un
  gráfico (evolución en el tiempo, comparación entre categorías,
  composición de un total), generá un bloque de código de lenguaje "chart"
  que contenga EXCLUSIVAMENTE un objeto JSON válido, sin comentarios ni
  texto extra, con esta forma exacta:
  \`\`\`chart
  {"type":"bar","title":"Título breve","labels":["Ene","Feb","Mar"],"datasets":[{"label":"Ventas","data":[100,120,90]}]}
  \`\`\`
  "type" puede ser "bar", "line", "pie" o "doughnut". Podés incluir más de
  un "dataset" si hay varias series comparables. Usá como máximo 2 gráficos
  por respuesta, y solo cuando realmente aporten valor — no decores
  respuestas simples con gráficos innecesarios.
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
// Subida de archivos
// -----------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Sube un archivo binario (PDF o imagen) a la Files API de Gemini y
// devuelve su URI, para poder referenciarlo en generateContent sin
// tener que reenviar los bytes completos en cada mensaje.
async function uploadToGeminiFiles(buffer, mimeType, displayName) {
  const numBytes = buffer.length;

  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(numBytes),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    }
  );

  if (!startRes.ok) {
    throw new Error("No se pudo iniciar la subida del archivo a Gemini");
  }
  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini no devolvió una URL de subida");

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(numBytes),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    throw new Error("No se pudo completar la subida del archivo a Gemini");
  }

  const data = await uploadRes.json();
  let fileInfo = data.file;

  // Si el archivo todavía se está procesando, esperamos un poco (breve)
  let attempts = 0;
  while (fileInfo?.state === "PROCESSING" && attempts < 6) {
    await new Promise((r) => setTimeout(r, 1000));
    const checkRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileInfo.name}?key=${API_KEY}`
    );
    fileInfo = await checkRes.json();
    attempts++;
  }

  if (fileInfo?.state === "FAILED") {
    throw new Error("Gemini no pudo procesar el archivo subido");
  }

  return { uri: fileInfo.uri, mimeType: fileInfo.mimeType };
}

// Convierte un Excel/CSV a texto plano (CSV por hoja) para mandarlo como
// contexto de texto — Gemini no lee binarios de Excel directamente.
function extractSpreadsheetText(buffer, isCsv) {
  const workbook = isCsv
    ? XLSX.read(buffer.toString("utf-8"), { type: "string" })
    : XLSX.read(buffer, { type: "buffer" });

  let out = "";
  workbook.SheetNames.forEach((name) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
    out += `--- Hoja: ${name} ---\n${csv}\n\n`;
  });

  const MAX_CHARS = 40000;
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS) + "\n\n[...contenido truncado por longitud...]";
  }
  return out.trim();
}

app.post("/api/upload", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      const msg =
        err.code === "LIMIT_FILE_SIZE"
          ? "El archivo supera el límite de 20MB."
          : "No se pudo procesar el archivo.";
      return res.status(400).json({ error: msg });
    }
    if (!API_KEY) {
      return res.status(500).json({ error: "El servidor no tiene configurada GEMINI_API_KEY." });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No se recibió ningún archivo." });
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype || "";

    const isImage = mime.startsWith("image/");
    const isPdf = mime === "application/pdf" || ext === ".pdf";
    const isExcel =
      [".xlsx", ".xls"].includes(ext) ||
      mime.includes("spreadsheet") ||
      mime === "application/vnd.ms-excel";
    const isCsv = ext === ".csv" || mime === "text/csv";

    try {
      if (isImage || isPdf) {
        const uploaded = await uploadToGeminiFiles(
          file.buffer,
          mime || (isPdf ? "application/pdf" : "application/octet-stream"),
          file.originalname
        );
        return res.json({
          attachment: {
            kind: "file",
            uri: uploaded.uri,
            mimeType: uploaded.mimeType,
            name: file.originalname,
          },
        });
      }

      if (isExcel || isCsv) {
        const extractedText = extractSpreadsheetText(file.buffer, isCsv);
        return res.json({
          attachment: {
            kind: "text",
            extractedText,
            name: file.originalname,
          },
        });
      }

      return res.status(400).json({
        error: "Formato no soportado. Subí un PDF, Excel, CSV o imagen.",
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "No se pudo procesar el archivo." });
    }
  });
});

// -----------------------------------------------------------------------
// Endpoint de chat
// El frontend manda: { history: [{role, text, attachment?}, ...] }
// attachment: { kind: "file", uri, mimeType, name } | { kind: "text", extractedText, name }
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

    const contents = history.map((m) => {
      const parts = [];
      const att = m.attachment;

      if (m.role !== "assistant" && att) {
        if (att.kind === "file" && att.uri) {
          parts.push({ file_data: { mime_type: att.mimeType, file_uri: att.uri } });
        } else if (att.kind === "text" && att.extractedText) {
          parts.push({
            text: `Datos extraídos del archivo adjunto "${att.name}":\n\n${att.extractedText}`,
          });
        }
      }

      parts.push({ text: m.text });

      return {
        role: m.role === "assistant" ? "model" : "user",
        parts,
      };
    });

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

    const chunks = candidate?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
      .map((c) => c.web)
      .filter(Boolean)
      .map((w) => ({ title: w.title, uri: w.uri }))
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
