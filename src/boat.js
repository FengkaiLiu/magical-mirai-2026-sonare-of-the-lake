/**
 * ==========================================
 * Boat — Cannon-es 物理ボート
 * ==========================================
 * WASD/矢印キーで操作。
 * Cannon-es Body で力を加えて動かす（速度直接設定ではない）。
 * Three.js の Mesh は物理ボディに同期。
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

export class Boat {
  constructor(engine) {
    this.engine = engine;

    // === Cannon-es physics body ===
    // 箱型の衝突形状
    const shape = new CANNON.Box(new CANNON.Vec3(0.3, 0.12, 0.6));
    this.body = new CANNON.Body({
      mass: 5,
      position: new CANNON.Vec3(0, 0.3, 0),
      linearDamping: 0.6,   // 水の抵抗
      angularDamping: 0.85, // 回転抵抗
      allowSleep: false,     // 船は常にアクティブ
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

    // === Controls ===
    this.forwardForce = 25;
    this.turnTorque = 5;
    this.keys = { w: false, s: false, a: false, d: false };

    window.addEventListener("keydown", e => this.setKey(e.code, true));
    window.addEventListener("keyup",   e => this.setKey(e.code, false));

    engine.addUpdatable(this);
  }

  setKey(code, val) {
    const m = { KeyW:"w", ArrowUp:"w", KeyS:"s", ArrowDown:"s",
                KeyA:"a", ArrowLeft:"a", KeyD:"d", ArrowRight:"d" };
    if (m[code]) this.keys[m[code]] = val;
  }

  /**
   * preStep — 物理演算前: 入力を読んで速度を設定
   */
  preStep(dt, elapsed) {
    // 船の向き (quaternion → forward vector)
    const quat = this.body.quaternion;
    const forward = new CANNON.Vec3(0, 0, -1);
    quat.vmult(forward, forward);
    forward.y = 0;
    forward.normalize();

    // === 速度操作 ===
    const vel = this.body.velocity;

    if (this.keys.w) {
      vel.x += forward.x * this.forwardForce * dt;
      vel.z += forward.z * this.forwardForce * dt;
    }
    if (this.keys.s) {
      vel.x -= forward.x * this.forwardForce * 0.3 * dt;
      vel.z -= forward.z * this.forwardForce * 0.3 * dt;
    }

    // 旋回
    if (this.keys.a) {
      this.body.angularVelocity.y += this.turnTorque * dt;
    }
    if (this.keys.d) {
      this.body.angularVelocity.y -= this.turnTorque * dt;
    }

    // 水の抵抗 (速度減衰)
    vel.x *= 0.98;
    vel.z *= 0.98;

    // 最大速度制限
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const maxSpeed = 8;
    if (speed > maxSpeed) {
      const ratio = maxSpeed / speed;
      vel.x *= ratio;
      vel.z *= ratio;
    }

    // Y軸固定 (水面に浮かせる)
    this.body.position.y = 0.25;
    vel.y = 0;

    // Y軸以外の回転を抑制 (転覆防止)
    this.body.angularVelocity.x *= 0.9;
    this.body.angularVelocity.z *= 0.9;
  }

  /**
   * update — 物理演算後: メッシュ同期 + 範囲制限
   */
  update(dt, elapsed) {
    const p = this.body.position;
    const quat = this.body.quaternion;

    // 範囲制限
    p.x = Math.max(-40, Math.min(40, p.x));
    p.z = Math.max(-40, Math.min(40, p.z));

    // === Three.js mesh を物理ボディに同期 ===
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);

    // 微かなボブ (波の上の揺れ)
    this.mesh.position.y += Math.sin(elapsed * 1.5) * 0.015;
  }

  /** ワールド位置を取得 */
  getPosition() {
    const p = this.body.position;
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  /** 速度スカラーを取得 */
  getSpeed() {
    const v = this.body.velocity;
    return Math.sqrt(v.x * v.x + v.z * v.z);
  }
}