/**
 * ==========================================
 * Boat — Cannon-es 物理ボート
 * ==========================================
 * Controls の actions を読んで動く。
 * キーボード入力は Controls が管理。
 * Three.js の Mesh は物理ボディに同期。
 *
 * v2 — Frame-rate independent damping
 *     - All *= damping → Math.pow(damping, dt * 60)
 *     - Buoyancy via applyForce() instead of direct vel mutation
 *     - Reusable CANNON.Vec3 to avoid GC pressure
 *     - Anti-capsize via restoring torque instead of quaternion reset
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

// ─── Helpers ─────────────────────────────────────────────

/** Frame-rate independent damping: equivalent to `v *= d` at 60fps */
function damp(factor, dt) {
  return Math.pow(factor, dt * 60);
}

export class Boat {
  constructor(engine, controls) {
    this.engine = engine;
    this.controls = controls;

    // === Cannon-es physics body ===
    const shape = new CANNON.Box(new CANNON.Vec3(0.3, 0.12, 0.6));
    this.body = new CANNON.Body({
      mass: 5,
      position: new CANNON.Vec3(0, 0.3, 0),
      material: engine.materials.boat,
      linearDamping: 0.6,
      angularDamping: 0.85,
      allowSleep: false,
    });
    this.body.addShape(shape);

    engine.world.addBody(this.body);

    // === Three.js placeholder mesh ===
    // TODO: Replace with .glb model loaded via GLTFLoader
    this.mesh = new THREE.Group();

    const hullMat = new THREE.MeshLambertMaterial({ color: 0xd4a060 });

    // 船体
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 1.2), hullMat);
    hull.position.y = 0.1;
    hull.castShadow = true;
    this.mesh.add(hull);

    // 船首
    const bow = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.5, 4),
      hullMat
    );
    bow.rotation.x = -Math.PI / 2;
    bow.position.set(0, 0.1, -0.75);
    bow.castShadow = true;
    this.mesh.add(bow);

    // マスト
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.9),
      new THREE.MeshLambertMaterial({ color: 0x6b5030 })
    );
    mast.position.set(0, 0.55, -0.1);
    this.mesh.add(mast);

    // 帆
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute("position", new THREE.BufferAttribute(
      new Float32Array([0,0,0, 0,0.55,0, 0.35,0.1,0]), 3
    ));
    sailGeo.computeVertexNormals();
    const sail = new THREE.Mesh(sailGeo, new THREE.MeshLambertMaterial({
      color: 0xeeeedd, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
    }));
    sail.position.set(0.02, 0.15, -0.1);
    this.mesh.add(sail);

    // ランタン
    const lantern = new THREE.PointLight(0xffcc55, 0.8, 8);
    lantern.position.set(0, 0.5, -0.4);
    lantern.castShadow = true;
    this.mesh.add(lantern);

    engine.scene.add(this.mesh);

    // === Movement params ===
    this.forwardForce = 25;
    this.turnTorque = 5;

    // === Reusable vectors (avoid GC pressure) ===
    this._forceVec = new CANNON.Vec3();
    this._forwardVec = new CANNON.Vec3();
    this._posVec = new THREE.Vector3();

    engine.addUpdatable(this);
  }

  /**
   * preStep — 物理演算前: 入力を読んで力を適用
   */
  preStep(dt, elapsed) {
    const actions = this.controls.actions;
    const body = this.body;
    const vel = body.velocity;

    // ─── Buoyancy: spring force via applyForce ───
    const waterLevel = 0.30;
    const springK = 150;       // spring stiffness (force = k * displacement)
    const dampingK = 30;       // vertical velocity damping coefficient
    const displacement = waterLevel - body.position.y;
    this._forceVec.set(0, springK * displacement - dampingK * vel.y, 0);
    body.applyForce(this._forceVec);

    // ─── Forward direction ───
    const fwd = this._forwardVec;
    fwd.set(0, 0, -1);
    body.quaternion.vmult(fwd, fwd);
    fwd.y = 0;
    fwd.normalize();

    // ─── Thrust ───
    if (actions.forward) {
      this._forceVec.set(
        fwd.x * this.forwardForce,
        0,
        fwd.z * this.forwardForce
      );
      body.applyForce(this._forceVec);
    }
    if (actions.backward) {
      this._forceVec.set(
        -fwd.x * this.forwardForce * 0.3,
        0,
        -fwd.z * this.forwardForce * 0.3
      );
      body.applyForce(this._forceVec);
    }

    // ─── Turning ───
    if (actions.left) {
      body.angularVelocity.y += this.turnTorque * dt;
    }
    if (actions.right) {
      body.angularVelocity.y -= this.turnTorque * dt;
    }

    // ─── Horizontal water drag (frame-rate independent) ───
    const horizDamp = damp(0.98, dt);
    vel.x *= horizDamp;
    vel.z *= horizDamp;

    // ─── Speed cap ───
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const maxSpeed = 8;
    if (speed > maxSpeed) {
      const ratio = maxSpeed / speed;
      vel.x *= ratio;
      vel.z *= ratio;
    }

    // ─── Anti-capsize: restoring torque toward upright ───
    // Instead of brutally zeroing quaternion components, apply a
    // strong restoring angular impulse that pulls the boat level.
    // This lets the physics solver work correctly while keeping
    // the boat stable.
    const q = body.quaternion;
    // Measure tilt: extract x and z from quaternion (small-angle ≈ 2*q.x, 2*q.z)
    const restoreK = 50;  // how aggressively to right the boat
    body.angularVelocity.x += (-q.x * restoreK - body.angularVelocity.x * 5) * dt;
    body.angularVelocity.z += (-q.z * restoreK - body.angularVelocity.z * 5) * dt;
  }

  /**
   * update — 物理演算後: メッシュ同期 + 範囲制限
   */
  update(dt, elapsed) {
    const p = this.body.position;
    const quat = this.body.quaternion;
    const vel = this.body.velocity;

    // ─── Soft boundary: push boat back toward center ───
    const bounds = {
      xPos: { boundary: 60, slowStart: 50 },
      xNeg: { boundary: 58, slowStart: 48 },
      zPos: { boundary: 60, slowStart: 50 },
      zNeg: { boundary: 60, slowStart: 40 },
    };

    // +X / -X
    const bx = p.x > 0 ? bounds.xPos : bounds.xNeg;
    const ax = Math.abs(p.x);
    if (ax > bx.slowStart) {
      const ratio = Math.min((ax - bx.slowStart) / (bx.boundary - bx.slowStart), 1);
      vel.x *= damp(1 - ratio * 0.3, dt);
      // Push-back force (not magic 60, scaled properly)
      const pushForce = ratio * ratio * 300; // force magnitude, not frame-coupled
      this._forceVec.set(-Math.sign(p.x) * pushForce, 0, 0);
      this.body.applyForce(this._forceVec);
    }

    // +Z / -Z
    const bz = p.z > 0 ? bounds.zPos : bounds.zNeg;
    const az = Math.abs(p.z);
    if (az > bz.slowStart) {
      const ratio = Math.min((az - bz.slowStart) / (bz.boundary - bz.slowStart), 1);
      vel.z *= damp(1 - ratio * 0.3, dt);
      const pushForce = ratio * ratio * 300;
      this._forceVec.set(0, 0, -Math.sign(p.z) * pushForce);
      this.body.applyForce(this._forceVec);
    }

    // ─── Sync Three.js mesh to physics body ───
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);

    // 微かなボブ（visual only, on top of physics position）
    this.mesh.position.y += Math.sin(elapsed * 1.5) * 0.015;
  }

  /** Returns boat position (reuses internal vector — do NOT store the reference) */
  getPosition() {
    const p = this.body.position;
    return this._posVec.set(p.x, p.y, p.z);
  }

  /** Returns boat Y-axis heading in radians */
  getHeading() {
    // Extract Y rotation from quaternion:
    // heading = atan2(2(wy + xz), 1 - 2(yy + zz))
    const q = this.body.quaternion;
    return Math.atan2(
      2 * (q.w * q.y + q.x * q.z),
      1 - 2 * (q.y * q.y + q.z * q.z)
    );
  }

  getSpeed() {
    const v = this.body.velocity;
    return Math.sqrt(v.x * v.x + v.z * v.z);
  }
}