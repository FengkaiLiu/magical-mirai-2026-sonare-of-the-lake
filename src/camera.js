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
    this.smoothing    = 0.08;  // フレームレート非依存 (boat follow)
    this.skySmoothing = 0.025; // slow cinematic sweep into sky view
    this._boatRef = null;

    // 初期位置
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(0, 0, 0);

    engine.addUpdatable(this);
  }

  attachBoat(boat) {
    this._boatRef = boat;
  }

  setTarget(boatPosition) {
    this.targetPos = boatPosition;
  }

  setSkyMode(enable) {
    this.skyMode = enable;
  }

  setSkyLyric(mesh) {
    this.skyLyricMesh = mesh;
  }

  update(dt, elapsed) {
    if (this._boatRef) this.targetPos = this._boatRef.getPosition();
    if (!this.targetPos) return;

    // 目標注視点: 船の少し前方、Chorus中は空高く且つ歌詞をセンターに
    let goalLook;
    if (this.skyMode) {
      // Look at a point high in front of the boat
      goalLook = new THREE.Vector3(
        this.targetPos.x,
        15, // Lower than 35 for more horizontal view
        this.targetPos.z - 40
      );
    } else {
      goalLook = new THREE.Vector3(
        this.targetPos.x,
        0,
        this.targetPos.z - this.lookAhead
      );
    }

    const goalPos = new THREE.Vector3(
      this.targetPos.x,
      this.targetPos.y + (this.skyMode ? 2.5 : this.height), // Slightly higher in sky mode to see horizon
      this.targetPos.z + (this.skyMode ? 12 : this.distance) // Farther back to see the scale
    );

    // フレームレート非依存のスムーズ補間
    // 60fps でも 30fps でも同じ速度で追従する
    const smooth = this.skyMode ? this.skySmoothing : this.smoothing;
    const alpha = 1 - Math.pow(1 - smooth, dt * 60);
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
