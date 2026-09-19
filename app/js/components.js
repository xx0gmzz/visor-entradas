// Componentes que se repiten en varias pantallas: tarjetas de entrada y sus miniaturas.

import * as db from "./db.js";
import { makeThumb } from "./files.js";
import { icon } from "./icons.js";
import { blobUrl, countdown, esc, formatDate, today } from "./ui.js";

/**
 * Tarjeta de una entrada. `park` se usa para el color y, con `showPark`, para el rótulo.
 */
export function ticketCard(t, park, { showPark = false } = {}) {
  const type = db.ticketType(t.type);
  const past = t.visitDate && t.visitDate < today();
  const meta = [
    t.holder && `${icon("user", { size: 14 })}${esc(t.holder)}`,
    t.visitDate && `${icon("calendar", { size: 14 })}${esc(formatDate(t.visitDate))}`,
    t.pages > 1 && `${t.pages} págs.`,
  ].filter(Boolean);

  return `
    <li><a class="card ticket-card${past ? " past" : ""}${t.used ? " used" : ""}"
           href="#/entrada/${t.id}" style="--park:${esc(park?.color ?? "var(--primary)")}">
      <span class="thumb" data-thumb="${t.id}">
        ${icon(type.icon, { size: 22 })}
      </span>
      <span class="card-info">
        <span class="kicker">${icon(type.icon, { size: 13 })}${esc(type.label)}${
          showPark && park ? ` · ${esc(park.name)}` : ""
        }</span>
        <strong>${esc(t.title)}</strong>
        ${meta.length ? `<small class="meta">${meta.map((m) => `<span>${m}</span>`).join("")}</small>` : ""}
      </span>
      ${
        t.used
          ? `<span class="used-badge" title="Usada">${icon("check", { size: 16 })}</span>`
          : `<span class="chevron">${icon("chevron", { size: 18 })}</span>`
      }
    </a></li>`;
}

/**
 * Encabezado de un grupo de entradas del mismo día. Si la fecha no ha pasado ofrece el modo
 * puerta y un botón de calendario (con data-ics=fecha; la pantalla pone el manejador).
 */
export function dateGroupHeader(date, { doorHref = null } = {}) {
  if (!date) return `<div class="group-title"><h3>Sin fecha</h3></div>`;
  const upcoming = date >= today();
  return `
    <div class="group-title">
      <h3>${esc(formatDate(date))} <em>${esc(countdown(date))}</em></h3>
      ${
        upcoming
          ? `<button type="button" class="chip" data-ics="${esc(date)}" aria-label="Añadir al calendario">
               ${icon("calendar", { size: 15 })}</button>
             ${doorHref ? `<a class="chip chip-action" href="${doorHref}">${icon("expand", { size: 15 })}Modo puerta</a>` : ""}`
          : ""
      }
    </div>`;
}

/** Selector de tipo de entrada (radios con aspecto de chips). */
export const typePicker = (selected = "entrada") => `
  <fieldset class="type-picker">
    <legend>Tipo</legend>
    ${db.TICKET_TYPES.map(
      (t) => `
      <label class="type-option">
        <input type="radio" name="type" value="${t.id}" ${t.id === selected ? "checked" : ""}>
        <span>${icon(t.icon, { size: 18 })}${esc(t.label)}</span>
      </label>`,
    ).join("")}
  </fieldset>`;

// Cola única: las miniaturas se generan de una en una para no disparar la memoria en iOS.
let queue = Promise.resolve();

/**
 * Rellena las miniaturas de las tarjetas ya pintadas. Las entradas antiguas no tienen
 * miniatura: se genera ahora a partir de la primera página y se guarda para la próxima vez.
 */
export function hydrateThumbs(container) {
  for (const el of container.querySelectorAll("[data-thumb]")) {
    queue = queue
      .then(async () => {
        if (!el.isConnected) return;
        const id = el.dataset.thumb;
        let thumb = await db.getThumb(id);
        if (!thumb) {
          const files = await db.getFiles(id);
          if (!files) return;
          const source =
            files.pages[0] ?? (files.original?.type.startsWith("image/") ? files.original : null);
          thumb = await makeThumb(source);
          if (!thumb) return;
          await db.setThumb(id, thumb);
        }
        if (!el.isConnected) return;
        const img = new Image();
        img.alt = "";
        img.decoding = "async";
        img.onload = () => el.classList.add("loaded");
        img.src = blobUrl(thumb);
        el.replaceChildren(img);
      })
      .catch((err) => console.warn("Miniatura", err)); // una que falle no para las demás
  }
}
