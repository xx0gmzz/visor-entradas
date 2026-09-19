import { hydrateThumbs, ticketCard } from "../components.js";
import * as db from "../db.js";
import { icon } from "../icons.js";
import { empty, esc, formatDate, header, root } from "../ui.js";

// Se recuerda la búsqueda para que al volver de una entrada siga ahí.
let lastQuery = "";

// Sin tildes ni mayúsculas: «Óscar» encuentra «oscar».
const normalize = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export async function viewSearch() {
  const [parks, tickets] = await Promise.all([db.listParks(), db.listTickets()]);
  const parkById = new Map(parks.map((p) => [p.id, p]));

  // Texto en el que buscar para cada entrada, calculado una sola vez.
  const haystack = new Map(
    tickets.map((t) => [
      t.id,
      normalize(
        [
          t.title,
          t.holder,
          t.locator,
          t.notes,
          t.fileName,
          parkById.get(t.parkId)?.name,
          db.ticketType(t.type).label,
          t.visitDate,
          formatDate(t.visitDate),
        ].join(" "),
      ),
    ]),
  );

  root.innerHTML = `
    ${header({ title: "Buscar", back: "#/" })}
    <main>
      <label class="search-box">
        ${icon("search", { size: 20 })}
        <input type="search" id="q" placeholder="Titular, localizador, parque, fecha…"
               value="${esc(lastQuery)}" autocomplete="off" enterkeyhint="search">
      </label>
      <div id="results"></div>
    </main>`;

  const input = root.querySelector("#q");
  const results = root.querySelector("#results");

  function paint() {
    lastQuery = input.value;
    const words = normalize(input.value).split(/\s+/).filter(Boolean);
    if (!words.length) {
      results.innerHTML = empty({
        icon: "search",
        title: `${tickets.length} entrada${tickets.length === 1 ? "" : "s"} guardada${tickets.length === 1 ? "" : "s"}`,
        text: "Escribe un nombre, un localizador, un parque o una fecha.",
      });
      return;
    }
    // Todas las palabras tienen que aparecer, en cualquier orden.
    const found = tickets.filter((t) => words.every((w) => haystack.get(t.id).includes(w)));
    results.innerHTML = found.length
      ? `<p class="muted small">${found.length} resultado${found.length === 1 ? "" : "s"}</p>
         <ul class="card-list">${found
           .map((t) => ticketCard(t, parkById.get(t.parkId), { showPark: true }))
           .join("")}</ul>`
      : empty({
          icon: "search",
          title: "Sin resultados",
          text: `Nada coincide con «${input.value}».`,
        });
    hydrateThumbs(results);
  }

  input.addEventListener("input", paint);
  paint();
  input.focus();
}
