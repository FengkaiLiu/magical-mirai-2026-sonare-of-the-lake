/**
 * ==========================================
 * CameraController — スムーズ追従カメラ
 * ==========================================
 * v2 — Actually smooth + follows boat heading
 *
 * Changes:
 *   - smoothing lowered to 0.08 (was 1.0 = no smoothing)
 *   - Camera offset rotates with boat heading (always behind the boat)
 *   - Separate position/look smoothing speeds for cinematic feel
 *   - Reusable Vector3 to avoid GC
 */

import * as THREE from "three";

export class CameraController {
  constructor(engine) {
    this.camera = engine.camera;

    // Camera offset from boat (in boat's local space)
    this.height = 8;       // above boat
    this.distance = 10;    // behind boat
    this.lookAhead = 3;    // look target ahead of boat

    // Smoothing: lower = more cinematic lag (frame-rate independent)
    this.posSmoothing = 0.06;   // camera position follows slowly
    this.lookSmoothing = 0.10;  // look target follows a bit faster
    this.headingSmoothing = 0.04; // heading angle follows slowest (prevents jitter on quick turns)

    // State
    this.currentPos = new THREE.Vector3(0, this.height, this.distance);
    this.currentLook = new THREE.Vector3(0, 0, 0);
    this.currentHeading = 0; // smoothed Y rotation angle in radians

    // Reusable
    this._goalPos = new THREE.Vector3();
    this._goalLook = new THREE.Vector3();

    // Initial position
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(0, 0, 0);

    // Target reference (set externally)
    this.targetPos = null;
    this.targetHeading = 0; // radians, Y-axis rotation

    engine.addUpdatable(this);
  }

  /**
   * Call each frame with boat position and heading.
   * @param {THREE.Vector3} position - boat world position
   * @param {number} heading - boat Y rotation in radians
   */
  setTarget(position, heading) {
    this.targetPos = position;
    this.targetHeading = heading ?? 0;
  }

  update(dt, elapsed) {
    if (!this.targetPos) return;

    // ─── Smooth heading (prevents camera whip on quick turns) ───
    // Handle angle wrapping for smooth interpolation
    let headingDiff = this.targetHeading - this.currentHeading;
    // Wrap to [-PI, PI]
    while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
    while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;

    const headingAlpha = 1 - Math.pow(1 - this.headingSmoothing, dt * 60);
    this.currentHeading += headingDiff * headingAlpha;

    // ─── Goal camera position: behind + above boat, rotated by heading ───
    const sinH = Math.sin(this.currentHeading);
    const cosH = Math.cos(this.currentHeading);

    // "Behind" in boat local space = +Z after rotation
    this._goalPos.set(
      this.targetPos.x + sinH * this.distance,
      this.targetPos.y + this.height,
      this.targetPos.z + cosH * this.distance
    );

    // ─── Goal look-at: ahead of boat ───
    this._goalLook.set(
      this.targetPos.x - sinH * this.lookAhead,
      0,
      this.targetPos.z - cosH * this.lookAhead
    );

    // ─── Frame-rate independent lerp ───
    const posAlpha = 1 - Math.pow(1 - this.posSmoothing, dt * 60);
    const lookAlpha = 1 - Math.pow(1 - this.lookSmoothing, dt * 60);

    this.currentPos.lerp(this._goalPos, posAlpha);
    this.currentLook.lerp(this._goalLook, lookAlpha);

    // ─── Apply + subtle sway ───
    this.camera.position.set(
      this.currentPos.x + Math.sin(elapsed * 0.08) * 0.04,
      this.currentPos.y + Math.sin(elapsed * 0.11) * 0.03,
      this.currentPos.z
    );

    this.camera.lookAt(this.currentLook);
  }
}