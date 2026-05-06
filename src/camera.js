/**
 * ==========================================
 * CameraController — Smooth elevated chase camera
 * ==========================================
 * Follows the boat from a fixed offset, lerping each frame for a soft cinematic feel.
 */

import * as THREE from "three";

export class CameraController {
  constructor(engine, { skipIntro = false } = {}) {
    this.engine = engine;
    this.camera = engine.camera;

    // Camera placement (Bruno-style close follow)
    this.height = 8;      // height above the boat (was 14)
    this.distance = 10;   // distance behind the boat (was 16)
    this.lookAhead = 2;   // forward offset of the look-at point (was 3)

    // Smooth follow
    this.currentPos = new THREE.Vector3(0, this.height, this.distance);
    this.currentLook = new THREE.Vector3(0, 0, 0);
    this.smoothing    = 0.08;  // frame-rate independent (boat follow)
    this.skySmoothing = 0.025; // slow cinematic sweep into sky view
    this._boatRef = null;

    // ── Intro / Dive state ──────────────────────────────────────────
    // When isIntro=true the camera is locked overhead at (0,90,0) looking
    // straight down at the lake centre. Call startDive() to begin the
    // cinematic plunge to the boat-follow position.
    this.isIntro        = !skipIntro;
    this._diveStarted   = false;
    this._diveTimer     = 0;
    this._diveDuration  = 4.5;   // seconds — slower fall reads as graceful, not abrupt
    this.onDiveComplete = null;  // optional callback
    this.revealLock          = false; // when true, camera holds position while boat enters
    this._revealTransition   = 0;    // counts up after revealLock releases to ease smoothing in
    this._revealTransDur     = 1.5;  // seconds to ramp smoothing from dive-speed to normal
    this.gsapOverride        = false; // when true, GSAP owns the camera — skip all controller updates

    // Pre-allocated scratch vectors — reused each frame to avoid per-call heap allocation
    this._goalPos      = new THREE.Vector3();
    this._goalLook     = new THREE.Vector3();
    this._diveGoalPos  = new THREE.Vector3();
    this._diveGoalLook = new THREE.Vector3();
    this._introLockPos = new THREE.Vector3(0, 90, 0);
    this._zeroVec      = new THREE.Vector3(0, 0, 0);

    // Single-segment dive — quadratic bezier carves a slide-shape from
    // the overhead pose down to the boat-follow pose. The control point
    // sits at the "knee" of the slide (already low, not yet pushed forward),
    // so the path drops near-vertically at first then curves out horizontal.
    // Combined with easeInOutCubic on time, this gives accel-down → decel-out,
    // and the pitch tilt-up at the end emerges geometrically (no second curve
    // needed) as the camera slips under the lookAt point.
    this._divePosP0 = new THREE.Vector3(0, 90, 0);
    this._divePosP1 = new THREE.Vector3(0,  8, 0);
    this._divePosP2 = new THREE.Vector3(0, this.height, this.distance);
    this._diveLookP0 = new THREE.Vector3(0, 0, 0);
    this._diveLookP1 = new THREE.Vector3(0, 0, -this.lookAhead);

    // Start at the appropriate position — overhead for intro, boat-follow for direct play
    if (skipIntro) {
      this.currentPos.set(0, this.height, this.distance);
      this.currentLook.set(0, 0, -this.lookAhead);
      this._revealTransition = this._revealTransDur; // skip ramp-up too
    } else {
      this.currentPos.set(0, 90, 0);
      this.currentLook.set(0, 0, 0);
    }

    // Initial pose
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();

    engine.addUpdatable(this);
  }

  /**
   * Begin the cinematic camera dive from overhead to boat-follow position.
   * The trajectory is a single quadratic bezier (slide-shaped path) sampled
   * with linear time, so the camera starts moving immediately and decelerates
   * naturally as the curve flattens out. FOV lerps 50→60 throughout.
   */
  startDive() {
    if (!this.isIntro) return;
    this.isIntro      = false;
    this._diveStarted = true;
    this._diveTimer   = 0;
  }

  attachBoat(boat) {
    this._boatRef = boat;
  }

  setSkyMode(enable) {
    this.skyMode = enable;
  }

  update(dt, elapsed) {
    if (this.gsapOverride) return; // GSAP owns camera position during song-select transition

    // ── State 1: Intro — camera locked overhead ────────────────────
    if (this.isIntro) {
      const alpha = 1 - Math.pow(1 - 0.06, dt * 60);
      this.currentPos.lerp(this._introLockPos, alpha);
      this.currentLook.lerp(this._zeroVec, alpha);
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);
      return;
    }

    // ── State 2: Dive — single smooth slide-shaped curve ─────────
    // Time is linear: the bezier's own geometry decelerates the camera as
    // it curves into the horizontal exit, so an extra easeInOut would only
    // reintroduce the wind-up dwell at the top. Result: motion starts
    // immediately at the press, falls fastest near the top, and settles
    // gently as it slips under the lookAt point.
    if (this._diveStarted) {
      this._diveTimer += dt;
      const t = Math.min(1, this._diveTimer / this._diveDuration);

      this._sampleDive(t, this._diveGoalPos, this._diveGoalLook);
      this.currentPos.copy(this._diveGoalPos);
      this.currentLook.copy(this._diveGoalLook);

      // FOV: plain lerp from intro (50) to follow (60) — no mid-flight
      // widening, since the bezier's own speed feel carries the dive.
      const fovBase = 50, fovLand = 60;
      this.camera.fov = fovBase + (fovLand - fovBase) * t;
      this.camera.updateProjectionMatrix();

      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);

      if (t >= 1) {
        this._diveStarted = false;
        this.camera.fov = fovLand;
        this.camera.updateProjectionMatrix();
        if (this.onDiveComplete) {
          this.onDiveComplete();
          this.onDiveComplete = null;
        }
      }
      return;
    }

    // ── State 3: Reveal lock — camera frozen, boat sails into frame ─
    // Song-select sets this while the boat entrance animation plays.
    // It is cleared externally (cam.revealLock = false) once the boat
    // has reached the center.
    if (this.revealLock) {
      this._revealTransition = 0; // reset while locked
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);
      return;
    }

    // ── State 4: Normal boat follow ────────────────────────────────
    if (this._boatRef) this.targetPos = this._boatRef.getPosition();
    if (!this.targetPos) return;

    // Ramp smoothing up from dive-speed (0.02) to normal (this.smoothing)
    // over _revealTransDur seconds to avoid a snap when revealLock first releases
    this._revealTransition = Math.min(this._revealTransDur,
                                      this._revealTransition + dt);
    const t = this._revealTransition / this._revealTransDur;
    const easedT = t * t * (3 - 2 * t); // smoothstep

    if (this.skyMode) {
      this._goalLook.set(this.targetPos.x, 15, this.targetPos.z - 40);
    } else {
      this._goalLook.set(this.targetPos.x, 0, this.targetPos.z - this.lookAhead);
    }
    this._goalPos.set(
      this.targetPos.x,
      this.targetPos.y + (this.skyMode ? 2.5 : this.height),
      this.targetPos.z + (this.skyMode ? 12 : this.distance)
    );

    const baseSmooth = this.skyMode ? this.skySmoothing : this.smoothing;
    const smooth = 0.02 + (baseSmooth - 0.02) * easedT;
    const alpha = 1 - Math.pow(1 - smooth, dt * 60);
    this.currentPos.lerp(this._goalPos, alpha);
    this.currentLook.lerp(this._goalLook, alpha);

    // Subtle camera bob
    this.camera.position.set(
      this.currentPos.x + Math.sin(elapsed * 0.08) * 0.04,
      this.currentPos.y + Math.sin(elapsed * 0.11) * 0.03,
      this.currentPos.z
    );

    this.camera.lookAt(this.currentLook);
  }

  _sampleDive(t01, outPos, outLook) {
    const e = Math.max(0, Math.min(1, t01)); // linear — bezier shape provides decel
    const u = 1 - e;
    const w0 = u * u, w1 = 2 * u * e, w2 = e * e;
    const p0 = this._divePosP0, p1 = this._divePosP1, p2 = this._divePosP2;
    outPos.set(
      w0 * p0.x + w1 * p1.x + w2 * p2.x,
      w0 * p0.y + w1 * p1.y + w2 * p2.y,
      w0 * p0.z + w1 * p1.z + w2 * p2.z,
    );
    outLook.copy(this._diveLookP0).lerp(this._diveLookP1, e);
  }

  dispose() {
    this.engine.removeUpdatable(this);
    this.engine = null;
  }
}
