// Almacenamiento local en el móvil (IndexedDB). Nada sale del dispositivo.
//
//   parks   { id, name, color, createdAt }
//   tickets { id, parkId, title, holder, visitDate, notes, kind, fileName, mime, pages, createdAt }
//   files   { ticketId, original, pages[] }   // pages: PDF convertido a imágenes
//
// Los ficheros se guardan como { type, data: ArrayBuffer } y no como Blob: Safari no deja guardar
// Blobs en IndexedDB en navegación privada y algunas versiones de iOS los corrompían.
// Fuera de este módulo siempre se trabaja con Blobs.

const DB_NAME = "visor-entradas";
const DB_VERSION = 1;

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("parks", { keyPath: "id" });
      db.createObjectStore("tickets", { keyPath: "id" }).createIndex("parkId", "parkId");
      db.createObjectStore("files", { keyPath: "ticketId" });
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
const fromStored = (item) => new Blob([item.data], { type: item.type });

async function packFiles({ ticketId, original, pages }) {
  return {
    ticketId,
    original: await toStored(original),
    pages: await Promise.all(pages.map(toStored)),
  };
}

function unpackFiles(record) {
  if (!record) return record;
  return { ...record, original: fromStored(record.original), pages: record.pages.map(fromStored) };
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

// files: { original: Blob, pages: Blob[] }
export async function addTicket(ticket, files) {
  const packed = await packFiles({ ticketId: ticket.id, ...files });
  return run(["tickets", "files"], "readwrite", (tx) => {
    tx.objectStore("tickets").put(ticket);
    tx.objectStore("files").put(packed);
  });
}

export const getFiles = (ticketId) =>
  run("files", "readonly", (tx) => tx.objectStore("files").get(ticketId)).then(unpackFiles);

export const deleteTicket = (id) =>
  run(["tickets", "files"], "readwrite", (tx) => {
    tx.objectStore("tickets").delete(id);
    tx.objectStore("files").delete(id);
  });

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

export async function restoreAll({ parks, tickets, files }) {
  const packed = await Promise.all(files.map(packFiles));
  return run(["parks", "tickets", "files"], "readwrite", (tx) => {
    parks.forEach((p) => tx.objectStore("parks").put(p));
    tickets.forEach((t) => tx.objectStore("tickets").put(t));
    packed.forEach((f) => tx.objectStore("files").put(f));
  });
}
