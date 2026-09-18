// Procesado de los ficheros subidos: PDF -> imágenes (con pdf.js), imágenes y HTML tal cual.

const MAX_WIDTH = 1600; // px de ancho al renderizar un PDF: sobra para leer cualquier QR
const MAX_PIXELS = 12_000_000; // Safari en iOS no permite canvas mucho mayores

export function kindOf(file) {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type === "text/html" || /\.html?$/.test(name)) return "html";
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic)$/.test(name)) return "image";
  return null;
}

let pdfjsPromise;

function loadPdfjs() {
  // Se carga solo cuando hace falta: pdf.js pesa ~1,5 MB.
  pdfjsPromise ??= import("../vendor/pdfjs/pdf.min.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "../vendor/pdfjs/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    return pdfjs;
  });
  return pdfjsPromise;
}

export async function pdfToImages(file) {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pages = [];
  try {
    const doc = await loadingTask.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      let scale = MAX_WIDTH / base.width;
      scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport, background: "white" }).promise;
      pages.push(await new Promise((resolve) => canvas.toBlob(resolve, "image/png")));

      page.cleanup();
      canvas.width = canvas.height = 0; // libera memoria en iOS
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}

// Prepara un fichero para guardarlo. Devuelve { kind, pages, original } o lanza un error legible.
export async function processFile(file) {
  const kind = kindOf(file);
  if (!kind) throw new Error(`Formato no soportado: ${file.name}`);
  const pages = kind === "pdf" ? await pdfToImages(file) : [];
  // Copia el contenido en un Blob propio: en iOS los File de un <input> pueden dejar de ser legibles.
  const original = new Blob([await file.arrayBuffer()], { type: file.type });
  return { kind, pages, original };
}

// ------------------------------------------------------------------ base64 (copias de seguridad)

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); // data:<tipo>;base64,...
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function base64ToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}
