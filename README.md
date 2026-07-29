# Agente Consultor Estratégico (Gemini 3.5 Flash)

Chat web con un agente de IA especializado en gestión empresarial, corriendo
sobre la API de Gemini 3.5 Flash de Google. La API key queda solo en el
servidor — nunca se expone a quien usa el chat.

## Estructura
```
agente-consultor/
├── server.js          # Backend Express (guarda la key y el prompt maestro)
├── package.json
├── .env.example        # Plantilla de variables de entorno
└── public/
    └── index.html       # Interfaz de chat
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
Ahí definís personalidad, reglas y límites. El usuario del chat nunca puede
verlo ni sobreescribirlo — se manda por separado en cada llamada a la API
como `system_instruction`.

## 3. Publicarlo para que cualquiera pueda entrar

Para que otras personas accedan necesitás subir esto a un hosting. Opciones
simples y con capa gratuita:

- **Render** (render.com): "New Web Service" → conectá tu repo de GitHub →
  Build command `npm install`, Start command `npm start` → agregás
  `GEMINI_API_KEY` en la sección "Environment".
- **Railway** (railway.app): similar a Render, importás el repo y cargás la
  variable de entorno.
- **Fly.io / VPS propio**: si ya tenés más experiencia con despliegues.

Pasos generales:
1. Subí esta carpeta a un repositorio de GitHub.
2. Conectá ese repo con el hosting que elijas.
3. Configurá la variable de entorno `GEMINI_API_KEY` (y opcionalmente
   `GEMINI_MODEL`) en el panel del hosting — **nunca la subas al repo**.
4. Deploy. Te van a dar una URL pública (ej: `tu-agente.onrender.com`) que
   podés compartir con quien quieras.

## Seguridad y costos

- La key vive solo en el servidor (variable de entorno), así que quien entre
  al chat no puede verla ni robártela.
- Como es pública, cualquiera que tenga el link puede usarla y consumir tu
  cuota de la API. Si te preocupa el costo, más adelante se puede agregar:
  límite de mensajes por usuario, una contraseña simple, o un captcha.
- Revisá los precios de Gemini 3.5 Flash en la consola de Google AI Studio
  antes de compartir el link masivamente.
