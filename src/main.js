/**
 * main.js — Boots GameScene. One scene, one session, no swap.
 *
 * The loading bar aggregates five real preload stages, weighted roughly by
 * the work each one represents.  Start enables only when every stage hits
 * 1.0 — never on a cosmetic timer.  A 60 s watchdog force-enables Start if
 * something hangs (e.g. TextAlive API blocked, GLB fetch failed) so the
 * user is never permanently stuck on the intro screen.
 */

import * as THREE from "three";
import { Engine } from "./engine.js";
import { GameScene } from "./game-scene.js";
import { BOATS, BOAT_COLORS, getLang, setLang, setBoatId, getBoatId, onLangChange, t } from "./i18n.js";

const engine = new Engine(document.getElementById("app"));
const scene  = new GameScene(engine);

// ── DOM refs ─────────────────────────────────────────────────────────────────
const progressFill  = document.getElementById("intro-progress-fill");
const progressPct   = document.getElementById("intro-progress-pct");
const progressWrap  = document.getElementById("intro-progress-wrap");
const startBtn      = document.getElementById("intro-start-btn");
const boatBtn       = document.getElementById("intro-boat-btn");
const settingBtn    = document.getElementById("intro-setting-btn");
const secondaryBtns = document.getElementById("intro-secondary-btns");

// ── Loading stages ───────────────────────────────────────────────────────────
const stages = {
  glbs:    { weight: 0.25, progress: 0 },
  fonts:   { weight: 0.10, progress: 0 },
  shaders: { weight: 0.05, progress: 0 },
  songs:   { weight: 0.45, progress: 0 },
  prewarm: { weight: 0.15, progress: 0 },
};

let started = false;
function applyProgress() {
  let total = 0;
  for (const s of Object.values(stages)) total += s.weight * s.progress;
  const pct = Math.min(100, Math.round(total * 100));
  if (progressFill) progressFill.style.width  = pct + "%";
  if (progressPct)  progressPct.textContent   = pct + "%";

  const coreReady = stages.glbs.progress    >= 1
                 && stages.fonts.progress   >= 1
                 && stages.shaders.progress >= 1
                 && stages.songs.progress   >= 0.8;
  if (coreReady && !started) {
    started = true;
    revealAndEnable();
  }
}

function revealAndEnable() {
  fadeOutReveal();
  progressWrap?.classList.add("hidden");
  if (startBtn) { startBtn.disabled = false; startBtn.classList.add("ready"); }
  secondaryBtns?.classList.add("ready");
}

function fadeOutReveal() {
  const el = document.getElementById("circle-reveal");
  if (!el || el.classList.contains("gone")) return;
  el.style.transition = "opacity 1.5s ease";
  el.style.opacity    = "0";
  setTimeout(() => el.classList.add("gone"), 1500);
}

// ── Stage 1: GLBs (Three.js DefaultLoadingManager) ───────────────────────────
THREE.DefaultLoadingManager.onProgress = (_url, loaded, total) => {
  stages.glbs.progress = total > 0 ? loaded / total : 0;
  applyProgress();
};
THREE.DefaultLoadingManager.onLoad = () => {
  stages.glbs.progress = 1;
  applyProgress();
  Promise.resolve().then(async () => {
    try {
      if (engine.renderer.compileAsync) {
        await engine.renderer.compileAsync(engine.scene, engine.camera);
      } else {
        engine.renderer.compile(engine.scene, engine.camera);
      }
    } catch (e) {
      console.warn("[main] Shader compile failed — continuing anyway.", e);
    }
    stages.shaders.progress = 1;
    applyProgress();
  });
};

// ── Stage 2: Fonts ────────────────────────────────────────────────────────────
document.fonts.ready.then(() => {
  stages.fonts.progress = 1;
  applyProgress();
}).catch((e) => {
  console.warn("[main] Font preload failed — continuing.", e);
  stages.fonts.progress = 1;
  applyProgress();
});

// ── Stages 4 & 5: Songs + Prewarm ─────────────────────────────────────────────
scene.onPreloadProgress = (timerFrac, prewarmFrac) => {
  stages.songs.progress   = timerFrac;
  stages.prewarm.progress = prewarmFrac;
  applyProgress();
};

const _songsTick = setInterval(() => {
  if (started) { clearInterval(_songsTick); return; }
  stages.songs.progress = Math.max(
    stages.songs.progress,
    Math.min(stages.songs.progress + 0.006, 0.78),
  );
  applyProgress();
}, 500);

// ── Watchdog ─────────────────────────────────────────────────────────────────
setTimeout(() => {
  if (!started) {
    console.warn("[main] Loading watchdog tripped — forcing ready state.", {
      stages: Object.fromEntries(
        Object.entries(stages).map(([k, v]) => [k, v.progress.toFixed(2)])
      ),
    });
    for (const s of Object.values(stages)) s.progress = 1;
    applyProgress();
  }
}, 20000);

// ── Translation helpers ───────────────────────────────────────────────────────

function applyTranslations() {
  const lang = getLang();

  // Intro logo title
  const logo = document.getElementById("intro-logo");
  if (logo) logo.textContent = t("logoTitle");

  // Start button
  if (startBtn) startBtn.textContent = t("startBtn");

  // Secondary buttons
  if (boatBtn)    boatBtn.textContent    = t("boatBtn");
  if (settingBtn) settingBtn.textContent = t("settingBtn");

  // Modals
  const boatTitle    = document.getElementById("boat-modal-title");
  const settingTitle = document.getElementById("setting-modal-title");
  const langLabel    = document.getElementById("lang-label");
  const boatClose    = document.getElementById("boat-modal-close");
  const settingClose = document.getElementById("setting-modal-close");
  if (boatTitle)    boatTitle.textContent    = t("boatModalTitle");
  if (settingTitle) settingTitle.textContent = t("settingTitle");
  if (langLabel)    langLabel.textContent    = t("langLabel");
  if (boatClose)    boatClose.textContent    = t("closeBtn");
  if (settingClose) settingClose.textContent = t("closeBtn");

  // Static game UI (in-scene elements)
  const selectHint  = document.getElementById("select-hint");
  const overlayP    = document.querySelector("#overlay p");
  if (selectHint) selectHint.textContent = t("selectHint");
  if (overlayP)   overlayP.textContent   = t("overlayText");

  // Language toggle button active state
  document.getElementById("lang-ja-btn")?.classList.toggle("active", lang === "ja");
  document.getElementById("lang-en-btn")?.classList.toggle("active", lang === "en");

  // Boat card names
  document.querySelectorAll(".boat-card").forEach(card => {
    const boat = BOATS.find(b => b.id === card.dataset.boatId);
    if (boat) card.querySelector(".boat-card-name").textContent = lang === "ja" ? boat.ja : boat.en;
  });
}

// ── Boat modal ────────────────────────────────────────────────────────────────

function buildBoatGrid() {
  const grid = document.getElementById("boat-grid");
  if (!grid) return;
  grid.innerHTML = "";
  const lang = getLang();
  BOATS.forEach(boat => {
    const card = document.createElement("button");
    card.className = "boat-card" + (getBoatId() === boat.id ? " selected" : "");
    card.dataset.boatId = boat.id;

    const avatar = document.createElement("div");
    avatar.className = "boat-card-avatar";
    avatar.style.setProperty("--char-color", BOAT_COLORS[boat.id] ?? "#88e8ff");
    avatar.textContent = "⛵";

    const nameEl = document.createElement("span");
    nameEl.className = "boat-card-name";
    nameEl.textContent = lang === "ja" ? boat.ja : boat.en;

    card.appendChild(avatar);
    card.appendChild(nameEl);
    card.addEventListener("click", () => {
      setBoatId(boat.id);
      grid.querySelectorAll(".boat-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
    });
    grid.appendChild(card);
  });
}

function openModal(id) {
  document.getElementById(id)?.classList.remove("hidden");
}
function closeModal(id) {
  document.getElementById(id)?.classList.add("hidden");
}

boatBtn?.addEventListener("click", () => {
  buildBoatGrid();
  applyTranslations();
  openModal("boat-modal");
});
document.getElementById("boat-modal-close")?.addEventListener("click", () => closeModal("boat-modal"));
document.getElementById("boat-modal")?.addEventListener("click", e => {
  if (e.target === e.currentTarget) closeModal("boat-modal");
});

// ── Settings modal ────────────────────────────────────────────────────────────

settingBtn?.addEventListener("click", () => {
  applyTranslations();
  openModal("setting-modal");
});
document.getElementById("setting-modal-close")?.addEventListener("click", () => closeModal("setting-modal"));
document.getElementById("setting-modal")?.addEventListener("click", e => {
  if (e.target === e.currentTarget) closeModal("setting-modal");
});

document.getElementById("lang-ja-btn")?.addEventListener("click", () => {
  setLang("ja");
});
document.getElementById("lang-en-btn")?.addEventListener("click", () => {
  setLang("en");
});

// Re-apply translations whenever language changes
onLangChange(() => applyTranslations());

// Apply translations immediately on load
applyTranslations();

// ── Return-to-menu transition ─────────────────────────────────────────────────
// Called by GameScene when the player confirms the MenuReturnCircle.
// Sequence:
//   1. Blue circle-reveal overlay snaps to fully opaque (covers 3D scene)
//   2. Camera has already teleported to overhead in GameScene._beginReturnToMenu
//   3. After one frame: restore intro-screen elements, start fading overlay out
//   4. Overlay fades out (1.5 s) revealing the overhead lake view + title UI
function showIntroScreen() {
  const overlay = document.getElementById("circle-reveal");
  if (overlay) {
    // Remove the "gone" (display:none) class and any lingering opacity transition,
    // then snap straight to fully opaque so the frame never shows the 3D jump.
    overlay.classList.remove("gone");
    overlay.style.transition = "none";
    overlay.style.opacity    = "1";
    // Force a reflow so the browser commits opacity:1 before any further changes.
    void overlay.offsetHeight;
  }

  // One rAF guarantees the overlay rendered at full opacity before we modify
  // any other DOM elements, preventing a single-frame flash.
  requestAnimationFrame(() => {
    // Restore intro screen (title + buttons).  The loading bar stays hidden
    // because its ".hidden" class was added in revealAndEnable() and never removed.
    const introEl = document.getElementById("intro-screen");
    if (introEl) {
      introEl.classList.remove("gone", "hidden");
      // Override any lingering inline opacity from the original hide sequence.
      introEl.style.opacity   = "1";
      introEl.style.transform = "translateY(0)";
    }
    // Re-enable the Start button (it was disabled on the first click).
    if (startBtn) startBtn.disabled = false;

    // Begin fading out the overlay after a short hold so everything settles.
    setTimeout(() => {
      if (!overlay) return;
      overlay.style.transition = "opacity 1.5s ease";
      overlay.style.opacity    = "0";
      setTimeout(() => {
        overlay.classList.add("gone");
        // Clean up inline overrides so the next return trip works identically.
        overlay.style.transition = "";
        overlay.style.opacity    = "";
      }, 1500);
    }, 300);
  });
}

scene.onReturnToMenu = showIntroScreen;

// ── Wiring ────────────────────────────────────────────────────────────────────
startBtn?.addEventListener("click", () => {
  startBtn.disabled = true;
  scene.beginIntroSequence();
});

document.getElementById("pause-btn")?.addEventListener("click", () => scene.togglePause());

engine.start();
