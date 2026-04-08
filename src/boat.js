/**
 * ==========================================
 * Boat — Cannon-es 物理ボート v3
 * ==========================================
 * Fixes from v2:
 *   - forwardForce 25→60 to compensate linearDamping:0.6 eating force
 *   - Shift sprint (2x force)
 *   - waterLevel unified to 0.35 (was 0.30, planks were 0.40 → collision gap)
 *   - springK/dampingK tuned for stable float without oscillation
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
    const shape = new CANNON.Box(new CANNON.Vec3(0.3, 0.12, 0.6));
    this.body = new CANNON.Body({
      mass: 5,
      position: new CANNON.Vec3(0, 0.35, 0),
      material: engine.materials.boat,
      linearDamping: 0.5,     // slightly lower for snappier feel
      angularDamping: 0.85,
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

    engine.scene.add(this.mesh);

    // === Movement params ===
    this.forwardForce = 60;      // compensates linearDamping eating ~50% of force
    this.sprintMultiplier = 1.8; // Shift key
    this.turnTorque = 5;

    // === Reusable vectors ===
    this._forceVec = new CANNON.Vec3();
    this._forwardVec = new CANNON.Vec3();
    this._posVec = new THREE.Vector3();

    engine.addUpdatable(this);
  }

  preStep(dt, elapsed) {
    const actions = this.controls.actions;
    const body = this.body;
    const vel = body.velocity;

    // ─── Buoyancy ───
    // Unified waterLevel: must match lyric-manager's waterLevel
    const waterLevel = 0.35;
    const springK = 120;
    const dampK = 25;
    this._forceVec.set(0, springK * (waterLevel - body.position.y) - dampK * vel.y, 0);
    body.applyForce(this._forceVec);

    // ─── Forward direction ───
    const fwd = this._forwardVec;
    fwd.set(0, 0, -1);
    body.quaternion.vmult(fwd, fwd);
    fwd.y = 0;
    fwd.normalize();

    // ─── Thrust (with Shift sprint) ───
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

    // ─── Horizontal drag (frame-rate independent) ───
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

    // ─── Anti-capsize: restoring torque ───
    const q = body.quaternion;
    const restoreK = 50;
    body.angularVelocity.x += (-q.x * restoreK - body.angularVelocity.x * 5) * dt;
    body.angularVelocity.z += (-q.z * restoreK - body.angularVelocity.z * 5) * dt;
  }

  update(dt, elapsed) {
    const p = this.body.position;
    const quat = this.body.quaternion;
    const vel = this.body.velocity;

    // ─── Soft boundary ───
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

    // ─── Sync mesh ───
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    this.mesh.position.y += Math.sin(elapsed * 1.5) * 0.015;
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
}