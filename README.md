# Agente Consultor Estratégico (Gemini 3.5 Flash)

Chat web con un agente de IA especializado en gestión empresarial, corriendo
sobre la API de Gemini 3.5 Flash de Google. Incluye:

- **Búsqueda web** (grounding con Google Search) con fuentes citadas.
- **Análisis de archivos**: PDF, Excel/CSV e imágenes.
- **Tablas y gráficos** generados automáticamente cuando los datos lo ameritan.

La API key queda solo en el servidor — nunca se expone a quien usa el chat.

## Estructura
```
agente-consultor/
├── server.js          # Backend Express (key, prompt maestro, subida de archivos)
├── package.json
├── .env.example         # Plantilla de variables de entorno
└── public/
    └── index.html        # Interfaz de chat
```

## 1. Probarlo en tu computadora

```bash
npm install
cp .env.example .env
```

Abrí `.env` y pegá tu API key de Google AI Studio:
```
GEMINI_API_KEY=AIza...tu_key_real
```

Después corré:
```bash
npm start
```

Y entrá a `http://localhost:3000`.

## 2. Editar el prompt maestro

El "cerebro" del agente está en `server.js`, en la constante `MASTER_PROMPT`.
Ahí definís personalidad, reglas, formato de tablas/gráficos y límites. El
usuario del chat nunca puede verlo ni sobreescribirlo.

## 3. Publicarlo para que cualquiera pueda entrar

Sigue siendo el mismo proceso: subir a GitHub y desplegar en Render, Railway,
etc., con la variable de entorno `GEMINI_API_KEY` configurada en el hosting.

## Cómo funciona el análisis de archivos

- **PDF e imágenes**: se suben a la Files API de Gemini (quedan disponibles
  por 48hs) y el modelo los analiza de forma nativa (lee texto, tablas,
  gráficos, fotos de documentos, etc.).
- **Excel/CSV**: se convierten en el servidor a texto (CSV por hoja) y se le
  pasan al modelo como contexto — Gemini no lee el binario de Excel
  directamente, pero sí interpreta muy bien los datos en formato texto.
- Límite de tamaño: **20MB** por archivo (configurable en `server.js`,
  variable `limits.fileSize` de multer).
- Si retomás una conversación guardada después de 48hs, las referencias a
  PDFs/imágenes antiguos pueden vencer del lado de Gemini — en ese caso,
  basta con volver a adjuntar el archivo.

## Cómo funcionan las tablas y gráficos

- Las **tablas** son Markdown estándar — el modelo las genera solo cuando
  corresponde, y el frontend las renderiza con estilo automáticamente.
- Los **gráficos** los arma el modelo emitiendo un bloque de código
  \`\`\`chart con un JSON (tipo de gráfico, etiquetas y series). El frontend
  lo detecta y lo dibuja con Chart.js. Si querés ajustar cuándo el agente
  decide graficar, editá la sección "Formato de respuesta" del
  `MASTER_PROMPT` en `server.js`.

## Seguridad y costos

- La key vive solo en el servidor (variable de entorno).
- Cualquiera con el link público puede usar el chat, adjuntar archivos y
  consumir tu cuota de la API — revisá los precios de Gemini 3.5 Flash antes
  de compartirlo masivamente. Si te preocupa, se puede agregar una
  contraseña simple de acceso o un límite de mensajes por usuario.
- Los archivos que suben los usuarios se envían a la API de Gemini para su
  análisis (según la política de datos de Google) — evitá usarlo para
  documentos con información extremadamente sensible sin revisar antes los
  términos de servicio de Gemini.
