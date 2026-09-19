// Pantalla siempre encendida mientras se enseña una entrada y gesto de deslizar entre entradas.

import { go } from "./ui.js";

let wakeLock = null;
let wanted = false;

export async function keepScreenOn() {
  wanted = true;
  try {
    if ("wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    }
  } catch {
    // No disponible (http, navegador antiguo o modo ahorro de batería): no pasa nada.
  }
}

export function releaseScreen() {
  wanted = false;
  wakeLock?.release();
  wakeLock = null;
}

// Al volver a la app el sistema ha soltado el bloqueo: se pide otra vez si hacía falta.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wanted) keepScreenOn();
});

// ------------------------------------------------------------------ deslizar

let swipe = null;

export function enableSwipe(prevHash, nextHash) {
  swipe = { prevHash, nextHash };
}

export function disableSwipe() {
  swipe = null;
}

let touchStart = null;
document.addEventListener(
  "touchstart",
  (e) => (touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }),
  { passive: true },
);
document.addEventListener(
  "touchend",
  (e) => {
    if (!swipe || !touchStart || e.touches.length) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2) return;
    if (window.visualViewport && window.visualViewport.scale > 1.05) return; // está haciendo zoom
    const target = dx < 0 ? swipe.nextHash : swipe.prevHash;
    if (!target) return;
    // Pista para la transición: hacia qué lado se va.
    document.documentElement.dataset.nav = dx < 0 ? "forward" : "back";
    go(target, { replace: true });
  },
  { passive: true },
);
