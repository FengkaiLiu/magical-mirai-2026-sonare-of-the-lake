/**
 * ==========================================
 * DiveController v4
 * ==========================================
 * Changes from v3:
 *   - Underwater fog (FogExp2, deep blue, fades in with transition)
 *   - Water surface ceiling (semi-transparent plane visible from below)
 *   - Notifies environment to switch particles to bubble mode
 *   - ClearColor blends to deep underwater blue
 */

import * as THREE from "three";
import { SCHOOL_CENTER_EXPORT } from "./fish-school.js";

const TRANSITION_SPEED = 0.8;

// Colors
const SURFACE_CLEAR = new THREE.Color(0xb8daf0);
const UNDERWATER_CLEAR = new THREE.Color(0x0a1a2e);
const FOG_COLOR = new THREE.Color(0x0c2244);

export class DiveController {
  constructor(engine, boat, camera, environment, fishSchool, lyrics) {
    this.engine = engine;
    this.boat = boat;
    this.camera = camera;
    this.environment = environment;
    this.fishSchool = fishSchool;
    this.lyrics = lyrics;

    this.isDiving = false;
    this.transition = 0;
    this.forceDive = false;

    // Underwater ambient light
    this._underwaterAmbient = new THREE.AmbientLight(0x1a3a6a, 0);
    engine.scene.add(this._underwaterAmbient);

    // Find surface lights
    this._surfaceAmbient = null;
    this._surfaceSun = environment.sunLight || null;
    engine.scene.traverse(child => {
      if (child.isAmbientLight && child !== this._underwaterAmbient && !this._surfaceAmbient) {
        this._surfaceAmbient = child;
      }
    });

    // Store original clear color
    this._surfaceClearColor = SURFACE_CLEAR.clone();

    // === Water surface ceiling (visible from below) ===
    const ceilGeo = new THREE.PlaneGeometry(300, 300);
    ceilGeo.rotateX(Math.PI / 2); // face downward
    const ceilMat = new THREE.MeshBasicMaterial({
      color: 0x1a4a6a,
      transparent: true,
      opacity: 0,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    this._ceilingMesh = new THREE.Mesh(ceilGeo, ceilMat);
    this._ceilingMesh.position.y = 0.1; // just above water surface
    this._ceilingMesh.renderOrder = -1;
    engine.scene.add(this._ceilingMesh);

    // === Fog (starts disabled) ===
    this._fog = new THREE.FogExp2(FOG_COLOR, 0);
    // Don't set scene.fog yet — set it on first dive

    // Reusable color for lerping
    this._lerpColor = new THREE.Color();

    engine.addUpdatable(this);
  }

  toggle() {
    if (this.forceDive) return;
    this.isDiving = !this.isDiving;
    if (!this.isDiving) {
      this.fishSchool.clearPhrase();
    }
  }

  forceDiveStart() { this.forceDive = true; this.isDiving = true; }
  forceDiveEnd() { this.forceDive = false; }

  get isUnderwater() { return this.transition > 0.5; }

  update(dt) {
    const target = this.isDiving ? 1 : 0;
    if (this.transition !== target) {
      const dir = target > this.transition ? 1 : -1;
      this.transition = Math.max(0, Math.min(1, this.transition + dir * TRANSITION_SPEED * dt));
    }

    const t = this.transition;
    const ease = t * t * (3 - 2 * t);

    // ─── Boat waterLevel ───
    this.boat._diveWaterLevel = THREE.MathUtils.lerp(0.35, -3.0, ease);

    // ─── Camera ───
    this.camera._diveBlend = t;
    this.camera._diveLookTarget = SCHOOL_CENTER_EXPORT;

    // ─── Lighting ───
    if (this._surfaceAmbient) {
      this._surfaceAmbient.intensity = THREE.MathUtils.lerp(1.2, 0.15, ease);
    }
    if (this._surfaceSun) {
      this._surfaceSun.intensity = THREE.MathUtils.lerp(1.8, 0.3, ease);
    }
    this._underwaterAmbient.intensity = ease * 0.6;

    // ─── Fog ───
    if (ease > 0.01) {
      // Enable fog
      this.engine.scene.fog = this._fog;
      this._fog.density = ease * 0.025; // max density 0.025 at full dive
    } else {
      // Disable fog on surface
      this.engine.scene.fog = null;
    }

    // ─── Clear color blend ───
    this._lerpColor.copy(this._surfaceClearColor).lerp(UNDERWATER_CLEAR, ease);
    this.engine.renderer.setClearColor(this._lerpColor);

    // ─── Water ceiling ───
    this._ceilingMesh.material.opacity = ease * 0.35;
    // Animate ceiling with subtle caustic-like movement
    if (ease > 0.01) {
      this._ceilingMesh.visible = true;
    } else {
      this._ceilingMesh.visible = false;
    }

    // ─── Tell environment about underwater state ───
    this.environment.underwaterAmount = ease;
  }
}