// ChatBot SkillMatch — WhatsApp con Neurona ML integrada
// Node.js 22 con ESM y Firebase Functions

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import axios from "axios";
import mysql from "mysql2/promise";                              
import { entrenarClasificador, clasificar } from "./classifier.js"; // neurona ML

// SECRETS 
const VERIFY_TOKEN             = defineSecret("VERIFY_TOKEN_SKILLMATCH");
const WHATSAPP_TOKEN           = defineSecret("WHATSAPP_TOKEN_SKILLMATCH");
const WHATSAPP_PHONE_NUMBER_ID = defineSecret("WHATSAPP_PHONE_NUMBER_ID_SKILLMATCH");
const DB_HOST                  = defineSecret("DB_HOST_SKILLMATCH");
const DB_USER                  = defineSecret("DB_USER_SKILLMATCH");
const DB_PASSWORD              = defineSecret("DB_PASSWORD_SKILLMATCH");
const DB_NAME                  = defineSecret("DB_NAME_SKILLMATCH");
const ANTHROPIC_KEY            = defineSecret("ANTHROPIC_KEY_SKILLMATCH"); // claude

// NEURONA: se entrena una vez cuando Firebase carga el módulo
// Lee training_data.csv y aprende a clasificar mensajes
entrenarClasificador();

// CONEXIÓN A MYSQL (Pool Lazy — igual que ya lo tenías)
let pool = null;
function getPool(cfg) {
  if (!pool) {
    pool = mysql.createPool({
      host:     cfg.DB_HOST,
      user:     cfg.DB_USER,
      password: cfg.DB_PASSWORD,
      database: cfg.DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      timezone: "Z",
    });
  }
  return pool;
}

// FUNCIONES WHATSAPP (exactamente las mismas que tenías)
const WA_API = (phoneNumberId) =>
  `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

const waHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

async function sendWhatsAppText({ to, text, token, phoneNumberId }) {
  await axios.post(
    WA_API(phoneNumberId),
    { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
    { headers: waHeaders(token), timeout: 15000 }
  );
}

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
        body:   { text: bodyText },
        action: { button: buttonText, sections },
      },
    },
    { headers: waHeaders(token), timeout: 15000 }
  );
}

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

// MENU PRINCIPAL 
const MENU_SECTIONS = [
  {
    title: "Opciones",
    rows: [
      { id: "opcion_fechas",    title: "📅 Fechas de estadía",    description: "Inicio y fin de la estadía" },
      { id: "opcion_horarios",  title: "🕘 Horarios servicios",    description: "Horarios de servicios escolares" },
      { id: "opcion_faq",       title: "📋 Preguntas frecuentes",  description: "Dudas comunes de estudiantes" },
      { id: "opcion_profes",    title: "👨‍🏫 Profesores",           description: "Horarios de profesores" },
      { id: "opcion_proyectos", title: "📁 Mis proyectos",         description: "Tus proyectos en SkillMatch" },  
      { id: "opcion_matching",  title: "🔍 Buscar tecnología",     description: "Empresas o estudiantes" },        
    ],
  },
];

// Botones 
const CIERRE_BUTTONS = [
  { id: "cierre_si", title: "✅ Sí" },
  { id: "cierre_no", title: "❌ No" },
];

async function enviarMenu({ to, token, phoneNumberId }) {
  await sendWhatsAppList({
    to, token, phoneNumberId,
    headerText: "SkillMatch 🎓",
    bodyText:   "¡Bienvenido! ¿Qué deseas consultar?\nSelecciona una opción o escribe tu pregunta directamente.",
    buttonText: "Ver opciones",
    sections:   MENU_SECTIONS,
  });
}

async function enviarRespuestaConCierre({ to, token, phoneNumberId, textoRespuesta }) {
  await sendWhatsAppButtons({
    to, token, phoneNumberId,
    bodyText: textoRespuesta + "\n\n¿Quieres consultar otra opción?",
    buttons:  CIERRE_BUTTONS,
  });
}

// CONSULTAS A BASE DE DATOS  

// Busca al usuario por su número de WhatsApp
// REQUISITO: correr este SQL una sola vez en tu BD:
// ALTER TABLE usuarios ADD COLUMN telefono VARCHAR(20) NULL;
async function identificarUsuario(telefono, db) {
  const [rows] = await db.execute(
    `SELECT u.id_usuario, u.nombre, u.apellido, u.id_rol, r.nombre_rol AS rol
     FROM usuarios u
     JOIN roles r ON u.id_rol = r.id_rol
     WHERE u.telefono = ? AND u.estado = 'activo'
     LIMIT 1`,
    [telefono]
  );
  return rows[0] || null;
}

// Proyectos del estudiante
async function obtenerProyectosEstudiante(id_usuario, db) {
  const [rows] = await db.execute(
    `SELECT p.titulo, p.tecnologias, p.estado, p.fecha_registro
     FROM proyectos p
     JOIN estudiantes e ON p.id_estudiante = e.id_estudiante
     WHERE e.id_usuario = ?
     ORDER BY p.fecha_registro DESC`,
    [id_usuario]
  );
  return rows;
}

// Estudiantes que tienen proyectos con cierta tecnología (para empresas)
async function buscarEstudiantesPorTecnologia(tecnologia, db) {
  const [rows] = await db.execute(
    `SELECT u.nombre, u.apellido, e.carrera,
            GROUP_CONCAT(p.titulo SEPARATOR ', ') AS proyectos
     FROM usuarios u
     JOIN estudiantes e ON u.id_usuario = e.id_usuario
     JOIN proyectos p ON e.id_estudiante = p.id_estudiante
     WHERE p.tecnologias LIKE CONCAT('%', ?, '%')
       AND u.estado = 'activo'
     GROUP BY u.id_usuario
     LIMIT 5`,
    [tecnologia]
  );
  return rows;
}

// CLAUDE API — Responde preguntas abiertas (FAQ)  
async function preguntarAClaude(pregunta, apiKey) {
  const DOCUMENTO = `
Eres el asistente virtual de SkillMatch, plataforma de la UTEQ (Universidad Tecnológica de Querétaro).

INFORMACIÓN INSTITUCIONAL:
- La estadía profesional es obligatoria para titulación y dura entre 4 y 6 meses.
- Las fechas de inicio y fin varían cada periodo y siempre inician en día hábil.
- Para iniciar estadía se necesita carta de presentación firmada y aceptación de la empresa.
- Si el estudiante no tiene empresa, puede acudir a Vinculación en la UTEQ.
- Las calificaciones de estadía las registra el asesor de la escuela, no en SkillMatch.
- SkillMatch es repositorio de proyectos innovadores y plataforma de matching empresa-estudiante.
- Para dudas formales, acudir a Servicios Escolares o Vinculación.

Responde en español mexicano, breve, claro y amable.
No inventes información que no esté aquí.
  `.trim();

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model:      "claude-sonnet-4-20250514",
      max_tokens: 400,
      system:     DOCUMENTO,
      messages:   [{ role: "user", content: pregunta }],
    },
    {
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type":      "application/json",
      },
      timeout: 20000,
    }
  );

  return response.data.content[0]?.text ||
    "No pude procesar tu pregunta. Acude a Servicios Escolares.";
}

// MANEJADOR DE MENSAJES — handleMessage
// Estructura base 
const userState = {};

async function handleMessage({ from, msg, token, phoneNumberId, cfg, db }) {
  const estado = userState[from] || "inicio";

  // Extraer ID o texto 
  let seleccionId = null;
  let textoLibre  = null;

  if (msg.type === "interactive") {
    seleccionId =
      msg.interactive?.list_reply?.id ||
      msg.interactive?.button_reply?.id ||
      null;
  } else if (msg.type === "text") {
    textoLibre = msg.text.body.trim();
  } else {
    return;
  }

  // Estado: esperando sí/no
  if (estado === "esperando_cierre") {
    if (
      seleccionId === "cierre_no" ||
      textoLibre?.toLowerCase() === "no" ||
      textoLibre?.toLowerCase() === "salir"
    ) {
      delete userState[from];
      await sendWhatsAppText({
        to: from, token, phoneNumberId,
        text: "Gracias por usar *SkillMatch*. ¡Éxito en tu estadía! 🎉",
      });
      return;
    }
    userState[from] = "menu";
    await enviarMenu({ to: from, token, phoneNumberId });
    return;
  }

  // Estado: esperando tecnología para matching 
  if (estado === "esperando_tecnologia") {
    if (!textoLibre) {
      await sendWhatsAppText({
        to: from, token, phoneNumberId,
        text: "Por favor escribe la tecnología que buscas (ej: React, Node.js, MySQL...)",
      });
      return;
    }

    const usuario = userState[`${from}_usuario`];
    let respuesta = "";

    if (usuario?.rol === "empresa") {
      const estudiantes = await buscarEstudiantesPorTecnologia(textoLibre, db);
      if (estudiantes.length === 0) {
        respuesta = `No encontré estudiantes con proyectos en *${textoLibre}* por el momento.`;
      } else {
        respuesta = `👨‍💻 *Estudiantes con proyectos en ${textoLibre}:*\n\n`;
        for (const e of estudiantes) {
          respuesta += `• *${e.nombre} ${e.apellido}* — ${e.carrera}\n  Proyectos: ${e.proyectos}\n\n`;
        }
      }
    } else {
      respuesta =
        `🏢 Para ver empresas que buscan *${textoLibre}*, visita el portal SkillMatch.\n\n` +
        `También puedes acudir a Vinculación para que te orienten.`;
    }

    delete userState[`${from}_usuario`];
    userState[from] = "esperando_cierre";
    await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: respuesta });
    return;
  }

  // AQUÍ ENTRA LA NEURONA
  // Botones del menú → intención directa (sin neurona)
  // Texto libre      → neurona clasifica la intención

  const mapaMenu = {
    opcion_fechas:    "fechas",
    opcion_horarios:  "horarios",
    opcion_faq:       "faq",
    opcion_profes:    "horarios",        // profesores va a la misma acción
    opcion_proyectos: "mis_proyectos",
    opcion_matching:  "buscar_matching",
  };

  let intencion;
  let necesitaMenu = false;

  if (seleccionId && mapaMenu[seleccionId]) {
    // Opción del menú presionada — intención 100% segura
    intencion = mapaMenu[seleccionId];

  } else if (textoLibre) {
    // NEURONA: clasifica el texto libre del usuario
    const resultado = clasificar(textoLibre);
    intencion    = resultado.intencion;
    necesitaMenu = resultado.necesitaMenu;

    logger.info("Neurona clasificó:", {
      texto:     textoLibre,
      intencion,
      confianza: resultado.confianza,
    });

  } else {
    await enviarMenu({ to: from, token, phoneNumberId });
    return;
  }

  // Si la neurona no está segura → menú
  if (necesitaMenu) {
    userState[from] = "menu";
    await enviarMenu({ to: from, token, phoneNumberId });
    return;
  }

  // Identificar usuario en BD (falla silenciosa, no bloquea el bot)
  let usuario = null;
  try {
    usuario = await identificarUsuario(from, db);
  } catch (e) {
    logger.warn("No se pudo identificar usuario:", e.message);
  }

  // ── ENRUTAMIENTO POR INTENCIÓN ────────────────────────
  switch (intencion) {

    case "fechas": {
      // TODO: leer de BD cuando tengas tabla estadias_config
      const texto =
        "📅 *Fechas de estadía 2025–2026:*\n\n" +
        "• *Inicio:* lunes 14 de abril de 2025\n" +
        "• *Fin:* viernes 18 de julio de 2025\n" +
        "• *Duración:* 480 hrs (IDGS) | 420 hrs (otras carreras)\n\n" +
        "_Las fechas siempre inician en día hábil._";
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
      break;
    }

    case "horarios": {
      let texto =
        "🕘 *Horarios de atención:*\n\n" +
        "*Servicios Escolares:*\nLun–Vie: 9:00–14:00 y 16:00–18:00\n\n" +
        "*Vinculación:*\nLun–Vie: 9:00–15:00\n\n";
      try {
        const [rows] = await db.execute(
          `SELECT titulo, descripcion FROM horarios_profesores LIMIT 3`
        );
        if (rows.length > 0) {
          texto += "*Profesores (recientes):*\n";
          for (const h of rows) {
            texto += `• ${h.titulo}: ${h.descripcion || "ver plataforma"}\n`;
          }
        } else {
          texto += "*Profesores:* Consulta el directorio en la plataforma SkillMatch.";
        }
      } catch {
        texto += "*Profesores:* Consulta el directorio en la plataforma SkillMatch.";
      }
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
      break;
    }

    case "mis_proyectos": {
      if (!usuario) {
        const texto =
          "Para ver tus proyectos necesito identificarte. 🔐\n\n" +
          "Asegúrate de que tu número de WhatsApp esté registrado en SkillMatch.";
        userState[from] = "esperando_cierre";
        await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
        break;
      }
      const proyectos = await obtenerProyectosEstudiante(usuario.id_usuario, db);
      if (proyectos.length === 0) {
        const texto = `Hola *${usuario.nombre}*, aún no tienes proyectos subidos. 📁\nPuedes subirlos desde la plataforma web.`;
        userState[from] = "esperando_cierre";
        await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
        break;
      }
      let texto = `📁 *Tus proyectos, ${usuario.nombre}:*\n\n`;
      for (const p of proyectos) {
        const e = p.estado === "completado" ? "✅" : p.estado === "en progreso" ? "🔄" : "⏸️";
        texto += `${e} *${p.titulo}*\n   Tecnologías: ${p.tecnologias || "no especificadas"}\n\n`;
      }
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
      break;
    }

    case "buscar_matching": {
      userState[from]              = "esperando_tecnologia";
      userState[`${from}_usuario`] = usuario;
      const prompt = usuario?.rol === "empresa"
        ? "🔍 ¿Qué tecnología buscan en sus candidatos?\n\nEscribe el nombre (ej: *React*, *Node.js*, *MySQL*...)"
        : "🔍 ¿Qué tecnología quieres buscar?\n\nEscribe el nombre (ej: *React*, *Node.js*, *MySQL*...)";
      await sendWhatsAppText({ to: from, token, phoneNumberId, text: prompt });
      break;
    }

    case "faq": {
      let respuesta;
      try {
        const pregunta = textoLibre || "información general sobre la estadía";
        respuesta = await preguntarAClaude(pregunta, cfg.ANTHROPIC_KEY);
      } catch (e) {
        logger.error("Error Claude API:", e.message);
        respuesta =
          "Lo siento, no pude procesar tu pregunta ahora. 😔\n\n" +
          "Acude a *Servicios Escolares* o *Vinculación* para más información.";
      }
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: respuesta });
      break;
    }

    case "menu":
    default: {
      userState[from] = "menu";
      await enviarMenu({ to: from, token, phoneNumberId });
      break;
    }
  }
}

// WEBHOOK PRINCIPAL 
export const whatsappWebhookSkillMatch = onRequest(
  {
    cors: true,
    region: "us-central1",
    secrets: [
      VERIFY_TOKEN,
      WHATSAPP_TOKEN,
      WHATSAPP_PHONE_NUMBER_ID,
      DB_HOST, DB_USER, DB_PASSWORD, DB_NAME,
      ANTHROPIC_KEY,
    ],
  },
  async (req, res) => {
    const cfg = {
      VERIFY_TOKEN:             VERIFY_TOKEN.value(),
      WHATSAPP_TOKEN:           WHATSAPP_TOKEN.value(),
      WHATSAPP_PHONE_NUMBER_ID: WHATSAPP_PHONE_NUMBER_ID.value(),
      DB_HOST:                  DB_HOST.value(),
      DB_USER:                  DB_USER.value(),
      DB_PASSWORD:              DB_PASSWORD.value(),
      DB_NAME:                  DB_NAME.value(),
      ANTHROPIC_KEY:            ANTHROPIC_KEY.value(),
    };

    // GET: verificación Meta 
    if (req.method === "GET") {
      const mode      = req.query["hub.mode"];
      const token     = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      return mode === "subscribe" && token === cfg.VERIFY_TOKEN
        ? res.status(200).send(challenge)
        : res.sendStatus(403);
    }

    // POST: mensajes entrantes 
    try {
      const body = req.body;
      logger.info("Webhook body", body);

      const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;
      if (Array.isArray(statuses) && statuses.length) return res.sendStatus(200);

      const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
      const from     = messages?.[0]?.from;
      if (!messages || !from) return res.sendStatus(200);

      const token         = cfg.WHATSAPP_TOKEN;
      const phoneNumberId = cfg.WHATSAPP_PHONE_NUMBER_ID;
      const msg           = messages[0];

      if (!msg || (msg.type !== "text" && msg.type !== "interactive")) {
        return res.sendStatus(200);
      }

      const db = getPool(cfg);
      await handleMessage({ from, msg, token, phoneNumberId, cfg, db });

      return res.sendStatus(200);
    } catch (err) {
      logger.error("Error webhook:", err?.response?.data || err);
      return res.sendStatus(200);
    }
  }
);