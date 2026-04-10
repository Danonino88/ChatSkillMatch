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
let poolWarmed = false;
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
      enableKeepAlive:  true,                          // Reutiliza conexiones TCP
      keepAliveInitialDelay: 10000,
      connectTimeout:   10000,
    });
    // Warm up: abre la conexion SSL de una vez (no bloquea)
    if (!poolWarmed) {
      poolWarmed = true;
      pool.execute("SELECT 1").catch(() => {});
    }
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
      { id: "opcion_matching",       title: "Buscar vacantes",      description: "Vacantes abiertas para aplicar" },
      { id: "opcion_postulaciones",  title: "Mis postulaciones",    description: "Estado de tus aplicaciones" },
    ],
  },
];

const CIERRE_BUTTONS = [
  { id: "cierre_si", title: "Si" },
  { id: "cierre_no", title: "No" },
];

// Genera saludo personalizado segun rol
function obtenerSaludo(usuario) {
  if (!usuario) {
    return "Bienvenido a SkillMatch! Que deseas consultar?\nSelecciona una opcion o escribe tu pregunta directamente.";
  }

  const nombre = usuario.nombre.split(" ")[0]; // primer nombre
  switch (usuario.rol) {
    case "estudiante":
      return `Hola *${nombre}*! 👋\n` +
        (usuario.carrera ? `Carrera: ${usuario.carrera}\n` : "") +
        (usuario.semestre ? `Semestre: ${usuario.semestre}\n` : "") +
        `\nQue deseas consultar?`;
    case "empresa":
      return `Hola *${nombre}*! 👋\n` +
        (usuario.razon_social ? `Empresa: ${usuario.razon_social}\n` : "") +
        (usuario.giro ? `Giro: ${usuario.giro}\n` : "") +
        `\nQue deseas consultar?`;
    case "profesor":
      return `Hola Profe *${nombre}*! 👋\n` +
        (usuario.departamento ? `Depto: ${usuario.departamento}\n` : "") +
        `\nQue deseas consultar?`;
    case "admin":
      return `Hola *${nombre}* (Admin)! 👋\nQue deseas consultar?`;
    default:
      return `Hola *${nombre}*! Que deseas consultar?`;
  }
}

async function enviarMenu({ to, token, phoneNumberId, usuario = null }) {
  await sendWhatsAppList({
    to, token, phoneNumberId,
    headerText: "SkillMatch",
    bodyText:   obtenerSaludo(usuario),
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
// CACHE DE RESPUESTAS ESTATICAS (fechas, horarios, etc.)
// =========================================================
const configCache = new Map();

// =========================================================
// CONSULTAS A BASE DE DATOS
// =========================================================

// =========================================================
// CACHE DE USUARIOS (evita consultar la BD en cada mensaje)
// =========================================================
const userCache = new Map();
const USER_CACHE_TTL = 300_000; // 5 minutos

function getCachedUser(telefono) {
  const entry = userCache.get(telefono);
  if (!entry) return undefined; // no existe
  if (Date.now() - entry.ts > USER_CACHE_TTL) {
    userCache.delete(telefono);
    return undefined;
  }
  return entry.data; // puede ser null (usuario no encontrado)
}
function setCachedUser(telefono, data) {
  userCache.set(telefono, { data, ts: Date.now() });
}

// Identifica al usuario con UNA SOLA query (LEFT JOINs)
async function identificarUsuario(telefono, db) {
  // Revisar cache primero
  const cached = getCachedUser(telefono);
  if (cached !== undefined) return cached;

  const telefonoLimpio = telefono.replace(/^521/, "");
  const [rows] = await db.execute(
    `SELECT u.id_usuario, u.nombre, u.apellido, u.id_rol, r.nombre_rol AS rol,
            u.correo, u.telefono,
            est.id_estudiante, est.matricula, est.carrera, est.semestre, est.competencias,
            emp.razon_social, emp.giro, emp.contacto,
            prof.departamento, prof.asignaturas
     FROM usuarios u
     JOIN roles r ON u.id_rol = r.id_rol
     LEFT JOIN estudiantes est ON est.id_usuario = u.id_usuario
     LEFT JOIN empresas emp    ON emp.id_usuario = u.id_usuario
     LEFT JOIN profesores prof ON prof.id_profesor = u.id_usuario
     WHERE (u.telefono = ? OR u.telefono = ?) AND u.estado = 'activo'
     LIMIT 1`,
    [telefono, telefonoLimpio]
  );
  const usuario = rows[0] || null;
  setCachedUser(telefono, usuario);
  return usuario;
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

// Vacantes abiertas (todas, para mostrar al estudiante)
async function obtenerVacantesAbiertas(db) {
  const [rows] = await db.execute(
    `SELECT v.id_vacante, v.titulo, v.categoria, v.nivel, v.descripcion,
            emp.razon_social, emp.contacto
     FROM vacantes v
     JOIN empresas emp ON v.id_empresa = emp.id_empresa
     WHERE v.estado = 'abierta'
     ORDER BY v.fecha_registro DESC
     LIMIT 10`
  );
  return rows;
}

// Crear postulacion del estudiante a una vacante
async function crearPostulacion(id_vacante, id_estudiante, db) {
  // Verifica si ya existe
  const [existing] = await db.execute(
    `SELECT id_postulacion FROM postulaciones WHERE id_vacante = ? AND id_estudiante = ? LIMIT 1`,
    [id_vacante, id_estudiante]
  );
  if (existing.length > 0) return { ya_existe: true };

  await db.execute(
    `INSERT INTO postulaciones (id_vacante, id_estudiante, estado) VALUES (?, ?, 'pendiente')`,
    [id_vacante, id_estudiante]
  );
  return { ya_existe: false };
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

// Postulaciones del estudiante (usa tabla postulaciones)
async function obtenerPostulacionesEstudiante(id_estudiante, db) {
  const [rows] = await db.execute(
    `SELECT v.titulo, emp.razon_social, po.estado, po.fecha_postulacion
     FROM postulaciones po
     JOIN vacantes v   ON po.id_vacante  = v.id_vacante
     JOIN empresas emp ON v.id_empresa   = emp.id_empresa
     WHERE po.id_estudiante = ?
     ORDER BY po.fecha_postulacion DESC
     LIMIT 5`,
    [id_estudiante]
  );
  return rows;
}

// Documento institucional — cacheado en memoria (se refresca cada 10 min)
let docCache = { texto: null, ts: 0 };
const DOC_CACHE_TTL = 600_000; // 10 minutos

async function obtenerDocumentoInstitucional(db) {
  if (docCache.texto && Date.now() - docCache.ts < DOC_CACHE_TTL) {
    return docCache.texto;
  }

  try {
    const [rows] = await db.execute(
      `SELECT valor FROM chatbot_config WHERE clave = 'documento_institucional' LIMIT 1`
    );
    if (rows[0]?.valor) {
      docCache = { texto: rows[0].valor, ts: Date.now() };
      return docCache.texto;
    }
  } catch (e) {
    logger.warn("No se pudo leer chatbot_config, usando archivo local:", e.message);
  }

  // Fallback: archivo .md local
  const rutaDoc = path.join(__dirname, "documento_institucional.md");
  if (fs.existsSync(rutaDoc)) {
    docCache = { texto: fs.readFileSync(rutaDoc, "utf8"), ts: Date.now() };
    return docCache.texto;
  }

  return "Eres el asistente virtual de SkillMatch de la UTEQ. Responde en espanol mexicano, breve y amable.";
}

// Guardar log — fire-and-forget (no bloquea la respuesta al usuario)
function guardarLog(pregunta, respuesta, categoria, id_usuario, db) {
  db.execute(
    `INSERT INTO chatbot (pregunta, respuesta, categoria) VALUES (?, ?, ?)`,
    [pregunta.substring(0, 255), respuesta.substring(0, 500), categoria]
  ).catch((e) => logger.warn("No se pudo guardar log:", e.message));
}

// =========================================================
// CLAUDE API
// =========================================================
async function preguntarAClaude(pregunta, apiKey, db) {
  const DOCUMENTO = await obtenerDocumentoInstitucional(db);

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model:      "claude-3-5-haiku-20241022",  // Haiku: 3-5x mas rapido que Sonnet
      max_tokens: 300,
      system:     DOCUMENTO,
      messages:   [{ role: "user", content: pregunta }],
    },
    {
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type":      "application/json",
      },
      timeout: 15000,
    }
  );

  return response.data.content[0]?.text ||
    "No pude procesar tu pregunta. Acude a Servicios Escolares.";
}

// =========================================================
// MANEJADOR DE MENSAJES
// =========================================================
const userState = {};

// Intenciones que NECESITAN identificar al usuario en BD
const INTENTS_NEED_USER = new Set(["mis_proyectos", "buscar_matching"]);

async function handleMessage({ from, msg, token, phoneNumberId, cfg, db }) {
  const t0 = Date.now();
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

  // ── Funcion lazy: identifica usuario solo cuando se necesite ──
  let usuario = getCachedUser(from); // del cache si existe (no va a BD)
  if (usuario === undefined) usuario = null; // no cacheado aun

  async function requireUsuario() {
    if (usuario) return usuario;
    try {
      const t = Date.now();
      usuario = await identificarUsuario(from, db);
      logger.info(`[TIMING] identificarUsuario: ${Date.now() - t}ms`);
    } catch (e) {
      logger.warn("No se pudo identificar usuario:", e.message);
    }
    return usuario;
  }

  // ── Estado: esperando si/no ───────────────────────────
  if (estado === "esperando_cierre") {
    if (
      seleccionId === "cierre_no" ||
      textoLibre?.toLowerCase() === "no" ||
      textoLibre?.toLowerCase() === "salir"
    ) {
      delete userState[from];
      const nombre = usuario?.nombre?.split(" ")[0];
      const despedida = nombre
        ? `Gracias *${nombre}* por usar *SkillMatch*. Exito en tu estadia!`
        : "Gracias por usar *SkillMatch*. Exito en tu estadia!";
      await sendWhatsAppText({ to: from, token, phoneNumberId, text: despedida });
      logger.info(`[TIMING] total cierre_no: ${Date.now() - t0}ms`);
      return;
    }
    userState[from] = "menu";
    await enviarMenu({ to: from, token, phoneNumberId, usuario });
    logger.info(`[TIMING] total cierre_si: ${Date.now() - t0}ms`);
    return;
  }

  // ── Estado: esperando que seleccione una vacante de la lista ──
  if (estado === "esperando_seleccion_vacante") {
    const vacId = seleccionId?.startsWith("vacante_") ? seleccionId.replace("vacante_", "") : null;

    if (!vacId) {
      await sendWhatsAppText({
        to: from, token, phoneNumberId,
        text: "Por favor selecciona una vacante de la lista.",
      });
      return;
    }

    // Busca los datos de la vacante seleccionada
    const db2 = getPool(cfg);
    const [rows] = await db2.execute(
      `SELECT v.id_vacante, v.titulo, v.nivel, v.categoria, v.descripcion,
              emp.razon_social, emp.contacto
       FROM vacantes v
       JOIN empresas emp ON v.id_empresa = emp.id_empresa
       WHERE v.id_vacante = ? AND v.estado = 'abierta'
       LIMIT 1`,
      [vacId]
    );

    if (rows.length === 0) {
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({
        to: from, token, phoneNumberId,
        textoRespuesta: "Esa vacante ya no esta disponible.",
      });
      return;
    }

    const vacante = rows[0];

    // Guardar la vacante seleccionada y pedir confirmacion
    userState[from] = "esperando_confirmar_postulacion";
    userState[`${from}_vacante`] = vacante;

    const detalle =
      `*${vacante.titulo}*\n` +
      `Empresa: ${vacante.razon_social}\n` +
      `Nivel: ${vacante.nivel} | Area: ${vacante.categoria}\n` +
      (vacante.descripcion ? `Descripcion: ${vacante.descripcion}\n` : "") +
      (vacante.contacto ? `Contacto: ${vacante.contacto}\n` : "");

    await sendWhatsAppButtons({
      to: from, token, phoneNumberId,
      bodyText: detalle + "\n¿Deseas postularte a esta vacante?",
      buttons: [
        { id: "postular_si", title: "Si, postularme" },
        { id: "postular_no", title: "No, regresar" },
      ],
    });
    return;
  }

  // ── Estado: confirmar postulacion ──
  if (estado === "esperando_confirmar_postulacion") {
    const vacante  = userState[`${from}_vacante`];
    const usuarioP = userState[`${from}_usuario_postulacion`];

    if (seleccionId === "postular_no" || textoLibre?.toLowerCase() === "no") {
      delete userState[`${from}_vacante`];
      delete userState[`${from}_usuario_postulacion`];
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({
        to: from, token, phoneNumberId,
        textoRespuesta: "De acuerdo, no se realizo la postulacion.",
      });
      return;
    }

    if (seleccionId === "postular_si" || textoLibre?.toLowerCase() === "si") {
      if (!usuarioP?.id_estudiante || !vacante?.id_vacante) {
        delete userState[`${from}_vacante`];
        delete userState[`${from}_usuario_postulacion`];
        userState[from] = "esperando_cierre";
        await enviarRespuestaConCierre({
          to: from, token, phoneNumberId,
          textoRespuesta: "No fue posible completar la postulacion. Asegurate de estar registrado en SkillMatch.",
        });
        return;
      }

      try {
        const db2 = getPool(cfg);
        const resultado = await crearPostulacion(vacante.id_vacante, usuarioP.id_estudiante, db2);

        let textoResp;
        if (resultado.ya_existe) {
          textoResp = `Ya te habias postulado a *${vacante.titulo}* en *${vacante.razon_social}*.\n\nPuedes ver el estado de tus postulaciones desde la plataforma SkillMatch.`;
        } else {
          textoResp = `✅ Te has postulado exitosamente a *${vacante.titulo}* en *${vacante.razon_social}*.\n\nEstado: ⏳ Pendiente\nLa empresa revisara tu perfil y proyectos en SkillMatch.`;
        }

        guardarLog(
          `Postulacion: ${vacante.titulo}`,
          textoResp,
          "buscar_matching",
          usuarioP.id_usuario || null,
          db2
        );

        delete userState[`${from}_vacante`];
        delete userState[`${from}_usuario_postulacion`];
        userState[from] = "esperando_cierre";
        await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: textoResp });
      } catch (e) {
        logger.error("Error al crear postulacion:", e.message);
        delete userState[`${from}_vacante`];
        delete userState[`${from}_usuario_postulacion`];
        userState[from] = "esperando_cierre";
        await enviarRespuestaConCierre({
          to: from, token, phoneNumberId,
          textoRespuesta: "Hubo un error al procesar tu postulacion. Intenta desde la plataforma web de SkillMatch.",
        });
      }
      return;
    }

    // Si no respondio si/no
    await sendWhatsAppButtons({
      to: from, token, phoneNumberId,
      bodyText: "¿Deseas postularte a esta vacante?",
      buttons: [
        { id: "postular_si", title: "Si, postularme" },
        { id: "postular_no", title: "No, regresar" },
      ],
    });
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
    opcion_matching:       "buscar_matching",
    opcion_postulaciones:  "mis_postulaciones_vacantes",
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
    await enviarMenu({ to: from, token, phoneNumberId, usuario });
    return;
  }

  if (necesitaMenu) {
    userState[from] = "menu";
    await enviarMenu({ to: from, token, phoneNumberId, usuario });
    return;
  }

  // =========================================================
  // ENRUTAMIENTO POR INTENCION
  // =========================================================
  switch (intencion) {

    // ── FECHAS ──────────────────────────────────────────────
    case "fechas": {
      const TEXTO_FECHAS_DEFAULT =
        "*Fechas de estadia Mayo-Agosto 2026:*\n\n" +
        "• *Elegir empresa:* hasta el 15 de abril 2026\n" +
        "• *Entregar CV:* hasta el 21 de abril 2026\n" +
        "• *Inicio de estadia:* 4 de mayo 2026\n" +
        "• *Talleres:* junio, julio y agosto\n" +
        "• *Fin de estadia:* 31 de agosto 2026\n\n" +
        "_Si no tienes empresa, envia tu CV antes del 21 de abril para que la universidad te asigne una._";

      // Usa texto estatico directo (sin esperar BD)
      // El admin puede actualizar chatbot_config, se lee en background para proxima vez
      let texto = configCache.get("fechas_estadia") || TEXTO_FECHAS_DEFAULT;

      // Refresca cache en background (no bloquea respuesta)
      db.execute(`SELECT valor FROM chatbot_config WHERE clave = 'fechas_estadia' LIMIT 1`)
        .then(([rows]) => { if (rows[0]?.valor) configCache.set("fechas_estadia", rows[0].valor); })
        .catch(() => {});

      guardarLog(textoLibre || "opcion_fechas", texto, "fechas", usuario?.id_usuario || null, db);
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
      logger.info(`[TIMING] total fechas: ${Date.now() - t0}ms`);
      break;
    }

    // ── HORARIOS ────────────────────────────────────────────
    case "horarios": {
      const BASE_HORARIOS =
        "*Horarios de atencion:*\n\n" +
        "*Servicios Escolares:*\nLun-Vie: 9:00-14:00 y 16:00-18:00\n\n" +
        "*Vinculacion:*\nLun-Vie: 9:00-15:00\nUbicacion: Edificio principal, planta baja\n\n";

      // Usa cache si existe, sino texto base
      let texto = configCache.get("horarios_full") || (BASE_HORARIOS +
        "*Profesores:* Consulta el directorio completo en la plataforma SkillMatch.");

      // Refresca horarios de profesores en background
      db.execute(
        `SELECT h.titulo, h.descripcion FROM horarios_profesores h
         JOIN profesores p ON h.id_profesor = p.id_profesor
         ORDER BY h.fecha_subida DESC LIMIT 4`
      ).then(([rows]) => {
        let full = BASE_HORARIOS;
        if (rows.length > 0) {
          full += "*Horarios de profesores:*\n";
          for (const h of rows) full += `• ${h.titulo}: ${h.descripcion || "ver plataforma"}\n`;
        } else {
          full += "*Profesores:* Consulta el directorio completo en la plataforma SkillMatch.";
        }
        configCache.set("horarios_full", full);
      }).catch(() => {});

      guardarLog(textoLibre || "opcion_horarios", texto, "horarios", usuario?.id_usuario || null, db);
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
      logger.info(`[TIMING] total horarios: ${Date.now() - t0}ms`);
      break;
    }

    // ── MIS PROYECTOS ────────────────────────────────────────
    case "mis_proyectos": {
      await requireUsuario();
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

      guardarLog(textoLibre || "opcion_proyectos", texto, "mis_proyectos", usuario.id_usuario, db);
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
      logger.info(`[TIMING] total mis_proyectos: ${Date.now() - t0}ms`);
      break;
    }

    // ── BUSCAR MATCHING ──────────────────────────────────────
    case "buscar_matching": {
      await requireUsuario();

      if (!usuario || usuario.rol !== "estudiante" || !usuario.id_estudiante) {
        userState[from] = "esperando_cierre";
        await enviarRespuestaConCierre({
          to: from, token, phoneNumberId,
          textoRespuesta:
            "Para ver vacantes y postularte necesito identificarte como estudiante.\n\n" +
            "Asegurate de que tu numero de WhatsApp este registrado en tu perfil de SkillMatch.",
        });
        break;
      }

      // Obtener vacantes abiertas y mostrarlas como lista interactiva
      const vacantes = await obtenerVacantesAbiertas(db);

      if (vacantes.length === 0) {
        userState[from] = "esperando_cierre";
        await enviarRespuestaConCierre({
          to: from, token, phoneNumberId,
          textoRespuesta: "No hay vacantes disponibles en este momento.\n\nAcude a Vinculacion para mas opciones.",
        });
        break;
      }

      // Construir lista interactiva de WhatsApp (max 10 rows)
      const rows = vacantes.map((v) => ({
        id:          `vacante_${v.id_vacante}`,
        title:       v.titulo.substring(0, 24),
        description: `${v.razon_social} | ${v.nivel}`.substring(0, 72),
      }));

      userState[from] = "esperando_seleccion_vacante";
      userState[`${from}_usuario_postulacion`] = usuario;

      await sendWhatsAppList({
        to: from, token, phoneNumberId,
        headerText: "Vacantes disponibles",
        bodyText:   `*${usuario.nombre}*, estas son las vacantes abiertas.\nSelecciona una para ver el detalle y postularte.`,
        buttonText: "Ver vacantes",
        sections:   [{ title: "Vacantes abiertas", rows }],
      });

      guardarLog(textoLibre || "opcion_matching", `Mostrando ${vacantes.length} vacantes`, "buscar_matching", usuario.id_usuario, db);
      logger.info(`[TIMING] total buscar_matching: ${Date.now() - t0}ms`);
      break;
    }

    // ── MIS POSTULACIONES ─────────────────────────────────────
    case "mis_postulaciones_vacantes": {
      await requireUsuario();

      if (!usuario || usuario.rol !== "estudiante" || !usuario.id_estudiante) {
        userState[from] = "esperando_cierre";
        await enviarRespuestaConCierre({
          to: from, token, phoneNumberId,
          textoRespuesta:
            "Para ver tus postulaciones necesito identificarte como estudiante.\n\n" +
            "Asegurate de que tu numero de WhatsApp este registrado en tu perfil de SkillMatch.",
        });
        break;
      }

      const postulaciones = await obtenerPostulacionesEstudiante(usuario.id_estudiante, db);

      if (postulaciones.length === 0) {
        userState[from] = "esperando_cierre";
        await enviarRespuestaConCierre({
          to: from, token, phoneNumberId,
          textoRespuesta:
            `*${usuario.nombre}*, aun no te has postulado a ninguna vacante.\n\n` +
            `Selecciona *Buscar vacantes* en el menu para ver las vacantes disponibles y aplicar.`,
        });
        break;
      }

      const estadoMap = {
        pendiente:   "⏳ Pendiente",
        en_revision: "🔍 En revision",
        aceptado:    "✅ Aceptado",
        rechazado:   "❌ Rechazado",
      };

      let texto = `*Tus postulaciones, ${usuario.nombre}:*\n\n`;
      for (const po of postulaciones) {
        const fecha = new Date(po.fecha_postulacion).toLocaleDateString("es-MX", {
          day: "numeric", month: "short", year: "numeric",
        });
        texto += `• *${po.titulo}* — ${po.razon_social}\n`;
        texto += `  Estado: ${estadoMap[po.estado] || po.estado}\n`;
        texto += `  Fecha: ${fecha}\n\n`;
      }

      guardarLog(textoLibre || "opcion_postulaciones", texto, "mis_postulaciones", usuario.id_usuario, db);
      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: texto });
      logger.info(`[TIMING] total mis_postulaciones: ${Date.now() - t0}ms`);
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

      guardarLog(textoLibre || "faq", respuesta, "faq", usuario?.id_usuario || null, db);

      userState[from] = "esperando_cierre";
      await enviarRespuestaConCierre({ to: from, token, phoneNumberId, textoRespuesta: respuesta });
      logger.info(`[TIMING] total faq: ${Date.now() - t0}ms`);
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
// DEDUPLICACION: evita procesar el mismo mensaje varias veces
// (Meta reintenta el webhook si no recibe 200 rapido)
// =========================================================
const processedMessages = new Map();
const DEDUP_TTL_MS = 120_000; // 2 minutos

function yaProcesado(msgId) {
  // Limpia entradas viejas
  const ahora = Date.now();
  for (const [id, ts] of processedMessages) {
    if (ahora - ts > DEDUP_TTL_MS) processedMessages.delete(id);
  }
  if (processedMessages.has(msgId)) return true;
  processedMessages.set(msgId, ahora);
  return false;
}

// =========================================================
// WEBHOOK PRINCIPAL
// =========================================================
export const whatsappWebhookSkillMatch = onRequest(
  {
    cors:    true,
    region:  "us-central1",
    minInstances: 1,        // Mantiene 1 instancia activa = sin cold start
    memory:       "256MiB",
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
    // ── Responder 200 INMEDIATAMENTE para que Meta no reintente ──
    res.sendStatus(200);

    try {
      const body = req.body;
      logger.info("Webhook body", body);

      const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;
      if (Array.isArray(statuses) && statuses.length) return;

      const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
      const from     = messages?.[0]?.from;
      if (!messages || !from) return;

      const msg = messages[0];
      if (!msg || (msg.type !== "text" && msg.type !== "interactive")) return;

      // ── Deduplicar: si ya procesamos este mensaje, ignorar ──
      if (yaProcesado(msg.id)) {
        logger.info("Mensaje duplicado ignorado:", msg.id);
        return;
      }

      const token         = cfg.WHATSAPP_TOKEN;
      const phoneNumberId = cfg.WHATSAPP_PHONE_NUMBER_ID;
      const db = getPool(cfg);
      await handleMessage({ from, msg, token, phoneNumberId, cfg, db });
    } catch (err) {
      logger.error("Error webhook:", err?.response?.data || err);
    }
  }
);