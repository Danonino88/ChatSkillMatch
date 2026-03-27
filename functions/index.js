// =========================================================
// ChatBot SkillMatch — WhatsApp con Neurona ML + Claude API
// Node.js 22 con ESM y Firebase Functions
// Version 2 — conectado a BD real con vacantes y postulaciones
// =========================================================

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import axios from "axios";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { entrenarClasificador, clasificar } from "./classifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =========================================================
// SECRETS
// =========================================================
const VERIFY_TOKEN             = defineSecret("VERIFY_TOKEN_SKILLMATCH");
const WHATSAPP_TOKEN           = defineSecret("WHATSAPP_TOKEN_SKILLMATCH");
const WHATSAPP_PHONE_NUMBER_ID = defineSecret("WHATSAPP_PHONE_NUMBER_ID_SKILLMATCH");
const DB_HOST                  = defineSecret("DB_HOST_SKILLMATCH");
const DB_USER                  = defineSecret("DB_USER_SKILLMATCH");
const DB_PASSWORD              = defineSecret("DB_PASSWORD_SKILLMATCH");
const DB_NAME                  = defineSecret("DB_NAME_SKILLMATCH");
const ANTHROPIC_KEY            = defineSecret("ANTHROPIC_KEY_SKILLMATCH");

// =========================================================
// NEURONA: entrena una vez al arrancar Firebase
// =========================================================
entrenarClasificador();

// =========================================================
// CONEXIÓN MYSQL (Pool Lazy)
// =========================================================
let pool = null;
function getPool(cfg) {
  if (!pool) {
    pool = mysql.createPool({
      host:             cfg.DB_HOST,
      port:             4000,                          // TiDB Cloud Serverless
      user:             cfg.DB_USER,
      password:         cfg.DB_PASSWORD,
      database:         cfg.DB_NAME,
      waitForConnections: true,
      connectionLimit:  5,
      queueLimit:       0,
      timezone:         "Z",
      ssl:              { rejectUnauthorized: true },  // Requerido por TiDB Cloud
    });
  }
  return pool;
}

// =========================================================
// FUNCIONES WHATSAPP
// =========================================================
const WA_API    = (id) => `https://graph.facebook.com/v20.0/${id}/messages`;
const waHeaders = (token) => ({
  Authorization:  `Bearer ${token}`,
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
        type:   "list",
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
            type:  "reply",
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    },
    { headers: waHeaders(token), timeout: 15000 }
  );
}

// =========================================================
// MENÚ PRINCIPAL
// =========================================================
const MENU_SECTIONS = [
  {
    title: "Opciones",
    rows: [
      { id: "opcion_fechas",    title: "Fechas de estadia",    description: "Inicio y fin del periodo" },
      { id: "opcion_horarios",  title: "Horarios servicios",   description: "Servicios escolares y profesores" },
      { id: "opcion_faq",       title: "Preguntas frecuentes", description: "Dudas sobre la estadia" },
      { id: "opcion_profes",    title: "Profesores",           description: "Horarios de profesores" },
      { id: "opcion_proyectos", title: "Mis proyectos",        description: "Tus proyectos en SkillMatch" },
      { id: "opcion_matching",  title: "Buscar vacantes",      description: "Empresas o estudiantes" },
    ],
  },
];

const CIERRE_BUTTONS = [
  { id: "cierre_si", title: "Si" },
  { id: "cierre_no", title: "No" },
];

async function enviarMenu({ to, token, phoneNumberId }) {
  await sendWhatsAppList({
    to, token, phoneNumberId,
    headerText: "SkillMatch",
    bodyText:   "Bienvenido a SkillMatch! Que deseas consultar?\nSelecciona una opcion o escribe tu pregunta directamente.",
    buttonText: "Ver opciones",
    sections:   MENU_SECTIONS,
  });
}

async function enviarRespuestaConCierre({ to, token, phoneNumberId, textoRespuesta }) {
  await sendWhatsAppButtons({
    to, token, phoneNumberId,
    bodyText: textoRespuesta + "\n\nDeseas consultar algo mas?",
    buttons:  CIERRE_BUTTONS,
  });
}

// =========================================================
// CONSULTAS A BASE DE DATOS
// =========================================================

// Identifica al usuario por su numero de WhatsApp
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

// Vacantes abiertas filtradas por tecnologia (para estudiantes)
// Usa la tabla vacantes real de tu BD
async function buscarVacantesPorTecnologia(tecnologia, db) {
  const [rows] = await db.execute(
    `SELECT v.titulo, v.categoria, v.nivel, v.descripcion,
            e.razon_social, e.giro, e.contacto
     FROM vacantes v
     JOIN empresas e ON v.id_empresa = e.id_empresa
     WHERE (v.requisitos LIKE CONCAT('%', ?, '%')
         OR v.descripcion LIKE CONCAT('%', ?, '%')
         OR v.titulo LIKE CONCAT('%', ?, '%'))
       AND v.estado = 'abierta'
     LIMIT 5`,
    [tecnologia, tecnologia, tecnologia]
  );
  return rows;
}

// Estudiantes con proyectos en cierta tecnologia (para empresas)
async function buscarEstudiantesPorTecnologia(tecnologia, db) {
  const [rows] = await db.execute(
    `SELECT u.nombre, u.apellido, e.carrera, e.matricula,
            GROUP_CONCAT(p.titulo SEPARATOR ', ') AS proyectos,
            p.tecnologias
     FROM usuarios u
     JOIN estudiantes e ON u.id_usuario = e.id_usuario
     JOIN proyectos p   ON e.id_estudiante = p.id_estudiante
     WHERE p.tecnologias LIKE CONCAT('%', ?, '%')
       AND u.estado = 'activo'
     GROUP BY u.id_usuario
     LIMIT 5`,
    [tecnologia]
  );
  return rows;
}

// Documento institucional desde BD (tabla chatbot_config)
// El admin lo actualiza desde la web sin hacer deploy
async function obtenerDocumentoInstitucional(db) {
  try {
    const [rows] = await db.execute(
      `SELECT valor FROM chatbot_config WHERE clave = 'documento_institucional' LIMIT 1`
    );
    if (rows[0]?.valor) return rows[0].valor;
  } catch (e) {
    logger.warn("No se pudo leer chatbot_config, usando archivo local:", e.message);
  }

  // Fallback: lee el archivo .md local si la BD no tiene el documento
  const rutaDoc = path.join(__dirname, "documento_institucional.md");
  if (fs.existsSync(rutaDoc)) return fs.readFileSync(rutaDoc, "utf8");

  return "Eres el asistente virtual de SkillMatch de la UTEQ. Responde en espanol mexicano, breve y amable.";
}

// Guardar log de interaccion en tabla chatbot
async function guardarLog(pregunta, respuesta, categoria, id_usuario, db) {
  try {
    await db.execute(
      `INSERT INTO chatbot (pregunta, respuesta, categoria) VALUES (?, ?, ?)`,
      [pregunta.substring(0, 255), respuesta.substring(0, 500), categoria]
    );
  } catch (e) {
    logger.warn("No se pudo guardar log:", e.message);
  }
}

// =========================================================
// CLAUDE API
// =========================================================
async function preguntarAClaude(pregunta, apiKey, db) {
  const DOCUMENTO = await obtenerDocumentoInstitucional(db);

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

// =========================================================
// MANEJADOR DE MENSAJES
// =========================================================
const userState = {};

async function handleMessage({ from, msg, token, phoneNumberId, cfg, db }) {
  const estado = userState[from] || "inicio";

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

  // ── Estado: esperando si/no ───────────────────────────
  if (estado === "esperando_cierre") {
    if (
      seleccionId === "cierre_no" ||
      textoLibre?.toLowerCase() === "no" ||
      textoLibre?.toLowerCase() === "salir"
    ) {
      delete userState[from];
      await sendWhatsAppText({
        to: from, token, phoneNumberId,
        text: "Gracias por usar *SkillMatch*. Exito en tu estadia!",
      });
      return;
    }
    userState[from] = "menu";
    await enviarMenu({ to: from, token, phoneNumberId });
    return;
  }

  // ── Estado: esperando tecnologia para matching ────────
  if (estado === "esperando_tecnologia") {
    if (!textoLibre) {
      await sendWhatsAppText({
        to: from, token, phoneNumberId,
        text: "Por favor escribe la tecnologia o puesto que buscas\n(ej: React, Python, Node.js, Java...)",
      });
      return;
    }

    const usuario = userState[`${from}_usuario`];
    let respuesta = "";

    if (usuario?.rol === "empresa") {
      // Empresa busca estudiantes con proyectos en esa tecnologia
      const estudiantes = await buscarEstudiantesPorTecnologia(textoLibre, db);
      if (estudiantes.length === 0) {
        respuesta =
          `No encontre estudiantes con proyectos en *${textoLibre}* por el momento.\n\n` +
          `Puedes publicar una vacante en SkillMatch para que los estudiantes te contacten.`;
      } else {
        respuesta = `*Estudiantes con proyectos en ${textoLibre}:*\n\n`;
        for (const e of estudiantes) {
          respuesta += `• *${e.nombre} ${e.apellido}*\n`;
          respuesta += `  Carrera: ${e.carrera}\n`;
          respuesta += `  Proyectos: ${e.proyectos}\n\n`;
        }
      }
    } else {
      // Estudiante busca vacantes en esa tecnologia
      const vacantes = await buscarVacantesPorTecnologia(textoLibre, db);
      if (vacantes.length === 0) {
        respuesta =
          `No encontre vacantes abiertas relacionadas con *${textoLibre}* en este momento.\n\n` +
          `Acude a Vinculacion para mas opciones de empresas disponibles.`;
      } else {
        respuesta = `*Vacantes disponibles relacionadas con ${textoLibre}:*\n\n`;
        for (const v of vacantes) {
          respuesta += `• *${v.titulo}* — ${v.razon_social}\n`;
          respuesta += `  Nivel: ${v.nivel} | Area: ${v.categoria}\n`;
          respuesta += `  Contacto: ${v.contacto || "ver plataforma"}\n\n`;
        }
        respuesta += `_Para postularte, ingresa a la plataforma SkillMatch._`;
      }
    }

    await guardarLog(
      `Busqueda matching: ${textoLibre}`,
      respuesta,
      "buscar_matching",
      usuario?.id_usuario || null,
      db
    );

    delete userState[`${from}_usuario`];
    userState[from] = "esperando_cierre";
    await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: respuesta });
    return;
  }

  // =========================================================
  // AQUI ENTRA LA NEURONA
  // =========================================================
  const mapaMenu = {
    opcion_fechas:    "fechas",
    opcion_horarios:  "horarios",
    opcion_faq:       "faq",
    opcion_profes:    "horarios",
    opcion_proyectos: "mis_proyectos",
    opcion_matching:  "buscar_matching",
  };

  let intencion;
  let necesitaMenu = false;

  if (seleccionId && mapaMenu[seleccionId]) {
    intencion = mapaMenu[seleccionId];

  } else if (textoLibre) {
    const resultado = clasificar(textoLibre);
    intencion    = resultado.intencion;
    necesitaMenu = resultado.necesitaMenu;

    logger.info("Neurona clasifico:", {
      texto:     textoLibre,
      intencion,
      confianza: resultado.confianza,
    });

  } else {
    await enviarMenu({ to: from, token, phoneNumberId });
    return;
  }

  if (necesitaMenu) {
    userState[from] = "menu";
    await enviarMenu({ to: from, token, phoneNumberId });
    return;
  }

  // Identificar usuario en BD
  let usuario = null;
  try {
    usuario = await identificarUsuario(from, db);
  } catch (e) {
    logger.warn("No se pudo identificar usuario:", e.message);
  }

  // =========================================================
  // ENRUTAMIENTO POR INTENCION
  // =========================================================
  switch (intencion) {

    // ── FECHAS ──────────────────────────────────────────────
    case "fechas": {
      // Intenta leer fechas dinamicas desde chatbot_config
      let texto = "";
      try {
        const [rows] = await db.execute(
          `SELECT valor FROM chatbot_config WHERE clave = 'fechas_estadia' LIMIT 1`
        );
        if (rows[0]?.valor) {
          texto = rows[0].valor;
        }
      } catch { /* usa texto estatico */ }

      if (!texto) {
        texto =
          "*Fechas de estadia Mayo-Agosto 2026:*\n\n" +
          "• *Elegir empresa:* hasta el 15 de abril 2026\n" +
          "• *Entregar CV:* hasta el 21 de abril 2026\n" +
          "• *Inicio de estadia:* 4 de mayo 2026\n" +
          "• *Talleres:* junio, julio y agosto\n" +
          "• *Fin de estadia:* 31 de agosto 2026\n\n" +
          "_Si no tienes empresa, envia tu CV antes del 21 de abril para que la universidad te asigne una._";
      }

      await guardarLog(textoLibre || "opcion_fechas", texto, "fechas", usuario?.id_usuario || null, db);
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
      break;
    }

    // ── HORARIOS ────────────────────────────────────────────
    case "horarios": {
      let texto =
        "*Horarios de atencion:*\n\n" +
        "*Servicios Escolares:*\nLun-Vie: 9:00-14:00 y 16:00-18:00\n\n" +
        "*Vinculacion:*\nLun-Vie: 9:00-15:00\nUbicacion: Edificio principal, planta baja\n\n";

      try {
        const [rows] = await db.execute(
          `SELECT h.titulo, h.descripcion
           FROM horarios_profesores h
           JOIN profesores p ON h.id_profesor = p.id_profesor
           ORDER BY h.fecha_subida DESC
           LIMIT 4`
        );
        if (rows.length > 0) {
          texto += "*Horarios de profesores:*\n";
          for (const h of rows) {
            texto += `• ${h.titulo}: ${h.descripcion || "ver plataforma"}\n`;
          }
        } else {
          texto += "*Profesores:* Consulta el directorio completo en la plataforma SkillMatch.";
        }
      } catch {
        texto += "*Profesores:* Consulta el directorio completo en la plataforma SkillMatch.";
      }

      await guardarLog(textoLibre || "opcion_horarios", texto, "horarios", usuario?.id_usuario || null, db);
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
      break;
    }

    // ── MIS PROYECTOS ────────────────────────────────────────
    case "mis_proyectos": {
      if (!usuario) {
        const texto =
          "Para ver tus proyectos necesito identificarte.\n\n" +
          "Asegurate de que tu numero de WhatsApp este registrado en tu perfil de SkillMatch.\n" +
          "Puedes actualizarlo desde la plataforma web.";
        userState[from] = "esperando_cierre";
        await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
        break;
      }

      const proyectos = await obtenerProyectosEstudiante(usuario.id_usuario, db);

      if (proyectos.length === 0) {
        const texto =
          `Hola *${usuario.nombre}*, aun no tienes proyectos subidos en SkillMatch.\n\n` +
          `Puedes subir tu primer proyecto desde la plataforma web para que las empresas te encuentren.`;
        userState[from] = "esperando_cierre";
        await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
        break;
      }

      let texto = `*Tus proyectos en SkillMatch, ${usuario.nombre}:*\n\n`;
      for (const p of proyectos) {
        const estadoTexto =
          p.estado === "completado"  ? "Completado" :
          p.estado === "en progreso" ? "En progreso" : "Pausado";
        texto += `• *${p.titulo.trim()}* — ${estadoTexto}\n`;
        if (p.tecnologias) texto += `  Tecnologias: ${p.tecnologias}\n`;
        texto += "\n";
      }

      await guardarLog(textoLibre || "opcion_proyectos", texto, "mis_proyectos", usuario.id_usuario, db);
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
      break;
    }

    // ── BUSCAR MATCHING ──────────────────────────────────────
    case "buscar_matching": {
      userState[from]              = "esperando_tecnologia";
      userState[`${from}_usuario`] = usuario;

      const prompt = usuario?.rol === "empresa"
        ? "*Busqueda de talento*\n\nEscribe la tecnologia o habilidad que buscas en los candidatos:\n(ej: React, Python, Node.js, Java, MySQL...)"
        : "*Busqueda de vacantes*\n\nEscribe la tecnologia o puesto que te interesa:\n(ej: React, Python, Node.js, Java, MySQL...)";

      await sendWhatsAppText({ to: from, token, phoneNumberId, text: prompt });
      break;
    }

    // ── FAQ → CLAUDE API ─────────────────────────────────────
    case "faq": {
      let respuesta;
      try {
        const pregunta = textoLibre || "informacion general sobre la estadia";
        respuesta = await preguntarAClaude(pregunta, cfg.ANTHROPIC_KEY, db);
      } catch (e) {
        logger.error("Error Claude API:", e.message);
        respuesta =
          "Lo siento, no pude procesar tu pregunta en este momento.\n\n" +
          "Por favor acude a *Servicios Escolares* o *Vinculacion* para mas informacion.\n" +
          "Telefono UTEQ: (442) 209 6100";
      }

      await guardarLog(
        textoLibre || "faq",
        respuesta,
        "faq",
        usuario?.id_usuario || null,
        db
      );

      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: respuesta });
      break;
    }

    // ── MENU (fallback) ──────────────────────────────────────
    case "menu":
    default: {
      userState[from] = "menu";
      await enviarMenu({ to: from, token, phoneNumberId });
      break;
    }
  }
}

// =========================================================
// WEBHOOK PRINCIPAL
// =========================================================
export const whatsappWebhookSkillMatch = onRequest(
  {
    cors:    true,
    region:  "us-central1",
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

    // GET: verificacion Meta
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