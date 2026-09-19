// Genera un evento .ics de día completo para la visita, con aviso la tarde anterior.
// En iPhone, al abrirlo aparece la hoja «Añadir al calendario».

const escText = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

// RFC 5545: líneas de 75 octetos como máximo; las siguientes empiezan por un espacio.
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let current = "";
  for (const ch of line) {
    if (new TextEncoder().encode(current + ch).length > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
    }
    current += ch;
  }
  out.push(current);
  return out.join("\r\n ");
}

const compact = (iso) => iso.replaceAll("-", "");

function nextDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1));
  return date.toISOString().slice(0, 10);
}

export function visitIcs({ park, date, tickets }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const holders = [...new Set(tickets.map((t) => t.holder).filter(Boolean))];
  const locators = tickets.map((t) => t.locator).filter(Boolean);
  const description = [
    `${tickets.length} entrada${tickets.length === 1 ? "" : "s"} en Mis entradas.`,
    holders.length && `Titulares: ${holders.join(", ")}`,
    locators.length && `Localizadores: ${locators.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Visor de Entradas//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${park.id}-${compact(date)}@visor-entradas`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(date)}`,
    `DTEND;VALUE=DATE:${compact(nextDay(date))}`,
    `SUMMARY:${escText(`🎢 ${park.name}`)}`,
    `DESCRIPTION:${escText(description)}`,
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escText(`Mañana: ${park.name}. Revisa tus entradas.`)}`,
    "TRIGGER:-PT6H", // las 18:00 del día anterior
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const body = lines.map(fold).join("\r\n") + "\r\n";
  const safeName = park.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return new File([body], `${safeName || "visita"}-${date}.ics`, { type: "text/calendar" });
}

// Safari abre text/calendar con la hoja nativa del calendario; la hoja de compartir no lo ofrece.
export function openIcs(file) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
