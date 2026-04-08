/**
 * ==========================================
 * Sonare of the Lake — Main
 * Three.js + Cannon-es + TextAlive
 * ==========================================
 */

import { Player } from "textalive-app-api";
import { Engine } from "./engine.js";
import { Water } from "./water.js";
import { Boat } from "./boat.js";
import { Controls } from "./controls.js";
import { CameraController } from "./camera.js";
import { Environment } from "./environment.js";
import { LyricManager } from "./lyric-manager.js";
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
env.setBoat(boat); // particle spawning + shadow follow

// Debug用グローバル参照
window._boat = boat;
window._engine = engine;
window._lyrics = lyrics;

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
  const boatModel = gltf.scene;
  boatModel.scale.set(0.3, 0.3, 0.3);
  boatModel.rotation.y = Math.PI;
  boat.mesh.add(boatModel);
  boat.mesh.children.forEach(child => {
    if (child !== boatModel) child.visible = false;
  });
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

// Phrase cache: avoid calling findPhrase every frame when position
// is still within the same phrase's time range
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
    // Auto-play: timer ready means player is fully initialized
    player.requestPlay();
  },
  onTimeUpdate(pos) {
    if (timeTxt) timeTxt.textContent = `${fmt(pos)} / ${fmt(player.video?.duration||0)}`;

    // Cached phrase lookup: only call findPhrase when position exits current phrase
    let phrase = cachedPhrase;
    if (!phrase || pos < phrase.startTime || pos >= cachedPhraseEnd) {
      phrase = player.video.findPhrase(pos);
      cachedPhrase = phrase;
      cachedPhraseEnd = phrase ? (phrase.startTime + phrase.duration) : 0;
    }
    if (phrase) lyrics.addPhrase(phrase);
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