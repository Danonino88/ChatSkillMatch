// =========================================================
// 🧠 classifier.js — Neurona ML con natural.js
// Naive Bayes + TF-IDF para clasificar intenciones
// Vive dentro de functions/ junto a index.js
// =========================================================

import natural from "natural";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Instancia del clasificador Naive Bayes ───────────────
const classifier = new natural.BayesClassifier();
let entrenado = false;

// =========================================================
// 🏋️ ENTRENAMIENTO
// Lee training_data.csv y entrena la neurona.
// Se llama UNA SOLA VEZ al arrancar Firebase Functions.
// =========================================================
export function entrenarClasificador() {
  if (entrenado) return; // Evita reentrenar si ya está listo

  const csvPath = path.join(__dirname, "training_data.csv");

  if (!fs.existsSync(csvPath)) {
    console.error("❌ No se encontró training_data.csv en:", csvPath);
    return;
  }

  const csv = fs.readFileSync(csvPath, "utf8");
  const lineas = csv.trim().split("\n").slice(1); // Salta el header

  let total = 0;
  for (const linea of lineas) {
    const coma = linea.indexOf(",");
    if (coma === -1) continue;

    const texto = linea.substring(0, coma).trim().toLowerCase();
    const categoria = linea.substring(coma + 1).trim();

    if (texto && categoria) {
      classifier.addDocument(texto, categoria);
      total++;
    }
  }

  classifier.train();
  entrenado = true;
  console.log(`✅ Neurona entrenada con ${total} frases`);
}

// =========================================================
// 🔍 CLASIFICACIÓN
// Recibe un texto libre y devuelve la intención detectada.
// Retorna: { intencion, confianza, necesitaMenu }
//
// Categorías posibles:
//   fechas         → info pública sobre fechas de estadía
//   horarios       → horarios de servicios / profesores
//   mis_proyectos  → proyectos del estudiante en SkillMatch
//   faq            → dudas generales → Claude API
//   buscar_matching→ matching empresa↔estudiante por tecnología
//   menu           → saludo o fallback → mostrar menú
// =========================================================
export function clasificar(textoOriginal) {
  if (!entrenado) {
    console.warn("⚠️ Clasificador no entrenado, mostrando menú");
    return { intencion: "menu", confianza: 0, necesitaMenu: true };
  }

  const texto = textoOriginal.toLowerCase().trim();

  // Clasificar y obtener scores de todas las categorías
  const intencion = classifier.classify(texto);
  const clasificaciones = classifier.getClassifications(texto);

  // El score más alto es el de la categoría ganadora
  const scoreGanador = clasificaciones[0]?.value ?? 0;
  const scoreSegundo = clasificaciones[1]?.value ?? 0;

  // Confianza = diferencia entre el 1er y 2do lugar
  // Si están muy cerca, el modelo no está seguro
  const confianza = scoreGanador - scoreSegundo;
  const UMBRAL = 0.5; // Ajusta este valor si hay muchos falsos positivos

  return {
    intencion,
    confianza: parseFloat(confianza.toFixed(3)),
    necesitaMenu: confianza < UMBRAL,
  };
}