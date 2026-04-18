/**
 * ==========================================
 * CameraController — スムーズ俯瞰追従
 * ==========================================
 * 固定角度で船を追いかける。急に動かず、ゆったりlerp。
 */

import * as THREE from "three";

export class CameraController {
  constructor(engine) {
    this.engine = engine;
    this.camera = engine.camera;

    // カメラの設定 (Bruno風の近い追従)
    this.height = 8;      // 船からの高さ (was 14)
    this.distance = 10;   // 船からの後方距離 (was 16)
    this.lookAhead = 2;   // 注視点を船の前方にずらす量 (was 3)

    // スムーズ追従
    this.currentPos = new THREE.Vector3(0, this.height, this.distance);
    this.currentLook = new THREE.Vector3(0, 0, 0);
    this.smoothing    = 0.08;  // フレームレート非依存 (boat follow)
    this.skySmoothing = 0.025; // slow cinematic sweep into sky view
    this._boatRef = null;

    // ── Intro / Dive state ──────────────────────────────────────────
    // When isIntro=true the camera is locked overhead at (0,90,0) looking
    // straight down at the lake centre. Call startDive() to begin the
    // cinematic plunge to the boat-follow position.
    this.isIntro        = true;
    this._diveStarted   = false;
    this._diveTimer     = 0;
    this._diveDuration  = 3.5;   // seconds — long enough to feel dramatic
    this.onDiveComplete = null;  // optional callback
    this.revealLock          = false; // when true, camera holds position while boat enters
    this._revealTransition   = 0;    // counts up after revealLock releases to ease smoothing in
    this._revealTransDur     = 1.5;  // seconds to ramp smoothing from dive-speed to normal

    // Start right at the overhead position so there is no camera snap
    this.currentPos.set(0, 90, 0);
    this.currentLook.set(0, 0, 0);

    // 初期位置
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(0, 0, 0);
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();

    engine.addUpdatable(this);
  }

  /**
   * Begin the dramatic camera dive from overhead to boat-follow position.
   * The camera uses a boosted smoothing factor so it covers the distance in
   * roughly _diveDuration seconds.  FOV is stretched 50→75→60 for speed feel.
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

  setTarget(boatPosition) {
    this.targetPos = boatPosition;
  }

  setSkyMode(enable) {
    this.skyMode = enable;
  }

  setSkyLyric(mesh) {
    this.skyLyricMesh = mesh;
  }

  update(dt, elapsed) {
    // ── State 1: Intro — camera locked overhead ────────────────────
    if (this.isIntro) {
      const alpha = 1 - Math.pow(1 - 0.06, dt * 60);
      this.currentPos.lerp(new THREE.Vector3(0, 90, 0), alpha);
      this.currentLook.lerp(new THREE.Vector3(0, 0, 0), alpha);
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);
      return;
    }

    // ── State 2: Dive — lerp toward fixed boat-at-origin position ──
    // Target is fixed (origin follow pos), NOT the moving boat, so there
    // is no jitter from boat physics influencing the dive trajectory.
    if (this._diveStarted) {
      this._diveTimer += dt;
      const t = Math.min(1, this._diveTimer / this._diveDuration);

      // FOV arc: 50 → 75 (widening rush) → 60 (narrowing brake)
      const fovBase = 50, fovPeak = 75, fovLand = 60;
      this.camera.fov = t < 0.5
        ? fovBase + (fovPeak - fovBase) * (t * 2)
        : fovPeak + (fovLand - fovPeak) * ((t - 0.5) * 2);
      this.camera.updateProjectionMatrix();

      // Fixed landing target: where the camera sits when boat is at origin
      const diveGoalPos  = new THREE.Vector3(0, this.height, this.distance);
      const diveGoalLook = new THREE.Vector3(0, 0, -this.lookAhead);
      const alpha = 1 - Math.pow(1 - 0.02, dt * 60);
      this.currentPos.lerp(diveGoalPos, alpha);
      this.currentLook.lerp(diveGoalLook, alpha);

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

    let goalLook;
    if (this.skyMode) {
      goalLook = new THREE.Vector3(
        this.targetPos.x,
        15,
        this.targetPos.z - 40
      );
    } else {
      goalLook = new THREE.Vector3(
        this.targetPos.x,
        0,
        this.targetPos.z - this.lookAhead
      );
    }

    const goalPos = new THREE.Vector3(
      this.targetPos.x,
      this.targetPos.y + (this.skyMode ? 2.5 : this.height),
      this.targetPos.z + (this.skyMode ? 12 : this.distance)
    );

    const baseSmooth = this.skyMode ? this.skySmoothing : this.smoothing;
    const smooth = 0.02 + (baseSmooth - 0.02) * easedT;
    const alpha = 1 - Math.pow(1 - smooth, dt * 60);
    this.currentPos.lerp(goalPos, alpha);
    this.currentLook.lerp(goalLook, alpha);

    // 微揺れ
    this.camera.position.set(
      this.currentPos.x + Math.sin(elapsed * 0.08) * 0.04,
      this.currentPos.y + Math.sin(elapsed * 0.11) * 0.03,
      this.currentPos.z
    );

    this.camera.lookAt(this.currentLook);
  }

  dispose() {
    this.engine.removeUpdatable(this);
    this.engine = null;
  }
}
