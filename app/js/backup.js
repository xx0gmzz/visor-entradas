// Copias de seguridad.
//
// Formato actual (v2): un ZIP sin comprimir con
//   manifest.json            { app, version, exportedAt, parks, tickets, files: [...] }
//   files/<id>/original.*    el fichero tal y como se subió
//   files/<id>/page-N.png    páginas de los PDF ya convertidas
//   files/<id>/thumb.jpg     miniatura
//
// También se siguen importando las copias v1 (un JSON con todo en base64).

import * as db from "./db.js";
import { base64ToBlob } from "./files.js";
import { today } from "./ui.js";
import { looksLikeZip, unzip, zip } from "./zip.js";

const APP = "visor-entradas";

const EXT = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "text/html": "html",
};

export const BACKUP_REMINDER_DAYS = 30;

export async function buildBackup(onProgress) {
  const { parks, tickets, files } = await db.dumpAll();
  const entries = [];
  const index = [];

  for (const f of files) {
    const dir = `files/${f.ticketId}`;
    const ext = EXT[f.original?.type] ?? "bin";
    const item = {
      ticketId: f.ticketId,
      original: `${dir}/original.${ext}`,
      pages: [],
      thumb: null,
    };
    entries.push({ name: item.original, blob: f.original });
    f.pages.forEach((page, i) => {
      const name = `${dir}/page-${i + 1}.png`;
      item.pages.push(name);
      entries.push({ name, blob: page });
    });
    if (f.thumb) {
      item.thumb = `${dir}/thumb.jpg`;
      entries.push({ name: item.thumb, blob: f.thumb });
    }
    index.push(item);
  }

  const manifest = {
    app: APP,
    version: 2,
    exportedAt: new Date().toISOString(),
    parks,
    tickets,
    files: index,
  };
  entries.unshift({
    name: "manifest.json",
    blob: new Blob([JSON.stringify(manifest, null, 1)], { type: "application/json" }),
  });

  const blob = await zip(entries, onProgress);
  return new File([blob], `entradas-${today()}.zip`, { type: "application/zip" });
}

/** Lee una copia (ZIP v2 o JSON v1) y la deja lista para db.restoreAll. */
export async function readBackup(file) {
  if (await looksLikeZip(file)) return readZip(file);
  return readLegacyJson(file);
}

async function readZip(file) {
  const entries = await unzip(file);
  const manifestBlob = entries.get("manifest.json");
  if (!manifestBlob) throw new Error("Al ZIP le falta manifest.json: no es una copia de esta app");
  const manifest = JSON.parse(await manifestBlob.text());
  if (manifest.app !== APP) throw new Error("No es una copia de Mis entradas");

  const typed = (name, type) => {
    const blob = entries.get(name);
    if (!blob) throw new Error(`Falta ${name} en la copia`);
    return new Blob([blob], { type });
  };

  const byId = new Map(manifest.tickets.map((t) => [t.id, t]));
  const files = manifest.files.map((f) => {
    const ticket = byId.get(f.ticketId);
    return {
      ticketId: f.ticketId,
      original: typed(f.original, ticket?.mime || guessType(f.original)),
      pages: f.pages.map((p) => typed(p, "image/png")),
      thumb: f.thumb && entries.has(f.thumb) ? typed(f.thumb, "image/jpeg") : null,
    };
  });
  return {
    parks: manifest.parks,
    tickets: manifest.tickets,
    files,
    exportedAt: manifest.exportedAt,
  };
}

async function readLegacyJson(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("El fichero no es una copia válida");
  }
  if (data.app !== APP) throw new Error("No es una copia de Mis entradas");
  const files = [];
  for (const f of data.files) {
    files.push({
      ticketId: f.ticketId,
      original: await base64ToBlob(f.original),
      pages: await Promise.all(f.pages.map(base64ToBlob)),
      thumb: null, // se generan solas al ver las listas
    });
  }
  return { parks: data.parks, tickets: data.tickets, files, exportedAt: null };
}

function guessType(name) {
  const ext = name.split(".").pop();
  return Object.keys(EXT).find((type) => EXT[type] === ext) ?? "application/octet-stream";
}

// ------------------------------------------------------------------ recordatorio

export async function lastBackupAt() {
  return db.getMeta("lastBackupAt");
}

export async function markBackupDone() {
  await db.setMeta("lastBackupAt", Date.now());
}

/** Días desde la última copia, o null si nunca se ha hecho. */
export async function daysSinceBackup() {
  const last = await lastBackupAt();
  return last ? Math.floor((Date.now() - last) / 86_400_000) : null;
}

/** El aviso se puede posponer una semana desde la propia portada. */
export async function snoozeReminder() {
  await db.setMeta("backupSnoozedUntil", Date.now() + 7 * 86_400_000);
}

export async function shouldRemind(ticketCount) {
  if (!ticketCount) return false;
  const snoozed = await db.getMeta("backupSnoozedUntil");
  if (snoozed && snoozed > Date.now()) return false;
  const days = await daysSinceBackup();
  return days === null || days >= BACKUP_REMINDER_DAYS;
}
