/**
 * ==========================================
 * Sonare of the Lake — Main v2
 * ==========================================
 * Changes: Beat detection + broadcast to water/boat/environment
 * Fix: Phrase routing runs BEFORE beat detection so lyrics never break
 */

import { Player } from "textalive-app-api";
import { Engine } from "./engine.js";
import { Water } from "./water.js";
import { Boat } from "./boat.js";
import { Controls } from "./controls.js";
import { CameraController } from "./camera.js";
import { Environment } from "./environment.js";
import { LyricManager } from "./lyric-manager.js";
import { FishSchool } from "./fish-school.js";
import { DiveController } from "./dive-controller.js";
import { WakeTrail } from "./wake-trail.js";
import { SONGS } from "./songs.js";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// === DOM ===
const mount      = document.getElementById("mount");
const overlay    = document.getElementById("overlay");
const playBtn    = document.getElementById("play-btn");
const pauseBtn   = document.getElementById("pause-btn");
const timeTxt    = document.getElementById("time");
const songSelect = document.getElementById("song-select");
const songInfo   = document.getElementById("song-info");

// === Song ===
const params = new URLSearchParams(location.search);
const si = Number(params.get("song") || 0);
if (songSelect) songSelect.value = si;
const song = SONGS[si];

// === Engine ===
const engine = new Engine(mount);

// === World objects ===
const water = new Water(engine);
water.setColors(song.theme.water, song.theme.deep);
water.setSkyHorizon(song.theme.skyHorizon || 0xdceaf5);

const env = new Environment(engine);
env.setTheme(song.theme);

const controls = new Controls();
const boat = new Boat(engine, controls);
const cam = new CameraController(engine);
const lyrics = new LyricManager(engine, boat);
const fishSchool = new FishSchool(engine, boat);
const dive = new DiveController(engine, boat, cam, env, fishSchool, lyrics);
const wake = new WakeTrail(engine);
wake.setBoat(boat);
env.setBoat(boat);

// Wire dive toggle
controls.onDiveToggle = () => dive.toggle();

// === Beat tracker ===
let lastBeatIdx = -1;

// === Chorus auto-dive ===
let inChorus = false;

// === Beat debug indicator (remove after confirming beats work) ===
const beatDot = document.createElement("div");
Object.assign(beatDot.style, {
  position: "fixed", top: "10px", right: "10px", width: "20px", height: "20px",
  borderRadius: "50%", background: "red", opacity: "0", zIndex: "999",
  transition: "opacity 0.05s", pointerEvents: "none",
});
document.body.appendChild(beatDot);
function flashBeatDot(strong) {
  beatDot.style.background = strong ? "red" : "orange";
  beatDot.style.opacity = "1";
  setTimeout(() => { beatDot.style.opacity = "0"; }, 100);
}

// Debug
window._boat = boat;
window._engine = engine;
window._lyrics = lyrics;
window._dive = dive;
window._fishSchool = fishSchool;

// === Load terrain & boat models ===
const gltfLoader = new GLTFLoader();

gltfLoader.load('/models/terrain.glb', (gltf) => {
  const terrain = gltf.scene;
  terrain.position.y = 12;
  terrain.traverse(child => {
    if (child.isMesh) {
      child.material.roughness = 1.0;
      child.material.metalness = 0.0;
    }
  });
  engine.scene.add(terrain);
  console.log('Terrain loaded!');
}, undefined, (err) => {
  console.warn('Terrain load failed (non-critical):', err.message || err);
});

gltfLoader.load('/models/boat.glb', (gltf) => {
  boat.setModel(gltf.scene);
  console.log('Boat model loaded!');
}, undefined, (err) => {
  console.warn('Boat model load failed, using placeholder:', err.message || err);
});

// Camera follows boat + gamepad polling
engine.addUpdatable({
  update() {
    controls.pollGamepad();
    cam.setTarget(boat.getPosition(), boat.getHeading());
  }
});

// === TextAlive ===
const player = new Player({
  app: { token: "xTTinPuYYoHYLhnk" },
  mediaElement: document.createElement("audio"),
});

// Phrase cache
let cachedPhrase = null;
let cachedPhraseEnd = 0;

player.addListener({
  onAppReady(app) {
    if (!app.managed) {
      if (songInfo) songInfo.textContent = `${song.title} / ${song.artist}`;
      player.createFromSongUrl(song.url, song.options);
    }
  },
  onVideoReady() {
    playBtn.disabled = false;
    playBtn.textContent = "▶ Play";
  },
  onTimerReady() {
    player.requestPlay();
  },
  onTimeUpdate(pos) {
    if (timeTxt) timeTxt.textContent = `${fmt(pos)} / ${fmt(player.video?.duration||0)}`;

    if (document.hidden) return;

    // ─── Phrase / lyric routing (FIRST — must never be skipped) ───
    let phrase = cachedPhrase;
    if (!phrase || pos < phrase.startTime || pos >= cachedPhraseEnd) {
      phrase = player.video.findPhrase(pos);
      cachedPhrase = phrase;
      cachedPhraseEnd = phrase ? (phrase.startTime + phrase.duration) : 0;
    }

    if (phrase) {
      if (dive.isUnderwater) {
        fishSchool.setPhrase(phrase.text || phrase);
      } else {
        fishSchool.clearPhrase();
        lyrics.addPhrase(phrase);
      }
    }

    // ─── Beat detection (AFTER phrase — safe to fail) ───
    try {
      const beat = player.findBeat(pos);
      if (beat && beat.index !== lastBeatIdx) {
        lastBeatIdx = beat.index;
        const strong = (beat.index % 4 === 0);

        // Particles respond to every beat
        env.beatPulse(strong ? 1.0 : 0.4);

        // Water + lantern: ONLY on downbeat (surge + breathe)
        if (strong) {
          water.pulse(1.0);
          boat.lanternPulse(1.0);
        }

        flashBeatDot(strong);
      }
    } catch (e) {
      if (!window._beatErrorLogged) {
        console.warn("Beat detection error:", e.message || e);
        window._beatErrorLogged = true;
      }
    }

    // ─── Chorus auto-dive (manual segments > findChorus fallback) ───
    {
      const segments = song.diveSegments;
      let shouldDive = false;

      if (segments && segments.length > 0) {
        // Manual segments defined — use them
        for (const seg of segments) {
          if (pos >= seg.start && pos < seg.end) { shouldDive = true; break; }
        }
      } else {
        // Fallback to TextAlive chorus detection
        try {
          shouldDive = !!player.findChorus(pos);
        } catch (e) { /* no chorus data */ }
      }

      if (shouldDive && !inChorus) {
        inChorus = true;
        dive.forceDiveStart();
      } else if (!shouldDive && inChorus) {
        inChorus = false;
        dive.forceDiveEnd();
      }
    }
  },
  onPlay()  { overlay.classList.add("hidden"); if(pauseBtn) pauseBtn.textContent="⏸"; },
  onPause() { if(pauseBtn) pauseBtn.textContent="▶"; },
});

// === UI ===
playBtn.addEventListener("click", () => {
  if (!player.video) return;
  player.isPlaying ? player.requestPause() : player.requestPlay();
});
if (pauseBtn) pauseBtn.addEventListener("click", () => {
  player.isPlaying ? player.requestPause() : player.requestPlay();
});
if (songSelect) songSelect.addEventListener("change", e => {
  location.search = `?song=${e.target.value}`;
});

// === Start ===
engine.start();

function fmt(ms) {
  const s = Math.floor(ms/1000);
  return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;
}