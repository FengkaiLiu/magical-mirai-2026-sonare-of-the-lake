/**
 * FishLyricSystem — manages up to MAX_PHRASES LyricFormation instances.
 *
 * Each lyric phrase spawns a new formation on the water surface near the boat.
 * When a 4th phrase arrives the oldest starts fading out.
 * Faded formations are disposed automatically.
 */

import * as THREE from "three";
import { LyricFormation } from "./fish-school.js";

const MAX_PHRASES    = 1;   // only one phrase visible at a time — prevents overlap
const PHRASE_LIFE    = 8.0; // seconds of display time after the formation is fully gathered
const SPAWN_DIST     = 7;   // distance from boat to formation center
const SPAWN_SIDE_OFF = 1.5; // slight lateral offset so text doesn't bisect the boat

// Boat play area is ±40 (boat.js). Text is always axis-aligned in world space:
// TEXT_WIDTH=24 → ±12 along global X; FORM_Y_RANGE=3.5 → ±1.75 along global Z.
// Add a 1-unit margin so the outermost particles stay inside the play area.
const PLAY_HALF   = 48;
const TEXT_CLAMP_X = PLAY_HALF - 13; // 35
const TEXT_CLAMP_Z = PLAY_HALF - 3;  // 45

// Single source of truth for the LyricFormation options used by addPhrase().
// prewarmPhrase() must pass the SAME values, otherwise sampleTextPoints()
// computes a different cache key for the prewarm call than for the runtime
// call, the cache misses on first phrase render, and getImageData stalls the
// frame (~5–15 ms) — visible as a small camera jitter every new lyric.
const FORMATION_OPTS = Object.freeze({
  particleCount: 2400,
  sizeBase:   0.1,
  sizeRange:  0.07,
  glowMin:    1.8,
  glowMax:    4.0,
  outlineOnly: false,
  fontFamily: '"KiwiMaru",sans-serif',
  fontWeight: "400",
});

export class FishLyricSystem {
  /**
   * Prime the text-sampling cache for a phrase so the first runtime addPhrase
   * doesn't pay the getImageData cost.  Call from idle preload time.
   */
  static prewarmPhrase(text) {
    LyricFormation.prewarmPhrase(text, FORMATION_OPTS);
  }

  constructor(engine, boat) {
    this.engine      = engine;
    this.boat        = boat;
    this._formations = [];
    this._lastSlot   = 1; // start so first phrase spawns in slot 0 (front)
    this._activeColor = 0x88eeff;
    engine.addUpdatable(this);
  }

  /** Called on each new lyric phrase from TextAlive onTimeUpdate */
  addPhrase(text) {
    if (!text) return;

    // Count only formations that are still visible (not already fading out)
    const active = this._formations.filter(f => f._fadeState !== "out");

    // Prevent double-render: skip if the most recent active formation already shows this text.
    // This catches timer quirks where the same phrase fires more than once.
    if (active.length > 0 && active[active.length - 1]._phraseText === text) return;

    // Evict oldest active ones until we're under cap
    while (active.length >= MAX_PHRASES) {
      active.shift().startFade();
    }

    // Alternate front/back relative to boat heading so phrases never overlap
    const boatPos  = this.boat.getPosition();
    const boatBody = this.boat.body;

    // Derive forward vector from physics body quaternion
    const q = boatBody.quaternion;
    // Cannon-es: forward is -Z in local space
    const fwdX = -2 * (q.x * q.z + q.w * q.y);
    const fwdZ = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const len  = Math.sqrt(fwdX * fwdX + fwdZ * fwdZ) || 1;
    const fx   = fwdX / len;
    const fz   = fwdZ / len;

    // Slot 0 = front, slot 1 = back; pick opposite of last used
    this._lastSlot = (this._lastSlot === 0) ? 1 : 0;
    const sign = this._lastSlot === 0 ? 1 : -1;

    const cx = boatPos.x + fx * SPAWN_DIST * sign + (-fz) * SPAWN_SIDE_OFF;
    const cz = boatPos.z + fz * SPAWN_DIST * sign + fx   * SPAWN_SIDE_OFF;
    const center = new THREE.Vector3(
      Math.max(-TEXT_CLAMP_X, Math.min(TEXT_CLAMP_X, cx)),
      0,
      Math.max(-TEXT_CLAMP_Z, Math.min(TEXT_CLAMP_Z, cz)),
    );

    const color = this._activeColor;
    const formation = new LyricFormation(this.engine, center, text, color, FORMATION_OPTS);
    formation._age        = 0;    // tracked here for auto-expire
    formation._phraseText = text; // used by duplicate-guard above
    this._formations.push(formation);
  }

  /** Immediately remove all active formations (used on visibility restore). */
  clear() {
    for (const f of this._formations) f.dispose();
    this._formations = [];
  }

  /** Trigger a color shift on all active formations and persist for future phrases */
  triggerColorShift(hexColor, duration = 3.0) {
    this._activeColor = hexColor;
    for (const f of this._formations) f.triggerColorShift(hexColor, duration);
  }

  update(dt, elapsed) {
    const boatPos = this.boat.getPosition();
    const boatVel = this.boat.body.velocity; // CANNON.Vec3 — live reference
    for (let i = this._formations.length - 1; i >= 0; i--) {
      const f = this._formations[i];
      // Only count display age after targets are assigned (2 deferred frames in LyricFormation).
      // This prevents the gather animation from consuming the display window.
      if (!f._pendingPhrase && !f._pendingAssign) f._age += dt;
      if (f._age >= PHRASE_LIFE && f._fadeState !== "out") f.startFade();
      f.update(dt, elapsed, boatPos, boatVel);
      if (f.faded) {
        f.dispose();
        this._formations.splice(i, 1);
      }
    }
  }

  dispose() {
    this.engine.removeUpdatable(this);
    for (const f of this._formations) f.dispose();
    this._formations = [];
  }
}
