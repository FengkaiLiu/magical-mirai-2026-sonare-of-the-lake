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

const engine = new Engine(document.getElementById("app"));
const scene  = new GameScene(engine);

// ── DOM refs ─────────────────────────────────────────────────────────────────
const progressFill = document.getElementById("intro-progress-fill");
const progressPct  = document.getElementById("intro-progress-pct");
const progressWrap = document.getElementById("intro-progress-wrap");
const startBtn     = document.getElementById("intro-start-btn");

// ── Loading stages ───────────────────────────────────────────────────────────
// Weights mirror the dominant cost of each stage so the bar moves at honest
// speed.  Total must sum to 1.
//   GLBs    (~5–10 MB)            → 25 %
//   Fonts   (~10 MB across faces) → 10 %
//   Shaders (compileAsync)        →  5 %
//   Songs   (timer-ready, 6 × ~3–5 MB audio + TextAlive metadata) → 45 %
//   Prewarm (per-phrase glyph sampling, 6 songs)                  → 15 %
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

  // Start can enable as soon as the four "must-have" stages are done.  Prewarm
  // is nice-to-have — it runs in the background while the user watches the
  // 5-second intro, and the only cost of an un-prewarmed phrase is a single
  // ~15 ms hitch on its first render (still much better than the per-phrase
  // jitter we had before any prewarm existed).  The bar keeps moving past
  // this point until prewarm completes, so progress stays honest.
  const coreReady = stages.glbs.progress    >= 1
                 && stages.fonts.progress   >= 1
                 && stages.shaders.progress >= 1
                 && stages.songs.progress   >= 1;
  if (coreReady && !started) {
    started = true;
    revealAndEnable();
  }
}

function revealAndEnable() {
  fadeOutReveal();
  progressWrap?.classList.add("hidden");
  if (startBtn) { startBtn.disabled = false; startBtn.classList.add("ready"); }
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
  // Stage 3: shader compile only starts after geometry is in.
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

// ── Stage 2: Fonts (CSS @font-face + document.fonts.load calls in modules) ──
// document.fonts.ready resolves once every font.load() queued before access has
// finished.  All our load() calls live at module top level, so they're queued
// by the time main.js runs this line.
document.fonts.ready.then(() => {
  stages.fonts.progress = 1;
  applyProgress();
}).catch((e) => {
  console.warn("[main] Font preload failed — continuing.", e);
  stages.fonts.progress = 1; // don't strand the bar
  applyProgress();
});

// ── Stages 4 & 5: Songs (timer-ready) + Prewarm (glyph sampling) ────────────
scene.onPreloadProgress = (timerFrac, prewarmFrac) => {
  stages.songs.progress   = timerFrac;
  stages.prewarm.progress = prewarmFrac;
  applyProgress();
};

// ── Watchdog ────────────────────────────────────────────────────────────────
// 60 s is generous enough for slow connections to finish all 6 songs at
// reasonable bandwidth, but short enough that a hard failure (CSP block,
// TextAlive outage, 404) doesn't trap the user forever.  Inside-game fallbacks
// in _activatePlay handle individual song failures.
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
}, 60000);

// ── Wiring ──────────────────────────────────────────────────────────────────
startBtn?.addEventListener("click", () => {
  startBtn.disabled = true;
  scene.beginIntroSequence();
});

document.getElementById("pause-btn")?.addEventListener("click", () => scene.togglePause());

engine.start();
