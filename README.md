# 🎢 Visor de Entradas (PWA)

Guarda las entradas de los parques de atracciones **en el propio móvil** y enséñalas en la puerta
sin buscar el PDF en el correo, incluso sin cobertura.

- Todo se hace desde el móvil: subir, organizar por parques y ver las entradas.
- Los datos solo existen en el móvil (IndexedDB). No hay servidor ni cuentas.
- Funciona sin conexión una vez instalada.
- Admite PDF (convertido a imagen para que el QR se vea nítido), imágenes/capturas y HTML.

**En la puerta del parque**

- **Modo puerta**: las entradas del día en un carrusel a pantalla completa. Marcas cada una como
  _usada_ al pasar el torno y salta sola a la siguiente. Desde la portada («¡Hoy toca!») o desde
  cada fecha en la vista del parque.
- **Marcar como usada**: sello «Usada» con la hora, para saber quién ha entrado ya.
- **Ampliar código**: el QR o código de barras recortado a pantalla completa, con el localizador
  en grande para dictarlo si el lector falla. En Chrome/Android se lee con `BarcodeDetector`; en
  Safari (que no lo tiene) lo localiza un detector propio en `files.js` (`locateCode`).
- Fondo blanco, modo «solo la entrada», deslizar entre entradas y pantalla siempre encendida.

**Al guardar**

- **Autorrelleno** desde el texto del PDF: fecha de visita, titular y localizador. Con varios
  ficheros, cada entrada usa lo detectado en el suyo.
- **Una entrada por página** para PDFs que traen a varias personas.
- **Tipo** de entrada: entrada, acceso rápido, parking, hotel, comida u otro.

**Organización**

- Miniaturas en las listas, filtros _Próximas / Pasadas / Todas_ y grupos por fecha.
- **Buscador** por titular, localizador, parque, fecha o notas (sin distinguir tildes).
- **Cuenta atrás** de la próxima visita y **añadir al calendario** (.ics con aviso la tarde antes).
- Las entradas «huérfanas» (cuyo parque ya no existe) se avisan en la portada y se pueden mover.

**Datos y privacidad**

- **Copia de seguridad en ZIP** a Archivos / iCloud Drive. Se genera por partes, sin cargar todo
  en memoria. Importa también las copias JSON de la primera versión, y al importar eliges entre
  _añadir_ o _reemplazar todo_.
- **Aviso** en la portada si llevas más de 30 días sin copia (se puede posponer una semana).
- **Bloqueo con Face ID / Touch ID** (WebAuthn) y PIN de respaldo. Es un bloqueo de pantalla,
  no cifra los datos. Solo funciona desde https (GitHub Pages) o localhost.

## Estructura

```
app/                 ← lo que se publica (HTML/CSS/JS sin compilar)
  index.html
  styles.css         ← sistema de diseño (tokens de color claro/oscuro, componentes)
  sw.js              ← service worker: caché para uso sin conexión (lista de ficheros a mano)
  manifest.webmanifest
  js/app.js          ← router por #hash, arranque, bloqueo y PWA
  js/ui.js           ← cabecera, avisos, hoja de opciones, fechas y utilidades
  js/icons.js        ← iconos SVG
  js/components.js   ← tarjeta de entrada, miniaturas, selector de tipo
  js/db.js           ← almacenamiento en IndexedDB (con migraciones por versión)
  js/files.js        ← PDF → imágenes, miniaturas, autorrelleno, localizar códigos
  js/backup.js       ← copias de seguridad (ZIP v2 y JSON v1)
  js/zip.js          ← ZIP sin compresión, sin dependencias
  js/calendar.js     ← evento .ics
  js/lock.js         ← bloqueo con Face ID y PIN
  js/screen.js       ← pantalla encendida y gesto de deslizar
  js/views/*.js      ← una pantalla por fichero
  vendor/pdfjs/      ← pdf.js copiado desde node_modules (npm install lo actualiza)
scripts/vendor.js
.github/workflows/deploy.yml  ← publica app/ en GitHub Pages en cada push a main
```

> Si añades un fichero a `app/js/`, añádelo también a `ASSETS` en `sw.js` o la app no abrirá sin
> conexión.

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
