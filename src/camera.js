/**
 * ==========================================
 * CameraController v9 — Unified smooth blend
 * ==========================================
 * v9 changes from v8:
 *   - Underwater camera Y follows boat.y (not hardcoded -0.5)
 *   - Transition smoothing boosted mid-dive (less sluggish)
 *   - Removed unused _diveLookTarget
 *   - Surface camera unchanged: fixed +Z god-mode view
 */

import * as THREE from "three";

const CAM_MAX_RADIUS = 55;

export class CameraController {
  constructor(engine) {
    this.camera = engine.camera;

    // Smoothing base (boosted during transitions)
    this.smoothingBase = 0.03;

    // State
    this.currentPos = new THREE.Vector3(0, 8, 10);
    this.currentLook = new THREE.Vector3(0, 0, 0);

    // Reusable
    this._surfPos = new THREE.Vector3();
    this._surfLook = new THREE.Vector3();
    this._uwPos = new THREE.Vector3();
    this._uwLook = new THREE.Vector3();
    this._goalPos = new THREE.Vector3();
    this._goalLook = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(0, 0, 0);

    this.targetPos = null;
    this._boatHeading = 0;
    this._smoothHeading = 0;
    this._diveBlend = 0;

    engine.addUpdatable(this);
  }

  setTarget(position, heading) {
    this.targetPos = position;
    this._boatHeading = heading ?? 0;
  }

  update(dt, elapsed) {
    if (!this.targetPos) return;
    const boat = this.targetPos;

    const t = this._diveBlend;
    const ease = t * t * (3 - 2 * t);

    // ─── Surface goal: fixed +Z behind, high above (god-mode) ───
    this._surfPos.set(boat.x, boat.y + 8, boat.z + 10);
    this._surfLook.set(boat.x, 0, boat.z - 2);

    // ─── Underwater goal: above+behind boat, looking at school center ───
    // Composition: boat at bottom of screen, lyrics at top
    {
      let headingDiff = this._boatHeading - this._smoothHeading;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      const headingAlpha = 1 - Math.pow(0.92, dt * 60);
      this._smoothHeading += headingDiff * headingAlpha;

      const behindX = Math.sin(this._smoothHeading);
      const behindZ = Math.cos(this._smoothHeading);

      // Camera: behind boat + above → boat appears at bottom of frame
      this._uwPos.set(
        boat.x + behindX * 8,
        boat.y + 4,           // 4 units above boat
        boat.z + behindZ * 8
      );

      // Clamp to map
      const r2 = this._uwPos.x * this._uwPos.x + this._uwPos.z * this._uwPos.z;
      if (r2 > CAM_MAX_RADIUS * CAM_MAX_RADIUS) {
        const s = CAM_MAX_RADIUS / Math.sqrt(r2);
        this._uwPos.x *= s;
        this._uwPos.z *= s;
      }

      // Look at school center → lyrics appear at top of frame
      this._uwLook.set(0, -5, 0);
    }

    // ─── Blend surface ↔ underwater ───
    this._goalPos.lerpVectors(this._surfPos, this._uwPos, ease);
    this._goalLook.lerpVectors(this._surfLook, this._uwLook, ease);

    // ─── Smoothing: boost during transition for snappier dive/surface ───
    const transitionUrgency = 1 - Math.abs(t * 2 - 1); // peaks at t=0.5
    const smoothing = this.smoothingBase + transitionUrgency * 0.06;
    const alpha = 1 - Math.pow(1 - smoothing, dt * 60);

    this.currentPos.lerp(this._goalPos, alpha);
    this.currentLook.lerp(this._goalLook, alpha);

    // ─── Apply + subtle sway ───
    this.camera.position.set(
      this.currentPos.x + Math.sin(elapsed * 0.08) * 0.04,
      this.currentPos.y + Math.sin(elapsed * 0.11) * 0.03,
      this.currentPos.z
    );

    this.camera.lookAt(this.currentLook);
  }
}