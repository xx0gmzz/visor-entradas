// Piezas de interfaz compartidas por todas las pantallas: cabecera, avisos, fechas y utilidades.

import { icon } from "./icons.js";

export const root = document.getElementById("app");

export const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

const MONTHS_LONG = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatDateLong(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${weekday} ${d} de ${MONTHS_LONG[m - 1]} de ${y}`;
}

// Días entre hoy y una fecha ISO. Negativo si ya pasó.
export function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86_400_000);
}

export function countdown(iso) {
  const days = daysUntil(iso);
  if (days === null) return "";
  if (days === 0) return "¡hoy!";
  if (days === 1) return "mañana";
  if (days < 0) return days === -1 ? "ayer" : `hace ${-days} días`;
  if (days < 7) return `en ${days} días`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `en ${weeks} semana${weeks === 1 ? "" : "s"}`;
  }
  const months = Math.round(days / 30);
  return `en ${months} ${months === 1 ? "mes" : "meses"}`;
}

// ------------------------------------------------------------------ navegación

export const go = (hash, { replace = false } = {}) =>
  replace ? location.replace(hash) : (location.hash = hash);

/**
 * Animación de entrada de una pantalla recién pintada, hacia delante o hacia atrás.
 * Se anima <main> y no toda la app: un transform en un antecesor descoloca los position: fixed
 * (botón flotante, modo puerta) mientras dura.
 */
export function animateIn(direction = "forward") {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const main = root.querySelector("main");
  const target = main ?? root;
  const dx = direction === "back" ? -20 : 20;
  target.animate?.(
    main
      ? [
          { opacity: 0, transform: `translateX(${dx}px)` },
          { opacity: 1, transform: "none" },
        ]
      : [{ opacity: 0 }, { opacity: 1 }],
    { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
}

// ------------------------------------------------------------------ blobs

// URLs de Blob creadas para la vista actual; se liberan al cambiar de pantalla.
let objectUrls = [];

export function blobUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

export function releaseBlobUrls() {
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
}

// ------------------------------------------------------------------ avisos

const toasts = document.createElement("div");
toasts.className = "toasts";
document.body.append(toasts);

export function toast(message, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `${icon(type === "error" ? "warning" : "check", { size: 18 })}<span>${esc(message)}</span>`;
  toasts.append(el);
  const remove = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 200);
  };
  setTimeout(remove, type === "error" ? 6000 : 3200);
}

// ------------------------------------------------------------------ diálogos

/**
 * Hoja de opciones al estilo iOS. Resuelve con el `value` del botón pulsado o null si se cancela.
 * options: [{ label, value, style: "primary" | "danger" | "" }]
 */
export function ask({ title, text = "", options, cancel = "Cancelar" }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "sheet";
    dialog.innerHTML = `
      <form method="dialog" class="sheet-card" tabindex="-1" autofocus>
        <h2>${esc(title)}</h2>
        ${text ? `<p class="muted">${esc(text)}</p>` : ""}
        <div class="sheet-actions">
          ${options
            .map(
              (o, i) =>
                `<button class="btn btn-block ${o.style ? `btn-${o.style}` : ""}" value="${i}">${esc(o.label)}</button>`,
            )
            .join("")}
          <button class="btn btn-block btn-ghost" value="">${esc(cancel)}</button>
        </div>
      </form>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      const i = dialog.returnValue;
      dialog.classList.add("out");
      setTimeout(() => dialog.remove(), 200);
      resolve(i === "" || i == null ? null : options[Number(i)].value);
    });
    // Tocar fuera de la tarjeta cancela.
    dialog.addEventListener("click", (e) => e.target === dialog && dialog.close(""));
    dialog.showModal();
  });
}

export const confirmDanger = async (title, text, label = "Borrar") =>
  (await ask({ title, text, options: [{ label, value: true, style: "danger" }] })) === true;

// ------------------------------------------------------------------ bloques reutilizables

/**
 * Cabecera fija. `actions` es una lista de HTML ya montado (normalmente iconButton).
 * `large` muestra además un título grande debajo, fuera de la barra: se va con el scroll y
 * entonces aparece el pequeño en la barra (clase body.scrolled), como en las apps de iOS.
 */
export function header({
  title,
  subtitle = "",
  back = null,
  actions = [],
  color = "",
  large = false,
}) {
  return `
    <header class="topbar${large ? " topbar-large" : ""}" ${color ? `style="--park:${esc(color)}"` : ""}>
      <div class="topbar-row">
        ${back ? `<a class="icon-btn back" href="${back}" aria-label="Volver">${icon("back")}</a>` : ""}
        <h1 class="topbar-title">
          <span class="topbar-text">${esc(title)}</span>
          ${subtitle ? `<small>${esc(subtitle)}</small>` : ""}
        </h1>
        ${actions.join("")}
      </div>
    </header>
    ${large ? `<h2 class="big-title">${esc(title)}</h2>` : ""}`;
}

export const iconButton = (name, { href, id, label, className = "" } = {}) => {
  const attrs = `class="icon-btn ${className}" aria-label="${esc(label)}" title="${esc(label)}"`;
  return href
    ? `<a ${attrs} href="${href}">${icon(name)}</a>`
    : `<button type="button" ${attrs} id="${id}">${icon(name)}</button>`;
};

export const empty = ({ icon: name = "inbox", title, text = "", action = "" }) => `
  <div class="empty">
    <span class="empty-art">${icon(name, { size: 40 })}</span>
    <p class="empty-title">${esc(title)}</p>
    ${text ? `<p class="empty-text">${esc(text)}</p>` : ""}
    ${action}
  </div>`;

export const fab = (href, label, name = "plus") => `
  <a class="fab" href="${href}" aria-label="${esc(label)}">${icon(name, { size: 26 })}<span>${esc(label)}</span></a>`;

export const skeletonList = (n = 3) =>
  `<ul class="card-list">${Array.from({ length: n }, () => `<li class="card skeleton"></li>`).join("")}</ul>`;

export function formData(form) {
  const data = Object.fromEntries(new FormData(form));
  for (const key of Object.keys(data)) {
    if (typeof data[key] === "string") data[key] = data[key].trim() || null;
  }
  return data;
}

// ------------------------------------------------------------------ compartir

// Devuelve false si el usuario cancela la hoja de compartir.
export async function shareOrDownload(file) {
  // En iPhone la hoja de compartir permite «Guardar en Archivos».
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === "AbortError") return false;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return true;
}

export const formatSize = (bytes) => {
  const mb = (bytes ?? 0) / 1024 / 1024;
  return mb < 1 ? `${Math.max(1, Math.round((bytes ?? 0) / 1024))} KB` : `${mb.toFixed(1)} MB`;
};
