// Modo puerta: todas las entradas de un día en un carrusel a pantalla completa y fondo blanco.
// Pensado para la cola del torno: se enseña una, se marca como usada y pasa sola a la siguiente.

import * as db from "../db.js";
import { icon } from "../icons.js";
import { keepScreenOn } from "../screen.js";
import { empty, esc, formatDate, header, root, toast, today } from "../ui.js";
import { fillStage, openMagnifier, stageContent, toggleUsed } from "./ticket.js";

/** #/hoy: las entradas de hoy de todos los parques. */
export const viewToday = () => viewDoor(null, today());

/** #/puerta/:parque/:fecha */
export async function viewDoor(parkId, date) {
  const [parks, all] = await Promise.all([db.listParks(), db.listTickets(parkId || undefined)]);
  const parkById = new Map(parks.map((p) => [p.id, p]));
  const tickets = all.filter((t) => t.visitDate === date && parkById.has(t.parkId));
  const back = parkId ? `#/parque/${parkId}` : "#/";

  if (!tickets.length) {
    root.innerHTML = `${header({ title: "Modo puerta", back })}
      <main>${empty({ icon: "calendar", title: `No hay entradas para el ${formatDate(date)}` })}</main>`;
    return;
  }

  const parksShown = [...new Set(tickets.map((t) => t.parkId))].map((id) => parkById.get(id));
  const isToday = date === today();
  const title = parksShown.map((p) => p.name).join(" + ");

  root.innerHTML = `
    <div class="door" style="--park:${esc(parksShown[0].color)}">
      <header class="door-bar">
        <a class="icon-btn" href="${back}" aria-label="Salir del modo puerta">${icon("close", { size: 24 })}</a>
        <div class="door-title">
          <strong>${esc(title)}</strong>
          <small id="door-status"></small>
        </div>
        <span class="door-counter" id="door-counter"></span>
      </header>

      <div class="door-track" id="track">
        ${tickets
          .map((t) => {
            const type = db.ticketType(t.type);
            return `
            <section class="door-slide" data-id="${t.id}" aria-label="${esc(t.holder || t.title)}">
              <div class="door-person">
                <strong>${esc(t.holder || t.title)}</strong>
                <small>${icon(type.icon, { size: 14 })}${esc(type.label)}${
                  t.holder ? ` · ${esc(t.title)}` : ""
                }${parksShown.length > 1 ? ` · ${esc(parkById.get(t.parkId).name)}` : ""}</small>
              </div>
              <div class="stage-wrap${t.used ? " used" : ""}">
                <div class="stage door-stage"><div class="door-loading"></div></div>
                <span class="used-stamp" aria-hidden="true">Usada</span>
              </div>
              ${t.locator ? `<p class="door-locator">${esc(t.locator)}</p>` : ""}
            </section>`;
          })
          .join("")}
      </div>

      <footer class="door-foot">
        <div class="door-dots" id="dots">
          ${tickets.map((t, i) => `<button type="button" data-i="${i}" class="${t.used ? "used" : ""}" aria-label="Entrada ${i + 1}"></button>`).join("")}
        </div>
        <div class="door-actions">
          <button type="button" class="btn door-magnify" id="magnify" aria-label="Ampliar código">${icon("qr")}</button>
          <button type="button" class="btn btn-block btn-used" id="used"></button>
        </div>
      </footer>
    </div>`;

  document.body.classList.add("door-mode");
  keepScreenOn();

  const track = root.querySelector("#track");
  const slides = [...track.children];
  const dots = [...root.querySelectorAll("#dots button")];
  const usedBtn = root.querySelector("#used");
  const status = root.querySelector("#door-status");
  const counter = root.querySelector("#door-counter");
  const filesById = new Map();
  let index = 0;

  const usedCount = () => tickets.filter((t) => t.used).length;

  function paint() {
    const t = tickets[index];
    counter.textContent = `${index + 1}/${tickets.length}`;
    status.textContent = `${isToday ? "Hoy" : formatDate(date)} · ${usedCount()} de ${tickets.length} usadas`;
    dots.forEach((d, i) => {
      d.classList.toggle("current", i === index);
      d.classList.toggle("used", Boolean(tickets[i].used));
    });
    usedBtn.classList.toggle("is-used", Boolean(t.used));
    usedBtn.innerHTML = `${icon("check", { size: 20 })}${t.used ? "Usada · deshacer" : "Marcar como usada"}`;
    slides[index].querySelector(".stage-wrap").classList.toggle("used", Boolean(t.used));
  }

  const goTo = (i, behavior = "smooth") =>
    track.scrollTo({ left: i * track.clientWidth, behavior });

  // El índice sale de la posición del carrusel: funciona igual con el dedo que con los puntos.
  let scrollTimer;
  track.addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const i = Math.round(track.scrollLeft / track.clientWidth);
        if (i !== index && tickets[i]) {
          index = i;
          paint();
        }
      }, 60);
    },
    { passive: true },
  );

  root.querySelector("#dots").addEventListener("click", (e) => {
    const dot = e.target.closest("[data-i]");
    if (dot) goTo(Number(dot.dataset.i));
  });

  usedBtn.addEventListener("click", async () => {
    const wasUsed = tickets[index].used;
    tickets[index] = await toggleUsed(tickets[index]);
    paint();
    if (wasUsed) return;
    const nextUnused = tickets.findIndex((t, i) => i > index && !t.used);
    const anyUnused = nextUnused >= 0 ? nextUnused : tickets.findIndex((t) => !t.used);
    if (anyUnused >= 0) setTimeout(() => goTo(anyUnused), 450);
    else toast("¡Todas usadas! A disfrutar 🎢");
  });

  root.querySelector("#magnify").addEventListener("click", () => {
    const t = tickets[index];
    const files = filesById.get(t.id);
    if (files) openMagnifier(t, files);
  });

  // Empieza en la primera que falte por usar.
  index = Math.max(
    0,
    tickets.findIndex((t) => !t.used),
  );
  requestAnimationFrame(() => goTo(index, "instant"));
  paint();

  // Carga el contenido empezando por la visible; el resto después, de una en una.
  // No se espera: la pantalla ya está pintada y cada entrada aparece cuando está lista.
  const order = [index, ...tickets.keys()].filter((v, i, a) => a.indexOf(v) === i);
  (async () => {
    for (const i of order) {
      const t = tickets[i];
      const files = await db.getFiles(t.id);
      if (!slides[i].isConnected) return; // ha salido del modo puerta
      filesById.set(t.id, files);
      const stage = slides[i].querySelector(".door-stage");
      stage.innerHTML = stageContent(t, files);
      await fillStage(stage, t, files);
    }
  })().catch((err) => console.error(err));
}
