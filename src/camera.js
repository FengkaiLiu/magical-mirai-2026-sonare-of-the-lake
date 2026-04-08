/**
 * ==========================================
 * CameraController — Bruno風 固定角度追従 v3
 * ==========================================
 * Reverted from heading-follow to fixed-angle.
 * Reason: rotating camera causes motion sickness for some users.
 * Bruno Simon style: camera always behind at fixed angle,
 * boat stays centered, smooth lerp follow.
 */

import * as THREE from "three";

export class CameraController {
  constructor(engine) {
    this.camera = engine.camera;

    // Camera offset (fixed world-space direction, not boat-relative)
    this.height = 8;
    this.distance = 10;
    this.lookAhead = 2;

    // Smoothing (frame-rate independent)
    this.posSmoothing = 0.08;
    this.lookSmoothing = 0.12;

    // State
    this.currentPos = new THREE.Vector3(0, this.height, this.distance);
    this.currentLook = new THREE.Vector3(0, 0, 0);

    // Reusable
    this._goalPos = new THREE.Vector3();
    this._goalLook = new THREE.Vector3();

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(0, 0, 0);

    this.targetPos = null;

    engine.addUpdatable(this);
  }

  /**
   * @param {THREE.Vector3} position - boat world position
   * @param {number} [heading] - ignored in fixed-angle mode
   */
  setTarget(position, heading) {
    this.targetPos = position;
  }

  update(dt, elapsed) {
    if (!this.targetPos) return;

    // Fixed direction: always behind in +Z, above by height
    this._goalPos.set(
      this.targetPos.x,
      this.targetPos.y + this.height,
      this.targetPos.z + this.distance
    );

    this._goalLook.set(
      this.targetPos.x,
      0,
      this.targetPos.z - this.lookAhead
    );

    // Frame-rate independent lerp
    const posAlpha = 1 - Math.pow(1 - this.posSmoothing, dt * 60);
    const lookAlpha = 1 - Math.pow(1 - this.lookSmoothing, dt * 60);

    this.currentPos.lerp(this._goalPos, posAlpha);
    this.currentLook.lerp(this._goalLook, lookAlpha);

    // Apply + subtle sway
    this.camera.position.set(
      this.currentPos.x + Math.sin(elapsed * 0.08) * 0.04,
      this.currentPos.y + Math.sin(elapsed * 0.11) * 0.03,
      this.currentPos.z
    );

    this.camera.lookAt(this.currentLook);
  }
}