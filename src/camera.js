/**
 * ==========================================
 * CameraController
 * ==========================================
 */

import * as THREE from "three";

const CAM_MAX_RADIUS = 55;

export class CameraController {
  constructor(engine) {
    this.camera = engine.camera;
    this.smoothingBase = 0.03;

    this.currentPos = new THREE.Vector3(0, 8, 10);
    this.currentLook = new THREE.Vector3(0, 0, 0);

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
    this.skyMode = false; // Added state for sky view

    engine.addUpdatable(this);
  }

  setTarget(position, heading) {
    this.targetPos = position;
    this._boatHeading = heading ?? 0;
  }
  
  setSkyMode(active) {
    this.skyMode = active;
  }

  update(dt, elapsed) {
    if (!this.targetPos) return;
    const boat = this.targetPos;

    // ─── Surface goal ───
    this._surfPos.set(boat.x, boat.y + 8, boat.z + 10);
    this._surfLook.set(boat.x, 0, boat.z - 2);

    // ─── Sky View goal ───
    let headingDiff = this._boatHeading - this._smoothHeading;
    while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
    while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
    const headingAlpha = 1 - Math.pow(0.92, dt * 60);
    this._smoothHeading += headingDiff * headingAlpha;

    const behindX = Math.sin(this._smoothHeading);
    const behindZ = Math.cos(this._smoothHeading);

    // Camera down near the water, looking up at the sky
    this._uwPos.set(
      boat.x,
      boat.y + 0.5, 
      boat.z + 6    
    );

    const r2 = this._uwPos.x * this._uwPos.x + this._uwPos.z * this._uwPos.z;
    if (r2 > CAM_MAX_RADIUS * CAM_MAX_RADIUS) {
      const s = CAM_MAX_RADIUS / Math.sqrt(r2);
      this._uwPos.x *= s;
      this._uwPos.z *= s;
    }

    this._uwLook.set(boat.x, boat.y + 25, boat.z - 30); 

    // ─── Transition Blend ───
    const targetBlend = this.skyMode ? 1 : 0;
    const dir = targetBlend > this._diveBlend ? 1 : -1;
    if (this._diveBlend !== targetBlend) {
        this._diveBlend = Math.max(0, Math.min(1, this._diveBlend + dir * dt * 2.0));
    }
    
    const t = this._diveBlend;
    const ease = t * t * (3 - 2 * t);

    this._goalPos.lerpVectors(this._surfPos, this._uwPos, ease);
    this._goalLook.lerpVectors(this._surfLook, this._uwLook, ease);

    const transitionUrgency = 1 - Math.abs(t * 2 - 1); 
    const smoothing = this.smoothingBase + transitionUrgency * 0.06;
    const alpha = 1 - Math.pow(1 - smoothing, dt * 60);

    this.currentPos.lerp(this._goalPos, alpha);
    this.currentLook.lerp(this._goalLook, alpha);

    this.camera.position.set(
      this.currentPos.x + Math.sin(elapsed * 0.08) * 0.04,
      this.currentPos.y + Math.sin(elapsed * 0.11) * 0.03,
      this.currentPos.z
    );

    this.camera.lookAt(this.currentLook);
  }
}