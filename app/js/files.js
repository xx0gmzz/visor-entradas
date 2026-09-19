// Procesado de los ficheros subidos: PDF -> imágenes (con pdf.js), imágenes y HTML tal cual.
// También saca miniaturas, lee el texto del PDF para rellenar el formulario y busca códigos QR.

const MAX_WIDTH = 1600; // px de ancho al renderizar un PDF: sobra para leer cualquier QR
const MAX_PIXELS = 12_000_000; // Safari en iOS no permite canvas mucho mayores
const THUMB_WIDTH = 240; // miniatura para las listas

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

export async function pdfToImages(file, onProgress) {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pages = [];
  const texts = [];
  try {
    const doc = await loadingTask.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress?.(n, doc.numPages);
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      let scale = MAX_WIDTH / base.width;
      scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
      const viewport = page.getViewport({ scale });

      try {
        const content = await page.getTextContent();
        texts.push(content.items.map((i) => i.str).join(" "));
      } catch {
        // Un PDF escaneado no tiene capa de texto: no pasa nada, solo no habrá autorrelleno.
        texts.push("");
      }

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
  return { pages, texts };
}

// Lee texto y número de páginas sin renderizar: sirve para proponer fecha y titular antes de
// guardar y para ofrecer «una entrada por página».
export async function pdfInfo(file) {
  try {
    const pdfjs = await loadPdfjs();
    const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
    try {
      const doc = await loadingTask.promise;
      const out = [];
      for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        out.push(content.items.map((i) => i.str).join(" "));
        page.cleanup();
      }
      return { text: out.join("\n"), numPages: doc.numPages };
    } finally {
      await loadingTask.destroy();
    }
  } catch {
    return { text: "", numPages: 0 };
  }
}

// Prepara un fichero para guardarlo. Devuelve { kind, pages, texts, original, thumb }
// (texts: texto de cada página del PDF) o lanza un error legible.
export async function processFile(file, onProgress) {
  const kind = kindOf(file);
  if (!kind) throw new Error(`Formato no soportado: ${file.name}`);
  let pages = [];
  let texts = [];
  if (kind === "pdf") ({ pages, texts } = await pdfToImages(file, onProgress));
  // Copia el contenido en un Blob propio: en iOS los File de un <input> pueden dejar de ser legibles.
  const original = new Blob([await file.arrayBuffer()], { type: file.type });
  const thumb = await makeThumb(kind === "pdf" ? pages[0] : kind === "image" ? original : null);
  return { kind, pages, texts, original, thumb };
}

// ------------------------------------------------------------------ miniaturas

export async function makeThumb(source) {
  if (!source) return null;
  try {
    const bitmap = await createImageBitmap(source);
    const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    canvas.width = canvas.height = 0;
    return blob;
  } catch {
    return null; // p. ej. un HEIC que el navegador no sabe decodificar
  }
}

// ------------------------------------------------------------------ autorrelleno desde el texto

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const validDate = (y, m, d) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

function findDates(text) {
  const found = [];
  const push = (y, m, d) => validDate(y, m, d) && found.push(iso(y, m, d));

  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g))
    push(+m[3], +m[2], +m[1]); // dd/mm/aaaa (formato español)
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) push(+m[1], +m[2], +m[3]);
  for (const m of text.matchAll(
    /\b(\d{1,2})\s*(?:de\s+)?([a-záéíóúñ]{3,12})\.?\s*(?:de\s+)?(\d{4})\b/gi,
  )) {
    const needle = m[2].toLowerCase();
    const month = MONTH_NAMES.findIndex((name) => name.startsWith(needle.slice(0, 3)));
    if (month >= 0) push(+m[3], month + 1, +m[1]);
  }
  return found;
}

const LOCATOR_LABELS =
  /(?:localizador|n[.º°]?\s*de\s*(?:reserva|pedido|entrada|billete)|reserva|referencia|confirmaci[óo]n|booking(?:\s*(?:ref|code))?|order|c[óo]digo)\b/i;

function findLocator(text) {
  // Se busca la etiqueta y se coge el primer "código" que venga detrás.
  const label = text.match(LOCATOR_LABELS);
  if (!label) return null;
  const after = text.slice(label.index + label[0].length, label.index + label[0].length + 80);
  const code = after.match(/\b([A-Z0-9][A-Z0-9-]{5,24})\b/);
  return code ? code[1] : null;
}

const HOLDER_LABELS =
  /(?:titular|a\s+nombre\s+de|nombre(?:\s+del?\s+(?:cliente|visitante|pasajero|titular))?|visitante|cliente|name)\s*:?\s*/i;

// En el texto de un PDF los campos van seguidos («… López Precio 60 €»): el nombre se corta
// en cuanto aparece una palabra típica de etiqueta.
const NAME_STOP = new Set(
  (
    "precio importe total fecha entrada entradas localizador reserva dni nif pasaporte tipo " +
    "válido valido válida valida email correo teléfono telefono edad adulto adultos niño niños " +
    "junior senior parque hora puerta acceso código codigo pedido referencia nº número numero " +
    "ticket tickets date price name booking order visitante titular cliente"
  ).split(" "),
);
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "da", "dos", "van", "von"]);
const CAPITALIZED = /^[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]*$/;

const titleCase = (w) =>
  w === w.toUpperCase() && w.length > 1 ? w.charAt(0) + w.slice(1).toLowerCase() : w;

function findHolder(text) {
  const label = text.match(HOLDER_LABELS);
  if (!label) return null;
  const words = text.slice(label.index + label[0].length).split(" ", 10);
  const name = [];
  for (const raw of words) {
    const word = raw.replace(/[,.;:]+$/, "");
    const lower = word.toLowerCase();
    if (NAME_STOP.has(lower)) break;
    if (CAPITALIZED.test(word)) name.push(titleCase(word));
    else if (PARTICLES.has(lower) && name.length) name.push(lower);
    else break;
    if (raw !== word) break; // «Gómez,» o «López.»: ahí acaba el nombre
    if (name.length >= 6) break;
  }
  while (name.length && PARTICLES.has(name.at(-1))) name.pop(); // «Ana de» -> «Ana»
  return name.length ? name.join(" ") : null;
}

/**
 * Propone campos a partir del texto de la entrada. Solo devuelve lo que encuentra;
 * el usuario siempre puede cambiarlo antes de guardar.
 */
export function guessFields(text, { todayIso } = {}) {
  if (!text || text.length < 20) return {};
  const clean = text.replace(/\s+/g, " ");
  const dates = findDates(clean);
  // La fecha de visita suele ser la primera que no haya pasado ya.
  const future = todayIso ? dates.filter((d) => d >= todayIso) : dates;
  const visitDate = (future.length ? future : dates).sort()[0] ?? null;
  return {
    visitDate,
    locator: findLocator(clean),
    holder: findHolder(clean),
  };
}

// ------------------------------------------------------------------ códigos QR

let detector;

export function canDetectCodes() {
  return typeof BarcodeDetector !== "undefined";
}

/**
 * Busca códigos en una imagen. Devuelve [{ value, box: {x, y, width, height} }] en píxeles
 * de la imagen original. Con BarcodeDetector (Chrome/Android) se lee también el valor; en Safari
 * no existe y se usa locateCode, que solo sabe dónde está (value: null).
 */
export async function detectCodes(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      if (canDetectCodes()) {
        detector ??= new BarcodeDetector({
          formats: ["qr_code", "aztec", "data_matrix", "pdf417", "code_128", "ean_13"],
        });
        const codes = await detector.detect(bitmap);
        if (codes.length) {
          return codes.map((c) => ({ value: c.rawValue, format: c.format, box: c.boundingBox }));
        }
      }
      const box = locateCode(bitmap);
      return box ? [{ value: null, format: null, box }] : [];
    } finally {
      bitmap.close?.();
    }
  } catch {
    return [];
  }
}

/**
 * Localiza sin leerlo el código más probable de una imagen (QR, Aztec, código de barras…).
 *
 * 1. Se reduce la imagen a 320 px de ancho y se divide en celdas de 4 px. Una celda es «de
 *    código» si es casi negra o si es bastante oscura y cambia mucho de blanco a negro.
 * 2. Se unen las celdas vecinas (con un margen de una celda, porque un QR tiene huecos blancos).
 * 3. Cada bloque se trocea por las franjas en blanco de 2+ celdas: así se separa el texto
 *    que va pegado encima o debajo del código.
 * 4. Se queda el trozo más grande que sea compacto, de forma razonable y que no tenga el
 *    patrón de las líneas de texto (filas llenas alternando con filas vacías).
 * 5. Si a los lados hay barras verticales de su misma altura, se amplía: es un código de barras
 *    y sus barras más finas se pierden al reducir la imagen.
 */
export function locateCode(bitmap) {
  const W = 320;
  const C = 4;
  const scale = Math.min(1, W / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  canvas.width = canvas.height = 0;

  const lum = new Uint8Array(w * h);
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    dark[i] = lum[i] < 128 ? 1 : 0;
  }

  const gw = Math.floor(w / C);
  const gh = Math.floor(h / C);
  const cell = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let on = 0;
      let flips = 0;
      for (let y = gy * C; y < gy * C + C; y++) {
        for (let x = gx * C; x < gx * C + C; x++) {
          const v = dark[y * w + x];
          on += v;
          if (x > gx * C && v !== dark[y * w + x - 1]) flips++;
          if (y > gy * C && v !== dark[(y - 1) * w + x]) flips++;
        }
      }
      const ratio = on / (C * C);
      cell[gy * gw + gx] = ratio > 0.8 || (ratio > 0.25 && flips >= C) ? 1 : 0;
    }
  }
  const at = (x, y) => cell[y * gw + x];

  // Paso 2: bloques conexos sobre la rejilla dilatada una celda.
  const grown = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (!at(gx, gy)) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = gx + dx;
          const y = gy + dy;
          if (x >= 0 && y >= 0 && x < gw && y < gh) grown[y * gw + x] = 1;
        }
      }
    }
  }
  const seen = new Uint8Array(gw * gh);
  const blocks = [];
  for (let start = 0; start < gw * gh; start++) {
    if (!grown[start] || seen[start]) continue;
    const box = { x0: gw, y0: gh, x1: -1, y1: -1 };
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % gw;
      const y = (i - x) / gw;
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
      if (x > 0 && grown[i - 1] && !seen[i - 1]) ((seen[i - 1] = 1), stack.push(i - 1));
      if (x < gw - 1 && grown[i + 1] && !seen[i + 1]) ((seen[i + 1] = 1), stack.push(i + 1));
      if (y > 0 && grown[i - gw] && !seen[i - gw]) ((seen[i - gw] = 1), stack.push(i - gw));
      if (y < gh - 1 && grown[i + gw] && !seen[i + gw]) ((seen[i + gw] = 1), stack.push(i + gw));
    }
    blocks.push(box);
  }

  // Paso 3: trocear por franjas en blanco.
  const rowCount = (y, b) => {
    let n = 0;
    for (let x = b.x0; x <= b.x1; x++) n += at(x, y);
    return n;
  };
  const colCount = (x, b) => {
    let n = 0;
    for (let y = b.y0; y <= b.y1; y++) n += at(x, y);
    return n;
  };
  function tighten(b) {
    const t = { x0: b.x1 + 1, y0: b.y1 + 1, x1: b.x0 - 1, y1: b.y0 - 1 };
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        if (!at(x, y)) continue;
        t.x0 = Math.min(t.x0, x);
        t.y0 = Math.min(t.y0, y);
        t.x1 = Math.max(t.x1, x);
        t.y1 = Math.max(t.y1, y);
      }
    }
    return t.x1 >= t.x0 ? t : null;
  }
  // Tramos con contenido separados por 2 o más filas/columnas vacías.
  function spans(from, to, count) {
    const out = [];
    let begin = null;
    let blank = 0;
    for (let i = from; i <= to; i++) {
      if (count(i)) {
        if (begin === null) begin = i;
        blank = 0;
      } else if (begin !== null && ++blank === 2) {
        out.push([begin, i - 2]);
        begin = null;
      }
    }
    if (begin !== null) out.push([begin, to]);
    return out;
  }
  function split(b, depth = 0) {
    const t = tighten(b);
    if (!t) return [];
    if (depth > 12) return [t];
    const rows = spans(t.y0, t.y1, (y) => rowCount(y, t));
    if (rows.length > 1) return rows.flatMap(([y0, y1]) => split({ ...t, y0, y1 }, depth + 1));
    const cols = spans(t.x0, t.x1, (x) => colCount(x, t));
    if (cols.length > 1) return cols.flatMap(([x0, x1]) => split({ ...t, x0, x1 }, depth + 1));
    return [t];
  }

  // Un código de barras se parte en columnas por sus huecos blancos: se vuelven a unir los trozos
  // que ocupan la misma franja horizontal y están muy juntos.
  const pieces = blocks.flatMap((b) => split(b)).sort((a, b) => a.x0 - b.x0);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < pieces.length && !merged; i++) {
      for (let j = i + 1; j < pieces.length && !merged; j++) {
        const a = pieces[i];
        const b = pieces[j];
        const sameBand = Math.abs(a.y0 - b.y0) <= 1 && Math.abs(a.y1 - b.y1) <= 1;
        if (sameBand && b.x0 - a.x1 <= 3 && a.y1 - a.y0 >= 5) {
          pieces[i] = {
            x0: Math.min(a.x0, b.x0),
            y0: Math.min(a.y0, b.y0),
            x1: Math.max(a.x1, b.x1),
            y1: Math.max(a.y1, b.y1),
          };
          pieces.splice(j, 1);
          merged = true;
        }
      }
    }
  }

  // Paso 4: elegir el mejor trozo.
  let best = null;
  for (const piece of pieces) {
    const bw = piece.x1 - piece.x0 + 1;
    const bh = piece.y1 - piece.y0 + 1;
    if (bw < 6 || bh < 6 || bw / bh > 4 || bh / bw > 4) continue;
    let real = 0;
    let sparseRows = 0;
    for (let y = piece.y0; y <= piece.y1; y++) {
      const n = rowCount(y, piece);
      real += n;
      if (n < bw * 0.2) sparseRows++;
    }
    const fill = real / (bw * bh);
    // Hueco o con forma de párrafo (muchas filas casi vacías entre líneas): no es un código.
    if (fill < 0.4 || sparseRows / bh > 0.25) continue;
    const score = real * fill;
    if (!best || score > best.score) best = { score, ...piece };
  }
  if (!best) return null;

  // Paso 5: ¿hay una barra vertical en esta columna de celdas? Se mira píxel a píxel con un
  // umbral suave (las barras finas quedan grises) y tiene que cubrir casi toda la altura.
  const top = best.y0 * C;
  const bottom = Math.min(h, (best.y1 + 1) * C);
  const hasBar = (cx) => {
    for (let x = cx * C; x < cx * C + C && x < w; x++) {
      let covered = 0;
      for (let y = top; y < bottom; y++) covered += lum[y * w + x] < 200 ? 1 : 0;
      if (covered >= (bottom - top) * 0.8) return true;
    }
    return false;
  };
  const extend = (from, step) => {
    let edge = from;
    let gap = 0;
    for (let cx = from + step; cx >= 0 && cx < gw && gap <= 3; cx += step) {
      if (hasBar(cx)) {
        edge = cx;
        gap = 0;
      } else gap++;
    }
    return edge;
  };
  // Solo si el propio bloque ya tiene barras así; un QR no tiene columnas enteras oscuras.
  let bars = 0;
  for (let cx = best.x0; cx <= best.x1; cx++) bars += hasBar(cx) ? 1 : 0;
  if (bars >= (best.x1 - best.x0 + 1) * 0.5) {
    best.x0 = extend(best.x0, -1);
    best.x1 = extend(best.x1, 1);
  }

  return {
    x: (best.x0 * C) / scale,
    y: (best.y0 * C) / scale,
    width: ((best.x1 - best.x0 + 1) * C) / scale,
    height: ((best.y1 - best.y0 + 1) * C) / scale,
  };
}

// ------------------------------------------------------------------ base64 (copias antiguas)

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
