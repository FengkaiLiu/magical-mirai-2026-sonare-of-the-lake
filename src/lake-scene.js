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

    // Boat, camera, controls
    this.controls = new Controls();
    this.boat = new Boat(engine, this.controls);
    this.cam = new CameraController(engine);
    this._camUpdatable = { update: () => this.cam.setTarget(this.boat.getPosition()) };
    engine.addUpdatable(this._camUpdatable);

    // Lyrics (uses song theme particle color)
    this.lyrics = new LyricManager(engine, this.boat, this.song.theme.particle);

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
    this.player = new Player({
      app: { token: "xTTinPuYYoHYLhnk" },
      mediaElement: document.createElement("audio"),
    });

    this._managed = false;
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
        if (phrase) this.lyrics.addPhrase(phrase.text);
      },
      onPlay: () => {
        document.getElementById("overlay")?.classList.add("hidden");
        const pauseBtn = document.getElementById("pause-btn");
        if (pauseBtn) pauseBtn.textContent = "⏸";
      },
      onPause: () => {
        const pauseBtn = document.getElementById("pause-btn");
        if (pauseBtn) pauseBtn.textContent = "▶";
      },
    });
  }

  togglePause() {
    if (!this.player.video) return;
    this.player.isPlaying ? this.player.requestPause() : this.player.requestPlay();
  }

  dispose() {
    this.player.dispose();
    this.engine.removeUpdatable(this._camUpdatable);
    this.water.dispose();
    this.env.dispose();
    this.boat.dispose();
    this.cam.dispose();
    this.controls.dispose();
    this.lyrics.dispose();

    const hud = document.getElementById("hud");
    if (hud) hud.classList.remove("visible");
  }
}

function _fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
