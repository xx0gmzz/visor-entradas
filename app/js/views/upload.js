import { typePicker } from "../components.js";
import * as db from "../db.js";
import { guessFields, kindOf, makeThumb, pdfInfo, processFile } from "../files.js";
import { icon } from "../icons.js";
import { esc, formatSize, formData, go, header, root, toast, today } from "../ui.js";
import { notFound } from "./park.js";

const KIND_ICON = { pdf: "file", image: "image", html: "ticket" };
const GUESSED = ["holder", "visitDate", "locator"];

// «portaventura-2_personas» -> «Portaventura 2 personas»: título por defecto más legible.
const prettyName = (stem) => {
  const clean = stem.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || stem;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

export async function viewUpload(parkId) {
  const park = await db.getPark(parkId);
  if (!park) return notFound();

  root.innerHTML = `
    ${header({ title: "Añadir entradas", subtitle: park.name, back: `#/parque/${park.id}`, color: park.color })}
    <main>
      <form class="form" id="upload-form">
        <label class="dropzone" id="dropzone">
          <input type="file" name="files" multiple required
                 accept="application/pdf,.pdf,image/*,text/html,.html,.htm">
          <span class="dropzone-icon">${icon("upload", { size: 30 })}</span>
          <strong>Elige tus entradas</strong>
          <small>PDF, imágenes, capturas o HTML · puedes elegir varios</small>
        </label>
        <ul class="file-list" id="file-list" hidden></ul>

        <label class="check-row" id="split-row" hidden>
          <input type="checkbox" name="split">
          <span><strong>Una entrada por página</strong>
            <small id="split-hint">Para PDFs con varias entradas dentro, una en cada página.</small></span>
        </label>

        ${typePicker()}

        <label>Título <small>(opcional; si no, el nombre del fichero)</small>
          <input name="title" placeholder="Entrada 1 día" autocomplete="off">
        </label>
        <label>Titular <input name="holder" placeholder="Nombre de la persona" autocomplete="off"></label>
        <label>Fecha de visita <input type="date" name="visitDate"></label>
        <label>Localizador <small>(para dictarlo si el lector no lee el QR)</small>
          <input name="locator" placeholder="ABC123456" autocomplete="off" autocapitalize="characters"
                 spellcheck="false">
        </label>
        <p class="autofill-hint" id="autofill-hint" hidden>
          ${icon("sparkles", { size: 16 })}<span></span>
        </p>
        <label>Notas
          <textarea name="notes" rows="2" placeholder="Puerta de acceso, parking, hora de entrada…"></textarea>
        </label>
        <div class="progress" id="progress" hidden><span></span></div>
        <button class="btn btn-primary btn-block" id="submit">Guardar</button>
      </form>
    </main>`;

  const form = root.querySelector("#upload-form");
  const input = form.querySelector("input[type=file]");
  const fileList = root.querySelector("#file-list");
  const dropzone = root.querySelector("#dropzone");
  const splitRow = root.querySelector("#split-row");
  const hint = root.querySelector("#autofill-hint");
  const submit = root.querySelector("#submit");
  const progress = root.querySelector("#progress");

  // Lo detectado en cada fichero. Se usa al guardar para los campos que el usuario no ha tocado:
  // así, con cuatro PDFs de cuatro personas, cada entrada se queda con su titular.
  const guesses = new Map();
  let selection = 0; // para descartar análisis de una selección anterior

  for (const name of GUESSED) {
    form.elements[name].addEventListener("input", (e) => {
      e.target.dataset.touched = "1";
      e.target.classList.remove("autofilled");
    });
  }

  input.addEventListener("change", async () => {
    const files = [...input.files];
    const current = ++selection;
    guesses.clear();
    dropzone.classList.toggle("has-files", files.length > 0);
    splitRow.hidden = true;
    hint.hidden = true;
    for (const name of GUESSED) {
      const field = form.elements[name];
      if (field.classList.contains("autofilled")) {
        field.value = "";
        field.classList.remove("autofilled");
      }
    }
    if (!files.length) {
      fileList.hidden = true;
      return;
    }

    fileList.hidden = false;
    fileList.innerHTML = files
      .map(
        (f, i) => `
        <li data-i="${i}">
          ${icon(KIND_ICON[kindOf(f)] ?? "warning", { size: 20 })}
          <span><strong>${esc(f.name)}</strong><small>${formatSize(f.size)}${
            kindOf(f) ? "" : " · formato no soportado"
          }</small></span>
        </li>`,
      )
      .join("");

    // Lee los PDF sin renderizarlos: número de páginas y texto para proponer campos.
    let multiPage = 0;
    for (const [i, file] of files.entries()) {
      if (kindOf(file) !== "pdf") continue;
      const info = await pdfInfo(file);
      if (current !== selection) return;
      guesses.set(file, guessFields(info.text, { todayIso: today() }));
      const small = fileList.querySelector(`[data-i="${i}"] small`);
      if (info.numPages) {
        small.textContent += ` · ${info.numPages} página${info.numPages === 1 ? "" : "s"}`;
      }
      if (info.numPages > 1) multiPage++;
    }

    splitRow.hidden = multiPage === 0;
    autofill(files);
  });

  function autofill(files) {
    const first = files.map((f) => guesses.get(f)).find((g) => g && Object.values(g).some(Boolean));
    if (!first) return;
    const filled = [];
    for (const name of GUESSED) {
      const field = form.elements[name];
      if (!first[name] || field.dataset.touched || field.value) continue;
      field.value = first[name];
      field.classList.add("autofilled");
      filled.push({ holder: "titular", visitDate: "fecha", locator: "localizador" }[name]);
    }
    if (!filled.length) return;
    hint.hidden = false;
    hint.querySelector("span").textContent =
      `Detectado en el PDF: ${filled.join(", ")}. Revísalo antes de guardar.` +
      (files.length > 1 ? " Con varios ficheros, cada entrada usa lo detectado en el suyo." : "");
  }

  // Valor de un campo para un fichero concreto: lo que escribió el usuario o, si no lo ha tocado,
  // lo detectado en ESE fichero (nunca lo de otro fichero).
  function valueFor(name, typed, guess) {
    return form.elements[name].dataset.touched ? typed : (guess?.[name] ?? null);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const files = [...input.files];
    const data = formData(form);
    const split = form.elements.split.checked;
    submit.disabled = true;
    progress.hidden = false;
    const bar = progress.querySelector("span");

    let saved = 0;
    for (const [i, file] of files.entries()) {
      const label = `Procesando ${i + 1} de ${files.length}`;
      submit.textContent = `${label}…`;
      bar.style.width = `${(i / files.length) * 100}%`;
      try {
        const processed = await processFile(file, (page, total) => {
          submit.textContent = `${label} · página ${page}/${total}…`;
          bar.style.width = `${((i + page / total) / files.length) * 100}%`;
        });
        const stem = file.name.replace(/\.[^.]+$/, "");
        const niceStem = prettyName(stem);
        const baseTitle = data.title
          ? files.length > 1
            ? `${data.title} · ${niceStem}`
            : data.title
          : niceStem;

        const base = (guess) => ({
          parkId: park.id,
          holder: valueFor("holder", data.holder, guess),
          visitDate: valueFor("visitDate", data.visitDate, guess),
          locator: valueFor("locator", data.locator, guess),
          notes: data.notes,
          type: data.type,
          used: false,
          createdAt: Date.now(),
        });

        if (split && processed.kind === "pdf" && processed.pages.length > 1) {
          // Cada página pasa a ser una entrada-imagen: el PDF completo no se duplica N veces.
          for (const [n, page] of processed.pages.entries()) {
            const guess = guessFields(processed.texts[n], { todayIso: today() });
            await db.addTicket(
              {
                ...base(guess),
                id: db.newId(),
                title: `${baseTitle} · pág. ${n + 1}`,
                kind: "image",
                fileName: `${stem} (pág. ${n + 1}).png`,
                mime: "image/png",
                pages: 1,
              },
              { original: page, pages: [], thumb: await makeThumb(page) },
            );
            saved++;
          }
        } else {
          await db.addTicket(
            {
              ...base(guesses.get(file)),
              id: db.newId(),
              title: baseTitle,
              kind: processed.kind,
              fileName: file.name,
              mime: file.type,
              pages: Math.max(processed.pages.length, 1),
            },
            { original: processed.original, pages: processed.pages, thumb: processed.thumb },
          );
          saved++;
        }
      } catch (err) {
        console.error(err);
        toast(err?.message || `No se pudo guardar ${file.name}`, "error");
      }
    }
    bar.style.width = "100%";

    if (saved) {
      toast(`${saved} entrada${saved > 1 ? "s" : ""} guardada${saved > 1 ? "s" : ""}`);
      go(`#/parque/${park.id}`, { replace: true });
    } else {
      submit.disabled = false;
      submit.textContent = "Guardar";
      progress.hidden = true;
    }
  });
}
