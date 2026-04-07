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

const env = new Environment(engine);
env.setTheme(song.theme);

const boat = new Boat(engine, new Controls());
const cam = new CameraController(engine);
const lyrics = new LyricManager(engine, boat);

// Debug用グローバル参照
window._boat = boat;
window._engine = engine;
window._lyrics = lyrics;

// === Load terrain & boat models ===
const gltfLoader = new GLTFLoader();

gltfLoader.load('/models/terrain.glb', (gltf) => {
  const terrain = gltf.scene;
  terrain.position.y = 2;  // 往上提更多，让山体挡住视野
  terrain.traverse(child => {
    if (child.isMesh) {
      child.material.roughness = 1.0;
      child.material.metalness = 0.0;
    }
  });
  engine.scene.add(terrain);
  console.log('Terrain loaded!');
});

gltfLoader.load('/models/boat.glb', (gltf) => {
  const boatModel = gltf.scene;
  boatModel.scale.set(0.3, 0.3, 0.3);
  boatModel.rotation.y = Math.PI;  // 旋转180度，修正朝向
  // 把模型挂到物理船的 mesh 上，这样会跟着动
  boat.mesh.add(boatModel);
  // 隐藏占位方块
  boat.mesh.children.forEach(child => {
    if (child !== boatModel) child.visible = false;
  });
  console.log('Boat model loaded!');
});

// Camera follows boat
engine.addUpdatable({
  update() {
    cam.setTarget(boat.getPosition());
  }
});

// === TextAlive ===
const player = new Player({
  app: { token: "xTTinPuYYoHYLhnk" },
  mediaElement: document.createElement("audio"),
});
let lastPos = 0;

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

    const phrase = player.video.findPhrase(pos);
    if (phrase) lyrics.addPhrase(phrase.text);

    lastPos = pos;
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