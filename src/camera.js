/**
 * ==========================================
 * CameraController v8 — Unified smooth blend
 * ==========================================
 * ONE camera system. No mode switching.
 * 
 * Every frame computes a surface goal and an underwater goal,
 * then blends them with the same easing curve.
 * Both goals are in world-space XYZ (not polar).
 * The currentPos/currentLook lerps toward the blended goal.
 * 
 * This means the camera path between surface and underwater
 * is always a smooth curve — no jumps, no clamps, no seams.
 * 
 * Underwater goal uses over-the-shoulder:
 *   school_center → boat → camera (all in a line)
 * Camera Y for underwater is set to boat.y + small offset,
 * which naturally goes below water as the boat sinks.
 */

import * as THREE from "three";

const CAM_MAX_RADIUS = 55;

export class CameraController {
  constructor(engine) {
    this.camera = engine.camera;

    // Smoothing — one speed for everything
    this.smoothing = 0.03;

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
    this._diveBlend = 0;
    this._diveLookTarget = null;

    engine.addUpdatable(this);
  }

  setTarget(position) {
    this.targetPos = position;
  }

  update(dt, elapsed) {
    if (!this.targetPos) return;
    const boat = this.targetPos;

    const t = this._diveBlend;
    const ease = t * t * (3 - 2 * t);

    // ─── Surface goal: fixed +Z behind, high above ───
    this._surfPos.set(boat.x, boat.y + 8, boat.z + 10);
    this._surfLook.set(boat.x, 0, boat.z - 2);

    // ─── Underwater goal: over-the-shoulder ───
    if (this._diveLookTarget) {
      const sc = this._diveLookTarget;

      // Direction from school center to boat on XZ
      this._dir.set(boat.x - sc.x, 0, boat.z - sc.z);
      const len = this._dir.length();
      if (len > 0.1) {
        this._dir.divideScalar(len);
      } else {
        this._dir.set(0, 0, 1); // fallback
      }

      // Camera behind boat along school→boat line
      this._uwPos.set(
        boat.x + this._dir.x * 12,
        boat.y + 2,               // slightly above boat, goes underwater with boat
        boat.z + this._dir.z * 12
      );

      // Clamp camera XZ to map radius
      const r2 = this._uwPos.x * this._uwPos.x + this._uwPos.z * this._uwPos.z;
      if (r2 > CAM_MAX_RADIUS * CAM_MAX_RADIUS) {
        const s = CAM_MAX_RADIUS / Math.sqrt(r2);
        this._uwPos.x *= s;
        this._uwPos.z *= s;
      }

      // LookAt: toward school center, slightly above
      this._uwLook.set(
        THREE.MathUtils.lerp(boat.x, sc.x, 0.65),
        sc.y + 1.5,
        THREE.MathUtils.lerp(boat.z, sc.z, 0.65)
      );
    } else {
      this._uwPos.copy(this._surfPos);
      this._uwLook.copy(this._surfLook);
    }

    // ─── Blend surface ↔ underwater ───
    this._goalPos.lerpVectors(this._surfPos, this._uwPos, ease);
    this._goalLook.lerpVectors(this._surfLook, this._uwLook, ease);

    // ─── Single smooth lerp toward goal ───
    const alpha = 1 - Math.pow(1 - this.smoothing, dt * 60);
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