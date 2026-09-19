import * as backup from "../backup.js";
import * as db from "../db.js";
import { icon } from "../icons.js";
import * as lock from "../lock.js";
import {
  ask,
  confirmDanger,
  esc,
  formatDate,
  formatSize,
  go,
  header,
  root,
  shareOrDownload,
  toast,
} from "../ui.js";

export async function viewSettings() {
  const [estimate, persisted, last, parks, tickets, lockSupported, currentLock] = await Promise.all(
    [
      navigator.storage?.estimate?.().catch(() => ({})) ?? {},
      navigator.storage?.persisted?.().catch(() => false) ?? false,
      backup.lastBackupAt(),
      db.listParks(),
      db.listTickets(),
      lock.lockSupported(),
      lock.getLock(),
    ],
  );
  const daysAgo = last ? Math.floor((Date.now() - last) / 86_400_000) : null;
  const lastLabel =
    last === null
      ? "Nunca"
      : daysAgo === 0
        ? "Hoy"
        : daysAgo === 1
          ? "Ayer"
          : `Hace ${daysAgo} días (${formatDate(new Date(last).toISOString().slice(0, 10))})`;
  const stale = daysAgo === null || daysAgo >= backup.BACKUP_REMINDER_DAYS;

  root.innerHTML = `
    ${header({ title: "Ajustes", back: "#/" })}
    <main>
      <section class="panel">
        <h2>${icon("download", { size: 20 })}Copia de seguridad</h2>
        <p class="muted">Tus entradas solo están en este móvil. Si borras la app o cambias de móvil,
          se pierden: guarda una copia en Archivos o iCloud Drive de vez en cuando.</p>
        <p class="stat-row"><span>Última copia</span>
          <strong class="${stale && tickets.length ? "text-warn" : ""}">${esc(lastLabel)}</strong></p>
        <div class="progress" id="export-progress" hidden><span></span></div>
        <button type="button" class="btn btn-primary btn-block" id="export">Exportar copia</button>
        <label class="btn btn-block file-btn">${icon("upload", { size: 20 })}Importar copia
          <input type="file" id="import" accept=".zip,application/zip,application/json,.json">
        </label>
      </section>

      <section class="panel">
        <h2>${icon("lock", { size: 20 })}Bloqueo</h2>
        ${
          lockSupported
            ? currentLock
              ? `<p class="muted">Activado. La app pide Face ID (o tu PIN) al abrirla y tras
                   2 minutos en segundo plano.</p>
                 <button type="button" class="btn btn-danger btn-block" id="lock-off">Desactivar bloqueo</button>`
              : `<p class="muted">Pide Face ID o Touch ID al abrir la app. Es un bloqueo de pantalla:
                   evita miradas curiosas, pero no cifra los datos del móvil.</p>
                 <form class="form" id="lock-form">
                   <label>PIN de respaldo <small>(4 a 8 cifras, por si Face ID falla)</small>
                     <input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}"
                            required autocomplete="new-password" maxlength="8">
                   </label>
                   <label>Repite el PIN
                     <input name="pin2" type="password" inputmode="numeric" pattern="[0-9]{4,8}"
                            required autocomplete="new-password" maxlength="8">
                   </label>
                   <button class="btn btn-block">${icon("shield", { size: 20 })}Activar bloqueo</button>
                 </form>`
            : `<p class="muted">Este navegador no permite Face ID en webs. Funciona con la app
                 instalada desde su dirección https.</p>`
        }
      </section>

      <section class="panel">
        <h2>${icon("inbox", { size: 20 })}Almacenamiento</h2>
        <p class="stat-row"><span>Parques</span><strong>${parks.length}</strong></p>
        <p class="stat-row"><span>Entradas</span><strong>${tickets.length}</strong></p>
        <p class="stat-row"><span>Espacio usado</span>
          <strong>${formatSize(estimate.usage)}${estimate.quota ? ` de ${formatSize(estimate.quota)}` : ""}</strong></p>
        <p class="stat-row"><span>Protegido contra borrado automático</span>
          <strong>${persisted ? "Sí" : "No"}</strong></p>
      </section>
    </main>`;

  setupExport();
  root.querySelector("#import").addEventListener("change", (e) => importBackup(e.target.files[0]));
  setupLock();
}

// Dos pasos: preparar la copia tarda, y iOS solo deja compartir justo tras un toque.
function setupExport() {
  const button = root.querySelector("#export");
  const progress = root.querySelector("#export-progress");
  const bar = progress.querySelector("span");

  button.addEventListener("click", async function prepare() {
    button.disabled = true;
    button.textContent = "Preparando copia…";
    progress.hidden = false;
    try {
      const file = await backup.buildBackup((done, total) => {
        bar.style.width = `${(done / total) * 100}%`;
      });
      button.removeEventListener("click", prepare);
      button.addEventListener("click", async () => {
        if (await shareOrDownload(file)) {
          await backup.markBackupDone();
          toast("Copia guardada");
          viewSettings(); // repinta la fecha de la última copia
        }
      });
      button.textContent = `Guardar copia (${formatSize(file.size)})`;
    } catch (err) {
      console.error(err);
      toast(`No se pudo preparar la copia: ${err?.message}`, "error");
      button.textContent = "Exportar copia";
      progress.hidden = true;
    }
    button.disabled = false;
  });
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = await backup.readBackup(file);
    const collisions = await db.countCollisions(data.tickets);
    const current = (await db.listTickets()).length;
    const when = data.exportedAt ? ` del ${formatDate(data.exportedAt.slice(0, 10))}` : "";

    const mode = await ask({
      title: "Importar copia",
      text:
        `La copia${when} tiene ${data.parks.length} parque${data.parks.length === 1 ? "" : "s"} y ` +
        `${data.tickets.length} entrada${data.tickets.length === 1 ? "" : "s"}.` +
        (collisions
          ? ` ${collisions} ya están en este móvil y se sustituirán por las de la copia.`
          : "") +
        (current ? ` Ahora tienes ${current} entrada${current === 1 ? "" : "s"}.` : ""),
      options: current
        ? [
            { label: "Añadir a lo que tengo", value: "merge", style: "primary" },
            { label: "Reemplazar todo", value: "replace", style: "danger" },
          ]
        : [{ label: "Importar", value: "merge", style: "primary" }],
    });
    if (!mode) return;
    if (
      mode === "replace" &&
      !(await confirmDanger(
        "¿Reemplazar todo?",
        `Se borrarán tus ${current} entradas actuales y se dejarán solo las de la copia.`,
        "Reemplazar",
      ))
    )
      return;

    await db.restoreAll(data, mode);
    toast("Copia importada");
    go("#/");
  } catch (err) {
    console.error(err);
    toast(`No se pudo importar: ${err?.message}`, "error");
  } finally {
    const input = root.querySelector("#import");
    if (input) input.value = ""; // permite volver a elegir el mismo fichero
  }
}

function setupLock() {
  root.querySelector("#lock-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { pin, pin2 } = Object.fromEntries(new FormData(e.target));
    if (pin !== pin2) return toast("Los PIN no coinciden", "error");
    try {
      await lock.enableLock(pin);
      toast("Bloqueo activado");
      viewSettings();
    } catch (err) {
      console.error(err);
      toast(
        err?.name === "NotAllowedError"
          ? "Cancelado: el bloqueo no se ha activado"
          : `No se pudo activar: ${err?.message}`,
        "error",
      );
    }
  });

  root.querySelector("#lock-off")?.addEventListener("click", async () => {
    if (!(await confirmDanger("¿Desactivar el bloqueo?", "", "Desactivar"))) return;
    await lock.disableLock();
    toast("Bloqueo desactivado");
    viewSettings();
  });
}
