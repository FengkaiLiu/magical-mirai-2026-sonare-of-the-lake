/**
 * ==========================================
 * Engine — Three.js + Cannon-es コアエンジン v2
 * ==========================================
 * Changes:
 *   - updatables: Set instead of Array (O(1) add/remove, no splice)
 *   - Snapshot iteration: spreads Set to array once per phase so
 *     objects added/removed mid-loop don't cause skips or double-updates
 *   - Camera far plane 1000 → 500 (scene is 300×300, saves depth precision)
 *   - dt clamp unchanged (0.05 = 20fps minimum)
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

    // === Physics Materials ===
    this.materials = {
      boat:  new CANNON.Material("boat"),
      lyric: new CANNON.Material("lyric"),
      water: new CANNON.Material("water"),
    };

    // 船 vs 歌詞: 高弾性（弾き飛ばす）、低摩擦（滑る）
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.materials.boat, this.materials.lyric,
      { friction: 0.1, restitution: 0.7 }
    ));

    // 歌詞 vs 水面: 高摩擦（着水後すぐ止まる）、低弾性
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.materials.lyric, this.materials.water,
      { friction: 0.8, restitution: 0.15 }
    ));

    // 船 vs 水面: 中摩擦
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.materials.boat, this.materials.water,
      { friction: 0.3, restitution: 0.05 }
    ));

    // 歌詞 vs 歌詞: 軽い弾性
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.materials.lyric, this.materials.lyric,
      { friction: 0.2, restitution: 0.4 }
    ));

    // Physics timestep
    this.fixedTimeStep = 1 / 60;
    this.maxSubSteps = 3;

    // === Clock ===
    this.clock = new THREE.Clock();
    this.elapsed = 0;

    // === Updatables (Set for O(1) add/remove) ===
    this._updatables = new Set();

    // === Resize ===
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  /**
   * Register an object with update(dt, elapsed).
   * May also implement preStep(dt, elapsed).
   */
  addUpdatable(obj) {
    this._updatables.add(obj);
  }

  /**
   * Unregister an updatable. Safe to call during iteration.
   */
  removeUpdatable(obj) {
    this._updatables.delete(obj);
  }

  /**
   * Main game loop.
   * Loop order:
   *   1. preStep  — input, forces
   *   2. physics  — cannon-es step
   *   3. update   — sync meshes
   *   4. render   — draw
   */
  start() {
    const tick = () => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.elapsed = this.clock.getElapsedTime();

      // Snapshot: spread once so mid-loop add/remove is safe
      const objs = [...this._updatables];

      // 1. Pre-step
      for (let i = 0; i < objs.length; i++) {
        if (objs[i].preStep) objs[i].preStep(dt, this.elapsed);
      }

      // 2. Physics
      this.world.step(this.fixedTimeStep, dt, this.maxSubSteps);

      // 3. Post-step
      for (let i = 0; i < objs.length; i++) {
        objs[i].update(dt, this.elapsed);
      }

      // 4. Render
      this.renderer.render(this.scene, this.camera);

      requestAnimationFrame(tick);
    };
    tick();
  }
}