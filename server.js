// server.js
// Backend Express: guarda la API key y el prompt maestro, llama a Groq
// (API compatible con OpenAI) con acceso a búsqueda web en vivo (modelo
// groq/compound) y a archivos adjuntos (PDF/Excel/CSV/imágenes), y
// devuelve texto + fuentes citadas.

import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import * as XLSX from "xlsx";
import pdfParse from "pdf-parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Modelo de texto con búsqueda web incorporada (decide solo cuándo buscar
// y devuelve las fuentes que usó). Ver https://console.groq.com/docs/compound
const TEXT_MODEL = process.env.GROQ_TEXT_MODEL || "groq/compound";

// Modelo con visión, para cuando el usuario adjunta una imagen. Los
// modelos "compound" no procesan imágenes, así que para ese caso se usa
// un Llama 4 multimodal en su lugar (pierde la búsqueda web en ese turno).
const VISION_MODEL =
  process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-maverick-17b-128e-instruct";

if (!API_KEY) {
  console.warn(
    "⚠️  No se encontró GROQ_API_KEY en las variables de entorno. " +
      "El chat no va a funcionar hasta que la configures (ver README)."
  );
}

// -----------------------------------------------------------------------
// PROMPT MAESTRO
// Identidad fija del agente. Se manda en cada request como mensaje
// "system", así que el usuario del chat nunca puede sobreescribirla.
// Editá este texto para ajustar personalidad, profundidad y reglas.
// -----------------------------------------------------------------------
const MASTER_PROMPT = `
Sos un Consultor Senior y Asesor Estratégico en Gestión Empresarial, con más de
20 años de experiencia asesorando a dueños de PyMEs, gerentes y equipos
directivos en Latinoamérica. Respondés con el rigor y la claridad de un
socio senior de una firma de consultoría top — pero explicando todo de forma
didáctica, como si le enseñaras el razonamiento a alguien que quiere aprender
a pensar así por sí mismo, no solo recibir la respuesta.

## Tu rol
- Ayudás a pensar estrategia, estructura organizacional, finanzas de negocio,
  operaciones, marketing, financiamiento y toma de decisiones gerenciales.
- Tenés acceso a búsqueda web en tiempo real y la usás activamente cuando la
  respuesta dependa de información que cambia con el tiempo: programas de
  financiamiento públicos (CORFO, SERCOTEC, BancoEstado, etc.), tasas de
  interés, normativa vigente, requisitos de trámites, datos de mercado o de
  la competencia, noticias del sector. No inventes cifras ni links: basá la
  respuesta en lo que encontraste; si no encontraste algo, decilo con
  honestidad en vez de asumir.
- El usuario puede adjuntar archivos: PDF, planillas de Excel/CSV o imágenes
  (fotos de balances, capturas de pantalla, gráficos, fotos de un local,
  etc.). Cuando haya un archivo adjunto, analizalo a fondo antes de
  responder: extraé los datos y cifras relevantes, identificá tendencias,
  riesgos u oportunidades, y fundamentá tu diagnóstico en lo que realmente
  ves en el archivo, nunca en suposiciones. Si el archivo es ilegible, está
  incompleto o le falta contexto para conclusiones firmes, decilo
  explícitamente. Nota interna: cuando el turno incluye una imagen, no
  tenés acceso a búsqueda web en simultáneo — si hace falta un dato externo
  para completar el análisis, decilo y proponé buscarlo en el próximo
  mensaje sin la imagen.
- Hacés preguntas de diagnóstico antes de aconsejar cuando falta contexto
  clave (tamaño de la empresa, industria, objetivo, presupuesto, plazo),
  pero sin transformar la conversación en un interrogatorio: máximo 1-2
  preguntas por vez, y solo cuando de verdad cambian la recomendación.
- Das recomendaciones concretas y accionables, nunca genéricas ni de
  relleno. Preferís frameworks reconocidos (FODA, 5 fuerzas de Porter, OKR,
  Lean, unit economics, matriz de Eisenhower, etc.) cuando aplican de
  verdad — y cuando los usás, explicás en una línea qué es y por qué lo
  elegiste, para que el framework enseñe, no para lucirte con jerga.
- Sos honesto sobre riesgos, trade-offs y los límites de tu consejo. No das
  asesoramiento legal, contable o impositivo vinculante — para eso sugerís
  consultar a un profesional matriculado, pero podés dar una orientación
  general de negocio.

## Cómo pensar antes de responder (calidad "consultora top")
- Priorizá: si hay varias ideas, ordenalas por impacto/urgencia, no las
  listes todas al mismo nivel.
- Cuantificá cuando sea posible: si podés estimar un orden de magnitud
  (ahorro, plazo, ROI aproximado), hacelo y aclará que es una estimación.
- Anticipá la objeción obvia: si una recomendación tiene un riesgo evidente,
  nombralo vos antes de que lo pregunten, con cómo mitigarlo.
- Enseñá el "por qué", no solo el "qué": una o dos frases que expliquen la
  lógica detrás de una recomendación valen más que una lista larga de
  tácticas sueltas.

## Formato de respuesta
- Para diagnósticos o planes con varias partes, abrí con 2-3 líneas de
  **resumen ejecutivo** (la conclusión y el paso más importante), y recién
  después desarrollás el detalle. En respuestas cortas o conversacionales,
  no fuerces esta estructura — respondé directo.
- Usás Markdown con criterio: negritas para lo importante, listas cuando hay
  varios puntos, subtítulos (##) solo en respuestas largas o con varias
  secciones.
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
  automáticas que se muestran aparte.
- Cerrás respuestas de diagnóstico o plan con un **paso siguiente concreto**
  (qué hacer, con qué, en qué plazo), no con un resumen genérico.

## Estilo
- Tono profesional, cercano y directo, como una reunión de consultoría real,
  no un informe corporativo acartonado.
- Español rioplatense/latino neutro, claro y sin anglicismos innecesarios.
  Si usás un término técnico o en inglés que no todo dueño de PyME conoce,
  explicalo en paréntesis la primera vez.

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

// Convierte un Excel/CSV a texto plano (CSV por hoja) para mandarlo como
// contexto de texto.
function extractSpreadsheetText(buffer, isCsv) {
  const workbook = isCsv
    ? XLSX.read(buffer.toString("utf-8"), { type: "string" })
    : XLSX.read(buffer, { type: "buffer" });

  let out = "";
  workbook.SheetNames.forEach((name) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
    out += `--- Hoja: ${name} ---\n${csv}\n\n`;
  });

  const MAX_CHARS = 22000;
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS) + "\n\n[...contenido truncado por longitud...]";
  }
  return out.trim();
}

// Extrae el texto de un PDF (Groq no tiene una Files API para leer PDFs
// nativamente en el chat, así que se manda como contexto de texto, igual
// que Excel/CSV).
async function extractPdfText(buffer) {
  const data = await pdfParse(buffer);
  let out = (data.text || "").trim();

  if (!out) {
    return "[El PDF no tiene texto extraíble — probablemente sea un escaneo de imágenes sin OCR.]";
  }

  const MAX_CHARS = 22000;
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS) + "\n\n[...contenido truncado por longitud...]";
  }
  return out;
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
      if (isImage) {
        // Las imágenes se mandan como data URL base64 directamente en el
        // mensaje al modelo de visión — Groq no requiere (ni ofrece) una
        // subida previa a un storage propio para esto.
        const dataUrl = `data:${mime || "image/jpeg"};base64,${file.buffer.toString("base64")}`;
        return res.json({
          attachment: {
            kind: "image",
            dataUrl,
            mimeType: mime || "image/jpeg",
            name: file.originalname,
          },
        });
      }

      if (isPdf) {
        const extractedText = await extractPdfText(file.buffer);
        return res.json({
          attachment: {
            kind: "text",
            extractedText,
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
// attachment: { kind: "image", dataUrl, mimeType, name }
//           | { kind: "text", extractedText, name }
// -----------------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        error: "El servidor no tiene configurada GROQ_API_KEY. Revisá el archivo .env",
      });
    }

    const { history: fullHistory } = req.body;
    if (!Array.isArray(fullHistory) || fullHistory.length === 0) {
      return res.status(400).json({ error: "Falta el historial de la conversación" });
    }

    // Recortamos a los últimos turnos para no mandar una conversación
    // gigante en cada request (protege contra límites de tamaño/tokens de
    // la API y mantiene las respuestas rápidas y enfocadas).
    const MAX_HISTORY_MESSAGES = 16;
    const history = fullHistory.slice(-MAX_HISTORY_MESSAGES);

    // Si el mensaje MÁS RECIENTE con adjunto es una imagen, usamos el
    // modelo de visión para toda la conversación. Si no, usamos el modelo
    // compound, que busca en la web solo cuando hace falta.
    const attachedIndexes = history
      .map((m, i) => (m.role !== "assistant" && m.attachment ? i : -1))
      .filter((i) => i !== -1);
    const lastAttachedIndex = attachedIndexes.length ? attachedIndexes[attachedIndexes.length - 1] : -1;
    const hasImage = lastAttachedIndex !== -1 && history[lastAttachedIndex].attachment?.kind === "image";
    const model = hasImage ? VISION_MODEL : TEXT_MODEL;

    const messages = [{ role: "system", content: MASTER_PROMPT }];

    history.forEach((m, i) => {
      const role = m.role === "assistant" ? "assistant" : "user";
      const att = m.attachment;
      const isLastAttachment = i === lastAttachedIndex;

      // Un adjunto que ya no es el más reciente no vuelve a mandarse
      // completo (ni la imagen en base64 ni el texto extraído) — así no
      // se acumula peso turno tras turno. Solo dejamos una referencia
      // corta a que existió, por si el usuario lo menciona más adelante.
      if (role === "user" && att && !isLastAttachment) {
        const note = `[Adjuntó antes el archivo "${att.name}"; su contenido ya no se reenvía para no sobrecargar la conversación — si hace falta volver a analizarlo, pedile al usuario que lo adjunte de nuevo.]`;
        messages.push({ role, content: `${note}\n\nMensaje del usuario: ${m.text || ""}` });
        return;
      }

      if (role === "user" && isLastAttachment && att?.kind === "image" && att.dataUrl) {
        messages.push({
          role,
          content: [
            { type: "text", text: m.text || "Analizá esta imagen y contame lo más relevante para mi negocio." },
            { type: "image_url", image_url: { url: att.dataUrl } },
          ],
        });
        return;
      }

      if (role === "user" && isLastAttachment && att?.kind === "text" && att.extractedText) {
        messages.push({
          role,
          content: `Datos extraídos del archivo adjunto "${att.name}":\n\n${att.extractedText}\n\n---\n\nMensaje del usuario: ${m.text || "Analizá este archivo y contame lo más relevante para mi negocio."}`,
        });
        return;
      }

      messages.push({ role, content: m.text || "" });
    });

    const body = {
      model,
      messages,
      temperature: 0.6,
      max_completion_tokens: hasImage ? 4096 : 6000,
    };

    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      console.error("Error de Groq:", data);
      return res.status(groqRes.status).json({
        error: data?.error?.message || "Error llamando a la API de Groq",
      });
    }

    const message = data?.choices?.[0]?.message;
    const reply = message?.content || "No obtuve respuesta del modelo. Probá de nuevo.";

    // El modelo compound devuelve las herramientas que ejecutó (incluida
    // la búsqueda web) en executed_tools, con los resultados de búsqueda
    // adentro. De ahí sacamos las fuentes para mostrar como citas.
    const executedTools = message?.executed_tools || [];
    const rawResults = executedTools.flatMap((t) => t?.search_results?.results || t?.search_results || []);
    const sources = rawResults
      .map((r) => ({
        title: r.title || r.name || r.url || r.uri || r.link,
        uri: r.url || r.uri || r.link,
      }))
      .filter((s) => s.uri)
      .filter((s, i, arr) => arr.findIndex((x) => x.uri === s.uri) === i);

    res.json({ reply, sources });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// -----------------------------------------------------------------------
// Manejo de errores de body-parsing (ej: request demasiado grande o JSON
// mal formado). Sin esto, Express devuelve una página/mensaje genérico en
// inglés que el frontend no puede mostrar de forma clara.
// -----------------------------------------------------------------------
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({
      error:
        "El mensaje es demasiado pesado (probablemente por un archivo adjunto muy grande o una conversación muy larga). Probá con un archivo más chico o iniciá una conversación nueva.",
    });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "No se pudo interpretar la solicitud." });
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agente corriendo en http://localhost:${PORT}`);
});
