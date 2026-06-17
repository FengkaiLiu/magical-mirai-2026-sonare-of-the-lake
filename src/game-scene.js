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
import { WASDHint } from "./wasd-hint.js";
import { ReturnCircle } from "./return-circle.js";
import { UtilityCircle, makeGearObject } from "./utility-circle.js";
import { preloadGLTF } from "./asset-cache.js";
import { IS_TOUCH } from "./device.js";
import { t, getLang, getBoat } from "./i18n.js";

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

    // WASD particle hint — shown once boat arrives at center, disposed on song select.
    this.wasdHint = new WASDHint(engine, this.boat);

    document.getElementById("overlay")?.classList.add("hidden");

    // One-time seek handler on the progress bar (safe to add once — checks this.player at call time)
    document.getElementById("song-progress-wrap")?.addEventListener("click", (e) => {
      if (!this.player?.video) return;
      const dur = this.player.video.duration;
      if (!dur) return;
      const frac = e.clientX / window.innerWidth;
      try { this.player.requestMediaSeek(Math.round(frac * dur)); } catch {}
    });

    // One-time fullscreen toggle (bound once so multiple play sessions don't stack listeners).
    document.getElementById("fullscreen-btn")?.addEventListener("click", () => {
      const el = document.documentElement;
      if (!document.fullscreenElement) {
        (el.requestFullscreen?.() || el.webkitRequestFullscreen?.())
          ?.catch(() => {});
      } else {
        (document.exitFullscreen?.() || document.webkitExitFullscreen?.())
          ?.catch(() => {});
      }
    });

    // ── Play-state resources (null until _activatePlay) ────────────────────
    this.lyrics            = null;
    this.fishLyrics        = null;
    this.waterObjects      = null;
    this.player            = null;
    this.audioContext      = null;
    this._lyricGate        = null;
    this._activeSongIndex  = -1;
    this._lastPhraseForGate = null;
    this._endingTriggered  = false;

    // ── Utility circles (select-state only: boat select + settings) ───────────
    this._boatCircle     = null;
    this._settingsCircle = null;
    // main.js sets these to open the respective modal when a circle is entered.
    this.onOpenBoatModal     = null;
    this.onOpenSettingsModal = null;
    this.onReturnToMenu      = null;

    // ── Preload progress reporting ─────────────────────────────────────────
    // main.js subscribes to onPreloadProgress to drive the loading bar; we
    // report two fractions: how many songs are timer-ready (audio+timer
    // pipeline live) and how many have finished glyph-prewarm (lyric cache
    // primed).  Counted per-song with idempotent guards so a Player restart
    // inside _ensurePreloadedPlayer can't double-increment.
    this._readyTimerCount   = 0;
    this._readyPrewarmCount = 0;
    this.onPreloadProgress  = null; // (timerFrac, prewarmFrac) => void

    // Kick off TextAlive preloading for all songs.  100 ms stagger is enough to
    // avoid burst-rate-limiting the TextAlive API while still letting all 6
    // requests overlap on the network for a near-parallel feel.
    this._preloadedSongs = SONGS.map((song, i) => {
      const entry = {
        player: null, audioEl: null, video: null,
        timerReady: false, managed: false,
        _timerCounted: false, _prewarmCounted: false,
      };
      setTimeout(() => { if (!this._disposed) this._startPreload(song, entry); }, i * 100);
      return entry;
    });

    this._updatable = { update: (dt, el) => this._update(dt, el) };
    engine.addUpdatable(this._updatable);
  }

  // ── Song preloading ────────────────────────────────────────────────────────

  /** Populate a pre-created entry with a TextAlive Player and start loading. */
  _startPreload(song, entry) {
    const audioEl = document.createElement("audio");
    // crossOrigin="anonymous" is required for createMediaElementSource (Web Audio routing).
    audioEl.crossOrigin = "anonymous";
    // Default <audio> preload is "metadata" — the browser only fetches enough to
    // know duration/codec, leaving real buffering until the first play() call.
    // "auto" tells the browser to start downloading the full file immediately,
    // which is what we want for a select-then-play flow where audio readiness
    // is the dominant load-time bottleneck.
    audioEl.preload = "auto";
    entry.audioEl = audioEl; // set synchronously so _activatePlay can use it immediately

    entry.player = new Player({ app: { token: "xTTinPuYYoHYLhnk" }, mediaElement: audioEl });
    // Keep the listener handle so _attachPlaybackListeners can detach it — otherwise
    // both listeners coexist on the same Player and onTimeUpdate/onTimerReady fire twice.
    entry.preloadListener = {
      onAppReady: (app) => {
        entry.managed = app.managed;
        if (!app.managed) entry.player.createFromSongUrl(song.url, song.options);
      },
      onVideoReady: (v) => {
        if (!v) return;
        entry.video = v;
        // Prewarm the text-point cache for all phrases during idle load — no game-state deps.
        // Use FishLyricSystem.prewarmPhrase so cache keys match the runtime addPhrase opts;
        // a key mismatch (e.g. fontWeight) silently misses and re-runs getImageData inline,
        // stalling the frame and showing as a camera jitter on each new phrase.
        const seen = new Set();
        let p = v.firstPhrase;
        while (p) { if (p.text) seen.add(p.text); p = p.next; }
        const queue = [...seen];
        let idx = 0;
        // Each prewarm step costs ~15 ms (two canvas getImageData readbacks).
        // The intro screen has near-zero render cost, so we can spend a full
        // ~32 ms frame on prewarm work without hurting perceived smoothness.
        // Batching 2 per rAF roughly halves the wall-clock prewarm time vs.
        // 1-per-frame, which dominated the loading-bar tail at ~10–15 s.
        const PREWARM_BATCH = 2;
        const step = () => {
          for (let n = 0; n < PREWARM_BATCH && idx < queue.length; n++) {
            const text = queue[idx++];
            FishLyricSystem.prewarmPhrase(text); // lake-view formation cache
            LyricManager.prewarmPhrase(text);   // sky-view chorus cache
          }
          if (idx < queue.length) {
            requestAnimationFrame(step);
          } else if (!entry._prewarmCounted) {
            // Queue drained (including the empty-queue case): mark prewarm done.
            entry._prewarmCounted = true;
            this._readyPrewarmCount++;
            this._reportPreloadProgress();
          }
        };
        requestAnimationFrame(step);
      },
      onTimerReady: () => {
        entry.timerReady = true;
        if (!entry._timerCounted) {
          entry._timerCounted = true;
          this._readyTimerCount++;
          this._reportPreloadProgress();
        }
      },
    };
    entry.player.addListener(entry.preloadListener);
  }

  /** Push current preload progress to main.js for the loading-bar aggregator. */
  _reportPreloadProgress() {
    this.onPreloadProgress?.(
      this._readyTimerCount   / SONGS.length,
      this._readyPrewarmCount / SONGS.length,
    );
  }

  /** Apply BPM-derived sky convergence time once this.lyrics exists. */
  _applyBPM(v, song) {
    if (!v || !this.lyrics) return;
    if (song.skyConvergenceTime != null) {
      this.lyrics.setSkyConvergenceTime(song.skyConvergenceTime);
    } else if (Array.isArray(v.beats) && v.beats.length > 0) {
      const validBeats = v.beats.filter(b => b.duration > 0);
      if (validBeats.length > 0) {
        const avgMs = validBeats.reduce((s, b) => s + b.duration, 0) / validBeats.length;
        const bpm   = 60000 / avgMs;
        const ct    = Math.max(0.5, Math.min(2.5, 120 / bpm));
        this.lyrics.setSkyConvergenceTime(ct);
      }
    }
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
    const isJa = getLang() === "ja";
    const f = new LyricFormation(
      this.engine, new THREE.Vector3(0, 0, 3), t("subTitle"), 0x88e8ff,
      { textScale: 2.5, poolRadius: 24, letterSpacing: "10px", outlineOnly: false,
        particleCount: 8000, skipGather: true,
        fontFamily: isJa ? '"KiwiMaru", sans-serif' : '"Caveat", cursive',
        fontWeight: isJa ? "400" : "700" },
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
      document.getElementById("select-hint")?.classList.add("visible");
      this.wasdHint?.show();
      this._spawnUtilityCircles();
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

    document.getElementById("select-hint")?.classList.remove("visible");
    this.wasdHint?.hide();

    const song = SONGS[songIndex];

    // Scatter all circles; selected circle gets dramatic title-dissolve effect
    this.songCircles.triggerSelection();

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
    this.wasdHint?.dispose();
    this.wasdHint = null;
    this._boatCircle?.dispose();
    this._boatCircle = null;
    this._settingsCircle?.dispose();
    this._settingsCircle = null;
    for (const f of this._introFormations) f.dispose();
    this._introFormations = [];
  }

  // ── Play activation ────────────────────────────────────────────────────────

  _activatePlay(songIndex) {
    this._state = "play";
    this._activeSongIndex   = songIndex;
    this._endingTriggered   = false;
    this._lastPhraseForGate = null;
    this._lyricGate?.dispose();
    this._lyricGate = null;
    const song = SONGS[songIndex];
    const pre  = this._ensurePreloadedPlayer(songIndex, song);

    if (!pre.timerReady) {
      document.getElementById("overlay")?.classList.remove("hidden");
    }

    // Update shared systems in place — no reconstruction.
    this.water.setColors(song.theme.water, song.theme.deep);
    this.env.setTheme(song.theme);
    this.controls.locked = false;

    this.lyrics       = new LyricManager(this.engine, this.boat, song.theme.particle);
    this.fishLyrics   = new FishLyricSystem(this.engine, this.boat);
    this.waterObjects = new WaterObjects(this.engine, this.boat, this.fishLyrics, this.lyrics);

    this._setupHUD(song);

    // Reuse the preloaded Player + audio element. createFromSongUrl was already called.
    this.player           = pre.player;
    this._managed         = pre.managed;
    this._lastPhrase      = null;
    this.skyMode          = false;
    this._autoChorus      = false;
    // Lyric dispatch is gated on this flag: onTimeUpdate ticks are dropped until
    // onPlay fires, which guarantees audio has actually started at position 0
    // (we always requestMediaSeek(0) before requestPlay below).
    this._playbackStarted = false;

    this._setupAudioPipeline(pre);
    this._applyBPM(pre.video, song); // safe even if video arrives later — listener also catches it
    this._setupVisibilityHandler();
    this._attachPlaybackListeners(song, pre);
    this._kickOffPlayback(pre);
    this._setupPlaybackFallback();
  }

  /**
   * Resolve the preloaded entry for the chosen song, fixing any preload that
   * never completed (stagger delay hadn't fired yet, or the player silently stalled).
   */
  _ensurePreloadedPlayer(songIndex, song) {
    const pre = this._preloadedSongs[songIndex];

    // Stagger delay hadn't fired yet — kick off preload now so pre.audioEl exists below.
    if (!pre.player) this._startPreload(song, pre);

    // Preload looks dead (no timer, no video) — discard and rebuild the player.
    if (pre.player && !pre.timerReady && !pre.video) {
      console.warn("[GameScene] Preload appears stalled — restarting player for:", song.title);
      pre.player.dispose();
      pre.player     = null;
      pre.audioEl    = null;
      pre.timerReady = false;
      pre.video      = null;
      pre.managed    = false;
      this._startPreload(song, pre);
    }
    return pre;
  }

  _setupHUD(song) {
    const hud = document.getElementById("hud");
    if (hud) {
      hud.style.opacity = "0";
      hud.style.transition = "";
      hud.classList.add("visible"); // switches display: none → flex
      // Double rAF: first frame commits display:flex, second starts opacity tween.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        hud.style.transition = "opacity 1.0s ease";
        hud.style.opacity    = "1";
      }));
    }
    const songInfo = document.getElementById("song-info");
    if (songInfo) {
      const displayTitle = getLang() === "en" ? (song.titleEn ?? song.title) : song.title;
      songInfo.textContent = `${displayTitle} / ${song.artist}`;
    }
    const controlsHint = document.getElementById("controls-hint");
    if (controlsHint) {
      controlsHint.textContent = t("controlsHint");
      controlsHint.style.opacity = "1";
      setTimeout(() => {
        controlsHint.style.transition = "opacity 1.5s ease";
        controlsHint.style.opacity    = "0";
      }, 5000);
    }

    const wrap = document.getElementById("song-progress-wrap");
    const fill = document.getElementById("song-progress-fill");
    if (fill) {
      fill.style.width = "0%";
      const c = new THREE.Color(song.theme?.particle ?? 0x88eeff);
      const lo = c.clone().lerp(new THREE.Color(0xffffff), 0.35);
      const rgb  = [c.r,  c.g,  c.b ].map(v => Math.round(v * 255));
      const rgbl = [lo.r, lo.g, lo.b].map(v => Math.round(v * 255));
      fill.style.background  = `linear-gradient(90deg,rgb(${rgb}),rgb(${rgbl}))`;
      fill.style.boxShadow   = `0 0 8px rgba(${rgb},0.7)`;
    }
    if (wrap) wrap.classList.add("visible");
  }

  _setupAudioPipeline(pre) {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      // Proactively resume — browsers may suspend AudioContexts created more
      // than a second after the last user gesture; unlock now while we're still
      // on the same frame as the click.
      this.audioContext.resume().catch(() => {});
      this.analyser         = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.audioData        = new Uint8Array(this.analyser.frequencyBinCount);
      const source = this.audioContext.createMediaElementSource(pre.audioEl);
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      this.env.setAudioAnalyser(this.analyser, this.audioData);
    } catch (e) {
      console.warn("AudioContext setup failed — audio reactivity disabled.", e);
    }
  }

  _setupVisibilityHandler() {
    // Returning from a background tab: drop in-flight lyric state so the next
    // tick resyncs cleanly rather than dumping a backlog.
    this._onVisibilityChange = () => {
      if (document.hidden || this._state !== "play") return;
      this.fishLyrics?.clear();
      this.lyrics?.clear();
      this._lastPhrase = null;
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);
  }

  _attachPlaybackListeners(song, pre) {
    // Detach the preload listener so onTimerReady / onVideoReady / etc. don't fire twice.
    if (pre.preloadListener) {
      this.player.removeListener?.(pre.preloadListener);
      pre.preloadListener = null;
    }
    this.player.addListener({
      // Fires only if video metadata arrived after _activatePlay started.
      onVideoReady: (v) => {
        if (!v || pre.video) return;
        pre.video = v;
        this._applyBPM(v, song);
      },
      // Fires only if the player wasn't timer-ready at selection time.
      onTimerReady: () => {
        if (!this._managed) {
          // Seek to 0 before playing so SongleTimer's internal position is reset.
          try { this.player.requestMediaSeek(0); } catch {}
          this.player.requestPlay();
        }
      },
      onTimeUpdate: (pos) => this._handleTimeUpdate(pos, song),
      onPlay: () => {
        // Audio actually started — unlock lyric dispatch and clear the fallback timer.
        this._playbackStarted = true;
        if (this._playTimeout) { clearTimeout(this._playTimeout); this._playTimeout = null; }
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
  }

  _handleTimeUpdate(pos, song) {
    if (document.hidden || !this._playbackStarted) return;

    const dur = this.player.video?.duration || 0;
    const timeTxt = document.getElementById("time");
    if (timeTxt) timeTxt.textContent = `${_fmt(pos)} / ${_fmt(dur)}`;

    const progressFill = document.getElementById("song-progress-fill");
    if (progressFill && dur) progressFill.style.width = `${Math.min(100, (pos / dur) * 100)}%`;

    const inChorus = (song.chorus || []).some(([s, e]) => pos >= s && pos < e);
    if (inChorus !== this._autoChorus) {
      this._autoChorus = inChorus;
      if (this.skyMode !== inChorus) this.toggleSkyMode();
    }

    const phraseText = this.player.video?.findPhrase(pos)?.text ?? null;
    if (phraseText !== this._lastPhrase) {
      this._lastPhrase = phraseText;
      if (phraseText) {
        this._lastPhraseForGate = phraseText;
        if (this.skyMode) this.lyrics.addPhrase(phraseText);
        else              this.fishLyrics.addPhrase(phraseText);
      }
    }

    // Detect song end: trigger ending sequence ~800 ms before song finishes
    if (!this._endingTriggered) {
      if (dur && pos >= dur - 800) {
        this._endingTriggered = true;
        setTimeout(() => this._beginEnding(), 1200);
      }
    }
  }

  /** Player is already timer-ready from preload — start playback immediately. */
  _kickOffPlayback(pre) {
    if (pre.timerReady && !this._managed) {
      try { this.player.requestMediaSeek(0); } catch {}
      this.player.requestPlay();
    }
  }

  /**
   * If onPlay hasn't fired within 8 s (e.g. AudioContext stayed suspended,
   * preloaded player silently failed), nudge the AudioContext and retry
   * requestPlay().  Either way force-hide the overlay so the user is never
   * stuck on a black loading screen.
   *
   * On iOS: also set a 3 s timer to show a "Tap to start" overlay so the
   * user can retry requestPlay() inside a fresh gesture context.
   */
  _setupPlaybackFallback() {
    this._playTimeout = setTimeout(() => {
      if (this._disposed || this._state !== "play") return;
      if (!this._playbackStarted) {
        console.warn("[GameScene] Playback start timeout — forcing AudioContext resume");
        this.audioContext?.resume().catch(() => {});
        if (!this._managed) {
          try { this.player?.requestPlay(); } catch {}
        }
        document.getElementById("overlay")?.classList.add("hidden");
      }
    }, 8000);
  }

  // ── Play helpers ───────────────────────────────────────────────────────────

  toggleSkyMode() {
    this.skyMode = !this.skyMode;
    this.cam.setSkyMode(this.skyMode);
    this.lyrics.setChorusMode(this.skyMode);
    if (this.skyMode) this.fishLyrics.clear();
    else              this.lyrics.clear?.();
  }

  togglePause() {
    if (!this.player?.video) return;
    this.player.isPlaying ? this.player.requestPause() : this.player.requestPlay();
  }

  // ── Song end → gate → return to select ────────────────────────────────────

  _beginEnding() {
    if (this._state !== "play") return;
    this._state = "ending";
    this._playbackStarted = false; // stop lyric dispatch

    // Copy last lyric formation particle positions NOW, before any fade/dispose
    const formations = this.fishLyrics?._formations;
    const lastForm   = formations?.[formations.length - 1];
    const startPos   = lastForm ? new Float32Array(lastForm.posArray) : null;

    // Fade out HUD
    const hud = document.getElementById("hud");
    if (hud) { hud.style.transition = "opacity 2.0s ease"; hud.style.opacity = "0"; }

    const color = SONGS[this._activeSongIndex]?.theme?.particle ?? 0x88eeff;

    // Brief pause, then spawn ReturnCircle — particles gather from last lyric position
    setTimeout(() => {
      if (this._disposed || this._state !== "ending") return;
      this._lyricGate = new ReturnCircle(
        this.engine, this.boat, color, startPos,
        () => {
          // Fade play-world objects out while the scene stays visible.
          this.waterObjects?.beginFadeOut();
          this._tweenToTheme(
            { water: 0x5bc8d8, deep: 0x2478a0, sky: 0x1a7ad4, skyHorizon: 0xe8f4ff },
            1.8,
          );
          // Notes take ~333ms to fade at rate 3/s; wait 450ms to be safe.
          setTimeout(() => { if (!this._disposed) this._resetToSelect(); }, 450);
        },
      );
    }, 1500);
  }

  _resetToSelect() {
    if (this._disposed) return;

    // Tear down all play-state resources
    this._lyricGate?.dispose();
    this._lyricGate = null;
    this.waterObjects?.dispose();
    this.waterObjects = null;
    this.fishLyrics?.dispose();
    this.fishLyrics = null;
    this.lyrics?.dispose();
    this.lyrics = null;

    try { this.player?.requestPause(); } catch {}
    this.audioContext?.close();
    this.audioContext = null;

    if (this._onVisibilityChange) {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
    if (this._playTimeout) { clearTimeout(this._playTimeout); this._playTimeout = null; }

    // Hide HUD and progress bar
    const hud = document.getElementById("hud");
    if (hud) {
      hud.style.transition = "opacity 0.8s ease";
      hud.style.opacity = "0";
      setTimeout(() => hud.classList.remove("visible"), 900);
    }
    const progressWrap = document.getElementById("song-progress-wrap");
    const progressFill = document.getElementById("song-progress-fill");
    progressWrap?.classList.remove("visible");
    // Reset fill after opacity transition completes so the bar isn't seen jumping.
    setTimeout(() => {
      if (progressFill) {
        progressFill.style.width = "0%";
        progressFill.style.background = "linear-gradient(90deg,#30c8d8,#80eeff)";
        progressFill.style.boxShadow  = "0 0 8px rgba(64,220,240,0.7)";
      }
    }, 550);

    // Reset sky mode
    if (this.skyMode) {
      this.skyMode = false;
      this.cam.setSkyMode(false);
    }

    // Re-create select-state resources
    this._introActive    = false;
    this._endingTriggered = false;
    this._lastPhraseForGate = null;

    this.songCircles = new SongCircleSystem(this.engine, this.boat, (songIndex) => {
      if (this._state !== "select" || this.cam.revealLock) return;
      this._beginTransition(songIndex);
    });
    this.songCircles.startReturn();

    this.wasdHint = new WASDHint(this.engine, this.boat);
    this.wasdHint.show();

    document.getElementById("select-hint")?.classList.add("visible");

    this._spawnUtilityCircles();

    this.controls.locked = false;
    this._state = "select";
  }

  // ── Utility circles (boat select + settings) ──────────────────────────────

  // Both utility circles on the left side, stacked vertically — boat select at (-20, 0, -4), settings below at (-20, 0, 4).
  _spawnUtilityCircles() {
    if (this._disposed) return;

    if (!this._boatCircle) {
      this._boatCircle = new UtilityCircle(
        this.engine, this.boat,
        new THREE.Vector3(-20, 0, -4),
        { color: 0xff88cc, textKey: "boatBtn", onActivate: () => this.onOpenBoatModal?.() },
      );
      const selectedBoat = getBoat();
      preloadGLTF(selectedBoat.glb).then(gltf => {
        if (this._disposed || !this._boatCircle) return;
        const model = gltf.scene.clone(true);
        model.scale.setScalar(0.13);
        this._boatCircle.setCenterObject(model);
      }).catch(() => {});
    }

    if (!this._settingsCircle) {
      const gear = makeGearObject(0xffaa44);
      gear.scale.setScalar(0.65);
      this._settingsCircle = new UtilityCircle(
        this.engine, this.boat,
        new THREE.Vector3(-20, 0, 4),
        { color: 0xffaa44, textKey: "settingBtn", onActivate: () => this.onOpenSettingsModal?.() },
      );
      this._settingsCircle.setCenterObject(gear);
    }
  }

  /** Call after the player changes boat in the modal to update the circle preview. */
  updateBoatCircleModel(boat) {
    if (!this._boatCircle) return;
    preloadGLTF(boat.glb).then(gltf => {
      if (this._disposed || !this._boatCircle) return;
      const model = gltf.scene.clone(true);
      model.scale.setScalar(0.13);
      this._boatCircle.setCenterObject(model);
    }).catch(() => {});
  }

  // ── Full teardown ──────────────────────────────────────────────────────────

  dispose() {
    this._disposed = true;
    this._disposeSelectResources();

    if (this._onVisibilityChange) {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      this._onVisibilityChange = null;
    }

    if (this._playTimeout) { clearTimeout(this._playTimeout); this._playTimeout = null; }

    this._lyricGate?.dispose();
    this._lyricGate = null;

    // Dispose all preloaded players (including whichever one is currently in use).
    for (const pre of this._preloadedSongs ?? []) pre.player?.dispose();
    this._preloadedSongs = [];
    this.player = null;
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
