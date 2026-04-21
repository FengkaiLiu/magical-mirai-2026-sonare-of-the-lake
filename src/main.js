/**
 * main.js — Boots GameScene. One scene, one session, no swap.
 */

import * as THREE from "three";
import { Engine } from "./engine.js";
import { GameScene } from "./game-scene.js";

const engine = new Engine(document.getElementById("app"));
const scene  = new GameScene(engine);

// ── Loading progress UI ───────────────────────────────────────────────────────
const progressFill = document.getElementById("intro-progress-fill");
const progressPct  = document.getElementById("intro-progress-pct");
const progressWrap = document.getElementById("intro-progress-wrap");
const startBtn     = document.getElementById("intro-start-btn");

THREE.DefaultLoadingManager.onProgress = (_url, loaded, total) => {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  if (progressFill) progressFill.style.width = pct + "%";
  if (progressPct)  progressPct.textContent   = pct + "%";
};

THREE.DefaultLoadingManager.onLoad = () => {
  if (progressFill) progressFill.style.width = "100%";
  if (progressPct)  progressPct.textContent  = "100%";

  // Pre-compile all shaders during the 2 s hold so the first visible render is stutter-free.
  Promise.resolve().then(() => {
    if (engine.renderer.compileAsync) {
      engine.renderer.compileAsync(engine.scene, engine.camera);
    } else {
      engine.renderer.compile(engine.scene, engine.camera);
    }
  });

  setTimeout(() => {
    fadeOutReveal();
    setTimeout(() => {
      progressWrap?.classList.add("hidden");
      if (startBtn) { startBtn.disabled = false; startBtn.classList.add("ready"); }
    }, 0);
  }, 2000);
};

function fadeOutReveal() {
  const el = document.getElementById("circle-reveal");
  if (!el || el.classList.contains("gone")) return;
  el.style.transition = "opacity 1.5s ease";
  el.style.opacity    = "0";
  setTimeout(() => el.classList.add("gone"), 1500);
}

// Fallback: if nothing triggers onLoad within 5 s (all assets cached), show Start.
setTimeout(() => {
  if (startBtn && !startBtn.classList.contains("ready")) {
    if (progressFill) progressFill.style.width = "100%";
    if (progressPct)  progressPct.textContent  = "100%";
    fadeOutReveal();
    setTimeout(() => {
      progressWrap?.classList.add("hidden");
      if (startBtn) { startBtn.disabled = false; startBtn.classList.add("ready"); }
    }, 1500);
  }
}, 5000);

startBtn?.addEventListener("click", () => {
  startBtn.disabled = true;
  scene.beginIntroSequence();
});

document.getElementById("pause-btn")?.addEventListener("click", () => scene.togglePause());

engine.start();
