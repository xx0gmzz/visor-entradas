// Iconos SVG en línea. Sustituyen a los emoji, que cambian de forma y de tamaño en cada
// sistema y nunca quedan alineados. Todos son de trazo y heredan el color con currentColor.

const PATHS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings:
    '<path d="M4 7h8M17 7h3M4 17h3M12 17h8"/><circle cx="14.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>',
  edit: '<path d="M4 20h4L19.5 8.5a2.47 2.47 0 0 0-3.5-3.5L4 16.5z"/><path d="M14.5 6.5l3.5 3.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.7-3.7"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.2 3.6-6.5 8-6.5s8 2.3 8 6.5"/>',
  note: '<path d="M5 3h9l5 5v13H5z"/><path d="M14 3v5h5M8.5 13h7M8.5 17h4"/>',
  share:
    '<path d="M12 15.5V3M8.5 6.5L12 3l3.5 3.5"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 14h9l1-14M10 11v6M14 11v6"/>',
  download: '<path d="M12 3v12M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5M5 20h14"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  qr:
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/>' +
    '<rect x="3.5" y="13.5" width="7" height="7" rx="1"/><path d="M13.5 13.5h3v3h-3zM19 13.5h1.5M19 19v1.5M16.5 20.5h2.5"/>',
  ticket:
    '<path d="M3 9V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a3 3 0 0 0 0 6v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a3 3 0 0 0 0-6z"/><path d="M14 6v12"/>',
  bolt: '<path d="M13.5 3L5 14h5.5L10 21l8.5-11H13z"/>',
  car: '<path d="M3 13.5l2-6A2 2 0 0 1 6.9 6h10.2a2 2 0 0 1 1.9 1.5l2 6V18a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1H6.5v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3.5 13.5h17M6.5 16h1M16.5 16h1"/>',
  bed: '<path d="M3 19V6M3 13h18v6M11 13V8h5a5 5 0 0 1 5 5"/><circle cx="7" cy="9.5" r="2"/>',
  cutlery:
    '<path d="M6 3v6a2 2 0 0 0 4 0V3M8 11v10"/><path d="M17.5 3c-1.4 2-2 4.2-2 6 0 1.4 1 2.2 2 2.2s2-.8 2-2.2c0-1.8-.6-4-2-6zM17.5 11.2V21"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.3 7.3a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0L3.8 12.9a1 1 0 0 1-.3-.7z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
  warning: '<path d="M12 3.5l9.5 17H2.5z"/><path d="M12 10v4.5M12 17.8v.2"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  sparkles:
    '<path d="M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.2 2"/>',
  image:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.8"/><path d="M4 17l4.5-4.5 3 3 3.5-3.5L20 16"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  inbox:
    '<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M4 13l2-8.2A1 1 0 0 1 7 4h10a1 1 0 0 1 1 .8L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  filter: '<path d="M3.5 5.5h17l-6.5 7.5V20l-4-2.2v-5z"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.4-3 8-7.5 9.5-4.5-1.5-7.5-5.1-7.5-9.5V6z"/>',
};

/**
 * Devuelve el SVG de un icono. `size` en px, `className` se añade a la clase base.
 */
export function icon(name, { size = 22, className = "" } = {}) {
  const path = PATHS[name];
  if (!path) return "";
  return `<svg class="ico ${className}" viewBox="0 0 24 24" width="${size}" height="${size}"
    fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}
