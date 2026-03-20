// =========================================================
// 📱 ChatBot – Chatbot de WhatsApp con flujo básico SkillMatch
// Node.js 22 con ESM y Firebase Functions
// =========================================================

// Importación de módulos principales
import { onRequest } from "firebase-functions/v2/https"; // Define una función HTTPS en Firebase
import * as logger from "firebase-functions/logger";      // Para registrar logs (info, error, etc.)
import { defineSecret } from "firebase-functions/params"; // Permite usar variables secretas seguras
import axios from "axios";                                // Cliente HTTP (para enviar mensajes a WhatsApp)

// =========================================================
// 🔐 SECRETS (valores sensibles, definidos en Firebase)
// =========================================================
// Cada uno corresponde a un valor almacenado en Firebase Secrets Manager.
// Así evitamos exponer contraseñas o tokens en el código.

const VERIFY_TOKEN = defineSecret("VERIFY_TOKEN_SKILLMATCH");// 190326
const WHATSAPP_TOKEN = defineSecret("WHATSAPP_TOKEN_SKILLMATCH");// EAAcNEJpDlf4BQ11kLKGdOTqI7xm78CVNCVWS7ZArvuak3kc5B32rwBkpRXwnIp6Bb8Vt8C2yWeL5i36674w0OIVUixLOvRug2SbNLRGgemZAV1zBe9rL96TPbZCpn4PHG8bbkr7i1zvyuokTHyQDwofYoY3MJhYNNN8HNbU2LnZBREff7gcRgvGV9fDLOkIXTwZDZD
const WHATSAPP_PHONE_NUMBER_ID = defineSecret("WHATSAPP_PHONE_NUMBER_ID_SKILLMATCH"); //  1109457215574133 o 961671560047525


// Configuración de conexión a base de datos MySQL
const DB_HOST = defineSecret("DB_HOST_SKILLMATCH"); //ejercitodigital.com.mx
const DB_USER = defineSecret("DB_USER_SKILLMATCH"); //ejercito_prueba
const DB_PASSWORD = defineSecret("DB_PASSWORD_SKILLMATCH"); //Bkb(}MDhBLCN
const DB_NAME = defineSecret("DB_NAME_SKILLMATCH"); //ejercito_prueba

// =========================================================
// 🗄️ CONEXIÓN A MYSQL (Pool Lazy)
// =========================================================
// Se crea un pool de conexiones reutilizable (lazy), lo que optimiza el rendimiento
// evitando reconexiones constantes cada vez que se procesa un mensaje.

let pool = null;
function getPool(cfg) {
  if (!pool) {
    pool = mysql.createPool({
      host: cfg.DB_HOST,
      user: cfg.DB_USER,
      password: cfg.DB_PASSWORD,
      database: cfg.DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      timezone: "Z", // UTC (evita desfases de hora)
    });
  }
  return pool;
}

// =========================================================
// 💬 FUNCIONES PARA ENVIAR MENSAJES POR WHATSAPP
// =========================================================
// Usa la Graph API v20.0 para enviar mensajes desde el bot al usuario.

const WA_API = (phoneNumberId) =>
  `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

const waHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

// Envía un mensaje de texto simple
async function sendWhatsAppText({ to, text, token, phoneNumberId }) {
  await axios.post(
    WA_API(phoneNumberId),
    { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
    { headers: waHeaders(token), timeout: 15000 }
  );
}

// Envía un mensaje interactivo tipo LISTA (hasta 10 opciones)
async function sendWhatsAppList({ to, token, phoneNumberId, headerText, bodyText, buttonText, sections }) {
  await axios.post(
    WA_API(phoneNumberId),
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        header: { type: "text", text: headerText },
        body: { text: bodyText },
        action: { button: buttonText, sections },
      },
    },
    { headers: waHeaders(token), timeout: 15000 }
  );
}

// Envía un mensaje interactivo tipo BOTONES (hasta 3 botones)
async function sendWhatsAppButtons({ to, token, phoneNumberId, bodyText, buttons }) {
  await axios.post(
    WA_API(phoneNumberId),
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    },
    { headers: waHeaders(token), timeout: 15000 }
  );
}

// =========================================================
// 🚀 WEBHOOK PRINCIPAL - CHATBOT
// =========================================================
// Esta función maneja las peticiones de Meta (Webhook):
// - Verifica el token (GET)
// - Flujo conversacional básico de SkillMatch (POST)

// Estado de conversación en memoria (se reinicia al redesplegar)
const userState = {};

// Respuestas fijas por ID de opción
const RESPUESTAS = {
  opcion_fechas:
    "📅 La estadía inicia el *15 de abril* y termina el *15 de julio*.",
  opcion_horarios:
    "🕘 Servicios escolares atiende de *lunes a viernes* de *9:00 a 14:00 hrs* y de *16:00 a 18:00 hrs*.",
  opcion_faq:
    `📋 *Preguntas frecuentes:*\n\n` +
    `❓ *¿Cómo registro mi empresa?*\n→ Envía tus datos a Vinculación.\n\n` +
    `❓ *¿Qué pasa si no tengo empresa?*\n→ Tu profesor te asignará un proyecto.\n\n` +
    `❓ *¿Dónde consulto mis calificaciones?*\n→ En el portal institucional.`,
  opcion_profes:
    `👨‍🏫 *Horarios de profesores:*\n\n` +
    `• *Profesor López:* lunes y miércoles 10:00–12:00\n` +
    `• *Profesor Martínez:* martes y jueves 14:00–16:00`,
};

// Secciones de la lista interactiva del menú
const MENU_SECTIONS = [
  {
    title: "Opciones",
    rows: [
      { id: "opcion_fechas",   title: "📅 Fechas de estadía",  description: "Inicio y fin de la estadía" },
      { id: "opcion_horarios", title: "🕘 Horarios servicios",  description: "Horarios de servicios escolares" },
      { id: "opcion_faq",      title: "📋 Preguntas frecuentes", description: "Dudas comunes de estudiantes" },
      { id: "opcion_profes",   title: "👨‍🏫 Profesores",         description: "Horarios de profesores" },
    ],
  },
];

// Botones de cierre (sí / no)
const CIERRE_BUTTONS = [
  { id: "cierre_si", title: "✅ Sí" },
  { id: "cierre_no", title: "❌ No" },
];

// ─── Envía el menú principal como lista interactiva ───
async function enviarMenu({ to, token, phoneNumberId }) {
  await sendWhatsAppList({
    to, token, phoneNumberId,
    headerText: "SkillMatch 🎓",
    bodyText: "¡Bienvenido! ¿Qué deseas consultar? Selecciona una opción:",
    buttonText: "Ver opciones",
    sections: MENU_SECTIONS,
  });
}

// ─── Envía respuesta + botones sí/no ───
async function enviarRespuestaConCierre({ to, token, phoneNumberId, textoRespuesta }) {
  await sendWhatsAppButtons({
    to, token, phoneNumberId,
    bodyText: textoRespuesta + "\n\n¿Quieres consultar otra opción?",
    buttons: CIERRE_BUTTONS,
  });
}

// ─── Procesa el mensaje y ejecuta las acciones correspondientes ───
async function handleMessage({ from, msg, token, phoneNumberId }) {
  const estado = userState[from] || "inicio";

  // Extraer el ID/texto según el tipo de mensaje
  let seleccionId = null;
  let textoLibre = null;

  if (msg.type === "interactive") {
    // Respuestas de lista o botones
    seleccionId =
      msg.interactive?.list_reply?.id ||
      msg.interactive?.button_reply?.id ||
      null;
  } else if (msg.type === "text") {
    textoLibre = msg.text.body.trim().toLowerCase();
  } else {
    return; // Ignora otros tipos (imagen, audio, etc.)
  }

  // --- Estado: esperando confirmación sí/no ---
  if (estado === "esperando_cierre") {
    if (seleccionId === "cierre_no" || textoLibre === "no" || textoLibre === "salir") {
      delete userState[from];
      await sendWhatsAppText({ to: from, token, phoneNumberId, text: "Gracias por usar *SkillMatch*. ¡Éxito en tu estadía! 🎉" });
      return;
    }
    // Cualquier otra cosa (sí, botón, texto) → volver al menú
    userState[from] = "menu";
    await enviarMenu({ to: from, token, phoneNumberId });
    return;
  }

  // --- Selección de una opción del menú (lista interactiva) ---
  if (seleccionId && RESPUESTAS[seleccionId]) {
    userState[from] = "esperando_cierre";
    await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: RESPUESTAS[seleccionId] });
    return;
  }

  // --- Cualquier texto o saludo → mostrar menú ---
  userState[from] = "menu";
  await enviarMenu({ to: from, token, phoneNumberId });
}

export const whatsappWebhookSkillMatch = onRequest(
  {
    cors: true,
    region: "us-central1",
    secrets: [VERIFY_TOKEN, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID],
  },
  async (req, res) => {
    // Carga las variables desde los secrets
    const cfg = {
      VERIFY_TOKEN: VERIFY_TOKEN.value(),
      WHATSAPP_TOKEN: WHATSAPP_TOKEN.value(),
      WHATSAPP_PHONE_NUMBER_ID: WHATSAPP_PHONE_NUMBER_ID.value(),
    };

    // === Fase 1: Verificación inicial de Meta (GET)
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      // Meta verifica que el endpoint es válido devolviendo "challenge"
      return mode === "subscribe" && token === cfg.VERIFY_TOKEN
        ? res.status(200).send(challenge)
        : res.sendStatus(403);
    }

    // === Fase 2: Procesamiento de mensajes entrantes (POST)
    try {
      const body = req.body;
      logger.info("Webhook body", body);

      // Ignora notificaciones de "status" (mensajes entregados, leídos, etc.)
      const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;
      if (Array.isArray(statuses) && statuses.length) return res.sendStatus(200);

      // Extrae mensaje y número del remitente
      const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
      const from = messages?.[0]?.from;
      if (!messages || !from) return res.sendStatus(200);

      const token = cfg.WHATSAPP_TOKEN;
      const phoneNumberId = cfg.WHATSAPP_PHONE_NUMBER_ID;
      const msg = messages[0];

      // Ignora tipos que no sean texto ni interactivo
      if (!msg || (msg.type !== "text" && msg.type !== "interactive")) {
        return res.sendStatus(200);
      }

      // Procesar mensaje según el flujo conversacional
      await handleMessage({ from, msg, token, phoneNumberId });

      return res.sendStatus(200);
    } catch (err) {
      // Manejo de errores y log detallado
      logger.error("Error webhook:", err?.response?.data || err);
      return res.sendStatus(200);
    }
  }
);