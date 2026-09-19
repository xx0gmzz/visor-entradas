import { openIcs, visitIcs } from "../calendar.js";
import { typePicker } from "../components.js";
import * as db from "../db.js";
import { detectCodes } from "../files.js";
import { icon } from "../icons.js";
import { enableSwipe, keepScreenOn } from "../screen.js";
import {
  blobUrl,
  confirmDanger,
  countdown,
  esc,
  formatDateLong,
  formData,
  go,
  header,
  iconButton,
  root,
  shareOrDownload,
  toast,
  today,
} from "../ui.js";
import { notFound } from "./park.js";

/** HTML del contenido de una entrada (imágenes o iframe) sobre fondo blanco. */
export function stageContent(ticket, files) {
  if (ticket.kind === "pdf" && files.pages.length) {
    return files.pages
      .map((p, i) => `<img src="${blobUrl(p)}" alt="Página ${i + 1}" decoding="async">`)
      .join("");
  }
  if (ticket.kind === "image" || ticket.kind === "pdf") {
    return `<img src="${blobUrl(files.original)}" alt="${esc(ticket.title)}">`;
  }
  // HTML aislado: puede ejecutar sus scripts (algunos dibujan el QR) pero no acceder a la app.
  return `<iframe sandbox="allow-scripts" title="${esc(ticket.title)}"></iframe>`;
}

/** Tras pintar stageContent: los HTML se cargan aparte porque srcdoc no admite escapado seguro. */
export async function fillStage(container, ticket, files) {
  if (ticket.kind === "html")
    container.querySelector("iframe").srcdoc = await files.original.text();
}

/** Marca o desmarca como usada y lo guarda. Devuelve la entrada actualizada. */
export async function toggleUsed(ticket) {
  const updated = { ...ticket, used: !ticket.used, usedAt: ticket.used ? null : Date.now() };
  await db.saveTicket(updated);
  navigator.vibrate?.(ticket.used ? 8 : [12, 40, 12]);
  return updated;
}

const usedLabel = (t) =>
  t.used
    ? `${icon("check", { size: 20 })}Usada${t.usedAt ? ` a las ${new Date(t.usedAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}` : ""}`
    : `${icon("check", { size: 20 })}Marcar como usada`;

export async function viewTicket(id) {
  let ticket = await db.getTicket(id);
  if (!ticket) return notFound();
  const [storedPark, siblings, files] = await Promise.all([
    db.getPark(ticket.parkId),
    db.listTickets(ticket.parkId),
    db.getFiles(id),
  ]);
  // Una entrada huérfana también se puede ver; al volver se regresa a la lista de huérfanas.
  const park = storedPark ?? { name: "Sin parque", color: "#6b6880" };
  const backHref = storedPark ? `#/parque/${park.id}` : "#/huerfanas";

  const pos = siblings.findIndex((t) => t.id === id);
  const prev = siblings[pos - 1];
  const next = siblings[pos + 1];
  const type = db.ticketType(ticket.type);
  const canMagnify = ticket.kind !== "html" || ticket.locator;
  const upcoming = ticket.visitDate && countdown(ticket.visitDate);

  root.innerHTML = `
    ${header({
      title: ticket.title,
      subtitle: [park.name, ticket.holder].filter(Boolean).join(" · "),
      back: backHref,
      color: park.color,
      actions: [
        iconButton("edit", { href: `#/entrada/${ticket.id}/editar`, label: "Editar entrada" }),
      ],
    })}
    <main class="viewer" style="--park:${esc(park.color)}">
      <div class="stage-wrap${ticket.used ? " used" : ""}" id="stage-wrap">
        <div class="stage" id="stage">${stageContent(ticket, files)}</div>
        <span class="used-stamp" aria-hidden="true">Usada</span>
      </div>

      <button type="button" class="btn btn-block btn-used${ticket.used ? " is-used" : ""}" id="used">
        ${usedLabel(ticket)}</button>

      <div class="tool-row">
        ${canMagnify ? `<button type="button" class="tool" id="magnify">${icon("qr")}<span>Ampliar código</span></button>` : ""}
        <button type="button" class="tool" id="focus">${icon("expand")}<span>Solo la entrada</span></button>
        <button type="button" class="tool" id="share">${icon("share")}<span>Compartir</span></button>
      </div>

      <dl class="info-list">
        <div><dt>${icon(type.icon, { size: 18 })}Tipo</dt><dd>${esc(type.label)}</dd></div>
        ${ticket.holder ? `<div><dt>${icon("user", { size: 18 })}Titular</dt><dd>${esc(ticket.holder)}</dd></div>` : ""}
        ${
          ticket.visitDate
            ? `<div><dt>${icon("calendar", { size: 18 })}Visita</dt>
                <dd>${esc(formatDateLong(ticket.visitDate))}<small>${esc(upcoming)}</small></dd>
                ${
                  storedPark && ticket.visitDate >= today()
                    ? `<button type="button" class="chip" id="ics" aria-label="Añadir al calendario">${icon("calendar", { size: 15 })}+</button>`
                    : ""
                }</div>`
            : ""
        }
        ${
          ticket.locator
            ? `<div><dt>${icon("tag", { size: 18 })}Localizador</dt>
                <dd class="locator">${esc(ticket.locator)}</dd>
                <button type="button" class="chip" id="copy">Copiar</button></div>`
            : ""
        }
        ${ticket.notes ? `<div class="notes"><dt>${icon("note", { size: 18 })}Notas</dt><dd>${esc(ticket.notes)}</dd></div>` : ""}
      </dl>

      <nav class="pager">
        ${prev ? `<a class="btn" href="#/entrada/${prev.id}" data-nav="back">${icon("back", { size: 18 })}Anterior</a>` : "<span></span>"}
        <span class="counter">${pos + 1} / ${siblings.length}</span>
        ${next ? `<a class="btn" href="#/entrada/${next.id}" data-nav="forward">Siguiente${icon("chevron", { size: 18 })}</a>` : "<span></span>"}
      </nav>
    </main>`;

  await fillStage(root, ticket, files);

  const usedBtn = root.querySelector("#used");
  const stageWrap = root.querySelector("#stage-wrap");
  usedBtn.addEventListener("click", async () => {
    ticket = await toggleUsed(ticket);
    usedBtn.innerHTML = usedLabel(ticket);
    usedBtn.classList.toggle("is-used", ticket.used);
    stageWrap.classList.toggle("used", ticket.used);
  });

  root.querySelector("#focus").addEventListener("click", () => {
    document.body.classList.add("focus");
    toast("Toca la entrada para salir");
  });
  root
    .querySelector("#stage")
    .addEventListener("click", () => document.body.classList.remove("focus"));

  root.querySelector("#magnify")?.addEventListener("click", () => openMagnifier(ticket, files));

  // Se prepara antes del toque: iOS solo deja compartir justo después de que el usuario pulse.
  const originalFile = new File([files.original], ticket.fileName, {
    type: ticket.mime || files.original.type,
  });
  root.querySelector("#share").addEventListener("click", () => shareOrDownload(originalFile));

  root.querySelector("#copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ticket.locator);
      toast("Localizador copiado");
    } catch {
      toast("No se pudo copiar", "error");
    }
  });

  root.querySelector("#ics")?.addEventListener("click", () =>
    openIcs(
      visitIcs({
        park,
        date: ticket.visitDate,
        tickets: siblings.filter((t) => t.visitDate === ticket.visitDate),
      }),
    ),
  );

  keepScreenOn();
  enableSwipe(prev && `#/entrada/${prev.id}`, next && `#/entrada/${next.id}`);
}

// ------------------------------------------------------------------ lupa del código

/**
 * Pantalla completa en blanco con el código lo más grande posible.
 * Con BarcodeDetector (Chrome/Android) se recorta el código; en Safari no existe, así que se
 * muestra la entrada entera con zoom libre y el localizador en grande.
 */
export async function openMagnifier(ticket, files) {
  const dialog = document.createElement("dialog");
  dialog.className = "magnifier";
  dialog.innerHTML = `
    <button type="button" class="icon-btn magnifier-close" aria-label="Cerrar">${icon("close", { size: 26 })}</button>
    <div class="magnifier-body" tabindex="-1" autofocus><p class="muted">Buscando el código…</p></div>`;
  document.body.append(dialog);
  dialog.showModal();
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector(".magnifier-close").addEventListener("click", close);
  dialog.addEventListener("cancel", close);

  const images =
    ticket.kind === "pdf" && files.pages.length
      ? files.pages
      : ticket.kind !== "html"
        ? [files.original]
        : [];

  let crop = null;
  let value = null;
  for (const img of images) {
    const [code] = await detectCodes(img);
    if (code) {
      crop = await cropCode(img, code.box);
      value = code.value;
      break;
    }
  }

  const code = ticket.locator || (value && value.length <= 40 ? value : null);
  const body = dialog.querySelector(".magnifier-body");
  body.innerHTML = `
    ${
      crop
        ? `<img class="magnified-code" src="${blobUrl(crop)}" alt="Código ampliado">`
        : images.length
          ? `<div class="magnifier-zoom"><img src="${blobUrl(images[0])}" alt="${esc(ticket.title)}"></div>
             <p class="muted magnifier-hint">Pellizca para ampliar el código</p>`
          : ""
    }
    ${code ? `<p class="magnified-text" aria-label="Código">${esc(groupChars(code))}</p>` : ""}
    ${ticket.holder ? `<p class="magnified-holder">${esc(ticket.holder)}</p>` : ""}`;
}

async function cropCode(blob, box) {
  const bitmap = await createImageBitmap(blob);
  const margin = Math.max(box.width, box.height) * 0.12; // zona blanca alrededor: la exige el lector
  const sx = Math.max(0, box.x - margin);
  const sy = Math.max(0, box.y - margin);
  const sw = Math.min(bitmap.width - sx, box.width + margin * 2);
  const sh = Math.min(bitmap.height - sy, box.height + margin * 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// «ABCD1234EFGH» -> «ABCD 1234 EFGH»: más fácil de dictar en la taquilla.
// Si ya trae separadores («WB-551203») se deja tal cual.
const groupChars = (s) => (/[\s\-./]/.test(s) ? s : s.replace(/(.{4})(?=.)/g, "$1 "));

// ------------------------------------------------------------------ edición

export async function viewTicketEdit(id) {
  const [ticket, parks] = await Promise.all([db.getTicket(id), db.listParks()]);
  if (!ticket) return notFound();
  const park = parks.find((p) => p.id === ticket.parkId);
  parks.sort((a, b) => a.name.localeCompare(b.name, "es"));

  root.innerHTML = `
    ${header({ title: "Editar entrada", back: `#/entrada/${ticket.id}`, color: park?.color })}
    <main>
      <form class="form" id="edit-form">
        <label>Título <input name="title" required value="${esc(ticket.title)}"></label>
        ${typePicker(ticket.type ?? "entrada")}
        <label>Titular <input name="holder" value="${esc(ticket.holder)}" autocomplete="off"></label>
        <label>Fecha de visita <input type="date" name="visitDate" value="${esc(ticket.visitDate)}"></label>
        <label>Localizador
          <input name="locator" value="${esc(ticket.locator)}" autocomplete="off"
                 autocapitalize="characters" spellcheck="false">
        </label>
        <label>Parque
          <select name="parkId">${parks
            .map(
              (p) =>
                `<option value="${p.id}" ${p.id === ticket.parkId ? "selected" : ""}>${esc(p.name)}</option>`,
            )
            .join("")}</select>
        </label>
        <label>Notas <textarea name="notes" rows="3">${esc(ticket.notes)}</textarea></label>
        <label class="check-row">
          <input type="checkbox" name="used" ${ticket.used ? "checked" : ""}>
          <span><strong>Usada</strong><small>Ya ha pasado por el torno</small></span>
        </label>
        <button class="btn btn-primary btn-block">Guardar</button>
      </form>
      <button type="button" class="btn btn-danger btn-block" id="delete">${icon("trash", { size: 20 })}Borrar entrada</button>
    </main>`;

  root.querySelector("#edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    const used = Boolean(data.used);
    await db.saveTicket({
      ...ticket,
      ...data,
      used,
      usedAt: used ? (ticket.usedAt ?? Date.now()) : null,
    });
    go(`#/entrada/${ticket.id}`, { replace: true });
  });

  root.querySelector("#delete").addEventListener("click", async () => {
    if (!(await confirmDanger("¿Borrar esta entrada?", "No se puede deshacer."))) return;
    await db.deleteTicket(ticket.id);
    toast("Entrada eliminada");
    go(`#/parque/${ticket.parkId}`, { replace: true });
  });
}
