/**
 * ==========================================
 * CameraController — スムーズ俯瞰追従
 * ==========================================
 * 固定角度で船を追いかける。急に動かず、ゆったりlerp。
 */

import * as THREE from "three";

export class CameraController {
  constructor(engine) {
    this.engine = engine;
    this.camera = engine.camera;

    // カメラの設定 (Bruno風の近い追従)
    this.height = 8;      // 船からの高さ (was 14)
    this.distance = 10;   // 船からの後方距離 (was 16)
    this.lookAhead = 2;   // 注視点を船の前方にずらす量 (was 3)

    // スムーズ追従
    this.currentPos = new THREE.Vector3(0, this.height, this.distance);
    this.currentLook = new THREE.Vector3(0, 0, 0);
    this.smoothing = 0.03; // 小さい = ゆったり (フレームレート非依存)

    // 初期位置
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(0, 0, 0);

    engine.addUpdatable(this);
  }

  setTarget(boatPosition) {
    this.targetPos = boatPosition;
  }

  update(dt, elapsed) {
    if (!this.targetPos) return;

    // 目標カメラ位置: 船の後方上空 (角度固定)
    const goalPos = new THREE.Vector3(
      this.targetPos.x,
      this.targetPos.y + this.height,
      this.targetPos.z + this.distance
    );

    // 目標注視点: 船の少し前方
    const goalLook = new THREE.Vector3(
      this.targetPos.x,
      0,
      this.targetPos.z - this.lookAhead
    );

    // フレームレート非依存のスムーズ補間
    // 60fps でも 30fps でも同じ速度で追従する
    const alpha = 1 - Math.pow(1 - this.smoothing, dt * 60);
    this.currentPos.lerp(goalPos, alpha);
    this.currentLook.lerp(goalLook, alpha);

    // 微揺れ
    this.camera.position.set(
      this.currentPos.x + Math.sin(elapsed * 0.08) * 0.04,
      this.currentPos.y + Math.sin(elapsed * 0.11) * 0.03,
      this.currentPos.z
    );

    this.camera.lookAt(this.currentLook);
  }

  dispose() {
    this.engine.removeUpdatable(this);
    this.engine = null;
  }
}
