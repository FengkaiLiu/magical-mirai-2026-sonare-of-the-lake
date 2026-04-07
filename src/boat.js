/**
 * ==========================================
 * Boat — Cannon-es 物理ボート
 * ==========================================
 * Controls の actions を読んで動く。
 * キーボード入力は Controls が管理。
 * Three.js の Mesh は物理ボディに同期。
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

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

    engine.addUpdatable(this);
  }

  /**
   * preStep — 物理演算前: 入力を読んで速度を設定
   */
  preStep(dt, elapsed) {
    const actions = this.controls.actions;

    // 浮力: 弹簧式，把船推向水面 (waterLevel = 0)
    const waterLevel = 0.30;
    const buoyancy = (waterLevel - this.body.position.y) * 30; // 弹簧力
    this.body.velocity.y += buoyancy * dt;
    this.body.velocity.y *= 0.9; // 水的阻尼

    // 船の向き
    const quat = this.body.quaternion;
    const forward = new CANNON.Vec3(0, 0, -1);
    quat.vmult(forward, forward);
    forward.y = 0;
    forward.normalize();

    const vel = this.body.velocity;

    if (actions.forward) {
      vel.x += forward.x * this.forwardForce * dt;
      vel.z += forward.z * this.forwardForce * dt;
    }
    if (actions.backward) {
      vel.x -= forward.x * this.forwardForce * 0.3 * dt;
      vel.z -= forward.z * this.forwardForce * 0.3 * dt;
    }

    if (actions.left) {
      this.body.angularVelocity.y += this.turnTorque * dt;
    }
    if (actions.right) {
      this.body.angularVelocity.y -= this.turnTorque * dt;
    }

    vel.x *= 0.98;
    vel.z *= 0.98;

    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const maxSpeed = 8;
    if (speed > maxSpeed) {
      const ratio = maxSpeed / speed;
      vel.x *= ratio;
      vel.z *= ratio;
    }

    // 転覆防止 (X/Z回転を抑制するが完全にはロックしない)
    this.body.angularVelocity.x *= 0.85;
    this.body.angularVelocity.z *= 0.85;
  }

  /**
   * update — 物理演算後: メッシュ同期 + 範囲制限
   */
  update(dt, elapsed) {
    const p = this.body.position;
    const quat = this.body.quaternion;

    // 岸辺の境界 — 正方形ベースの段階的減速
    const halfSize = Math.max(Math.abs(p.x), Math.abs(p.z));
    
    // 浅水域 (halfSize > 40): 徐々に減速開始
    if (halfSize > 60) {
      const ratio = (halfSize - 40) / 20;
      const slowFactor = 1 - Math.min(ratio, 0.95);
      this.body.velocity.x *= slowFactor;
      this.body.velocity.z *= slowFactor;
      
    }

    // Three.js mesh を物理ボディに同期
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);

    // 微かなボブ
    this.mesh.position.y += Math.sin(elapsed * 1.5) * 0.015;
  }

  getPosition() {
    const p = this.body.position;
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  getSpeed() {
    const v = this.body.velocity;
    return Math.sqrt(v.x * v.x + v.z * v.z);
  }
}