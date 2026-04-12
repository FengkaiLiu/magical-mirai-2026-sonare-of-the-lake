/**
 * ==========================================
 * Boat — Cannon-es 物理ボート SWE Refactor
 * ==========================================
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

export class Boat {
  constructor(engine, controls) {
    this.engine = engine;
    this.controls = controls;

    const shape = new CANNON.Box(new CANNON.Vec3(0.3, 0.25, 0.6));
    this.body = new CANNON.Body({
      mass: 8,
      position: new CANNON.Vec3(0, 0.35, 0),
      material: engine.materials.boat,
      linearDamping: 0.6, // 引擎自带空气/水阻力
      angularDamping: 0.8, 
      allowSleep: false,
    });
    this.body.addShape(shape);
    engine.world.addBody(this.body);

    this.mesh = new THREE.Group();
    
    // Placeholder Mesh (如果没加载出glb会显示这个)
    const hullMat = new THREE.MeshLambertMaterial({ color: 0xd4a060 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 1.2), hullMat);
    hull.position.y = 0.1;
    this.mesh.add(hull);

    const lantern = new THREE.PointLight(0xffcc55, 0.8, 8);
    lantern.position.set(0, 0.5, -0.4);
    this.mesh.add(lantern);

    this.lantern = lantern;
    this._lanternBase = 0.8;
    this._lanternPulse = 0;

    engine.scene.add(this.mesh);

    // === 物理参数 ===
    this.forwardForce = 50; 
    this.sprintMultiplier = 1.8;
    this.turnTorque = 12; // 真实扭矩参数

    this._forceVec = new CANNON.Vec3();
    this._forwardVec = new CANNON.Vec3();
    this._posVec = new THREE.Vector3();
    this._interpPos = new THREE.Vector3();
    this._interpQuat = new THREE.Quaternion();
    this._lanternGoal = 0;
    
    engine.addUpdatable(this);
  }

  lanternPulse(intensity = 1.0) {
    this._lanternGoal = intensity;
  }

  preStep(dt, elapsed) {
    const actions = this.controls.actions;
    const body = this.body;
    const vel = body.velocity;

    // ─── Buoyancy (浮力保持使用弹簧逻辑，手感最好) ───
    const waterLevel = this._diveWaterLevel ?? 0.35;
    const springK = 120;
    const dampK = 25;
    this._forceVec.set(0, springK * (waterLevel - body.position.y) - dampK * vel.y, 0);
    body.applyForce(this._forceVec);

    // ─── 物理局部坐标系转换 ───
    const fwd = this._forwardVec;
    fwd.set(0, 0, -1);
    body.quaternion.vmult(fwd, fwd);
    fwd.y = 0; fwd.normalize();

    // 船身右侧向量 (通过叉乘得到)
    const right = new CANNON.Vec3(-fwd.z, 0, fwd.x);

    // ─── Thrust (主推力) ───
    const sprint = actions.sprint ? this.sprintMultiplier : 1.0;
    let engineForce = 0;
    if (actions.forward) engineForce = this.forwardForce * sprint;
    if (actions.backward) engineForce = -this.forwardForce * 0.4;
    
    this._forceVec.set(fwd.x * engineForce, 0, fwd.z * engineForce);
    body.applyForce(this._forceVec);

    // ─── Steering (转向扭矩) ───
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const isReversing = (vel.x * fwd.x + vel.z * fwd.z) < 0;
    
    // 必须要有一点速度才能转向，倒车时转向反转（符合真实驾驶感）
    const turnMult = Math.min(speed / 2.0, 1.0) * (isReversing ? -1 : 1);
    const appliedTorque = this.turnTorque * turnMult;

    if (actions.left) body.applyTorque(new CANNON.Vec3(0, appliedTorque, 0));
    if (actions.right) body.applyTorque(new CANNON.Vec3(0, -appliedTorque, 0));

    // ─── Anisotropic Friction (侧滑修正) ───
    // 计算当前的横向速度，并施加一个巨大的反方向摩擦力，消灭“冰面漂移”的感觉
    const lateralSpeed = vel.x * right.x + vel.z * right.z;
    const lateralFrictionCoef = 25.0; 
    this._forceVec.set(right.x * -lateralSpeed * lateralFrictionCoef, 0, right.z * -lateralSpeed * lateralFrictionCoef);
    body.applyForce(this._forceVec);

    // ─── Anti-capsize (防翻船) ───
    const q = body.quaternion;
    body.angularVelocity.x += (-q.x * 120 - body.angularVelocity.x * 12) * dt;
    body.angularVelocity.z += (-q.z * 120 - body.angularVelocity.z * 12) * dt;
  }

  update(dt, elapsed) {
    const p = this.body.position;
    const quat = this.body.quaternion;

    const lerpF = Math.min(dt * 25, 1);
    this._interpPos.set(p.x, p.y, p.z);
    this.mesh.position.x += (this._interpPos.x - this.mesh.position.x) * lerpF;
    this.mesh.position.z += (this._interpPos.z - this.mesh.position.z) * lerpF;

    const targetY = this._interpPos.y + Math.sin(elapsed * 1.5) * 0.015;
    this.mesh.position.y += (targetY - this.mesh.position.y) * lerpF;

    this._interpQuat.set(quat.x, quat.y, quat.z, quat.w);
    this.mesh.quaternion.slerp(this._interpQuat, lerpF);

    this._lanternGoal *= Math.pow(0.22, dt);
    if (this._lanternGoal < 0.005) this._lanternGoal = 0;
    this._lanternPulse += (this._lanternGoal - this._lanternPulse) * Math.min(dt * 4.0, 1);
    this.lantern.intensity = this._lanternBase + this._lanternPulse * 3.0;
  }

  getPosition() { return this._posVec.set(this.body.position.x, this.body.position.y, this.body.position.z); }

  getHeading() {
    const q = this.body.quaternion;
    return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
  }

  getSpeed() {
    const v = this.body.velocity;
    return Math.sqrt(v.x * v.x + v.z * v.z);
  }

  setModel(gltfScene, { scale = 0.3, rotationY = 0 } = {}) {
    gltfScene.scale.setScalar(scale);
    
    // SWE 提示：在这里覆盖 Blender 模型自带的错误旋转
    gltfScene.rotation.set(0, rotationY, 0); 
    
    this.mesh.add(gltfScene);
    for (const child of this.mesh.children) {
      if (child === gltfScene) continue;
      if (child.isLight) continue;
      child.visible = false;
    }
    this._model = gltfScene;
  }
}