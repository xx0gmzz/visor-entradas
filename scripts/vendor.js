// Copia pdf.js dentro de app/vendor para que la app funcione sin conexión (sin CDN).
import { copyFileSync, mkdirSync } from "node:fs";

const src = "node_modules/pdfjs-dist/legacy/build";
const dest = "app/vendor/pdfjs";
mkdirSync(dest, { recursive: true });
for (const file of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  copyFileSync(`${src}/${file}`, `${dest}/${file}`);
}
console.log(`pdf.js copiado a ${dest}`);
