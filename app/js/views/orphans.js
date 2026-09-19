// Entradas cuyo parque ya no existe (p. ej. una copia importada a medias). Antes eran invisibles:
// aquí se pueden mover a un parque o borrar.

import { hydrateThumbs, ticketCard } from "../components.js";
import * as db from "../db.js";
import { icon } from "../icons.js";
import { confirmDanger, empty, esc, go, header, root, toast } from "../ui.js";

export async function viewOrphans() {
  const [parks, tickets] = await Promise.all([db.listParks(), db.listTickets()]);
  const ids = new Set(parks.map((p) => p.id));
  const orphans = tickets.filter((t) => !ids.has(t.parkId));
  parks.sort((a, b) => a.name.localeCompare(b.name, "es"));

  if (!orphans.length) {
    root.innerHTML = `${header({ title: "Entradas sin parque", back: "#/" })}
      <main>${empty({ icon: "check", title: "Todo en orden", text: "No hay entradas sin parque." })}</main>`;
    return;
  }

  root.innerHTML = `
    ${header({ title: "Entradas sin parque", back: "#/" })}
    <main>
      <p class="muted">Estas entradas pertenecían a un parque que ya no existe.
        Muévelas a uno de tus parques o bórralas.</p>
      <ul class="card-list">${orphans.map((t) => ticketCard(t, null)).join("")}</ul>

      <form class="form panel" id="move-form">
        <label>Mover todas a
          ${
            parks.length
              ? `<select name="parkId">${parks.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>`
              : `<input name="newPark" required placeholder="Nombre del parque nuevo">`
          }
        </label>
        ${
          parks.length
            ? `<label>o a un parque nuevo <input name="newPark" placeholder="Nombre (opcional)" autocomplete="off"></label>`
            : ""
        }
        <button class="btn btn-primary btn-block">Mover ${orphans.length} entrada${orphans.length === 1 ? "" : "s"}</button>
      </form>
      <button type="button" class="btn btn-danger btn-block" id="delete">${icon("trash", { size: 20 })}Borrarlas todas</button>
    </main>`;

  hydrateThumbs(root);

  root.querySelector("#move-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const newName = String(data.get("newPark") ?? "").trim();
    let parkId = data.get("parkId");
    if (newName) {
      parkId = db.newId();
      await db.savePark({ id: parkId, name: newName, color: "#5b4bdb", createdAt: Date.now() });
    }
    await db.saveTickets(orphans.map((t) => ({ ...t, parkId })));
    toast(
      `${orphans.length} entrada${orphans.length === 1 ? "" : "s"} movida${orphans.length === 1 ? "" : "s"}`,
    );
    go(`#/parque/${parkId}`, { replace: true });
  });

  root.querySelector("#delete").addEventListener("click", async () => {
    const ok = await confirmDanger(
      `¿Borrar ${orphans.length} entrada${orphans.length === 1 ? "" : "s"}?`,
      "No se puede deshacer.",
    );
    if (!ok) return;
    for (const t of orphans) await db.deleteTicket(t.id);
    toast("Entradas borradas");
    go("#/", { replace: true });
  });
}
