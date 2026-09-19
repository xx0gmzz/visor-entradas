// Almacenamiento local en el móvil (IndexedDB). Nada sale del dispositivo.
//
//   parks   { id, name, color, createdAt }
//   tickets { id, parkId, title, holder, visitDate, notes, type, locator, used, usedAt,
//             kind, fileName, mime, pages, createdAt }
//   files   { ticketId, original, pages[], thumb }   // pages: PDF convertido a imágenes
//   meta    { key, value }                           // ajustes y marcas de la propia app
//
// Los ficheros se guardan como { type, data: ArrayBuffer } y no como Blob: Safari no deja guardar
// Blobs en IndexedDB en navegación privada y algunas versiones de iOS los corrompían.
// Fuera de este módulo siempre se trabaja con Blobs.

const DB_NAME = "visor-entradas";
const DB_VERSION = 2;

export const TICKET_TYPES = [
  { id: "entrada", label: "Entrada", icon: "ticket" },
  { id: "fastpass", label: "Acceso rápido", icon: "bolt" },
  { id: "parking", label: "Parking", icon: "car" },
  { id: "hotel", label: "Hotel", icon: "bed" },
  { id: "comida", label: "Comida", icon: "cutlery" },
  { id: "otro", label: "Otro", icon: "tag" },
];

export const ticketType = (id) => TICKET_TYPES.find((t) => t.id === id) ?? TICKET_TYPES[0];

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Cada versión añade lo que falte: el móvil puede venir de cualquier versión anterior.
    req.onupgradeneeded = () => {
      const db = req.result;
      const has = (name) => db.objectStoreNames.contains(name);
      if (!has("parks")) db.createObjectStore("parks", { keyPath: "id" });
      if (!has("tickets")) {
        db.createObjectStore("tickets", { keyPath: "id" }).createIndex("parkId", "parkId");
      }
      if (!has("files")) db.createObjectStore("files", { keyPath: "ticketId" });
      if (!has("meta")) db.createObjectStore("meta", { keyPath: "key" });
      // v2 añadió campos a tickets (type, used, locator) y thumb a files. Son opcionales:
      // los registros antiguos se leen igual y se completan al guardarlos.
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Ejecuta `fn` dentro de una transacción. Si `fn` devuelve una petición, se resuelve con su resultado.
async function run(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const out = fn(tx);
    tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    tx.onerror = tx.onabort = () =>
      reject(tx.error ?? new Error("No se pudo acceder al almacenamiento del navegador"));
  });
}

const toStored = async (blob) => ({ type: blob.type, data: await blob.arrayBuffer() });
const fromStored = (item) => (item ? new Blob([item.data], { type: item.type }) : null);

async function packFiles({ ticketId, original, pages, thumb }) {
  return {
    ticketId,
    original: await toStored(original),
    pages: await Promise.all(pages.map(toStored)),
    thumb: thumb ? await toStored(thumb) : null,
  };
}

function unpackFiles(record) {
  if (!record) return record;
  return {
    ...record,
    original: fromStored(record.original),
    pages: (record.pages ?? []).map(fromStored),
    thumb: fromStored(record.thumb),
  };
}

export function newId() {
  // crypto.randomUUID solo existe en contextos seguros (https/localhost).
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ------------------------------------------------------------------ parques

export const listParks = () => run("parks", "readonly", (tx) => tx.objectStore("parks").getAll());

export const getPark = (id) => run("parks", "readonly", (tx) => tx.objectStore("parks").get(id));

export const savePark = (park) =>
  run("parks", "readwrite", (tx) => tx.objectStore("parks").put(park));

export const deletePark = (id) =>
  run(["parks", "tickets", "files"], "readwrite", (tx) => {
    tx.objectStore("parks").delete(id);
    const keys = tx.objectStore("tickets").index("parkId").getAllKeys(id);
    keys.onsuccess = () => {
      for (const key of keys.result) {
        tx.objectStore("tickets").delete(key);
        tx.objectStore("files").delete(key);
      }
    };
  });

// ------------------------------------------------------------------ entradas

export function sortTickets(tickets) {
  const cmp = (a, b) => (a || "").localeCompare(b || "", "es", { sensitivity: "base" });
  return tickets.sort(
    (a, b) =>
      !a.visitDate - !b.visitDate ||
      cmp(a.visitDate, b.visitDate) ||
      cmp(a.holder, b.holder) ||
      cmp(a.title, b.title),
  );
}

export const listTickets = (parkId) =>
  run("tickets", "readonly", (tx) => {
    const store = tx.objectStore("tickets");
    return parkId ? store.index("parkId").getAll(parkId) : store.getAll();
  }).then(sortTickets);

export const getTicket = (id) =>
  run("tickets", "readonly", (tx) => tx.objectStore("tickets").get(id));

export const saveTicket = (ticket) =>
  run("tickets", "readwrite", (tx) => tx.objectStore("tickets").put(ticket));

// Guarda varias entradas de golpe (reasignar huérfanas, marcar usadas en bloque…).
export const saveTickets = (tickets) =>
  run("tickets", "readwrite", (tx) => {
    const store = tx.objectStore("tickets");
    tickets.forEach((t) => store.put(t));
  });

// files: { original: Blob, pages: Blob[], thumb?: Blob }
export async function addTicket(ticket, files) {
  const packed = await packFiles({ ticketId: ticket.id, ...files });
  return run(["tickets", "files"], "readwrite", (tx) => {
    tx.objectStore("tickets").put(ticket);
    tx.objectStore("files").put(packed);
  });
}

export const getFiles = (ticketId) =>
  run("files", "readonly", (tx) => tx.objectStore("files").get(ticketId)).then(unpackFiles);

// Solo la miniatura: evita cargar el PDF entero al pintar una lista.
export async function getThumb(ticketId) {
  const record = await run("files", "readonly", (tx) => tx.objectStore("files").get(ticketId));
  return fromStored(record?.thumb);
}

export async function setThumb(ticketId, thumb) {
  const stored = await toStored(thumb);
  return run("files", "readwrite", (tx) => {
    const store = tx.objectStore("files");
    const req = store.get(ticketId);
    req.onsuccess = () => {
      if (req.result) store.put({ ...req.result, thumb: stored });
    };
  });
}

export const deleteTicket = (id) =>
  run(["tickets", "files"], "readwrite", (tx) => {
    tx.objectStore("tickets").delete(id);
    tx.objectStore("files").delete(id);
  });

// ------------------------------------------------------------------ ajustes de la app

export const getMeta = (key, fallback = null) =>
  run("meta", "readonly", (tx) => tx.objectStore("meta").get(key)).then(
    (r) => r?.value ?? fallback,
  );

export const setMeta = (key, value) =>
  run("meta", "readwrite", (tx) => tx.objectStore("meta").put({ key, value }));

export const deleteMeta = (key) =>
  run("meta", "readwrite", (tx) => tx.objectStore("meta").delete(key));

// ------------------------------------------------------------------ copia de seguridad

export async function dumpAll() {
  const out = await run(["parks", "tickets", "files"], "readonly", (tx) => {
    const out = {};
    for (const name of ["parks", "tickets", "files"]) {
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => (out[name] = req.result);
    }
    return out;
  });
  return { ...out, files: out.files.map(unpackFiles) };
}

// mode: "merge" añade y sobrescribe lo que coincida; "replace" borra todo antes.
export async function restoreAll({ parks, tickets, files }, mode = "merge") {
  const packed = await Promise.all(files.map(packFiles));
  return run(["parks", "tickets", "files"], "readwrite", (tx) => {
    if (mode === "replace") {
      tx.objectStore("parks").clear();
      tx.objectStore("tickets").clear();
      tx.objectStore("files").clear();
    }
    parks.forEach((p) => tx.objectStore("parks").put(p));
    tickets.forEach((t) => tx.objectStore("tickets").put(t));
    packed.forEach((f) => tx.objectStore("files").put(f));
  });
}

// Cuántas entradas se solaparían al importar (para avisar antes de tocar nada).
export async function countCollisions(tickets) {
  const mine = await run("tickets", "readonly", (tx) => tx.objectStore("tickets").getAll());
  const ids = new Set(mine.map((t) => t.id));
  return tickets.filter((t) => ids.has(t.id)).length;
}
