/**
 * LakeScene — full play scene.
 * Creates Water, Environment, Boat, Camera, LyricManager, TextAlive player.
 * Call dispose() to tear everything down when switching scenes.
 */

import { Player } from "textalive-app-api";
import { Water } from "./water.js";
import { Environment } from "./environment.js";
import { Boat } from "./boat.js";
import { CameraController } from "./camera.js";
import { Controls } from "./controls.js";
import { LyricManager } from "./lyric-manager.js";
import { FishLyricSystem } from "./fish-lyric-system.js";
import { WaterObjects } from "./water-objects.js";
import { SONGS } from "./songs.js";

export class LakeScene {
  constructor(engine, songIndex) {
    this.engine = engine;
    this.song = SONGS[songIndex];

    // Water + environment with song theme
    this.water = new Water(engine);
    this.water.setColors(this.song.theme.water, this.song.theme.deep);

    this.env = new Environment(engine);
    this.env.setTheme(this.song.theme);
    this.engine.env = this.env;

    // Boat, camera, controls
    this.controls = new Controls();
    this.boat = new Boat(engine, this.controls);
    this.cam = new CameraController(engine);
    this.cam.attachBoat(this.boat);

    // Lyrics (uses song theme particle color)
    this.lyrics = new LyricManager(engine, this.boat, this.song.theme.particle);

    // Fish school lyric system (underwater companion, always active)
    this.fishLyrics = new FishLyricSystem(engine, this.boat);

    // Water mini-game objects (planks + notes)
    this.waterObjects = new WaterObjects(engine, this.boat, this.fishLyrics, this.water);

    // HUD
    const hud = document.getElementById("hud");
    if (hud) hud.classList.add("visible");

    const songInfo = document.getElementById("song-info");
    if (songInfo) songInfo.textContent = `${this.song.title} / ${this.song.artist}`;

    // Controls hint — fade after 5s
    const hint = document.getElementById("controls-hint");
    if (hint) {
      hint.style.opacity = "1";
      setTimeout(() => { hint.style.opacity = "0"; }, 5000);
    }

    // TextAlive
    const audioEl = document.createElement("audio");
    audioEl.crossOrigin = "anonymous";
    this.player = new Player({
      app: { token: "xTTinPuYYoHYLhnk" },
      mediaElement: audioEl,
    });

    // Audio-Reaction setup
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.audioData = new Uint8Array(this.analyser.frequencyBinCount);

      const source = this.audioContext.createMediaElementSource(audioEl);
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      this.env.setAudioAnalyser(this.analyser, this.audioData);
      this.water.setAudioAnalyser(this.analyser, this.audioData);
    } catch (e) {
      console.warn("AudioContext setup failed (CORS or unavailable). Audio reactivity disabled.", e);
    }

    this._managed = false;
    this._lastPhraseText = null;
    this.player.addListener({
      onAppReady: (app) => {
        this._managed = app.managed;
        if (!app.managed) {
          this.player.createFromSongUrl(this.song.url, this.song.options);
        }
      },
      onVideoReady: () => {
        // #play-btn is not in the current HTML (auto-play via onTimerReady)
      },
      onTimerReady: () => {
        if (!this._managed) this.player.requestPlay();
      },
      onTimeUpdate: (pos) => {
        const timeTxt = document.getElementById("time");
        if (timeTxt) {
          timeTxt.textContent = `${_fmt(pos)} / ${_fmt(this.player.video?.duration || 0)}`;
        }
        const phrase = this.player.video?.findPhrase(pos);
        const phraseText = phrase?.text ?? null;
        if (phraseText !== this._lastPhraseText) {
          this._lastPhraseText = phraseText;
          if (phraseText) {
            this.fishLyrics.addPhrase(phraseText);
            if (this.skyMode) this.lyrics.addPhrase(phraseText);
          }
        }
      },
      onPlay: () => {
        document.getElementById("overlay")?.classList.add("hidden");
        const pauseBtn = document.getElementById("pause-btn");
        if (pauseBtn) pauseBtn.textContent = "⏸";

        if (this.audioContext && this.audioContext.state === "suspended") {
          this.audioContext.resume();
        }
      },
      onPause: () => {
        const pauseBtn = document.getElementById("pause-btn");
        if (pauseBtn) pauseBtn.textContent = "▶";
      },
    });

    // Sky Toggler
    this.skyMode = false;
    const skyBtn = document.getElementById("sky-btn");
    skyBtn?.addEventListener("click", () => this.toggleSkyMode());
  }

  toggleSkyMode() {
    this.skyMode = !this.skyMode;
    const skyBtn = document.getElementById("sky-btn");
    if (skyBtn) {
      skyBtn.textContent = this.skyMode ? "⛵ Lake View" : "🌌 Sky View";
      skyBtn.classList.toggle("active", this.skyMode);
    }
    this.cam.setSkyMode(this.skyMode);
    this.lyrics.setChorusMode(this.skyMode);
  }

  togglePause() {
    if (!this.player.video) return;
    this.player.isPlaying ? this.player.requestPause() : this.player.requestPlay();
  }

  dispose() {
    this.player.dispose();
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.engine.removeUpdatable(this._camUpdatable);
    this.water.dispose();
    this.env.dispose();
    this.boat.dispose();
    this.cam.dispose();
    this.controls.dispose();
    this.lyrics.dispose();
    this.fishLyrics.dispose();
    this.waterObjects.dispose();

    const hud = document.getElementById("hud");
    if (hud) hud.classList.remove("visible");
  }
}

function _fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
