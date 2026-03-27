// classifier.js — Neurona ML con natural.js
// Naive Bayes para clasificar intenciones del usuario

import natural from "natural";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const classifier = new natural.BayesClassifier();
let entrenado = false;

// Lee training_data.csv y entrena la neurona
// Se llama UNA SOLA VEZ al arrancar Firebase Functions
export function entrenarClasificador() {
  if (entrenado) return;

  const csvPath = path.join(__dirname, "training_data.csv");

  if (!fs.existsSync(csvPath)) {
    console.error("No se encontro training_data.csv en:", csvPath);
    return;
  }

  const csv = fs.readFileSync(csvPath, "utf8");
  const lineas = csv.trim().split("\n").slice(1);

  let total = 0;
  for (const linea of lineas) {
    const coma = linea.indexOf(",");
    if (coma === -1) continue;

    const texto    = linea.substring(0, coma).trim().toLowerCase();
    const categoria = linea.substring(coma + 1).trim();

    if (texto && categoria) {
      classifier.addDocument(texto, categoria);
      total++;
    }
  }

  classifier.train();
  entrenado = true;
  console.log(`Neurona entrenada con ${total} frases`);
}

// Clasifica el texto libre del usuario
// Retorna: { intencion, confianza, necesitaMenu }
export function clasificar(textoOriginal) {
  if (!entrenado) {
    console.warn("Clasificador no entrenado, mostrando menu");
    return { intencion: "menu", confianza: 0, necesitaMenu: false };
  }

  const texto = textoOriginal.toLowerCase().trim();

  // Naive Bayes elige siempre la categoria mas probable
  const intencion = classifier.classify(texto);

  // Solo muestra menu si el modelo clasifico como "menu"
  // y el texto es muy corto (saludo de una palabra)
  const necesitaMenu = intencion === "menu" && texto.split(" ").length <= 1;

  return {
    intencion,
    confianza: 1,
    necesitaMenu,
  };
}