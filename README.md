# 🎢 Visor de Entradas (PWA)

Guarda las entradas de los parques de atracciones **en el propio móvil** y enséñalas en la puerta
sin buscar el PDF en el correo, incluso sin cobertura.

- Todo se hace desde el móvil: subir, organizar por parques y ver las entradas.
- Los datos solo existen en el móvil (IndexedDB). No hay servidor ni cuentas.
- Funciona sin conexión una vez instalada.
- Admite PDF (convertido a imagen para que el QR se vea nítido), imágenes/capturas y HTML.
- Visor con fondo blanco, modo «solo la entrada», deslizar entre entradas y pantalla siempre encendida.
- Copia de seguridad a Archivos / iCloud Drive desde Ajustes.

## Estructura

```
app/                 ← lo que se publica (HTML/CSS/JS sin compilar)
  index.html
  styles.css
  sw.js              ← service worker: caché para uso sin conexión
  manifest.webmanifest
  js/app.js          ← pantallas y navegación (router por #hash)
  js/db.js           ← almacenamiento en IndexedDB
  js/files.js        ← PDF → imágenes con pdf.js, copias de seguridad
  vendor/pdfjs/      ← pdf.js copiado desde node_modules (npm install lo actualiza)
scripts/vendor.js
.github/workflows/deploy.yml  ← publica app/ en GitHub Pages en cada push a main
```

## Desarrollo

```bash
npm install          # instala herramientas y copia pdf.js a app/vendor
npm run dev          # servidor en http://localhost:8080 (y en tu IP local)
npm run lint         # ESLint
npm run format       # Prettier (VS Code ya formatea al guardar)
```

- **En el ordenador**: http://localhost:8080. El service worker está desactivado en localhost
  para que veas los cambios al recargar; para probarlo, abre http://localhost:8080/?sw=1.
- **En el iPhone (misma wifi)**: http://IP-DEL-MAC:8080 (`ipconfig getifaddr en0`). Funciona todo
  menos el modo sin conexión y mantener la pantalla encendida, que exigen https.
- **Depurar en el iPhone**: iPhone → Ajustes → Apps → Safari → Avanzado → _Inspector web_.
  Conecta el cable y en el Mac: Safari → menú _Desarrollo_ → tu iPhone.
- **Alternativa sin terminal**: clic derecho en `app/index.html` → _Open with Live Server_.

Los datos de desarrollo viven en el navegador que uses; no se mezclan con los del móvil.

## Publicar (GitHub Pages, gratis)

Solo la primera vez:

```bash
gh auth login
git init && git add . && git commit -m "Primera versión"
gh repo create visor-entradas --public --source . --push
gh api -X POST repos/{owner}/visor-entradas/pages -f build_type=workflow
```

Después, cada `git push` publica la versión nueva en `https://<usuario>.github.io/visor-entradas/`.
Los móviles la descargan sola al abrir la app con conexión. El repositorio solo contiene el código;
tus entradas nunca se suben.

## Instalar en el iPhone

1. Abre la URL de GitHub Pages en **Safari**.
2. Compartir → **Añadir a pantalla de inicio**.
3. Ábrela desde el icono. A partir de aquí funciona sin conexión.

> ⚠️ Si borras la app de la pantalla de inicio se borran sus datos. Usa _Ajustes → Exportar copia_.
