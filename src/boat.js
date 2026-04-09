/**
 * ==========================================
 * Boat — Cannon-es 物理ボート v4
 * ==========================================
 * Changes from v3:
 *   - lanternPulse() method: beat triggers brightness spike + decay
 *   - Dive edge pull for safe underwater transitions
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

function damp(factor, dt) {
  return Math.pow(factor, dt * 60);
}

export class Boat {
  constructor(engine, controls) {
    this.engine = engine;
    this.controls = controls;

    // === Cannon-es physics body ===
    const shape = new CANNON.Box(new CANNON.Vec3(0.3, 0.25, 0.6));
    this.body = new CANNON.Body({
      mass: 8,
      position: new CANNON.Vec3(0, 0.35, 0),
      material: engine.materials.boat,
      linearDamping: 0.5,
      angularDamping: 0.95,
      allowSleep: false,
    });
    this.body.addShape(shape);
    engine.world.addBody(this.body);

    // === Three.js placeholder mesh ===
    this.mesh = new THREE.Group();

    const hullMat = new THREE.MeshLambertMaterial({ color: 0xd4a060 });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 1.2), hullMat);
    hull.position.y = 0.1;
    hull.castShadow = true;
    this.mesh.add(hull);

    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 4), hullMat);
    bow.rotation.x = -Math.PI / 2;
    bow.position.set(0, 0.1, -0.75);
    bow.castShadow = true;
    this.mesh.add(bow);

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.9),
      new THREE.MeshLambertMaterial({ color: 0x6b5030 })
    );
    mast.position.set(0, 0.55, -0.1);
    this.mesh.add(mast);

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

    const lantern = new THREE.PointLight(0xffcc55, 0.8, 8);
    lantern.position.set(0, 0.5, -0.4);
    lantern.castShadow = true;
    this.mesh.add(lantern);

    // Beat pulse state
    this.lantern = lantern;
    this._lanternBase = 0.8;
    this._lanternPulse = 0;

    engine.scene.add(this.mesh);

    // === Movement params ===
    this.forwardForce = 32;
    this.sprintMultiplier = 1.8;
    this.turnTorque = 4;

    // === Reusable vectors ===
    this._forceVec = new CANNON.Vec3();
    this._forwardVec = new CANNON.Vec3();
    this._posVec = new THREE.Vector3();
    this._interpPos = new THREE.Vector3(0, 0.35, 0);
    this._interpQuat = new THREE.Quaternion();
    this._lanternGoal = 0;  // breathing target
    engine.addUpdatable(this);
  }

  lanternPulse(intensity = 1.0) {
    this._lanternGoal = intensity;
  }

  preStep(dt, elapsed) {
    const actions = this.controls.actions;
    const body = this.body;
    const vel = body.velocity;

    // ─── Buoyancy ───
    const waterLevel = this._diveWaterLevel ?? 0.35;
    const springK = 120;
    const dampK = waterLevel < 0 ? 50 : 25; // stronger damping underwater (absorbs frame spikes)
    this._forceVec.set(0, springK * (waterLevel - body.position.y) - dampK * vel.y, 0);
    body.applyForce(this._forceVec);

    // ─── Forward direction ───
    const fwd = this._forwardVec;
    fwd.set(0, 0, -1);
    body.quaternion.vmult(fwd, fwd);
    fwd.y = 0;
    fwd.normalize();

    // ─── Thrust ───
    const sprint = actions.sprint ? this.sprintMultiplier : 1.0;

    if (actions.forward) {
      const f = this.forwardForce * sprint;
      this._forceVec.set(fwd.x * f, 0, fwd.z * f);
      body.applyForce(this._forceVec);
    }
    if (actions.backward) {
      const f = this.forwardForce * 0.3;
      this._forceVec.set(-fwd.x * f, 0, -fwd.z * f);
      body.applyForce(this._forceVec);
    }

    // ─── Turning ───
    if (actions.left)  body.angularVelocity.y += this.turnTorque * dt;
    if (actions.right) body.angularVelocity.y -= this.turnTorque * dt;

    // ─── Horizontal drag ───
    const horizDamp = damp(0.98, dt);
    vel.x *= horizDamp;
    vel.z *= horizDamp;

    // ─── Speed cap ───
    const maxSpeed = actions.sprint ? 12 : 8;
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (speed > maxSpeed) {
      const ratio = maxSpeed / speed;
      vel.x *= ratio;
      vel.z *= ratio;
    }

    // ─── Anti-capsize (strong — boat should never flip) ───
    const q = body.quaternion;
    const restoreK = 120;
    body.angularVelocity.x += (-q.x * restoreK - body.angularVelocity.x * 12) * dt;
    body.angularVelocity.z += (-q.z * restoreK - body.angularVelocity.z * 12) * dt;
  }

  update(dt, elapsed) {
    const p = this.body.position;
    const quat = this.body.quaternion;
    const vel = this.body.velocity;

    // ─── Soft boundary ───
    const diving = (this._diveWaterLevel ?? 0.35) < 0;

    // Diving: circular pull toward center (open water, no rectangular shore)
    if (diving) {
      const distFromCenter = Math.sqrt(p.x * p.x + p.z * p.z);
      const safeRadius = 25;
      if (distFromCenter > safeRadius) {
        const urgency = Math.min((distFromCenter - safeRadius) / 10, 1);
        const pullForce = urgency * 600;
        this._forceVec.set(
          -p.x / distFromCenter * pullForce,
          0,
          -p.z / distFromCenter * pullForce
        );
        this.body.applyForce(this._forceVec);
        const dot = (vel.x * p.x + vel.z * p.z) / distFromCenter;
        if (dot > 0) {
          vel.x -= (p.x / distFromCenter) * dot * 0.8;
          vel.z -= (p.z / distFromCenter) * dot * 0.8;
        }
      }
    }

    // Surface: rectangular bounds matching shore terrain
    if (!diving) {
      const bounds = {
        xPos: { boundary: 60, slowStart: 50 },
        xNeg: { boundary: 58, slowStart: 48 },
        zPos: { boundary: 60, slowStart: 50 },
        zNeg: { boundary: 60, slowStart: 40 },
      };

    const bx = p.x > 0 ? bounds.xPos : bounds.xNeg;
    const ax = Math.abs(p.x);
    if (ax > bx.slowStart) {
      const ratio = Math.min((ax - bx.slowStart) / (bx.boundary - bx.slowStart), 1);
      vel.x *= damp(1 - ratio * 0.3, dt);
      this._forceVec.set(-Math.sign(p.x) * ratio * ratio * 300, 0, 0);
      this.body.applyForce(this._forceVec);
    }

    const bz = p.z > 0 ? bounds.zPos : bounds.zNeg;
    const az = Math.abs(p.z);
    if (az > bz.slowStart) {
      const ratio = Math.min((az - bz.slowStart) / (bz.boundary - bz.slowStart), 1);
      vel.z *= damp(1 - ratio * 0.3, dt);
      this._forceVec.set(0, 0, -Math.sign(p.z) * ratio * ratio * 300);
      this.body.applyForce(this._forceVec);
    }
    } // end if (!diving)

    // ─── Sync mesh (interpolated for smooth high-refresh) ───
    const lerpF = Math.min(dt * 25, 1);
    this._interpPos.set(p.x, p.y, p.z);

    // XZ: normal lerp
    this.mesh.position.x += (this._interpPos.x - this.mesh.position.x) * lerpF;
    this.mesh.position.z += (this._interpPos.z - this.mesh.position.z) * lerpF;

    // Y: clamp max change when underwater to prevent jitter from frame spikes
    const targetY = this._interpPos.y + Math.sin(elapsed * 1.5) * 0.015;
    if (diving) {
      const maxYStep = dt * 3.0; // max 3 units/sec vertical — very smooth
      const dy = targetY - this.mesh.position.y;
      this.mesh.position.y += Math.max(-maxYStep, Math.min(maxYStep, dy));
    } else {
      this.mesh.position.y += (targetY - this.mesh.position.y) * lerpF;
    }

    this._interpQuat.set(quat.x, quat.y, quat.z, quat.w);
    this.mesh.quaternion.slerp(this._interpQuat, lerpF);

    // ─── Lantern breathing (smooth attack + smooth decay over 4 beats) ───
    this._lanternGoal *= Math.pow(0.22, dt);
    if (this._lanternGoal < 0.005) this._lanternGoal = 0;

    const chase = Math.min(dt * 4.0, 1);
    this._lanternPulse += (this._lanternGoal - this._lanternPulse) * chase;
    this.lantern.intensity = this._lanternBase + this._lanternPulse * 3.0;
  }

  getPosition() {
    const p = this.body.position;
    return this._posVec.set(p.x, p.y, p.z);
  }

  getHeading() {
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

  /**
   * Replace placeholder geometry with a loaded GLTF model.
   * Call from main.js after gltfLoader.load succeeds.
   * Handles scale, rotation, placeholder hiding — all in one place.
   */
  setModel(gltfScene, { scale = 0.3, rotationY = Math.PI } = {}) {
    gltfScene.scale.setScalar(scale);
    gltfScene.rotation.y = rotationY;
    this.mesh.add(gltfScene);

    // Hide all placeholder children (keep lights + the new model)
    for (const child of this.mesh.children) {
      if (child === gltfScene) continue;
      if (child.isLight) continue;
      child.visible = false;
    }

    this._model = gltfScene;
  }
}