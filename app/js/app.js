import * as db from "./db.js";
import { base64ToBlob, blobToBase64, processFile } from "./files.js";

const PARK_COLORS = [
  "#e63946",
  "#f4a261",
  "#2a9d8f",
  "#457b9d",
  "#8e44ad",
  "#e76f51",
  "#264653",
  "#d63384",
];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const KIND_LABEL = { pdf: "PDF", image: "IMG", html: "WEB" };

const root = document.getElementById("app");

// ------------------------------------------------------------------ utilidades

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const toasts = document.createElement("div");
toasts.className = "toasts";
document.body.append(toasts);

function toast(message, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toasts.append(el);
  setTimeout(() => el.remove(), type === "error" ? 6000 : 3500);
}

const go = (hash, { replace = false } = {}) =>
  replace ? location.replace(hash) : (location.hash = hash);

// URLs de Blob creadas para la vista actual; se liberan al cambiar de pantalla.
let objectUrls = [];
function blobUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

function header({ title, subtitle = "", back = null, action = "", color = "" }) {
  return `
    <header class="topbar" ${color ? `style="--park:${esc(color)}"` : ""}>
      ${back ? `<a class="back" href="${back}" aria-label="Volver">‹</a>` : ""}
      <h1>${esc(title)}${subtitle ? `<small>${esc(subtitle)}</small>` : ""}</h1>
      ${action}
    </header>`;
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form));
  for (const key of Object.keys(data)) {
    if (typeof data[key] === "string") data[key] = data[key].trim() || null;
  }
  return data;
}

// ------------------------------------------------------------------ pantallas

async function viewHome() {
  const [parks, tickets] = await Promise.all([db.listParks(), db.listTickets()]);
  const now = today();

  const stats = new Map(parks.map((p) => [p.id, { total: 0, next: null }]));
  for (const t of tickets) {
    const s = stats.get(t.parkId);
    if (!s) continue;
    s.total++;
    if (t.visitDate && t.visitDate >= now && (!s.next || t.visitDate < s.next))
      s.next = t.visitDate;
  }
  parks.sort(
    (a, b) =>
      !stats.get(a.id).next - !stats.get(b.id).next ||
      (stats.get(a.id).next || "").localeCompare(stats.get(b.id).next || "") ||
      a.name.localeCompare(b.name, "es"),
  );

  const todayParks = parks.filter((p) => stats.get(p.id).next === now);

  root.innerHTML = `
    ${header({
      title: "🎢 Mis entradas",
      action: `<a class="icon-btn" href="#/ajustes" aria-label="Ajustes">⚙︎</a>`,
    })}
    <main>
      ${todayParks
        .map(
          (p) => `
        <a class="today-banner" href="#/parque/${p.id}" style="--park:${esc(p.color)}">
          <span>🎉 Hoy toca <strong>${esc(p.name)}</strong></span><span>Ver entradas ›</span>
        </a>`,
        )
        .join("")}
      ${
        parks.length
          ? `<ul class="card-list">${parks
              .map((p) => {
                const s = stats.get(p.id);
                return `
                <li><a class="card" href="#/parque/${p.id}" style="--park:${esc(p.color)}">
                  <span class="park-initial">${esc(p.name.charAt(0).toUpperCase())}</span>
                  <span class="card-info">
                    <strong>${esc(p.name)}</strong>
                    <small>${s.total} entrada${s.total === 1 ? "" : "s"}${
                      s.next ? ` · próxima visita ${formatDate(s.next)}` : ""
                    }</small>
                  </span>
                  <span class="chevron">›</span>
                </a></li>`;
              })
              .join("")}</ul>`
          : `<div class="empty"><p>Aún no tienes parques.</p></div>`
      }
      <a class="btn btn-primary btn-block" href="#/parque/nuevo">+ Añadir parque</a>
    </main>`;
}

async function viewParkForm(id) {
  const park = id ? await db.getPark(id) : null;
  if (id && !park) return notFound();
  const current = park?.color ?? PARK_COLORS[0];

  root.innerHTML = `
    ${header({
      title: park ? "Editar parque" : "Nuevo parque",
      back: park ? `#/parque/${park.id}` : "#/",
    })}
    <main>
      <form class="form" id="park-form">
        <label>Nombre
          <input name="name" required value="${esc(park?.name)}"
                 placeholder="PortAventura, Warner, Disneyland…" autocomplete="off">
        </label>
        <fieldset class="colors">
          <legend>Color</legend>
          ${PARK_COLORS.map(
            (c) => `
            <label class="swatch" style="--c:${c}">
              <input type="radio" name="color" value="${c}" ${c === current ? "checked" : ""}>
              <span></span>
            </label>`,
          ).join("")}
        </fieldset>
        <button class="btn btn-primary btn-block">Guardar</button>
      </form>
      ${park ? `<button class="btn btn-danger btn-block" id="delete">Borrar parque</button>` : ""}
    </main>`;

  if (!park) root.querySelector("input[name=name]").focus();

  root.querySelector("#park-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { name, color } = formData(e.target);
    const saved = { ...(park ?? { id: db.newId(), createdAt: Date.now() }), name, color };
    await db.savePark(saved);
    go(`#/parque/${saved.id}`, { replace: true });
  });

  root.querySelector("#delete")?.addEventListener("click", async () => {
    if (!confirm(`¿Borrar «${park.name}» y TODAS sus entradas?`)) return;
    await db.deletePark(park.id);
    toast("Parque eliminado");
    go("#/", { replace: true });
  });
}

async function viewPark(id) {
  const [park, tickets] = await Promise.all([db.getPark(id), db.listTickets(id)]);
  if (!park) return notFound();
  const now = today();

  root.innerHTML = `
    ${header({
      title: park.name,
      back: "#/",
      color: park.color,
      action: `<a class="icon-btn" href="#/parque/${park.id}/editar" aria-label="Editar parque">✎</a>`,
    })}
    <main>
      <a class="btn btn-primary btn-block" href="#/parque/${park.id}/subir">+ Añadir entradas</a>
      ${
        tickets.length
          ? `<ul class="card-list">${tickets
              .map(
                (t) => `
              <li><a class="card ${t.visitDate && t.visitDate < now ? "past" : ""}"
                     href="#/entrada/${t.id}" style="--park:${esc(park.color)}">
                <span class="kind">${KIND_LABEL[t.kind]}</span>
                <span class="card-info">
                  <strong>${esc(t.title)}</strong>
                  <small>${[
                    t.holder && `👤 ${esc(t.holder)}`,
                    t.visitDate && `📅 ${formatDate(t.visitDate)}`,
                    t.pages > 1 && `${t.pages} págs.`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}</small>
                </span>
                <span class="chevron">›</span>
              </a></li>`,
              )
              .join("")}</ul>`
          : `<div class="empty"><p>Este parque aún no tiene entradas.</p></div>`
      }
    </main>`;
}

async function viewUpload(parkId) {
  const park = await db.getPark(parkId);
  if (!park) return notFound();

  root.innerHTML = `
    ${header({ title: "Añadir entradas", subtitle: park.name, back: `#/parque/${park.id}`, color: park.color })}
    <main>
      <form class="form" id="upload-form">
        <label class="dropzone">
          <input type="file" name="files" multiple required
                 accept="application/pdf,.pdf,image/*,text/html,.html,.htm">
          <span id="drop-text">📎 Toca para elegir ficheros<br>
            <small>PDF, imágenes, capturas o HTML · puedes elegir varios</small></span>
        </label>
        <label>Título <small>(opcional; si no, se usa el nombre del fichero)</small>
          <input name="title" placeholder="Entrada 1 día" autocomplete="off">
        </label>
        <label>Titular <input name="holder" placeholder="Nombre de la persona" autocomplete="off"></label>
        <label>Fecha de visita <input type="date" name="visitDate"></label>
        <label>Notas
          <textarea name="notes" rows="2" placeholder="Localizador, puerta de acceso, parking…"></textarea>
        </label>
        <button class="btn btn-primary btn-block" id="submit">Guardar</button>
      </form>
    </main>`;

  const form = root.querySelector("#upload-form");
  const input = form.querySelector("input[type=file]");
  const dropText = root.querySelector("#drop-text");
  const submit = root.querySelector("#submit");

  input.addEventListener("change", () => {
    const n = input.files.length;
    if (!n) return;
    dropText.innerHTML = `✅ ${n} fichero${n > 1 ? "s" : ""}<br><small>${[...input.files]
      .map((f) => esc(f.name))
      .join(", ")}</small>`;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const files = [...input.files];
    const { title, holder, visitDate, notes } = formData(form);
    submit.disabled = true;

    let saved = 0;
    for (const [i, file] of files.entries()) {
      submit.textContent = `Procesando ${i + 1} de ${files.length}…`;
      try {
        const { kind, pages, original } = await processFile(file);
        const stem = file.name.replace(/\.[^.]+$/, "");
        const ticket = {
          id: db.newId(),
          parkId: park.id,
          title: title ? (files.length > 1 ? `${title} · ${stem}` : title) : stem,
          holder,
          visitDate,
          notes,
          kind,
          fileName: file.name,
          mime: file.type,
          pages: Math.max(pages.length, 1),
          createdAt: Date.now(),
        };
        await db.addTicket(ticket, { original, pages });
        saved++;
      } catch (err) {
        console.error(err);
        toast(err?.message || `No se pudo guardar ${file.name}`, "error");
      }
    }

    if (saved) {
      toast(`${saved} entrada${saved > 1 ? "s" : ""} guardada${saved > 1 ? "s" : ""}`);
      go(`#/parque/${park.id}`, { replace: true });
    } else {
      submit.disabled = false;
      submit.textContent = "Guardar";
    }
  });
}

async function viewTicket(id) {
  const ticket = await db.getTicket(id);
  if (!ticket) return notFound();
  const [park, siblings, files] = await Promise.all([
    db.getPark(ticket.parkId),
    db.listTickets(ticket.parkId),
    db.getFiles(id),
  ]);

  const pos = siblings.findIndex((t) => t.id === id);
  const prev = siblings[pos - 1];
  const next = siblings[pos + 1];

  let content;
  if (ticket.kind === "pdf") {
    content = files.pages.map((p, i) => `<img src="${blobUrl(p)}" alt="Página ${i + 1}">`).join("");
  } else if (ticket.kind === "image") {
    content = `<img src="${blobUrl(files.original)}" alt="${esc(ticket.title)}">`;
  } else {
    // HTML aislado: puede ejecutar sus scripts (algunos dibujan el QR) pero no acceder a la app.
    content = `<iframe sandbox="allow-scripts" title="${esc(ticket.title)}"></iframe>`;
  }

  root.innerHTML = `
    ${header({
      title: ticket.title,
      subtitle: [park.name, ticket.holder, formatDate(ticket.visitDate)]
        .filter(Boolean)
        .join(" · "),
      back: `#/parque/${park.id}`,
      color: park.color,
      action: `<a class="icon-btn" href="#/entrada/${ticket.id}/editar" aria-label="Editar">✎</a>`,
    })}
    <main>
      <div class="stage" id="stage">${content}</div>
      ${ticket.notes ? `<p class="notes">📝 ${esc(ticket.notes)}</p>` : ""}
      <nav class="pager">
        ${prev ? `<a class="btn" href="#/entrada/${prev.id}" id="prev">‹ Anterior</a>` : "<span></span>"}
        <span class="counter">${pos + 1} / ${siblings.length}</span>
        ${next ? `<a class="btn" href="#/entrada/${next.id}" id="next">Siguiente ›</a>` : "<span></span>"}
      </nav>
      <button class="btn btn-block" id="focus">⛶ Solo la entrada</button>
    </main>`;

  if (ticket.kind === "html") {
    root.querySelector("iframe").srcdoc = await files.original.text();
  }

  root.querySelector("#focus").addEventListener("click", () => {
    document.body.classList.add("focus");
    toast("Toca la entrada para salir");
  });
  root
    .querySelector("#stage")
    .addEventListener("click", () => document.body.classList.remove("focus"));

  keepScreenOn();
  enableSwipe(prev && `#/entrada/${prev.id}`, next && `#/entrada/${next.id}`);
}

async function viewTicketEdit(id) {
  const [ticket, parks] = await Promise.all([db.getTicket(id), db.listParks()]);
  if (!ticket) return notFound();
  const park = parks.find((p) => p.id === ticket.parkId);
  parks.sort((a, b) => a.name.localeCompare(b.name, "es"));

  root.innerHTML = `
    ${header({ title: "Editar entrada", back: `#/entrada/${ticket.id}`, color: park?.color })}
    <main>
      <form class="form" id="edit-form">
        <label>Título <input name="title" required value="${esc(ticket.title)}"></label>
        <label>Titular <input name="holder" value="${esc(ticket.holder)}"></label>
        <label>Fecha de visita <input type="date" name="visitDate" value="${esc(ticket.visitDate)}"></label>
        <label>Parque
          <select name="parkId">${parks
            .map(
              (p) =>
                `<option value="${p.id}" ${p.id === ticket.parkId ? "selected" : ""}>${esc(p.name)}</option>`,
            )
            .join("")}</select>
        </label>
        <label>Notas <textarea name="notes" rows="3">${esc(ticket.notes)}</textarea></label>
        <button class="btn btn-primary btn-block">Guardar</button>
      </form>
      <button class="btn btn-block" id="share">⤴︎ Compartir / guardar original</button>
      <button class="btn btn-danger btn-block" id="delete">Borrar entrada</button>
    </main>`;

  root.querySelector("#edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await db.saveTicket({ ...ticket, ...formData(e.target) });
    go(`#/entrada/${ticket.id}`, { replace: true });
  });

  // Se prepara antes del toque: iOS solo deja compartir justo después de que el usuario pulse.
  const { original } = await db.getFiles(ticket.id);
  const originalFile = new File([original], ticket.fileName, {
    type: ticket.mime || original.type,
  });
  root.querySelector("#share").addEventListener("click", () => shareOrDownload(originalFile));

  root.querySelector("#delete").addEventListener("click", async () => {
    if (!confirm("¿Borrar esta entrada?")) return;
    await db.deleteTicket(ticket.id);
    toast("Entrada eliminada");
    go(`#/parque/${ticket.parkId}`, { replace: true });
  });
}

async function viewSettings() {
  const estimate = (await navigator.storage?.estimate?.()) ?? {};
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  const mb = (bytes) => `${((bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`;

  root.innerHTML = `
    ${header({ title: "Ajustes", back: "#/" })}
    <main>
      <section class="panel">
        <h2>Copia de seguridad</h2>
        <p class="muted">Tus entradas solo están en este móvil. Si borras la app o cambias de móvil,
          se pierden: guarda una copia en Archivos o iCloud Drive de vez en cuando.</p>
        <button class="btn btn-primary btn-block" id="export">Exportar copia</button>
        <label class="btn btn-block file-btn">Importar copia
          <input type="file" id="import" accept="application/json,.json">
        </label>
      </section>
      <section class="panel">
        <h2>Almacenamiento</h2>
        <p class="muted">Usado: ${mb(estimate.usage)}${estimate.quota ? ` de ${mb(estimate.quota)}` : ""}<br>
          Protegido contra borrado automático: ${persisted ? "sí ✅" : "no"}</p>
      </section>
    </main>`;

  // Dos pasos: preparar la copia tarda, y iOS solo deja compartir justo tras un toque.
  const exportBtn = root.querySelector("#export");
  exportBtn.addEventListener("click", async function prepare() {
    exportBtn.disabled = true;
    exportBtn.textContent = "Preparando copia…";
    try {
      const file = await buildBackup();
      exportBtn.removeEventListener("click", prepare);
      exportBtn.addEventListener("click", () => shareOrDownload(file));
      exportBtn.textContent = `Guardar copia (${mb(file.size)})`;
    } catch (err) {
      console.error(err);
      toast(`No se pudo preparar la copia: ${err?.message}`, "error");
      exportBtn.textContent = "Exportar copia";
    }
    exportBtn.disabled = false;
  });
  root.querySelector("#import").addEventListener("change", (e) => importBackup(e.target.files[0]));
}

function notFound() {
  root.innerHTML = `${header({ title: "No encontrado", back: "#/" })}
    <main><div class="empty"><p>Esto ya no existe.</p></div></main>`;
}

// ------------------------------------------------------------------ copia de seguridad

async function buildBackup() {
  const { parks, tickets, files } = await db.dumpAll();
  const encoded = [];
  for (const f of files) {
    encoded.push({
      ticketId: f.ticketId,
      original: await blobToBase64(f.original),
      pages: await Promise.all(f.pages.map(blobToBase64)),
    });
  }
  const json = JSON.stringify({
    app: "visor-entradas",
    version: 1,
    parks,
    tickets,
    files: encoded,
  });
  return new File([json], `entradas-${today()}.json`, { type: "application/json" });
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "visor-entradas") throw new Error("No es una copia de Visor de Entradas");
    if (!confirm(`¿Importar ${data.parks.length} parques y ${data.tickets.length} entradas?`))
      return;
    const files = [];
    for (const f of data.files) {
      files.push({
        ticketId: f.ticketId,
        original: await base64ToBlob(f.original),
        pages: await Promise.all(f.pages.map(base64ToBlob)),
      });
    }
    await db.restoreAll({ parks: data.parks, tickets: data.tickets, files });
    toast("Copia importada");
    go("#/");
  } catch (err) {
    console.error(err);
    toast(`No se pudo importar: ${err?.message}`, "error");
  }
}

async function shareOrDownload(file) {
  // En iPhone la hoja de compartir permite «Guardar en Archivos».
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ------------------------------------------------------------------ visor: pantalla y gestos

let wakeLock = null;

async function keepScreenOn() {
  try {
    if ("wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    }
  } catch {
    // No disponible (http, navegador antiguo o modo ahorro de batería): no pasa nada.
  }
}

function releaseScreen() {
  wakeLock?.release();
  wakeLock = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && location.hash.startsWith("#/entrada/"))
    keepScreenOn();
});

let swipe = null;

function enableSwipe(prevHash, nextHash) {
  swipe = { prevHash, nextHash };
}

let touchStart = null;
document.addEventListener(
  "touchstart",
  (e) => (touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }),
  { passive: true },
);
document.addEventListener(
  "touchend",
  (e) => {
    if (!swipe || !touchStart || e.touches.length) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2) return;
    if (window.visualViewport && window.visualViewport.scale > 1.05) return; // está haciendo zoom
    const target = dx < 0 ? swipe.nextHash : swipe.prevHash;
    if (target) go(target, { replace: true });
  },
  { passive: true },
);

// ------------------------------------------------------------------ router

const routes = [
  [/^#?\/?$/, viewHome],
  [/^#\/ajustes$/, viewSettings],
  [/^#\/parque\/nuevo$/, () => viewParkForm()],
  [/^#\/parque\/([\w-]+)$/, viewPark],
  [/^#\/parque\/([\w-]+)\/editar$/, viewParkForm],
  [/^#\/parque\/([\w-]+)\/subir$/, viewUpload],
  [/^#\/entrada\/([\w-]+)$/, viewTicket],
  [/^#\/entrada\/([\w-]+)\/editar$/, viewTicketEdit],
];

async function render() {
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  swipe = null;
  document.body.classList.remove("focus");
  if (!location.hash.startsWith("#/entrada/") || location.hash.endsWith("/editar")) releaseScreen();

  const hash = location.hash;
  for (const [pattern, view] of routes) {
    const match = hash.match(pattern);
    if (match) {
      try {
        await view(...match.slice(1));
      } catch (err) {
        console.error(err);
        root.innerHTML = `${header({ title: "Error", back: "#/" })}
          <main><div class="empty"><p>${esc(err?.message)}</p></div></main>`;
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  notFound();
}

window.addEventListener("hashchange", render);
render();

// ------------------------------------------------------------------ PWA

// Pide al navegador que no borre los datos aunque falte espacio.
navigator.storage?.persist?.();

const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);
if (
  "serviceWorker" in navigator &&
  (!isLocalDev || new URLSearchParams(location.search).has("sw"))
) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register("./sw.js");
  // Cuando se instala una versión nueva, recarga para usarla (no en la primera instalación).
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) location.reload();
  });
}
