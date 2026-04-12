/**
 * ==========================================
 * Sonare of the Lake — Main v3
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
import { WakeTrail } from "./wake-trail.js";
import { SONGS } from "./songs.js";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SongSelectScene } from "./song-select.js";

const mount      = document.getElementById("mount");
const overlay    = document.getElementById("overlay");
const playBtn    = document.getElementById("play-btn");
const pauseBtn   = document.getElementById("pause-btn");
const timeTxt    = document.getElementById("time");
const songInfo   = document.getElementById("song-info");

const engine = new Engine(mount);

const gltfLoader = new GLTFLoader();
let boatModelTemplate = null;

// ==========================================
// 💡 模型旋转朝向配置！
// 如果你的船模型是倒着开的，修改这里：
// 比如换成 Math.PI (180度)， Math.PI/2 (90度) 或 -Math.PI/2 (-90度)
const MY_BOAT_CONFIG = { scale: 0.3, rotationY: Math.PI }; 
// ==========================================


gltfLoader.load('/models/terrain.glb', (gltf) => {
  const terrain = gltf.scene;
  terrain.position.y = 12;
  terrain.traverse(child => {
    if (child.isMesh) { child.material.roughness = 1.0; child.material.metalness = 0.0; }
  });
  engine.scene.add(terrain);
});

gltfLoader.load('/models/boat.glb', (gltf) => {
  boatModelTemplate = gltf.scene;
  if (window._currentBoat) {
    window._currentBoat.setModel(boatModelTemplate.clone(), MY_BOAT_CONFIG);
  }
});

function startMainGame(songIndex) {
  const song = SONGS[songIndex];

  const water = new Water(engine);
  water.setColors(song.theme.water, song.theme.deep);
  water.setSkyHorizon(song.theme.skyHorizon || 0xdceaf5);

  const env = new Environment(engine);
  env.setTheme(song.theme);

  const controls = new Controls();
  const boat = new Boat(engine, controls);
  
  window._currentBoat = boat;
  if (boatModelTemplate) {
    boat.setModel(boatModelTemplate.clone(), MY_BOAT_CONFIG);
  }

  const cam = new CameraController(engine);
  const lyrics = new LyricManager(engine, boat);
  const wake = new WakeTrail(engine);
  
  wake.setBoat(boat);
  env.setBoat(boat);

  let isSkyMode = false;
  controls.onDiveToggle = () => {
    isSkyMode = !isSkyMode;
    cam.setSkyMode(isSkyMode);
  };

  let lastBeatIdx = -1;

  engine.addUpdatable({
    update() {
      controls.pollGamepad();
      cam.setTarget(boat.getPosition(), boat.getHeading());
    }
  });

  const player = new Player({
    app: { token: "xTTinPuYYoHYLhnk" },
    mediaElement: document.createElement("audio"),
  });

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
    onTimerReady() {}, // 故意置空，等玩家点 Play 解锁 AudioContext
    onTimeUpdate(pos) {
      if (timeTxt) timeTxt.textContent = `${fmt(pos)} / ${fmt(player.video?.duration||0)}`;
      if (document.hidden) return;

      let phrase = cachedPhrase;
      if (!phrase || pos < phrase.startTime || pos >= cachedPhraseEnd) {
        phrase = player.video.findPhrase(pos);
        cachedPhrase = phrase;
        cachedPhraseEnd = phrase ? (phrase.startTime + phrase.duration) : 0;
      }

      if (phrase) {
         lyrics.addPhrase(phrase);
      }

      try {
        const beat = player.findBeat(pos);
        if (beat && beat.index !== lastBeatIdx) {
          lastBeatIdx = beat.index;
          const strong = (beat.index % 4 === 0);
          env.beatPulse(strong ? 1.0 : 0.4);
          if (strong) {
            water.pulse(1.0);
            boat.lanternPulse(1.0);
          }
        }
      } catch (e) {}
    },
    onPlay()  { 
      if (overlay) overlay.classList.add("hidden"); 
      if (pauseBtn) pauseBtn.textContent="⏸"; 
    },
    onPause() { 
      if (pauseBtn) pauseBtn.textContent="▶"; 
    }
  });

  playBtn.addEventListener("click", () => {
    if (!player.video) return;
    player.isPlaying ? player.requestPause() : player.requestPlay();
  });
  if (pauseBtn) pauseBtn.addEventListener("click", () => {
    player.isPlaying ? player.requestPause() : player.requestPlay();
  });
}

function fmt(ms) {
  const s = Math.floor(ms/1000);
  return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;
}

const selectScene = new SongSelectScene(engine, (selectedIndex) => {
  selectScene.dispose(); 
  if (overlay) overlay.classList.remove("hidden");
  startMainGame(selectedIndex); 
});

window._currentBoat = selectScene.boat;
engine.start();