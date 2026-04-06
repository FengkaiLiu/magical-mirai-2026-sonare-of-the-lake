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
import { CameraController } from "./camera.js";
import { Environment } from "./environment.js";
import { LyricManager } from "./lyric-manager.js";
import { SONGS } from "./songs.js";

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

const boat = new Boat(engine);
const cam = new CameraController(engine);
const lyrics = new LyricManager(engine);

// Debug用グローバル参照
window._boat = boat;
window._engine = engine;

// Camera follows boat
engine.addUpdatable({
  update() {
    cam.setTarget(boat.getPosition());
    lyrics.cleanup();
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
  onTimerReady() {},
  onTimeUpdate(pos) {
    if (timeTxt) timeTxt.textContent = `${fmt(pos)} / ${fmt(player.video?.duration||0)}`;

    const phrase = player.video.findPhrase(pos);
    if (phrase) lyrics.addPhrase(phrase.text, boat.getPosition());

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