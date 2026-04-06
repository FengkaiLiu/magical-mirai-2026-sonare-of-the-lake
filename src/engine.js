/**
 * ==========================================
 * Engine — Three.js + Cannon-es コアエンジン
 * ==========================================
 * Render loop, physics step, resize handling.
 * Bruno Simon 風のアーキテクチャ。
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

export class Engine {
  constructor(container) {
    // === Three.js ===
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0xb8daf0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      50, window.innerWidth / window.innerHeight, 0.1, 500
    );

    // === Cannon-es Physics ===
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;

    // Physics timestep
    this.fixedTimeStep = 1 / 60;
    this.maxSubSteps = 3;

    // === Clock ===
    this.clock = new THREE.Clock();
    this.elapsed = 0;

    // === Objects to update each frame ===
    this.updatables = [];

    // === Resize ===
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  /**
   * Register an object with update(dt, elapsed) method
   */
  addUpdatable(obj) {
    this.updatables.push(obj);
  }

  /**
   * Main game loop — call once, uses rAF internally
   */
  start() {
    const tick = () => {
      const dt = this.clock.getDelta();
      this.elapsed = this.clock.getElapsedTime();

      // Update all registered objects (input, forces)
      for (const obj of this.updatables) {
        obj.update(dt, this.elapsed);
      }

      // Physics step (applies forces from updates)
      this.world.step(this.fixedTimeStep, dt, this.maxSubSteps);

      // Render
      this.renderer.render(this.scene, this.camera);

      requestAnimationFrame(tick);
    };
    tick();
  }
}