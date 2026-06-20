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
import { t, getLang, getBoat, onLangChange } from "./i18n.js";
import { sfxStop, sfxResume } from "./sfx.js";

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

    // One-time seek handler on the progress bar (safe to add once — checks
    // state at call time). The state guard prevents a stray click during
    // ending/select from jumping playback on a player that's no longer current.
    document.getElementById("song-progress-wrap")?.addEventListener("click", (e) => {
      if (this._state !== "play" || !this.player?.video) return;
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

    // Refresh HUD strings whose text was committed when play started (song
    // title + controls hint) so a language switch during gameplay re-localises.
    this._currentSong = null;
    this._unsubLang   = onLangChange(() => this._refreshHudLocale());

    this._updatable = { update: (dt, el) => this._update(dt, el) };
    engine.addUpdatable(this._updatable);
  }

  _refreshHudLocale() {
    const song = this._currentSong;
    if (song) {
      const songInfo = document.getElementById("song-info");
      if (songInfo) {
        const displayTitle = getLang() === "en" ? (song.titleEn ?? song.title) : song.title;
        songInfo.textContent = `${displayTitle} / ${song.artist}`;
      }
    }
    const controlsHint = document.getElementById("controls-hint");
    if (controlsHint) controlsHint.textContent = t("controlsHint");
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
      // Surface TextAlive failures (bad URL, dropped session, API limit) so
      // they don't silently strand the player without timer-ready.
      onError: (e) => console.error("[TextAlive preload]", song.title, e),
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
    sfxStop();
    this._activeSongIndex        = songIndex;
    this._endingTriggered        = false;
    this._lastPhraseForGate      = null;
    this._playerRebuildAttempted = false;
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

    // Preload didn't reach timer-ready — rebuild. We used to require both
    // !timerReady and !video, but a common stall is "video metadata arrived,
    // audio is still buffering forever" — onTimerReady then never fires and the
    // player is silently dead. Better to throw away partial progress and start
    // clean; the user has already chosen to wait via the overlay.
    if (pre.player && !pre.timerReady) {
      console.warn("[GameScene] Preload not timer-ready at click — restarting player for:", song.title);
      try { pre.player.dispose(); } catch {}
      // Audio cache fields must be cleared in lockstep with audioEl — the cached
      // MediaElementSource is bound to the discarded element, and leaving it in
      // place would make _setupAudioPipeline take the cache-hit branch and wire
      // the analyser to the dead audioEl.
      try { pre.audioContext?.close(); } catch {}
      pre.audioContext     = null;
      pre.analyser         = null;
      pre.audioData        = null;
      pre.mediaSource      = null;
      pre.player           = null;
      pre.audioEl          = null;
      pre.timerReady       = false;
      pre.video            = null;
      pre.managed          = false;
      pre._timerCounted    = false;
      pre.playbackListener = null;
      // _prewarmCounted intentionally left as-is — see _rebuildAndRetryPlayback.
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
    // Remember the active song so _refreshHudLocale can re-render the title
    // strip if the player switches language during play.
    this._currentSong = song;
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
    // createMediaElementSource can only wrap a given <audio> element ONCE for its
    // lifetime, even after the AudioContext that created it is closed. So we
    // cache the context + analyser + source on the preload entry the first time
    // and reuse them on every replay — _resetToSelect suspends instead of closing.
    try {
      if (pre.mediaSource && pre.audioContext) {
        this.audioContext = pre.audioContext;
        this.analyser     = pre.analyser;
        this.audioData    = pre.audioData;
        this.audioContext.resume().catch(() => {});
        this.env.setAudioAnalyser(this.analyser, this.audioData);
        return;
      }
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume().catch(() => {});
      const analyser  = ctx.createAnalyser();
      analyser.fftSize = 256;
      const audioData = new Uint8Array(analyser.frequencyBinCount);
      const source    = ctx.createMediaElementSource(pre.audioEl);
      source.connect(analyser);
      analyser.connect(ctx.destination);

      pre.audioContext = ctx;
      pre.analyser     = analyser;
      pre.audioData    = audioData;
      pre.mediaSource  = source;

      this.audioContext = ctx;
      this.analyser     = analyser;
      this.audioData    = audioData;
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
    // If a previous play session already attached a playback listener (we don't
    // dispose pre.player on return-to-select), detach it first — otherwise the
    // new one stacks and onTimeUpdate / addPhrase fire N× per tick on every
    // replay of the same song.
    if (pre.playbackListener) {
      this.player.removeListener?.(pre.playbackListener);
      pre.playbackListener = null;
    }
    pre.playbackListener = {
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
      onError: (e) => console.error("[TextAlive playback]", song.title, e),
    };
    this.player.addListener(pre.playbackListener);
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

    // Detect song end: trigger ending sequence ~800 ms before song finishes.
    // The pos > 5000 floor guards against TextAlive sometimes reporting
    // duration=0 then a tiny value, or against a seek bringing pos into the
    // end-window during the opening; either would prematurely fire ending.
    if (!this._endingTriggered) {
      if (dur && pos > 5000 && pos >= dur - 800) {
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
   * If onPlay hasn't fired within 8 s, recover based on what's actually wrong:
   *   • Timer never became ready  → rebuild the player from scratch (the most
   *     common stall: audio element silently failed to buffer). One rebuild
   *     attempt only, gated by _playerRebuildAttempted, then a second watchdog
   *     covers the rebuild.
   *   • Timer ready but onPlay missed → AudioContext probably suspended; resume
   *     it and retry requestPlay. Then drop the overlay.
   */
  _setupPlaybackFallback() {
    this._playTimeout = setTimeout(() => {
      if (this._disposed || this._state !== "play" || this._playbackStarted) return;

      const pre = this._preloadedSongs[this._activeSongIndex];
      this.audioContext?.resume().catch(() => {});

      if (!pre?.timerReady && !this._playerRebuildAttempted) {
        console.warn("[GameScene] Player never reached timer-ready — rebuilding");
        this._playerRebuildAttempted = true;
        this._rebuildAndRetryPlayback();
        // Cover the rebuild with a fresh watchdog. Overlay stays up until onPlay.
        this._setupPlaybackFallback();
        return;
      }

      // Timer is ready (or we already retried once) — nudge play and give up
      // hiding behind the overlay so the user isn't stuck.
      if (!this._managed) {
        try { this.player?.requestPlay(); } catch {}
      }
      document.getElementById("overlay")?.classList.add("hidden");
    }, 8000);
  }

  /**
   * Tear down the dead player + audio pipeline for the active song and start a
   * fresh preload. The new onTimerReady (attached via _attachPlaybackListeners)
   * will kick off playback automatically — we don't call requestPlay here
   * because timer is by definition not ready yet.
   */
  _rebuildAndRetryPlayback() {
    const songIndex = this._activeSongIndex;
    if (songIndex < 0) return;
    const song = SONGS[songIndex];
    const pre  = this._preloadedSongs[songIndex];
    if (!pre) return;

    // The cached MediaElementSource is bound to the dead audioEl via
    // pre.mediaSource; close the cached AudioContext + clear all audio fields on
    // pre so _setupAudioPipeline rebuilds a fresh pipeline against the new audioEl.
    try { pre.audioContext?.close(); } catch {}
    pre.audioContext = null;
    pre.analyser     = null;
    pre.audioData    = null;
    pre.mediaSource  = null;
    this.audioContext = null;
    this.analyser     = null;
    this.audioData    = null;
    this.env.setAudioAnalyser(null, null);

    try { pre.player?.dispose(); } catch {}
    pre.player           = null;
    pre.audioEl          = null;
    pre.video            = null;
    pre.timerReady       = false;
    pre.managed          = false;
    pre._timerCounted    = false;
    // Keep _prewarmCounted as-is: prewarm fired on the original onVideoReady
    // and already incremented the loading-bar counter. Resetting would let the
    // rebuild's onVideoReady increment a second time and push it past 100%.
    pre.preloadListener  = null;
    pre.playbackListener = null;

    this._startPreload(song, pre);

    this.player           = pre.player;
    this._managed         = pre.managed;
    this._playbackStarted = false;
    this._setupAudioPipeline(pre);
    this._attachPlaybackListeners(song, pre);
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
    // Suspend (don't close) the AudioContext: the MediaElementSource is bound to
    // it for the lifetime of pre.audioEl, and closing would force us to wrap the
    // element again on replay — which throws. _setupAudioPipeline resumes it next
    // time the same song is selected.
    this.audioContext?.suspend().catch(() => {});
    this.audioContext = null;
    this.analyser     = null;
    this.audioData    = null;
    this.env.setAudioAnalyser(null, null);

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
    sfxResume();
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
      // owned=true: gear is built locally, so UtilityCircle.dispose() should
      // release its geometries + material. Boat clones (below + in
      // updateBoatCircleModel) keep the default owned=false because they share
      // material refs with the GLTF asset cache.
      this._settingsCircle.setCenterObject(gear, true);
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

    if (this._unsubLang)   { this._unsubLang();   this._unsubLang   = null; }

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
