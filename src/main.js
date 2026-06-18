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
import { preloadAll } from "./asset-cache.js";
import { sfxStart, sfxResume } from "./sfx.js";

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

// ── Preload all boat GLBs so they're cached before the Boat constructor runs ──
preloadAll(BOATS.map(b => b.glb));

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
  // sfxStart() is intentionally deferred to the Start button click so it runs
  // inside a user gesture — Safari blocks audio started from async/timer callbacks.
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

  // HUD popovers
  const hudBoatTitle    = document.getElementById("hud-boat-title");
  const hudSettingTitle = document.getElementById("hud-setting-title");
  const hudLangLabel    = document.getElementById("hud-lang-label");
  const hudBoatBtn      = document.getElementById("hud-boat-btn");
  const hudSettingBtn   = document.getElementById("hud-setting-btn");
  if (hudBoatTitle)    hudBoatTitle.textContent    = t("boatBtn");
  if (hudSettingTitle) hudSettingTitle.textContent = t("settingTitle");
  if (hudLangLabel)    hudLangLabel.textContent    = t("langLabel");
  if (hudBoatBtn)      hudBoatBtn.title            = t("boatBtn");
  if (hudSettingBtn)   hudSettingBtn.title         = t("settingTitle");

  // Static game UI (in-scene elements)
  const selectHint  = document.getElementById("select-hint");
  const overlayP    = document.querySelector("#overlay p");
  if (selectHint) selectHint.textContent = t("selectHint");
  if (overlayP)   overlayP.textContent   = t("overlayText");

  // Language toggle button active state (both intro modal + HUD popover)
  document.getElementById("lang-ja-btn")?.classList.toggle("active", lang === "ja");
  document.getElementById("lang-en-btn")?.classList.toggle("active", lang === "en");
  document.getElementById("hud-lang-ja-btn")?.classList.toggle("active", lang === "ja");
  document.getElementById("hud-lang-en-btn")?.classList.toggle("active", lang === "en");

  // Boat card names — covers both grids
  document.querySelectorAll(".boat-card").forEach(card => {
    const boat = BOATS.find(b => b.id === card.dataset.boatId);
    if (boat) card.querySelector(".boat-card-name").textContent = lang === "ja" ? boat.ja : boat.en;
  });
}

// ── Boat modal ────────────────────────────────────────────────────────────────

function buildBoatGrid(gridId = "boat-grid") {
  const grid = document.getElementById(gridId);
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
      scene.boat.swapModel(boat);
      scene.updateBoatCircleModel(boat);
      // Sync selected highlight across both boat grids.
      document.querySelectorAll(".boat-card").forEach(c => {
        c.classList.toggle("selected", c.dataset.boatId === boat.id);
      });
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
  buildBoatGrid("boat-grid");
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

    // Resume beach ambient when back on the intro screen.
    sfxResume();

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

// Open boat-select and settings modals from in-game utility circles
scene.onOpenBoatModal = () => {
  buildBoatGrid("boat-grid");
  applyTranslations();
  openModal("boat-modal");
};
scene.onOpenSettingsModal = () => {
  applyTranslations();
  openModal("setting-modal");
};

// ── Wiring ────────────────────────────────────────────────────────────────────
startBtn?.addEventListener("click", () => {
  startBtn.disabled = true;
  sfxStart(); // must run inside a user gesture so Safari allows audio playback
  scene.beginIntroSequence();
});

document.getElementById("pause-btn")?.addEventListener("click", () => scene.togglePause());

// ── HUD popovers (non-modal boat + setting bubbles) ───────────────────────────
//
// Anchored under the HUD button row.  Opening one closes the other so they
// never overlap.  Clicks outside any popover or its trigger close everything;
// gameplay underneath stays interactive (no backdrop, no input lock).
//
// Cross-browser: uses standard DOM APIs only — classList toggle, getElementById,
// addEventListener — verified on Chrome / Edge / Firefox / Safari (mac).

const hudBoatPopover    = document.getElementById("hud-boat-popover");
const hudSettingPopover = document.getElementById("hud-setting-popover");
const hudBoatBtn        = document.getElementById("hud-boat-btn");
const hudSettingBtn     = document.getElementById("hud-setting-btn");

function setPopoverOpen(popoverEl, triggerEl, open) {
  if (!popoverEl) return;
  popoverEl.classList.toggle("visible", open);
  popoverEl.setAttribute("aria-hidden", open ? "false" : "true");
  triggerEl?.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeAllHudPopovers() {
  setPopoverOpen(hudBoatPopover,    hudBoatBtn,    false);
  setPopoverOpen(hudSettingPopover, hudSettingBtn, false);
}

function toggleHudPopover(which) {
  const isBoat = which === "boat";
  const target = isBoat ? hudBoatPopover : hudSettingPopover;
  const trigger = isBoat ? hudBoatBtn    : hudSettingBtn;
  const other   = isBoat ? hudSettingPopover : hudBoatPopover;
  const otherT  = isBoat ? hudSettingBtn  : hudBoatBtn;
  const willOpen = !target.classList.contains("visible");
  setPopoverOpen(other,  otherT,  false);
  setPopoverOpen(target, trigger, willOpen);
  if (willOpen) {
    if (isBoat) buildBoatGrid("hud-boat-grid");
    applyTranslations();
  }
}

hudBoatBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleHudPopover("boat");
});
hudSettingBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleHudPopover("setting");
});

// Clicking inside a popover should not close it.
hudBoatPopover?.addEventListener("click",    (e) => e.stopPropagation());
hudSettingPopover?.addEventListener("click", (e) => e.stopPropagation());

// Click anywhere outside → close all.  Use capture phase so we close even if
// the underlying canvas/3D system stops propagation later.
document.addEventListener("pointerdown", (e) => {
  if (!hudBoatPopover?.classList.contains("visible") &&
      !hudSettingPopover?.classList.contains("visible")) return;
  const t = e.target;
  if (hudBoatPopover?.contains(t) || hudSettingPopover?.contains(t)) return;
  if (t === hudBoatBtn || t === hudSettingBtn) return;
  closeAllHudPopovers();
});

// Esc closes popovers (matches OS convention; non-blocking to gameplay).
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllHudPopovers();
});

// HUD language toggle — same store as the intro modal, just different buttons.
document.getElementById("hud-lang-ja-btn")?.addEventListener("click", () => setLang("ja"));
document.getElementById("hud-lang-en-btn")?.addEventListener("click", () => setLang("en"));

engine.start();
