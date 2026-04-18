/**
 * main.js — State machine: STATE_SELECT → STATE_PLAY
 *
 * Boots SongSelectScene. When player sails into a song card,
 * fades to black, tears down select scene, boots LakeScene.
 */

import * as THREE from "three";
import { Engine } from "./engine.js";
import { SongSelectScene } from "./song-select.js";
import { LakeScene } from "./lake-scene.js";

const engine = new Engine(document.getElementById("app"));

let currentScene = null;
const transitionOverlay = document.getElementById("transition-overlay");

// ── Loading progress UI ───────────────────────────────────────────────────────
// Hook DefaultLoadingManager before any scene creates loaders so every
// GLTFLoader (boat, terrain) is tracked automatically.
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
  // Fill bar to 100 % then swap loading → Start button
  if (progressFill) progressFill.style.width = "100%";
  if (progressPct)  progressPct.textContent  = "100%";
  setTimeout(() => {
    if (progressWrap) progressWrap.classList.add("hidden");
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.classList.add("ready");
    }
  }, 400);
};

// If no assets are loaded at all (all cached / no GLTF in scene), show Start
// immediately after a short grace period so the screen never gets stuck.
setTimeout(() => {
  if (startBtn && !startBtn.classList.contains("ready")) {
    if (progressFill) progressFill.style.width = "100%";
    if (progressPct)  progressPct.textContent  = "100%";
    setTimeout(() => {
      if (progressWrap) progressWrap.classList.add("hidden");
      if (startBtn) { startBtn.disabled = false; startBtn.classList.add("ready"); }
    }, 400);
  }
}, 5000);

// Start button triggers the 3-D intro sequence (overhead → dive)
if (startBtn) {
  startBtn.addEventListener("click", () => {
    startBtn.disabled = true;
    if (currentScene && currentScene.beginIntroSequence) {
      currentScene.beginIntroSequence();
    }
  });
}

function startSelect() {
  currentScene = new SongSelectScene(engine, onSongSelected);
}

function onSongSelected(songIndex) {
  // Fade to black
  transitionOverlay.classList.add("visible");

  setTimeout(() => {
    // Tear down select scene
    currentScene.dispose();
    currentScene = null;

    // Boot lake scene
    startPlay(songIndex);

    // Fade back in
    transitionOverlay.classList.remove("visible");
  }, 500);
}

function startPlay(songIndex) {
  currentScene = new LakeScene(engine, songIndex);
}

// Registered once — delegates to currentScene via closure
document.getElementById("pause-btn")?.addEventListener("click", () => {
  if (currentScene) currentScene.togglePause();
});

startSelect();
engine.start();
