/**
 * game-scene.js — Unified select → play scene. One continuous shot, no scene swap.
 *
 * Shared systems (Water, Environment, Boat, CameraController, Controls) are
 * created once in the constructor and kept alive through the full session.
 * Song selection is handled by SongCircleSystem — glowing particle circles
 * that spell song titles when the boat enters them.
 *
 * States: 'select' → 'transitioning' → 'play'
 */

import * as THREE from "three";
import { gsap } from "gsap";
import { Player } from "textalive-app-api";
import { Water } from "./water.js";
import { Environment } from "./environment.js";
import { Boat } from "./boat.js";
import { CameraController } from "./camera.js";
import { Controls } from "./controls.js";
import { SONGS } from "./songs.js";
import { LyricFormation } from "./fish-school.js";
import { LyricManager } from "./lyric-manager.js";
import { FishLyricSystem } from "./fish-lyric-system.js";
import { SongCircleSystem } from "./song-circles.js";
import { WaterObjects } from "./water-objects.js";

// ── GameScene ─────────────────────────────────────────────────────────────────

export class GameScene {
  constructor(engine) {
    this.engine    = engine;
    this._state    = "select"; // 'select' | 'transitioning' | 'play'
    this._disposed = false;

    // ── Shared persistent systems (live for the entire session) ────────────
    this.water    = new Water(engine);
    this.env      = new Environment(engine);
    engine.env    = this.env;
    this.controls = new Controls();
    this.controls.locked = true;
    this.boat     = new Boat(engine, this.controls);
    this.boat.mesh.visible = false;
    this.cam      = new CameraController(engine);
    this.cam.attachBoat(this.boat);

    // ── Select-state resources ─────────────────────────────────────────────
    this._introFormations = [];
    this._introActive     = true;

    // Particle circles — 6 circles, one per song, positioned where old icons were.
    // onSelect fires when boat drives to the centre of a circle.
    this.songCircles = new SongCircleSystem(engine, this.boat, (songIndex) => {
      if (this._state !== "select" || this._introActive || this.cam.revealLock) return;
      this._beginTransition(songIndex);
    });

    document.getElementById("overlay")?.classList.add("hidden");

    // ── Play-state resources (null until _activatePlay) ────────────────────
    this.lyrics       = null;
    this.fishLyrics   = null;
    this.waterObjects = null;
    this.player       = null;
    this.audioContext = null;

    this._updatable = { update: (dt, el) => this._update(dt, el) };
    engine.addUpdatable(this._updatable);
  }

  // ── Intro ──────────────────────────────────────────────────────────────────

  beginIntroSequence() {
    if (this._disposed) return;
    this._spawnTitleFormations();

    setTimeout(() => {
      if (this._disposed) return;
      const el = document.getElementById("intro-screen");
      if (el) { el.classList.add("hidden"); setTimeout(() => el.classList.add("gone"), 950); }
    }, 2500);

    setTimeout(() => this._beginDive(), 3600);
  }

  _spawnTitleFormations() {
    if (this._disposed) return;
    const f = new LyricFormation(
      this.engine,
      new THREE.Vector3(0, 0, 3),
      "Sonare of the Lake",
      0x88e8ff,
      { textScale: 2.5, poolRadius: 24, letterSpacing: "10px", outlineOnly: false, particleCount: 7200 }
    );
    this._introFormations = [f];
  }

  _beginDive() {
    if (this._disposed) return;
    this.cam.onDiveComplete = () => this._onDiveLanded();
    this.cam.startDive();
  }

  _onDiveLanded() {
    if (this._disposed) return;

    // Hand intro-formation particle positions to song circles so they visually
    // fly from the "Sonare of the Lake" text into the 6 orbit rings.
    // startFade (not dispose) so intro particles cross-dissolve with the song-circle
    // fade-in instead of popping off, preventing the sudden particle-size jump.
    const introForm = this._introFormations[0] ?? null;
    for (const f of this._introFormations) f.startFade();
    // Keep in _introFormations — _update disposes each one when fully faded.
    this.songCircles.startGatherFrom(introForm?.posArray ?? null);

    this.cam.revealLock = true;
    this.boat.mesh.visible = true;
    this.boat.startEntrance();

    if (this.env?.sunLight) {
      const sun = this.env.sunLight;
      sun.intensity *= 1.2;
      setTimeout(() => { if (sun) sun.intensity = this.env.baseSunIntensity; }, 350);
    }

    setTimeout(() => {
      if (this._disposed) return;
      this.controls.locked = false;
      this._introActive = false;
      const hint = document.getElementById("select-hint");
      if (hint) hint.style.display = "block";
    }, 1800);
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  _update(dt, elapsed) {
    // Tick intro formations until they self-dispose
    for (let i = this._introFormations.length - 1; i >= 0; i--) {
      const f = this._introFormations[i];
      f.update(dt, elapsed, null, null);
      if (f.faded) { f.dispose(); this._introFormations.splice(i, 1); }
    }

    if (this._state !== "select" || this._introActive) return;

    // Release camera reveal lock once boat auto-drive finishes
    if (this.cam.revealLock && !this.boat._autoTarget) {
      this.cam.revealLock = false;
    }
  }

  // ── Select → Play cinematic ────────────────────────────────────────────────

  _beginTransition(songIndex) {
    if (this._state !== "select") return;
    this._state = "transitioning";
    this.controls.locked = true;

    document.getElementById("select-hint")?.style.setProperty("display", "none");

    const song = SONGS[songIndex];

    // Scatter all circles; selected circle gets dramatic title-dissolve effect
    const selectedIdx = this.songCircles._activeIdx;
    for (let i = 0; i < this.songCircles._circles.length; i++) {
      if (i === selectedIdx) this.songCircles._circles[i].triggerTitleFade();
      else                   this.songCircles._circles[i].triggerScatter();
    }

    // Smooth water + sky crossfade to song theme (2.5 s)
    this._tweenToTheme(song.theme, 2.5);

    // Dispose select UI and enter play after crossfade settles
    setTimeout(() => {
      if (this._disposed) return;
      this._disposeSelectResources();
      this._activatePlay(songIndex);
    }, 2650);
  }

  // Tween water/sky colours from current values to the given song theme.
  _tweenToTheme(theme, dur) {
    const wU = this.water.uniforms;
    const sU = this.env.skyMat.uniforms;

    const s0   = wU.uShallow.value.clone();
    const d0   = wU.uDeep.value.clone();
    const wst0 = wU.uSkyTop.value.clone();
    const wsh0 = wU.uSkyHorizon.value.clone();
    const est0 = sU.uTopColor.value.clone();
    const esh0 = sU.uHorizonColor.value.clone();

    const s1   = new THREE.Color(theme.water);
    const d1   = new THREE.Color(theme.deep);
    const sky1 = new THREE.Color(theme.sky);
    const hor1 = new THREE.Color(theme.skyHorizon ?? 0xb8daf0);

    const proxy = { t: 0 };
    gsap.to(proxy, {
      t: 1, duration: dur, ease: "power2.inOut",
      onUpdate: () => {
        const t = proxy.t;
        wU.uShallow.value.copy(s0).lerp(s1, t);
        wU.uDeep.value.copy(d0).lerp(d1, t);
        wU.uSkyTop.value.copy(wst0).lerp(sky1, t);
        wU.uSkyHorizon.value.copy(wsh0).lerp(hor1, t);
        sU.uTopColor.value.copy(est0).lerp(sky1, t);
        sU.uHorizonColor.value.copy(esh0).lerp(hor1, t);
      },
      onComplete: () => {
        this.engine.renderer.setClearColor(theme.skyHorizon ?? 0xb8daf0);
      },
    });
  }

  _disposeSelectResources() {
    gsap.killTweensOf(this.engine.camera.position);
    this.songCircles?.dispose();
    this.songCircles = null;
    for (const f of this._introFormations) f.dispose();
    this._introFormations = [];
  }

  // ── Play activation ────────────────────────────────────────────────────────

  _activatePlay(songIndex) {
    this._state = "play";
    const song  = SONGS[songIndex];

    // Update shared systems in-place — no reconstruction
    this.water.setColors(song.theme.water, song.theme.deep);
    this.env.setTheme(song.theme);
    this.controls.locked = false;

    this.lyrics     = new LyricManager(this.engine, this.boat, song.theme.particle);
    this.fishLyrics = new FishLyricSystem(this.engine, this.boat);
    this.waterObjects = new WaterObjects(this.engine, this.boat, this.fishLyrics, this.lyrics);

    // HUD
    document.getElementById("hud")?.classList.add("visible");
    const songInfo = document.getElementById("song-info");
    if (songInfo) songInfo.textContent = `${song.title} / ${song.artist}`;
    const controlsHint = document.getElementById("controls-hint");
    if (controlsHint) {
      controlsHint.style.opacity = "1";
      setTimeout(() => { controlsHint.style.opacity = "0"; }, 5000);
    }

    // TextAlive
    const audioEl = document.createElement("audio");
    audioEl.crossOrigin = "anonymous";
    this.player = new Player({ app: { token: "xTTinPuYYoHYLhnk" }, mediaElement: audioEl });

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser     = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.audioData    = new Uint8Array(this.analyser.frequencyBinCount);
      const source = this.audioContext.createMediaElementSource(audioEl);
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      this.env.setAudioAnalyser(this.analyser, this.audioData);
      this.water.setAudioAnalyser(this.analyser, this.audioData);
    } catch (e) {
      console.warn("AudioContext setup failed — audio reactivity disabled.", e);
    }

    this._managed    = false;
    this._lastPhrase = null;
    this.skyMode     = false;
    this._autoChorus = false;

    this.player.addListener({
      onAppReady: (app) => {
        this._managed = app.managed;
        if (!app.managed) this.player.createFromSongUrl(song.url, song.options);
      },
      onVideoReady: (v) => {
        if (!v) return;

        // Derive BPM from beat data and set sky-particle convergence speed.
        // Fast songs (e.g. TAKEOVER ~150 BPM) → short convergence so particles
        // form text before the next lyric arrives; slow songs can afford more time.
        if (this.lyrics && Array.isArray(v.beats) && v.beats.length > 0) {
          const validBeats = v.beats.filter(b => b.duration > 0);
          if (validBeats.length > 0) {
            const avgMs  = validBeats.reduce((s, b) => s + b.duration, 0) / validBeats.length;
            const bpm    = 60000 / avgMs;
            // 2 beat-lengths as convergence time: 80 BPM→1.5 s, 120 BPM→1.0 s, 150 BPM→0.8 s
            const ct = Math.max(0.5, Math.min(2.5, 120 / bpm));
            this.lyrics.setSkyConvergenceTime(ct);
            console.log(`[SkyLyric] BPM ≈ ${bpm.toFixed(1)}, convergence time = ${ct.toFixed(2)} s`);
          }
        }

        // Pre-warm sampleTextPoints cache for every phrase so the getImageData
        // GPU readback stall happens here (during load) rather than mid-playback.
        const seen = new Set();
        let p = v.firstPhrase;
        while (p) { if (p.text) seen.add(p.text); p = p.next; }
        const queue = [...seen];
        let idx = 0;
        const step = () => {
          if (idx < queue.length) {
            LyricFormation.prewarmPhrase(queue[idx++], { outlineOnly: false });
            requestAnimationFrame(step);
          }
        };
        requestAnimationFrame(step);
      },
      onTimerReady: () => {
        if (!this._managed) this.player.requestPlay();
      },
      onTimeUpdate: (pos) => {
        const timeTxt = document.getElementById("time");
        if (timeTxt) timeTxt.textContent =
          `${_fmt(pos)} / ${_fmt(this.player.video?.duration || 0)}`;

        const inChorus = (song.chorus || []).some(([s, e]) => pos >= s && pos < e);
        if (inChorus !== this._autoChorus) {
          this._autoChorus = inChorus;
          if (this.skyMode !== inChorus) this.toggleSkyMode();
        }

        const phrase     = this.player.video?.findPhrase(pos);
        const phraseText = phrase?.text ?? null;
        if (phraseText !== this._lastPhrase) {
          this._lastPhrase = phraseText;
          if (phraseText) {
            if (this.skyMode) this.lyrics.addPhrase(phraseText);
            else              this.fishLyrics.addPhrase(phraseText);
          }
        }
      },
      onPlay: () => {
        document.getElementById("overlay")?.classList.add("hidden");
        const pauseBtn = document.getElementById("pause-btn");
        if (pauseBtn) pauseBtn.textContent = "⏸";
        if (this.audioContext?.state === "suspended") this.audioContext.resume();
      },
      onPause: () => {
        const pauseBtn = document.getElementById("pause-btn");
        if (pauseBtn) pauseBtn.textContent = "▶";
      },
    });

    document.getElementById("sky-btn")?.addEventListener("click", () => this.toggleSkyMode());
  }

  // ── Play helpers ───────────────────────────────────────────────────────────

  toggleSkyMode() {
    this.skyMode = !this.skyMode;
    const skyBtn = document.getElementById("sky-btn");
    if (skyBtn) {
      skyBtn.textContent = this.skyMode ? "⛵ Lake View" : "🌌 Sky View";
      skyBtn.classList.toggle("active", this.skyMode);
    }
    this.cam.setSkyMode(this.skyMode);
    this.lyrics.setChorusMode(this.skyMode);
    if (this.skyMode) this.fishLyrics.clear();
    else              this.lyrics.clear?.();
  }

  togglePause() {
    if (!this.player?.video) return;
    this.player.isPlaying ? this.player.requestPause() : this.player.requestPlay();
  }

  // ── Full teardown ──────────────────────────────────────────────────────────

  dispose() {
    this._disposed = true;
    this._disposeSelectResources();

    this.player?.dispose();
    this.audioContext?.close();
    this.lyrics?.dispose();
    this.fishLyrics?.dispose();
    this.waterObjects?.dispose();

    this.engine.removeUpdatable(this._updatable);
    this.water.dispose();
    this.env.dispose();
    this.boat.dispose();
    this.cam.dispose();
    this.controls.dispose();

    if (this.engine.scene.fog) this.engine.scene.fog = null;
  }
}

function _fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
