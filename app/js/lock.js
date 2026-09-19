// Bloqueo con Face ID / Touch ID (WebAuthn) y un PIN de respaldo.
//
// Es un bloqueo de interfaz, no cifrado: evita que alguien que coja el móvil desbloqueado vea
// tus entradas, pero los datos siguen en IndexedDB sin cifrar. Así se explica en Ajustes.
//
// No hay servidor, así que la firma de WebAuthn no se verifica: lo que protege es que el sistema
// solo completa credentials.get() si la verificación biométrica sale bien.

import * as db from "./db.js";
import { icon } from "./icons.js";
import { esc } from "./ui.js";

const RELOCK_AFTER_MS = 2 * 60_000; // en segundo plano más de 2 minutos: se vuelve a bloquear
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return b64(await crypto.subtle.digest("SHA-256", data));
}

export async function lockSupported() {
  if (!window.isSecureContext || !window.PublicKeyCredential || !crypto.subtle) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export const getLock = () => db.getMeta("lock");
export const disableLock = () => db.deleteMeta("lock");

/** Registra Face ID/Touch ID y guarda el PIN de respaldo. Lanza si el usuario cancela. */
export async function enableLock(pin) {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: "Mis entradas", id: location.hostname },
      user: { id: random(16), name: "mis-entradas", displayName: "Mis entradas" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "discouraged",
      },
      timeout: 60_000,
    },
  });
  const salt = b64(random(16));
  await db.setMeta("lock", {
    credentialId: b64(credential.rawId),
    salt,
    pinHash: await hashPin(pin, salt),
  });
}

async function verifyBiometrics(lock) {
  await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: [{ type: "public-key", id: unb64(lock.credentialId) }],
      userVerification: "required",
      timeout: 60_000,
    },
  });
}

// ------------------------------------------------------------------ pantalla de bloqueo

let unlockedAt = 0;
let hiddenAt = 0;
let showing = null;

function lockScreen(lock) {
  if (showing) return showing;
  showing = new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "lock-screen";
    el.innerHTML = `
      <div class="lock-card">
        <span class="lock-icon">${icon("lock", { size: 34 })}</span>
        <h2>Mis entradas</h2>
        <p class="muted">Bloqueada</p>
        <button class="btn btn-primary btn-block" id="lock-bio">${icon("shield", { size: 20 })}
          Desbloquear con Face ID</button>
        <form class="lock-pin" id="lock-pin">
          <input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
                 maxlength="8" placeholder="o escribe tu PIN" aria-label="PIN">
          <button class="btn">Entrar</button>
        </form>
        <p class="lock-error" role="alert"></p>
      </div>`;
    document.body.append(el);
    document.body.classList.add("locked");

    const error = el.querySelector(".lock-error");
    const input = el.querySelector("input");
    let attempts = 0;
    let blockedUntil = 0;

    const done = () => {
      unlockedAt = Date.now();
      el.classList.add("out");
      document.body.classList.remove("locked");
      setTimeout(() => el.remove(), 250);
      showing = null;
      resolve();
    };

    el.querySelector("#lock-bio").addEventListener("click", async () => {
      error.textContent = "";
      try {
        await verifyBiometrics(lock);
        done();
      } catch (err) {
        error.textContent =
          err?.name === "NotAllowedError"
            ? "Cancelado. Prueba otra vez o usa el PIN."
            : `No se pudo verificar: ${esc(err?.message)}`;
      }
    });

    el.querySelector("#lock-pin").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (Date.now() < blockedUntil) {
        const s = Math.ceil((blockedUntil - Date.now()) / 1000);
        error.textContent = `Demasiados intentos. Espera ${s} s.`;
        return;
      }
      if ((await hashPin(input.value, lock.salt)) === lock.pinHash) return done();
      attempts++;
      input.value = "";
      el.querySelector(".lock-card").classList.add("shake");
      setTimeout(() => el.querySelector(".lock-card")?.classList.remove("shake"), 400);
      if (attempts >= MAX_ATTEMPTS) {
        attempts = 0;
        blockedUntil = Date.now() + COOLDOWN_MS;
        error.textContent = "Demasiados intentos. Espera 30 s.";
      } else {
        error.textContent = "PIN incorrecto";
      }
    });
  });
  return showing;
}

/** Se llama al arrancar: si hay bloqueo, no deja seguir hasta desbloquear. */
export async function gate() {
  const lock = await getLock();
  if (lock) await lockScreen(lock);

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const current = await getLock();
    if (current && hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS && unlockedAt < hiddenAt) {
      lockScreen(current);
    }
  });
}
