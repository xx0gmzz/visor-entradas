// ZIP mínimo, sin compresión, para las copias de seguridad.
//
// El formato anterior (un JSON con todo en base64) obligaba a tener la copia entera en memoria
// y Safari mataba la pestaña con pocas decenas de entradas. Aquí cada fichero entra en el ZIP
// como un Blob más: el navegador los va volcando a disco y la memoria no crece.
//
// No se comprime a propósito: PDF, PNG y JPEG ya vienen comprimidos y así el ZIP se genera
// al instante y sin dependencias.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;

// ------------------------------------------------------------------ crc32

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

function crcUpdate(crc, bytes) {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

// Recorre el blob a trozos para no materializarlo entero en memoria.
async function crc32(blob) {
  let crc = 0xffffffff;
  if (blob.stream) {
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      crc = crcUpdate(crc, value);
    }
  } else {
    crc = crcUpdate(crc, new Uint8Array(await blob.arrayBuffer()));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------ escritura

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, day: day & 0xffff };
}

function bytes(spec) {
  const size = spec.reduce((n, [width]) => n + width, 0);
  const view = new DataView(new ArrayBuffer(size));
  let offset = 0;
  for (const [width, value] of spec) {
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    offset += width;
  }
  return new Uint8Array(view.buffer);
}

/**
 * Crea un ZIP a partir de [{ name, blob }]. Devuelve un Blob.
 * `onProgress(hechos, total)` se llama tras cada fichero.
 */
export async function zip(entries, onProgress) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  const { time, day } = dosDateTime(new Date());
  let offset = 0;

  for (const [i, entry] of entries.entries()) {
    const blob = entry.blob instanceof Blob ? entry.blob : new Blob([entry.blob]);
    const name = encoder.encode(entry.name);
    const crc = await crc32(blob);
    const size = blob.size;

    const local = bytes([
      [4, SIG_LOCAL],
      [2, 20],
      [2, FLAG_UTF8],
      [2, 0], // sin compresión
      [2, time],
      [2, day],
      [4, crc],
      [4, size],
      [4, size],
      [2, name.length],
      [2, 0],
    ]);
    parts.push(local, name, blob);

    central.push(
      bytes([
        [4, SIG_CENTRAL],
        [2, 20],
        [2, 20],
        [2, FLAG_UTF8],
        [2, 0],
        [2, time],
        [2, day],
        [4, crc],
        [4, size],
        [4, size],
        [2, name.length],
        [2, 0],
        [2, 0],
        [2, 0],
        [2, 0],
        [4, 0],
        [4, offset],
      ]),
      name,
    );

    offset += local.length + name.length + size;
    onProgress?.(i + 1, entries.length);
  }

  const centralSize = central.reduce((n, part) => n + part.length, 0);
  const eocd = bytes([
    [4, SIG_EOCD],
    [2, 0],
    [2, 0],
    [2, entries.length],
    [2, entries.length],
    [4, centralSize],
    [4, offset],
    [2, 0],
  ]);

  return new Blob([...parts, ...central, eocd], { type: "application/zip" });
}

// ------------------------------------------------------------------ lectura

const slice = async (blob, start, length) =>
  new DataView(await blob.slice(start, start + length).arrayBuffer());

/**
 * Abre un ZIP y devuelve un Map nombre -> Blob. Los datos se referencian por slices:
 * no se copia nada hasta que se lee cada fichero.
 */
export async function unzip(blob) {
  // El directorio central está al final, detrás de un comentario de longitud variable.
  const tailSize = Math.min(blob.size, 0xffff + 22);
  const tail = await slice(blob, blob.size - tailSize, tailSize);
  let eocd = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El fichero no es un ZIP válido");

  const count = tail.getUint16(eocd + 10, true);
  const centralSize = tail.getUint32(eocd + 12, true);
  const centralStart = tail.getUint32(eocd + 16, true);
  const central = await slice(blob, centralStart, centralSize);
  const decoder = new TextDecoder();
  const files = new Map();

  let p = 0;
  for (let i = 0; i < count; i++) {
    if (central.getUint32(p, true) !== SIG_CENTRAL) throw new Error("ZIP dañado");
    const method = central.getUint16(p + 10, true);
    const size = central.getUint32(p + 24, true);
    const nameLen = central.getUint16(p + 28, true);
    const extraLen = central.getUint16(p + 30, true);
    const commentLen = central.getUint16(p + 32, true);
    const localOffset = central.getUint32(p + 42, true);
    const name = decoder.decode(
      new Uint8Array(central.buffer, central.byteOffset + p + 46, nameLen),
    );
    if (method !== 0) throw new Error(`«${name}» está comprimido y esta copia no lo admite`);

    // La cabecera local repite el nombre y puede traer otros extras: hay que releerla.
    const local = await slice(blob, localOffset, 30);
    const dataStart = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    files.set(name, blob.slice(dataStart, dataStart + size));

    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

export const looksLikeZip = async (blob) =>
  blob.size > 22 && (await slice(blob, 0, 4)).getUint32(0, true) === SIG_LOCAL;
