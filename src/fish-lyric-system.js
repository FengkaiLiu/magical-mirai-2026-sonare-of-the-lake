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
const PHRASE_LIFE    = 5.0; // seconds before a formation auto-fades
const SPAWN_DIST     = 7;   // distance from boat to formation center
const SPAWN_SIDE_OFF = 1.5; // slight lateral offset so text doesn't bisect the boat

export class FishLyricSystem {
  constructor(engine, boat) {
    this.engine      = engine;
    this.boat        = boat;
    this._formations = [];
    this._lastSlot   = 1; // start so first phrase spawns in slot 0 (front)
    engine.addUpdatable(this);
  }

  /** Called on each new lyric phrase from TextAlive onTimeUpdate */
  addPhrase(text) {
    if (!text) return;

    // Count only formations that are still visible (not already fading out)
    const active = this._formations.filter(f => f._fadeState !== "out");
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

    const center = new THREE.Vector3(
      boatPos.x + fx * SPAWN_DIST * sign + (-fz) * SPAWN_SIDE_OFF,
      0,
      boatPos.z + fz * SPAWN_DIST * sign + fx   * SPAWN_SIDE_OFF,
    );

    const color = 0x88eeff;
    const formation = new LyricFormation(this.engine, center, text, color);
    formation._age = 0; // tracked here for auto-expire
    this._formations.push(formation);
  }

  /** Fade out and discard all active formations immediately */
  clear() {
    for (const f of this._formations) f.startFade();
  }

  /** Trigger a color shift on all active formations (called by note collision) */
  triggerColorShift(hexColor, duration = 3.0) {
    for (const f of this._formations) f.triggerColorShift(hexColor, duration);
  }

  /** No-op — intensity handled internally by each formation */
  setChorusMode() {}

  update(dt, elapsed) {
    const boatPos = this.boat.getPosition();
    const boatVel = this.boat.body.velocity; // CANNON.Vec3 — live reference
    for (let i = this._formations.length - 1; i >= 0; i--) {
      const f = this._formations[i];
      // Auto-expire after PHRASE_LIFE seconds
      f._age += dt;
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
