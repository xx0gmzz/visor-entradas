import { openIcs, visitIcs } from "../calendar.js";
import { dateGroupHeader, hydrateThumbs, ticketCard } from "../components.js";
import * as db from "../db.js";
import { icon } from "../icons.js";
import {
  confirmDanger,
  empty,
  esc,
  fab,
  formData,
  go,
  header,
  iconButton,
  root,
  toast,
  today,
} from "../ui.js";

export const PARK_COLORS = [
  "#e63946",
  "#f77f00",
  "#e9b10a",
  "#2a9d8f",
  "#06a77d",
  "#0096c7",
  "#457b9d",
  "#5b4bdb",
  "#8e44ad",
  "#d63384",
  "#e76f51",
  "#264653",
];

// Último filtro elegido en cada parque, para que al volver de una entrada no se pierda.
const filterByPark = new Map();

export async function viewPark(id) {
  const [park, tickets] = await Promise.all([db.getPark(id), db.listTickets(id)]);
  if (!park) return notFound();
  const now = today();

  const upcoming = tickets.filter((t) => !t.visitDate || t.visitDate >= now);
  const past = tickets.filter((t) => t.visitDate && t.visitDate < now);
  const pastNewestFirst = [...past].reverse(); // lo más reciente arriba
  const counts = { next: upcoming.length, past: past.length, all: tickets.length };

  let filter = filterByPark.get(id) ?? (upcoming.length || !past.length ? "next" : "past");

  root.innerHTML = `
    ${header({
      title: park.name,
      back: "#/",
      color: park.color,
      actions: [iconButton("edit", { href: `#/parque/${park.id}/editar`, label: "Editar parque" })],
    })}
    <main class="with-fab">
      ${
        tickets.length
          ? `<div class="segmented" role="tablist">
              ${[
                ["next", "Próximas"],
                ["past", "Pasadas"],
                ["all", "Todas"],
              ]
                .map(
                  ([key, label]) =>
                    `<button type="button" role="tab" data-filter="${key}">${label}<span>${counts[key]}</span></button>`,
                )
                .join("")}
             </div>
             <div id="list"></div>`
          : empty({
              icon: "ticket",
              title: "Este parque aún no tiene entradas",
              text: "Sube los PDF, capturas o páginas web de tus entradas.",
              action: `<a class="btn btn-primary" href="#/parque/${park.id}/subir">${icon("plus", { size: 20 })}Añadir entradas</a>`,
            })
      }
    </main>
    ${tickets.length ? fab(`#/parque/${park.id}/subir`, "Entradas") : ""}`;

  if (!tickets.length) return;

  const list = root.querySelector("#list");

  function paint() {
    filterByPark.set(id, filter);
    for (const b of root.querySelectorAll("[data-filter]")) {
      b.setAttribute("aria-selected", b.dataset.filter === filter);
    }
    const shown = filter === "next" ? upcoming : filter === "past" ? pastNewestFirst : tickets;

    if (!shown.length) {
      list.innerHTML = empty({
        icon: filter === "next" ? "calendar" : "clock",
        title: filter === "next" ? "No hay visitas pendientes" : "Aún no hay visitas pasadas",
      });
      return;
    }

    // Agrupadas por fecha: así se ve de un vistazo qué entradas van juntas.
    const groups = new Map();
    for (const t of shown) {
      const key = t.visitDate ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    list.innerHTML = [...groups]
      .map(
        ([date, items]) => `
        <section class="group">
          ${dateGroupHeader(date || null, {
            doorHref: date ? `#/puerta/${park.id}/${date}` : null,
          })}
          <ul class="card-list">${items.map((t) => ticketCard(t, park)).join("")}</ul>
        </section>`,
      )
      .join("");
    hydrateThumbs(list);
  }

  root.querySelector(".segmented").addEventListener("click", (e) => {
    const button = e.target.closest("[data-filter]");
    if (!button) return;
    filter = button.dataset.filter;
    paint();
  });

  list.addEventListener("click", (e) => {
    const button = e.target.closest("[data-ics]");
    if (!button) return;
    const date = button.dataset.ics;
    openIcs(visitIcs({ park, date, tickets: tickets.filter((t) => t.visitDate === date) }));
  });

  paint();
}

export async function viewParkForm(id) {
  const park = id ? await db.getPark(id) : null;
  if (id && !park) return notFound();
  const current = park?.color ?? PARK_COLORS[Math.floor(Math.random() * PARK_COLORS.length)];

  root.innerHTML = `
    ${header({
      title: park ? "Editar parque" : "Nuevo parque",
      back: park ? `#/parque/${park.id}` : "#/",
      color: current,
    })}
    <main>
      <div class="park-preview" id="preview" style="--park:${esc(current)}">
        <span class="park-badge">${esc((park?.name ?? "?").charAt(0).toUpperCase())}</span>
        <strong>${esc(park?.name ?? "Nombre del parque")}</strong>
      </div>
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
              <span>${icon("check", { size: 18 })}</span>
            </label>`,
          ).join("")}
        </fieldset>
        <button class="btn btn-primary btn-block">Guardar</button>
      </form>
      ${park ? `<button type="button" class="btn btn-danger btn-block" id="delete">${icon("trash", { size: 20 })}Borrar parque</button>` : ""}
    </main>`;

  const form = root.querySelector("#park-form");
  const preview = root.querySelector("#preview");
  const nameInput = form.querySelector("input[name=name]");

  // Vista previa en directo: se ve cómo quedará la tarjeta antes de guardar.
  form.addEventListener("input", () => {
    const name = nameInput.value.trim();
    const color = form.querySelector("input[name=color]:checked").value;
    preview.style.setProperty("--park", color);
    root.querySelector(".topbar").style.setProperty("--park", color);
    preview.querySelector(".park-badge").textContent = (name || "?").charAt(0).toUpperCase();
    preview.querySelector("strong").textContent = name || "Nombre del parque";
  });

  if (!park) nameInput.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { name, color } = formData(e.target);
    const saved = { ...(park ?? { id: db.newId(), createdAt: Date.now() }), name, color };
    await db.savePark(saved);
    go(`#/parque/${saved.id}`, { replace: true });
  });

  root.querySelector("#delete")?.addEventListener("click", async () => {
    const tickets = await db.listTickets(park.id);
    const ok = await confirmDanger(
      `¿Borrar «${park.name}»?`,
      tickets.length
        ? `Se borrarán también sus ${tickets.length} entradas. No se puede deshacer.`
        : "No se puede deshacer.",
    );
    if (!ok) return;
    await db.deletePark(park.id);
    toast("Parque eliminado");
    go("#/", { replace: true });
  });
}

export function notFound() {
  root.innerHTML = `${header({ title: "No encontrado", back: "#/" })}
    <main>${empty({ icon: "inbox", title: "Esto ya no existe" })}</main>`;
}
