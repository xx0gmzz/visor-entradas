import * as backup from "../backup.js";
import { openIcs, visitIcs } from "../calendar.js";
import * as db from "../db.js";
import { icon } from "../icons.js";
import {
  countdown,
  daysUntil,
  empty,
  esc,
  fab,
  formatDate,
  formatDateLong,
  header,
  iconButton,
  root,
  today,
} from "../ui.js";

export async function viewHome() {
  const [parks, tickets] = await Promise.all([db.listParks(), db.listTickets()]);
  const now = today();
  const parkById = new Map(parks.map((p) => [p.id, p]));

  const stats = new Map(parks.map((p) => [p.id, { total: 0, next: null }]));
  const orphans = [];
  for (const t of tickets) {
    const s = stats.get(t.parkId);
    if (!s) {
      orphans.push(t);
      continue;
    }
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

  // Hoy: todas las entradas de hoy, de cualquier parque.
  const todayTickets = tickets.filter((t) => t.visitDate === now && parkById.has(t.parkId));
  const todayParks = [...new Set(todayTickets.map((t) => t.parkId))].map((id) => parkById.get(id));

  // Si no hay nada hoy, la próxima visita (el primer parque de la lista ordenada).
  const nextPark = !todayTickets.length && parks.find((p) => stats.get(p.id).next);
  const nextDate = nextPark && stats.get(nextPark.id).next;
  const nextTickets = nextPark
    ? tickets.filter((t) => t.parkId === nextPark.id && t.visitDate === nextDate)
    : [];

  const remind = await backup.shouldRemind(tickets.length);
  const daysSince = remind ? await backup.daysSinceBackup() : null;

  root.innerHTML = `
    ${header({
      title: "Mis entradas",
      large: true,
      actions: [
        iconButton("search", { href: "#/buscar", label: "Buscar" }),
        iconButton("settings", { href: "#/ajustes", label: "Ajustes" }),
      ],
    })}
    <main class="with-fab">
      ${remind ? backupBanner(daysSince) : ""}
      ${
        orphans.length
          ? `<a class="banner banner-warn" href="#/huerfanas">
               ${icon("warning")}
               <span><strong>${orphans.length} entrada${orphans.length === 1 ? "" : "s"} sin parque</strong>
               <small>Toca para asignarlas a un parque</small></span>
               ${icon("chevron", { size: 18 })}
             </a>`
          : ""
      }
      ${todayTickets.length ? todayHero(todayParks, todayTickets) : ""}
      ${nextPark ? nextHero(nextPark, nextDate, nextTickets) : ""}

      ${
        parks.length
          ? `<h2 class="section-title">Parques</h2>
             <ul class="park-grid">${parks.map((p) => parkCard(p, stats.get(p.id))).join("")}</ul>`
          : empty({
              icon: "ticket",
              title: "Aún no tienes parques",
              text: "Crea uno y añade las entradas que te llegaron por correo. Quedan guardadas en el móvil y funcionan sin cobertura.",
              action: `<a class="btn btn-primary" href="#/parque/nuevo">${icon("plus", { size: 20 })}Añadir el primero</a>`,
            })
      }
    </main>
    ${parks.length ? fab("#/parque/nuevo", "Parque") : ""}`;

  root.querySelector("#snooze")?.addEventListener("click", async (e) => {
    const banner = e.currentTarget.closest(".banner");
    await backup.snoozeReminder();
    banner.remove();
  });

  root
    .querySelector("#add-calendar")
    ?.addEventListener("click", () =>
      openIcs(visitIcs({ park: nextPark, date: nextDate, tickets: nextTickets })),
    );
}

function backupBanner(days) {
  return `
    <div class="banner banner-info">
      <a class="banner-link" href="#/ajustes">
        ${icon("download")}
        <span><strong>${days === null ? "Aún no tienes copia de seguridad" : `Tu última copia es de hace ${days} días`}</strong>
        <small>Si borras la app se pierden las entradas. Guárdala en Archivos.</small></span>
      </a>
      <button type="button" class="banner-close" id="snooze" aria-label="Recordar en una semana">${icon("close", { size: 18 })}</button>
    </div>`;
}

function todayHero(parks, tickets) {
  const used = tickets.filter((t) => t.used).length;
  const main = parks[0];
  return `
    <section class="hero hero-today" style="--park:${esc(main.color)}">
      <span class="hero-kicker">${icon("sparkles", { size: 16 })}¡Hoy toca!</span>
      <h2>${parks.map((p) => esc(p.name)).join(" + ")}</h2>
      <p>${tickets.length} entrada${tickets.length === 1 ? "" : "s"}${
        used ? ` · ${used} usada${used === 1 ? "" : "s"}` : ""
      }</p>
      <a class="btn btn-light btn-block" href="#/hoy">${icon("expand", { size: 20 })}Abrir modo puerta</a>
    </section>`;
}

function nextHero(park, date, tickets) {
  const days = daysUntil(date);
  return `
    <section class="hero" style="--park:${esc(park.color)}">
      <a class="hero-link" href="#/parque/${park.id}">
        <span class="hero-kicker">${icon("clock", { size: 16 })}Próxima visita</span>
        <h2>${esc(park.name)}</h2>
        <p>${esc(formatDateLong(date))} · ${tickets.length} entrada${tickets.length === 1 ? "" : "s"}</p>
      </a>
      <div class="hero-count" aria-label="${esc(countdown(date))}">
        <strong>${days === 1 ? "Mañana" : days}</strong>${days === 1 ? "" : `<span>días</span>`}
      </div>
      <button type="button" class="btn btn-glass btn-sm" id="add-calendar">${icon("calendar", { size: 18 })}Añadir al calendario</button>
    </section>`;
}

function parkCard(p, s) {
  return `
    <li><a class="park-card" href="#/parque/${p.id}" style="--park:${esc(p.color)}">
      <span class="park-badge">${esc(p.name.charAt(0).toUpperCase())}</span>
      <span class="card-info">
        <strong>${esc(p.name)}</strong>
        <small>${s.total} entrada${s.total === 1 ? "" : "s"}${
          s.next ? ` · ${esc(formatDate(s.next))}` : ""
        }</small>
      </span>
      ${
        s.next
          ? `<span class="pill">${esc(countdown(s.next))}</span>`
          : `<span class="chevron">${icon("chevron", { size: 18 })}</span>`
      }
    </a></li>`;
}
