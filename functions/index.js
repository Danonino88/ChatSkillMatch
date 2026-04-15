// =========================================================
// ChatBot SkillMatch ??" WhatsApp con Neurona ML + Claude API
// Node.js 22 con ESM y Firebase Functions
// Version 2 ??" conectado a BD real con vacantes y postulaciones
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
// NEURONA: entrenamiento lazy (primera peticion)
// =========================================================

// =========================================================
// CONEXI?"N MYSQL (Pool Lazy)
// =========================================================
let pool = null;
let poolWarmed = false;
function getPool(cfg) {
  if (!pool) {
    pool = mysql.createPool({
      host:             cfg.DB_HOST,
      port:             46147,                         // Railway MySQL
      user:             cfg.DB_USER,
      password:         cfg.DB_PASSWORD,
      database:         cfg.DB_NAME,
      waitForConnections: true,
      connectionLimit:  5,
      queueLimit:       0,
      timezone:         "Z",
      ssl:              false,                         // Railway no requiere SSL estricto
      enableKeepAlive:  true,
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
  // WhatsApp interactive body limit: 1024 chars
  let text = bodyText;
  if (text.length > 1024) {
    text = text.substring(0, 1020) + "...";
  }
  const interactive = {
    type:   "list",
    body:   { text },
    action: { button: buttonText, sections },
  };
  if (headerText) {
    interactive.header = { type: "text", text: headerText };
  }
  await axios.post(
    WA_API(phoneNumberId),
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive,
    },
    { headers: waHeaders(token), timeout: 15000 }
  );
}

async function sendWhatsAppDocument({ to, token, phoneNumberId, documentUrl, filename, caption }) {
  await axios.post(
    WA_API(phoneNumberId),
    {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        link:     documentUrl,
        filename: filename || "horario.pdf",
        caption:  caption || "",
      },
    },
    { headers: waHeaders(token), timeout: 20000 }
  );
}

async function sendWhatsAppButtons({ to, token, phoneNumberId, bodyText, buttons }) {
  // WhatsApp interactive body limit: 1024 chars
  let text = bodyText;
  if (text.length > 1024) {
    text = text.substring(0, 1020) + "...";
  }
  await axios.post(
    WA_API(phoneNumberId),
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
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
// MENUS DINAMICO POR ROL
// =========================================================
// Menu basico para usuarios NO registrados
const MENU_BASICO = [{
  title: "Opciones",
  rows: [
    { id: "opcion_ayuda_ejemplos", title: "Que puedo preguntar", description: "Ejemplos de lo que puedo hacer" },
    { id: "opcion_fechas",     title: "Fechas de estadia",    description: "Inicio y fin del periodo" },
    { id: "opcion_horarios",   title: "Horarios y contactos", description: "Servicios escolares y profesores" },
    { id: "opcion_info_uteq",  title: "Info sobre la UTEQ",   description: "Ubicacion y datos de contacto" },
    { id: "opcion_faq",        title: "Preguntas frecuentes", description: "Dudas sobre la estadia" },
  ],
}];

// Intenciones avanzadas que requieren registro
const INTENTS_REQUIEREN_REGISTRO = new Set([
  "mis_proyectos", "buscar_matching", "mis_postulaciones_vacantes",
  "configurar_perfil",
]);

function generarMenu(usuario) {
  if (usuario?.rol === "estudiante") {
    return [{
      title: "Opciones",
      rows: [
        { id: "opcion_ayuda_ejemplos", title: "Que puedo preguntar", description: "Ejemplos de lo que puedo hacer" },
        { id: "opcion_fechas",        title: "Fechas de estadia",    description: "Inicio y fin del periodo" },
        { id: "opcion_horarios",      title: "Horarios y contactos", description: "Servicios escolares y profesores" },
        { id: "opcion_matching",      title: "Buscar vacantes",      description: "Vacantes abiertas para aplicar" },
        { id: "opcion_proyectos",     title: "Mis proyectos",        description: "Tus proyectos en SkillMatch" },
        { id: "opcion_postulaciones", title: "Mis postulaciones",    description: "Estado de tus aplicaciones" },
        { id: "opcion_info_uteq",     title: "Info sobre la UTEQ",   description: "Ubicacion y datos de contacto" },
        { id: "opcion_faq",           title: "Preguntas frecuentes", description: "Dudas sobre la estadia" },
      ],
    }];
  }
  return MENU_BASICO;
}

// =========================================================
// OPCIONES RELACIONADAS (reemplaza cierre automatico)
// =========================================================
const OPCIONES_RELACIONADAS = {
  fechas: [
    { id: "opcion_horarios",  title: "Ver horarios" },
    { id: "opcion_info_uteq", title: "Info UTEQ" },
    { id: "opcion_menu",      title: "Menu" },
  ],
  horarios: [
    { id: "opcion_fechas",    title: "Ver fechas" },
    { id: "opcion_info_uteq", title: "Info UTEQ" },
    { id: "opcion_menu",      title: "Menu" },
  ],
  info_uteq: [
    { id: "opcion_fechas",   title: "Ver fechas" },
    { id: "opcion_horarios", title: "Ver horarios" },
    { id: "opcion_menu",     title: "Menu" },
  ],
  mis_proyectos: [
    { id: "opcion_matching",      title: "Buscar vacantes" },
    { id: "opcion_postulaciones", title: "Mis postulaciones" },
    { id: "opcion_menu",          title: "Menu" },
  ],
  buscar_matching: [
    { id: "opcion_postulaciones", title: "Mis postulaciones" },
    { id: "opcion_proyectos",     title: "Mis proyectos" },
    { id: "opcion_menu",          title: "Menu" },
  ],
  mis_postulaciones_vacantes: [
    { id: "opcion_matching",  title: "Buscar vacantes" },
    { id: "opcion_proyectos", title: "Mis proyectos" },
    { id: "opcion_menu",      title: "Menu" },
  ],
  faq: [
    { id: "opcion_fechas",    title: "Ver fechas" },
    { id: "opcion_info_uteq", title: "Info UTEQ" },
    { id: "opcion_menu",      title: "Menu" },
  ],
};

// Opciones basicas para no registrados (max 3 por limite de WhatsApp buttons)
const OPCIONES_BASICAS = [
  { id: "opcion_fechas",   title: "Ver fechas" },
  { id: "opcion_horarios", title: "Ver horarios" },
  { id: "opcion_faq",      title: "FAQ" },
];

function generarOpcionesRelacionadas(intencion, usuario) {
  if (!usuario || usuario.rol !== "estudiante") {
    // No registrado o no estudiante: solo opciones basicas sin repetir la actual
    const basicas = OPCIONES_BASICAS.filter((o) => {
      if (intencion === "fechas"   && o.id === "opcion_fechas")   return false;
      if (intencion === "horarios" && o.id === "opcion_horarios") return false;
      if (intencion === "faq"      && o.id === "opcion_faq")      return false;
      return true;
    });
    return basicas;
  }
  return OPCIONES_RELACIONADAS[intencion] || [
    { id: "opcion_menu", title: "Menu" },
  ];
}

// Genera saludo personalizado segun rol
function obtenerSaludo(usuario) {
  const DESC_BOT =
    "Soy tu asistente virtual de *SkillMatch* \ud83e\udd16, la plataforma de vinculacion academica de la UTEQ. " +
    "Aqui puedes consultar fechas, horarios, preguntas frecuentes, entre otras cosas.";

  // Flujo 1: Usuario anonimo (no registrado o no estudiante)
  if (!usuario || usuario.rol !== "estudiante") {
    const EJEMPLOS_ANONIMO =
      "\ud83d\udccc *Desde el menu puedes:*\n" +
      "\u2022 Ver fechas de estadia\n" +
      "\u2022 Consultar horarios y contactos\n" +
      "\u2022 Informacion sobre la UTEQ\n" +
      "\u2022 Preguntas frecuentes\n\n" +
      "\ud83d\udcac *O escribeme directamente tus dudas:*\n" +
      "\u2022 _\u00bfQue pasa si no tengo empresa?_\n" +
      "\u2022 _Requisitos para titulacion_\n" +
      "\u2022 _\u00bfDonde esta ubicada la UTEQ?_\n" +
      "\u2022 _\u00bfQue es SkillMatch?_";

    return `\ud83d\udc4b *Bienvenido a SkillMatch*\n\n` +
      `${DESC_BOT}\n\n` +
      `No encontramos tu numero registrado. Puedes crear tu cuenta en:\n` +
      `https://skillmatch-lkz9.onrender.com/\n\n` +
      `${EJEMPLOS_ANONIMO}\n\n` +
      `Mientras tanto, estas son las opciones disponibles:`;
  }

  // Flujo 2: Estudiante registrado
  const nombre = usuario.nombre.split(" ")[0];
  const EJEMPLOS_ESTUDIANTE =
    "\ud83d\udccc *Desde el menu puedes:*\n" +
    "\u2022 Ver fechas de estadia\n" +
    "\u2022 Consultar horarios de Servicios Escolares y profesores\n" +
    "\u2022 Buscar vacantes y postularte\n" +
    "\u2022 Ver tus proyectos y postulaciones\n\n" +
    "\ud83d\udcac *O escribeme directamente tus dudas:*\n" +
    "\u2022 _\u00bfQue pasa si no tengo empresa?_\n" +
    "\u2022 _Requisitos para titulacion_\n" +
    "\u2022 _\u00bfQue obligaciones tengo en la estadia?_\n" +
    "\u2022 _\u00bfDonde esta ubicada la UTEQ?_\n" +
    "\u2022 _\u00bfA que hora atiende vinculacion?_\n" +
    "\u2022 _\u00bfQue es SkillMatch?_";

  return `\ud83d\udc4b *Hola, ${nombre}!*\n\n` +
    `${DESC_BOT}\n\n` +
    (usuario.carrera ? `\ud83c\udf93 *Carrera:* ${usuario.carrera}\n` : "") +
    (usuario.semestre ? `\ud83d\udcd6 *Semestre:* ${usuario.semestre}\n` : "") +
    `\n${EJEMPLOS_ESTUDIANTE}\n\n\u00bfQue deseas consultar?`;
}

async function enviarMenu({ to, token, phoneNumberId, usuario = null, from = null }) {
  // Usuarios recurrentes: atajos rapidos
  if (from && esUsuarioRecurrente(from)) {
    const atajos = obtenerAtajosRapidos(from, usuario);
    await sendWhatsAppButtons({
      to, token, phoneNumberId,
      bodyText: obtenerSaludo(usuario),
      buttons: atajos,
    });
    return;
  }
  // Usuarios nuevos o menu completo: lista por rol
  await sendWhatsAppList({
    to, token, phoneNumberId,
    headerText: "SkillMatch",
    bodyText:   obtenerSaludo(usuario),
    buttonText: "Ver opciones",
    sections:   generarMenu(usuario),
  });
}

async function enviarRespuestaConOpciones({ to, token, phoneNumberId, textoRespuesta, intencion, usuario = null }) {
  const opciones = generarOpcionesRelacionadas(intencion, usuario);
  await sendWhatsAppButtons({
    to, token, phoneNumberId,
    bodyText: textoRespuesta,
    buttons:  opciones,
  });
}

// =========================================================
// CACHE DE RESPUESTAS ESTATICAS (fechas, horarios, etc.)
// =========================================================
const configCache = new Map();

// =========================================================
// HISTORIAL DE INTERACCIONES (atajos para usuarios recurrentes)
// =========================================================
const userHistory = new Map();
const HISTORY_TTL = 86_400_000; // 24 horas

function registrarInteraccion(telefono, intencion) {
  if (!userHistory.has(telefono)) {
    userHistory.set(telefono, { intenciones: [], ts: Date.now() });
  }
  const entry = userHistory.get(telefono);
  entry.ts = Date.now();
  const idx = entry.intenciones.indexOf(intencion);
  if (idx !== -1) entry.intenciones.splice(idx, 1);
  entry.intenciones.unshift(intencion);
  if (entry.intenciones.length > 5) entry.intenciones.pop();
}

function esUsuarioRecurrente(telefono) {
  const entry = userHistory.get(telefono);
  if (!entry) return false;
  if (Date.now() - entry.ts > HISTORY_TTL) {
    userHistory.delete(telefono);
    return false;
  }
  return entry.intenciones.length > 0;
}

const ATAJO_MAP = {
  fechas:                     { id: "opcion_fechas",        title: "Fechas" },
  horarios:                   { id: "opcion_horarios",      title: "Horarios" },
  info_uteq:                  { id: "opcion_info_uteq",     title: "Info UTEQ" },
  mis_proyectos:              { id: "opcion_proyectos",     title: "Mis proyectos" },
  buscar_matching:            { id: "opcion_matching",      title: "Vacantes" },
  mis_postulaciones_vacantes: { id: "opcion_postulaciones", title: "Postulaciones" },
  faq:                        { id: "opcion_faq",           title: "FAQ" },
};

function obtenerAtajosRapidos(telefono, usuario) {
  const entry = userHistory.get(telefono);
  if (!entry || entry.intenciones.length === 0) return null;
  const atajos = [];
  for (const intencion of entry.intenciones) {
    if (ATAJO_MAP[intencion] && atajos.length < 2) {
      atajos.push(ATAJO_MAP[intencion]);
    }
  }
  atajos.push({ id: "opcion_menu", title: "Menu completo" });
  return atajos;
}

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

  // Comparar solo los ultimos 10 digitos del telefono
  const soloDigitos = telefono.replace(/\D/g, "");
  const ultimos10 = soloDigitos.slice(-10);

  logger.info("identificarUsuario", { telefonoOriginal: telefono, soloDigitos, ultimos10 });

  // Primero verificar que telefonos existen en la BD
  const [todos] = await db.execute(
    `SELECT id_usuario, nombre, telefono FROM usuarios WHERE telefono IS NOT NULL AND estado = 'activo'`
  );
  logger.info("Telefonos en BD:", todos.map(u => ({ id: u.id_usuario, nombre: u.nombre, tel: u.telefono })));

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
     WHERE RIGHT(u.telefono, 10) = ?
       AND u.estado = 'activo'
     LIMIT 1`,
    [ultimos10]
  );
  logger.info("? Resultado query:", { encontrado: rows.length > 0, usuario: rows[0]?.nombre || "ninguno" });

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

// Profesores con horario subido (solo Tecnologias de la informacion)
async function obtenerProfesoresConHorario(db) {
  const [rows] = await db.execute(
    `SELECT p.id_profesor, u.nombre, u.apellido, p.asignaturas, p.departamento
     FROM profesores p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     JOIN horarios_profesores hp ON hp.id_profesor = p.id_profesor
     WHERE u.estado = 'activo'
       AND LOWER(p.departamento) LIKE '%tecnolog%informaci%'
     GROUP BY p.id_profesor
     ORDER BY u.nombre
     LIMIT 10`
  );
  logger.info("obtenerProfesoresConHorario:", { total: rows.length, profes: rows.map(r => ({ id: r.id_profesor, nombre: r.nombre, depto: r.departamento })) });
  // Si no encontro con filtro de depto, intentar sin filtro (todos los que tengan horario)
  if (rows.length === 0) {
    const [todos] = await db.execute(
      `SELECT p.id_profesor, u.nombre, u.apellido, p.asignaturas, p.departamento
       FROM profesores p
       JOIN usuarios u ON p.id_usuario = u.id_usuario
       JOIN horarios_profesores hp ON hp.id_profesor = p.id_profesor
       WHERE u.estado = 'activo'
       GROUP BY p.id_profesor
       ORDER BY u.nombre
       LIMIT 10`
    );
    logger.info("obtenerProfesoresConHorario (sin filtro depto):", { total: todos.length, profes: todos.map(r => ({ id: r.id_profesor, nombre: r.nombre, depto: r.departamento })) });
    if (todos.length > 0) return todos;
    // Ultimo intento: sin filtro de estado
    const [sinEstado] = await db.execute(
      `SELECT p.id_profesor, u.nombre, u.apellido, p.asignaturas, p.departamento
       FROM profesores p
       JOIN usuarios u ON p.id_usuario = u.id_usuario
       JOIN horarios_profesores hp ON hp.id_profesor = p.id_profesor
       GROUP BY p.id_profesor
       ORDER BY u.nombre
       LIMIT 10`
    );
    logger.info("obtenerProfesoresConHorario (sin filtros):", { total: sinEstado.length });
    return sinEstado;
  }
  return rows;
}

// Horarios de un profesor especifico
async function obtenerHorariosProfesor(idProfesor, db) {
  const [rows] = await db.execute(
    `SELECT hp.titulo, hp.descripcion, hp.ruta_pdf, hp.fecha_subida
     FROM horarios_profesores hp
     WHERE hp.id_profesor = ?
     ORDER BY hp.fecha_subida DESC`,
    [idProfesor]
  );
  return rows;
}

// Documento institucional ??" cacheado en memoria (se refresca cada 10 min)
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

// Guardar log ??" fire-and-forget (no bloquea la respuesta al usuario)
function guardarLog(pregunta, respuesta, categoria, id_usuario, db) {
  db.execute(
    `INSERT INTO chatbot (pregunta, respuesta, categoria) VALUES (?, ?, ?)`,
    [pregunta.substring(0, 255), respuesta.substring(0, 500), categoria]
  ).catch((e) => logger.warn("No se pudo guardar log:", e.message));
}

// =========================================================
// CLAUDE API  (con cache de respuestas para velocidad)
// =========================================================
const faqCache = new Map();       // key = pregunta normalizada, value = { respuesta, ts }
const FAQ_CACHE_TTL = 1_800_000;  // 30 min

async function preguntarAClaude(pregunta, apiKey, db) {
  // Cache: si ya respondimos algo muy parecido, reutilizar
  const cacheKey = pregunta.toLowerCase().trim().replace(/[^a-z0-9áéíóúñü ]/g, "");
  const cached = faqCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FAQ_CACHE_TTL) {
    logger.info("[FAQ-CACHE] hit:", cacheKey);
    return cached.respuesta;
  }

  const DOCUMENTO = await obtenerDocumentoInstitucional(db);

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system:     DOCUMENTO,
      messages:   [{ role: "user", content: pregunta }],
    },
    {
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type":      "application/json",
      },
      timeout: 8000,
    }
  );

  const respuesta = response.data.content[0]?.text ||
    "No pude procesar tu pregunta. Acude a Servicios Escolares.";

  // Guardar en cache
  faqCache.set(cacheKey, { respuesta, ts: Date.now() });
  // Limitar tamaño del cache (max 100 entradas)
  if (faqCache.size > 100) {
    const oldest = faqCache.keys().next().value;
    faqCache.delete(oldest);
  }

  return respuesta;
}

// =========================================================
// MANEJADOR DE MENSAJES
// =========================================================
const userState = {};
const userStateTs = {}; // Timestamp de cada estado
const STATE_TTL = 600_000; // 10 minutos de timeout para estados pendientes

function limpiarEstado(telefono) {
  delete userState[telefono];
  delete userStateTs[telefono];
  delete userState[`${telefono}_vacante`];
  delete userState[`${telefono}_usuario_postulacion`];
}

// Intenciones que NECESITAN identificar al usuario en BD
const INTENTS_NEED_USER = new Set(["mis_proyectos", "buscar_matching"]);

async function handleMessage({ from, msg, token, phoneNumberId, cfg, db }) {
  const t0 = Date.now();

  // Limpiar estado si expiro el TTL
  if (userState[from] && userStateTs[from] && (Date.now() - userStateTs[from] > STATE_TTL)) {
    logger.info("Estado expirado para", from, "estado:", userState[from]);
    limpiarEstado(from);
  }

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

  // ?"??"? Funcion lazy: identifica usuario solo cuando se necesite ?"??"?
  // -- Identificacion de usuario EAGER: lanza la query ya, sin bloquear --
  let usuario = getCachedUser(from); // del cache si existe (no va a BD)
  let usuarioPromise = null;

  if (usuario === undefined) {
    // No esta en cache: lanzar query en background YA (no await)
    usuario = null;
    usuarioPromise = identificarUsuario(from, db).then((u) => {
      usuario = u;
      return u;
    }).catch((e) => {
      logger.warn("No se pudo identificar usuario:", e.message);
      return null;
    });
  }

  // Solo bloquea si REALMENTE se necesita el resultado
  async function requireUsuario() {
    if (usuario) return usuario;
    if (usuarioPromise) {
      const t = Date.now();
      usuario = await usuarioPromise;
      logger.info(`[TIMING] requireUsuario await: ${Date.now() - t}ms`);
      usuarioPromise = null;
    }
    return usuario;
  }

  // ?"??"? Despedida directa (salir/adios/bye) ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
  const FAREWELL_WORDS = ["salir", "adios", "bye", "chao", "hasta luego", "gracias"];
  if (textoLibre && FAREWELL_WORDS.includes(textoLibre.toLowerCase())) {
    limpiarEstado(from);
    const nombre = usuario?.nombre?.split(" ")[0];
    const despedida = nombre
      ? `Gracias *${nombre}* por usar *SkillMatch*. Exito en tu estadia!`
      : "Gracias por usar *SkillMatch*. Exito en tu estadia!";
    await sendWhatsAppText({ to: from, token, phoneNumberId, text: despedida });
    return;
  }

  // ?"??"? Estado: esperando que seleccione una vacante de la lista ?"??"?
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
      limpiarEstado(from);
      await enviarRespuestaConOpciones({
        to: from, token, phoneNumberId,
        textoRespuesta: "Esa vacante ya no esta disponible.",
        intencion: "buscar_matching", usuario,
      });
      return;
    }

    const vacante = rows[0];

    // Guardar la vacante seleccionada y pedir confirmacion
    userState[from] = "esperando_confirmar_postulacion";
    userStateTs[from] = Date.now();
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

  // ?"??"? Estado: confirmar postulacion ?"??"?
  if (estado === "esperando_confirmar_postulacion") {
    const vacante  = userState[`${from}_vacante`];
    const usuarioP = userState[`${from}_usuario_postulacion`];

    if (seleccionId === "postular_no" || textoLibre?.toLowerCase() === "no") {
      limpiarEstado(from);
      await enviarRespuestaConOpciones({
        to: from, token, phoneNumberId,
        textoRespuesta: "De acuerdo, no se realizo la postulacion.",
        intencion: "buscar_matching", usuario,
      });
      return;
    }

    if (seleccionId === "postular_si" || textoLibre?.toLowerCase() === "si") {
      if (!usuarioP?.id_estudiante || !vacante?.id_vacante) {
        limpiarEstado(from);
        await enviarRespuestaConOpciones({
          to: from, token, phoneNumberId,
          textoRespuesta: "No fue posible completar la postulacion. Asegurate de estar registrado en SkillMatch.",
          intencion: "buscar_matching", usuario,
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
          textoResp = `? Te has postulado exitosamente a *${vacante.titulo}* en *${vacante.razon_social}*.\n\nEstado: ? Pendiente\nLa empresa revisara tu perfil y proyectos en SkillMatch.`;
        }

        guardarLog(
          `Postulacion: ${vacante.titulo}`,
          textoResp,
          "buscar_matching",
          usuarioP.id_usuario || null,
          db2
        );
        registrarInteraccion(from, "buscar_matching");
        limpiarEstado(from);
        await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: textoResp, intencion: "buscar_matching", usuario });
      } catch (e) {
        logger.error("Error al crear postulacion:", e.message);
        limpiarEstado(from);
        await enviarRespuestaConOpciones({
          to: from, token, phoneNumberId,
          textoRespuesta: "Hubo un error al procesar tu postulacion. Intenta desde la plataforma web de SkillMatch.",
          intencion: "buscar_matching", usuario,
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

  // ?"?"? Estado: esperando que seleccione un profesor ?"?"?
  if (estado === "esperando_seleccion_profesor") {
    const profId = seleccionId?.startsWith("profesor_") ? seleccionId.replace("profesor_", "") : null;

    if (!profId) {
      await sendWhatsAppText({
        to: from, token, phoneNumberId,
        text: "Por favor selecciona un profesor de la lista.",
      });
      return;
    }

    try {
      const horarios = await obtenerHorariosProfesor(profId, db);
      // Obtener nombre del profesor
      const [profRows] = await db.execute(
        `SELECT u.nombre, u.apellido, p.asignaturas
         FROM profesores p
         JOIN usuarios u ON p.id_usuario = u.id_usuario
         WHERE p.id_profesor = ? LIMIT 1`,
        [profId]
      );
      const prof = profRows[0];
      const nombreProf = prof ? `${prof.nombre} ${prof.apellido || ""}`.trim() : "Profesor";

      if (horarios.length === 0) {
        limpiarEstado(from);
        await enviarRespuestaConOpciones({
          to: from, token, phoneNumberId,
          textoRespuesta: `No se encontraron horarios para *${nombreProf}*.`,
          intencion: "horarios", usuario,
        });
        return;
      }

      let texto = `\ud83d\udc64 *${nombreProf}*\n`;
      if (prof?.asignaturas) texto += `Asignaturas: ${prof.asignaturas}\n`;
      texto += `\n\ud83d\udcc4 *Horarios disponibles:* ${horarios.length}\n`;

      for (const h of horarios) {
        texto += `\n\u2022 *${h.titulo}*`;
        if (h.descripcion) texto += ` - ${h.descripcion}`;
      }

      texto += "\n\nEnviando PDF...";

      // Enviar texto informativo
      await sendWhatsAppText({ to: from, token, phoneNumberId, text: texto });

      // Enviar cada PDF como documento por WhatsApp
      const BASE_URL = "https://skillmatch-lkz9.onrender.com";
      for (const h of horarios) {
        if (h.ruta_pdf) {
          const pdfUrl = h.ruta_pdf.startsWith("http")
            ? h.ruta_pdf
            : `${BASE_URL}/${h.ruta_pdf.replace(/^\//, "")}`;
          const filename = `${nombreProf} - ${h.titulo}.pdf`;
          try {
            await sendWhatsAppDocument({
              to: from, token, phoneNumberId,
              documentUrl: pdfUrl,
              filename,
              caption: `\ud83d\udcc4 Horario: ${h.titulo}`,
            });
          } catch (docErr) {
            logger.warn("No se pudo enviar PDF:", docErr.message);
            await sendWhatsAppText({
              to: from, token, phoneNumberId,
              text: `No pude enviar el PDF de *${h.titulo}*. Puedes descargarlo desde:\n${pdfUrl}`,
            });
          }
        }
      }

      guardarLog(textoLibre || `profesor_${profId}`, texto, "horarios", usuario?.id_usuario || null, db);
      limpiarEstado(from);
      await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: "\u00bfDeseas consultar algo mas?", intencion: "horarios", usuario });
    } catch (e) {
      logger.error("Error al consultar horario del profesor:", e.message);
      limpiarEstado(from);
      await enviarRespuestaConOpciones({
        to: from, token, phoneNumberId,
        textoRespuesta: "Hubo un error al consultar el horario. Intenta de nuevo.",
        intencion: "horarios", usuario,
      });
    }
    return;
  }

  // =========================================================
  // AQUI ENTRA LA NEURONA
  // =========================================================
  const mapaMenu = {
    opcion_fechas:             "fechas",
    opcion_horarios:           "horarios",
    opcion_horarios_escolares: "horarios_escolares",
    opcion_horarios_profes:    "horarios_profes",
    opcion_info_uteq:          "info_uteq",
    opcion_faq:                "faq",
    opcion_ayuda_ejemplos:     "ayuda_ejemplos",
    opcion_proyectos:          "mis_proyectos",
    opcion_matching:           "buscar_matching",
    opcion_postulaciones:      "mis_postulaciones_vacantes",
    opcion_menu:               "menu",
  };

  let intencion;
  let necesitaMenu = false;

  if (seleccionId && mapaMenu[seleccionId]) {
    intencion = mapaMenu[seleccionId];

  } else if (textoLibre) {
    entrenarClasificador(); // lazy: solo entrena la primera vez
    const resultado = clasificar(textoLibre);
    intencion    = resultado.intencion;
    necesitaMenu = resultado.necesitaMenu;

    logger.info("Neurona clasifico:", {
      texto:     textoLibre,
      intencion,
      confianza: resultado.confianza,
    });

    // Respuesta rapida si no se entendio el mensaje
    if (intencion === "no_entendido") {
      await sendWhatsAppButtons({
        to: from, token, phoneNumberId,
        bodyText: "Lo siento, no comprendi tu mensaje.\n\nPuedes volver a intentarlo o usar el menu interactivo.",
        buttons: [
          { id: "opcion_menu",  title: "Ver menu" },
          { id: "opcion_faq",   title: "Pregunta frecuente" },
          { id: "opcion_fechas", title: "Ver fechas" },
        ],
      });
      logger.info(`[TIMING] total no_entendido: ${Date.now() - t0}ms`);
      return;
    }

  } else {
    // No hay texto ni seleccion: mostrar menu
    await requireUsuario();
    await enviarMenu({ to: from, token, phoneNumberId, usuario, from });
    return;
  }

  if (necesitaMenu) {
    limpiarEstado(from);
    await requireUsuario();
    await enviarMenu({ to: from, token, phoneNumberId, usuario, from });
    return;
  }

  // ?"??"? Bloquear intents avanzados para usuarios no registrados ?"??"?
  if (INTENTS_REQUIEREN_REGISTRO.has(intencion)) {
    await requireUsuario();
    if (!usuario) {
      const textoBloqueo =
        "Esta funcion requiere estar registrado en SkillMatch.\n\n" +
        "Registrate en:\nhttps://skillmatch-lkz9.onrender.com/\n\n" +
        "Mientras tanto puedes consultar fechas, horarios o preguntas frecuentes.";
      await sendWhatsAppButtons({
        to: from, token, phoneNumberId,
        bodyText: textoBloqueo,
        buttons: [
          { id: "opcion_fechas",    title: "Fechas" },
          { id: "opcion_horarios",  title: "Horarios" },
          { id: "opcion_faq",       title: "FAQ" },
        ],
      });
      return;
    }
  }

  // =========================================================
  // ENRUTAMIENTO POR INTENCION
  // =========================================================
  switch (intencion) {

    // ?"??"? FECHAS ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
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
      registrarInteraccion(from, "fechas");
      limpiarEstado(from);
      await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: texto, intencion: "fechas", usuario });
      logger.info(`[TIMING] total fechas: ${Date.now() - t0}ms`);
      break;
    }

    // -- HORARIOS (sub-menu) ----------------------------------
    case "horarios": {
      await sendWhatsAppButtons({
        to: from, token, phoneNumberId,
        bodyText: "¿Que horarios deseas consultar?",
        buttons: [
          { id: "opcion_horarios_escolares", title: "Servicios Escolares" },
          { id: "opcion_horarios_profes",    title: "Profesores" },
          { id: "opcion_menu",               title: "Menu" },
        ],
      });
      registrarInteraccion(from, "horarios");
      logger.info(`[TIMING] total horarios: ${Date.now() - t0}ms`);
      break;
    }

    // -- HORARIOS SERVICIOS ESCOLARES -------------------------
    case "horarios_escolares": {
      const texto =
        "*Horarios de atencion:*\n\n" +
        "\ud83d\udccd *Servicios Escolares:*\n" +
        "Lun-Vie: 9:00 - 14:00 y 16:00 - 18:00\n\n" +
        "\ud83d\udccd *Vinculacion:*\n" +
        "Lun-Vie: 9:00 - 15:00\n" +
        "Ubicacion: Edificio principal, planta baja\n\n" +
        "\ud83d\udcde Telefono UTEQ: (442) 209 6100";

      guardarLog(textoLibre || "opcion_horarios_escolares", texto, "horarios", usuario?.id_usuario || null, db);
      limpiarEstado(from);
      await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: texto, intencion: "horarios", usuario });
      break;
    }

    // -- HORARIOS PROFESORES ----------------------------------
    case "horarios_profes": {
      try {
        const profes = await obtenerProfesoresConHorario(db);

        if (profes.length === 0) {
          const texto = "No hay profesores con horarios subidos en este momento.\n\nConsulta el directorio completo en la plataforma SkillMatch.";
          limpiarEstado(from);
          await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: texto, intencion: "horarios", usuario });
          break;
        }

        const rows = profes.map((p) => ({
          id:          `profesor_${p.id_profesor}`,
          title:       `${p.nombre} ${p.apellido || ""}`.substring(0, 24),
          description: (p.asignaturas || "Sin asignaturas").substring(0, 72),
        }));

        userState[from] = "esperando_seleccion_profesor";
        userStateTs[from] = Date.now();

        await sendWhatsAppList({
          to: from, token, phoneNumberId,
          headerText: "Profesores - TI",
          bodyText: "*Profesores del area de Tecnologias de la Informacion* con horarios disponibles.\n\nSelecciona un profesor para ver su horario:",
          buttonText: "Ver profesores",
          sections: [{ title: "Profesores TI", rows }],
        });

        guardarLog(textoLibre || "opcion_horarios_profes", `Mostrando ${profes.length} profesores`, "horarios", usuario?.id_usuario || null, db);
        registrarInteraccion(from, "horarios");
      } catch (e) {
        logger.warn("Error al consultar profesores:", e.message);
        limpiarEstado(from);
        await enviarRespuestaConOpciones({
          to: from, token, phoneNumberId,
          textoRespuesta: "No fue posible consultar los profesores en este momento.\nIntenta de nuevo mas tarde.",
          intencion: "horarios", usuario,
        });
      }
      break;
    }

    // ?"??"? MIS PROYECTOS ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
    case "mis_proyectos": {
      await requireUsuario();
      if (!usuario) {
        const texto =
          "Para ver tus proyectos necesito identificarte.\n\n" +
          "Asegurate de que tu numero de WhatsApp este registrado en tu perfil de SkillMatch.\n" +
          "Puedes actualizarlo desde la plataforma web.";
        limpiarEstado(from);
        await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: texto, intencion: "mis_proyectos", usuario });
        break;
      }

      const proyectos = await obtenerProyectosEstudiante(usuario.id_usuario, db);

      if (proyectos.length === 0) {
        const texto =
          `Hola *${usuario.nombre}*, aun no tienes proyectos subidos en SkillMatch.\n\n` +
          `Puedes subir tu primer proyecto desde la plataforma web para que las empresas te encuentren.`;
        registrarInteraccion(from, "mis_proyectos");
        limpiarEstado(from);
        await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: texto, intencion: "mis_proyectos", usuario });
        break;
      }

      let texto = `*Tus proyectos en SkillMatch, ${usuario.nombre}:*\n\n`;
      for (const p of proyectos) {
        const estadoTexto =
          p.estado === "completado"  ? "Completado" :
          p.estado === "en progreso" ? "En progreso" : "Pausado";
        texto += `• *${p.titulo.trim()}* - ${estadoTexto}\n`;
        if (p.tecnologias) texto += `  Tecnologias: ${p.tecnologias}\n`;
        texto += "\n";
      }

      guardarLog(textoLibre || "opcion_proyectos", texto, "mis_proyectos", usuario.id_usuario, db);
      registrarInteraccion(from, "mis_proyectos");
      limpiarEstado(from);
      await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: texto, intencion: "mis_proyectos", usuario });
      logger.info(`[TIMING] total mis_proyectos: ${Date.now() - t0}ms`);
      break;
    }

    // ?"??"? BUSCAR MATCHING ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
    case "buscar_matching": {
      await requireUsuario();

      if (!usuario || usuario.rol !== "estudiante" || !usuario.id_estudiante) {
        limpiarEstado(from);
        await enviarRespuestaConOpciones({
          to: from, token, phoneNumberId,
          textoRespuesta:
            "Para ver vacantes y postularte necesito identificarte como estudiante.\n\n" +
            "Asegurate de que tu numero de WhatsApp este registrado en tu perfil de SkillMatch.",
          intencion: "buscar_matching", usuario,
        });
        break;
      }

      // Obtener vacantes abiertas y mostrarlas como lista interactiva
      const vacantes = await obtenerVacantesAbiertas(db);

      if (vacantes.length === 0) {
        limpiarEstado(from);
        await enviarRespuestaConOpciones({
          to: from, token, phoneNumberId,
          textoRespuesta: "No hay vacantes disponibles en este momento.\n\nAcude a Vinculacion para mas opciones.",
          intencion: "buscar_matching", usuario,
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
      userStateTs[from] = Date.now();
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

    // ?"??"? MIS POSTULACIONES ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
    case "mis_postulaciones_vacantes": {
      await requireUsuario();

      if (!usuario || usuario.rol !== "estudiante" || !usuario.id_estudiante) {
        limpiarEstado(from);
        await enviarRespuestaConOpciones({
          to: from, token, phoneNumberId,
          textoRespuesta:
            "Para ver tus postulaciones necesito identificarte como estudiante.\n\n" +
            "Asegurate de que tu numero de WhatsApp este registrado en tu perfil de SkillMatch.",
          intencion: "mis_postulaciones_vacantes", usuario,
        });
        break;
      }

      const postulaciones = await obtenerPostulacionesEstudiante(usuario.id_estudiante, db);

      if (postulaciones.length === 0) {
        registrarInteraccion(from, "mis_postulaciones_vacantes");
        limpiarEstado(from);
        await enviarRespuestaConOpciones({
          to: from, token, phoneNumberId,
          textoRespuesta:
            `*${usuario.nombre}*, aun no te has postulado a ninguna vacante.\n\n` +
            `Selecciona *Buscar vacantes* en el menu para ver las vacantes disponibles y aplicar.`,
          intencion: "mis_postulaciones_vacantes", usuario,
        });
        break;
      }

      const estadoMap = {
        pendiente:   "\u23f3 Pendiente",
        en_revision: "\ud83d\udd0d En revision",
        aceptado:    "\u2705 Aceptado",
        rechazado:   "\u274c Rechazado",
      };

      let texto = `*Tus postulaciones, ${usuario.nombre}:*\n\n`;
      for (const po of postulaciones) {
        const fecha = new Date(po.fecha_postulacion).toLocaleDateString("es-MX", {
          day: "numeric", month: "short", year: "numeric",
        });
        texto += `• *${po.titulo}* - ${po.razon_social}\n`;
        texto += `  Estado: ${estadoMap[po.estado] || po.estado}\n`;
        texto += `  Fecha: ${fecha}\n\n`;
      }

      guardarLog(textoLibre || "opcion_postulaciones", texto, "mis_postulaciones", usuario.id_usuario, db);
      registrarInteraccion(from, "mis_postulaciones_vacantes");
      limpiarEstado(from);
      await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: texto, intencion: "mis_postulaciones_vacantes", usuario });
      logger.info(`[TIMING] total mis_postulaciones: ${Date.now() - t0}ms`);
      break;
    }

    // ?"??"? FAQ ??' CLAUDE API ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
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

      registrarInteraccion(from, "faq");
      limpiarEstado(from);
      await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: respuesta, intencion: "faq", usuario });
      logger.info(`[TIMING] total faq: ${Date.now() - t0}ms`);
      break;
    }

    // -- AYUDA / EJEMPLOS -------------------------------------
    case "ayuda_ejemplos": {
      const esEstudiante = usuario?.rol === "estudiante";
      const seccionesAnonimo = [
        { title: "Fechas y horarios", rows: [
          { id: "opcion_fechas",   title: "Fechas de estadia",    description: "Inicio, fin y periodos de estadia" },
          { id: "opcion_horarios", title: "Horarios y contactos", description: "Servicios Escolares, profesores" },
        ]},
        { title: "Informacion general", rows: [
          { id: "opcion_info_uteq", title: "Info sobre la UTEQ",   description: "Ubicacion, telefono y datos" },
          { id: "opcion_faq",       title: "Preguntas frecuentes", description: "Requisitos, titulacion, obligaciones" },
        ]},
      ];
      const seccionesEstudiante = [
        { title: "Fechas y horarios", rows: [
          { id: "opcion_fechas",   title: "Fechas de estadia",    description: "Inicio, fin y periodos de estadia" },
          { id: "opcion_horarios", title: "Horarios y contactos", description: "Servicios Escolares, profesores" },
        ]},
        { title: "Vacantes y postulaciones", rows: [
          { id: "opcion_matching",      title: "Buscar vacantes",   description: "Vacantes abiertas para aplicar" },
          { id: "opcion_postulaciones", title: "Mis postulaciones", description: "Estado de tus aplicaciones" },
          { id: "opcion_proyectos",     title: "Mis proyectos",     description: "Tus proyectos en SkillMatch" },
        ]},
        { title: "Informacion general", rows: [
          { id: "opcion_info_uteq", title: "Info sobre la UTEQ",   description: "Ubicacion, telefono y datos" },
          { id: "opcion_faq",       title: "Preguntas frecuentes", description: "Requisitos, titulacion, obligaciones" },
        ]},
      ];

      const textoAyuda =
        "*\u00bfQue puedo preguntar?*\n\n" +
        "Puedes seleccionar un tema de la lista o *escribirme directamente*, por ejemplo:\n\n" +
        "\u2022 _\u00bfCuando empieza la estadia?_\n" +
        "\u2022 _\u00bfA que hora atiende Servicios Escolares?_\n" +
        "\u2022 _\u00bfDonde esta la UTEQ?_\n" +
        "\u2022 _\u00bfQue pasa si no tengo empresa?_\n" +
        (esEstudiante
          ? "\u2022 _\u00bfQue empresas buscan desarrolladores?_\n" +
            "\u2022 _\u00bfEn que estado estan mis postulaciones?_\n" +
            "\u2022 _\u00bfComo esta mi proyecto?_\n"
          : "") +
        "\u2022 _\u00bfComo edito mi perfil?_\n" +
        "\nSelecciona un tema para comenzar:";

      guardarLog(textoLibre || "ayuda_ejemplos", textoAyuda, "ayuda_ejemplos", usuario?.id_usuario || null, db);
      limpiarEstado(from);
      await sendWhatsAppList({
        to: from, token, phoneNumberId,
        bodyText: textoAyuda,
        buttonText: "Ver temas",
        sections: esEstudiante ? seccionesEstudiante : seccionesAnonimo,
      });
      logger.info(`[TIMING] total ayuda_ejemplos: ${Date.now() - t0}ms`);
      break;
    }

    // -- INFO UTEQ --------------------------------------------
    case "info_uteq": {
      const texto =
        "*Universidad Tecnologica de Queretaro (UTEQ)*\n\n" +
        "\ud83d\udccd Av. Pie de la Cuesta No. 2501\nCol. Unidad Nacional, Queretaro, Qro. C.P. 76148\n\n" +
        "\ud83d\udcde Telefonos: (442) 209 6100 al 04\n" +
        "\ud83c\udf10 www.uteq.edu.mx\n\n" +
        "*SkillMatch* es la plataforma digital de la UTEQ que conecta estudiantes, profesores y empresas " +
        "para gestionar estadias profesionales.\n\n" +
        "Permite a los estudiantes mostrar sus proyectos innovadores y a las empresas encontrar talento " +
        "segun las tecnologias que buscan.\n\n" +
        "Registrate o inicia sesion en:\nhttps://skillmatch-lkz9.onrender.com/";

      guardarLog(textoLibre || "opcion_info_uteq", texto, "info_uteq", usuario?.id_usuario || null, db);
      registrarInteraccion(from, "info_uteq");
      limpiarEstado(from);
      await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: texto, intencion: "info_uteq", usuario });
      logger.info(`[TIMING] total info_uteq: ${Date.now() - t0}ms`);
      break;
    }

    // -- CONFIGURAR PERFIL ------------------------------------
    case "configurar_perfil": {
      await requireUsuario();
      const texto = usuario
        ? `*${usuario.nombre.split(" ")[0]}*, puedes editar tu perfil desde la plataforma web de SkillMatch:\n\nhttps://skillmatch-lkz9.onrender.com/\n\nAhi podras actualizar tus datos personales, telefono, correo y mas.`
        : "Para configurar tu perfil necesitas estar registrado en SkillMatch.\n\nRegistrate en:\nhttps://skillmatch-lkz9.onrender.com/";

      guardarLog(textoLibre || "configurar_perfil", texto, "configurar_perfil", usuario?.id_usuario || null, db);
      limpiarEstado(from);
      await enviarRespuestaConOpciones({ to: from, token, phoneNumberId, textoRespuesta: texto, intencion: "faq", usuario });
      break;
    }

    // ?"??"? MENU (fallback) ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
    case "menu":
    default: {
      await requireUsuario();
      // Siempre mostrar lista completa (nunca atajos al pedir menu)
      await sendWhatsAppList({
        to: from, token, phoneNumberId,
        headerText: "SkillMatch",
        bodyText:   obtenerSaludo(usuario),
        buttonText: "Ver opciones",
        sections:   generarMenu(usuario),
      });
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
    // ?"??"? Responder 200 INMEDIATAMENTE para que Meta no reintente ?"??"?
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

      // ?"??"? Deduplicar: si ya procesamos este mensaje, ignorar ?"??"?
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
