import { gate } from "./lock.js";
import { disableSwipe, releaseScreen } from "./screen.js";
import { animateIn, empty, header, releaseBlobUrls, root, skeletonList } from "./ui.js";
import { viewDoor, viewToday } from "./views/door.js";
import { viewHome } from "./views/home.js";
import { viewOrphans } from "./views/orphans.js";
import { notFound, viewPark, viewParkForm } from "./views/park.js";
import { viewSearch } from "./views/search.js";
import { viewSettings } from "./views/settings.js";
import { viewTicket, viewTicketEdit } from "./views/ticket.js";
import { viewUpload } from "./views/upload.js";

// ------------------------------------------------------------------ router

const routes = [
  [/^#?\/?$/, viewHome],
  [/^#\/ajustes$/, viewSettings],
  [/^#\/buscar$/, viewSearch],
  [/^#\/hoy$/, viewToday],
  [/^#\/huerfanas$/, viewOrphans],
  [/^#\/parque\/nuevo$/, () => viewParkForm()],
  [/^#\/parque\/([\w-]+)$/, viewPark],
  [/^#\/parque\/([\w-]+)\/editar$/, viewParkForm],
  [/^#\/parque\/([\w-]+)\/subir$/, viewUpload],
  [/^#\/puerta\/([\w-]+)\/(\d{4}-\d{2}-\d{2})$/, viewDoor],
  [/^#\/entrada\/([\w-]+)$/, viewTicket],
  [/^#\/entrada\/([\w-]+)\/editar$/, viewTicketEdit],
];

// Profundidad de una ruta: sirve para saber si la transición va hacia delante o hacia atrás.
const depth = (hash) => (hash.replace(/^#\/?/, "").match(/[^/]+/g) ?? []).length;
let lastHash = location.hash;

// Las pantallas se pintan de una en una. Si se navega mientras otra carga, al acabar se pinta
// solo la última ruta: así una pantalla lenta nunca pisa a la que el usuario ya ha abierto.
let running = false;
let pending = false;

async function scheduleRender() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  do {
    pending = false;
    await render();
  } while (pending);
  running = false;
}

async function render() {
  const hash = location.hash;
  const html = document.documentElement;
  // El gesto de deslizar o el enlace ya dejan puesta la dirección; si no, se deduce de la ruta.
  const direction = html.dataset.nav || (depth(hash) < depth(lastHash) ? "back" : "forward");
  delete html.dataset.nav;
  lastHash = hash;

  releaseBlobUrls();
  disableSwipe();
  document.body.classList.remove("focus", "door-mode", "scrolled");
  const isViewer = /^#\/(entrada\/[\w-]+|hoy|puerta\/.+)$/.test(hash);
  if (!isViewer) releaseScreen();

  // Si la pantalla tarda (p. ej. un PDF grande), se ve un esqueleto en vez de la anterior.
  const skeleton = setTimeout(() => {
    root.innerHTML = `${header({ title: "" })}<main>${skeletonList(4)}</main>`;
  }, 150);

  try {
    const route = routes.find(([pattern]) => pattern.test(hash));
    if (route) await route[1](...hash.match(route[0]).slice(1));
    else notFound();
  } catch (err) {
    console.error(err);
    root.innerHTML = `${header({ title: "Error", back: "#/" })}
      <main>${empty({ icon: "warning", title: "Algo ha fallado", text: err?.message })}</main>`;
  } finally {
    clearTimeout(skeleton);
  }
  if (pending) return; // mientras cargaba se navegó a otra pantalla: se pinta esa enseguida
  window.scrollTo(0, 0);
  animateIn(direction);
}

// Los enlaces pueden forzar la dirección de la transición (p. ej. «Anterior» en el visor).
document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-nav]");
  if (link) document.documentElement.dataset.nav = link.dataset.nav;
});

// Cabecera grande que se encoge al hacer scroll, como en las apps de iOS.
let ticking = false;
window.addEventListener(
  "scroll",
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      document.body.classList.toggle("scrolled", window.scrollY > 24);
      ticking = false;
    });
  },
  { passive: true },
);

window.addEventListener("hashchange", scheduleRender);

// El bloqueo (si está activado) va antes de pintar nada.
gate().then(scheduleRender);

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
