/**
 * ==========================================
 * LyricManager — Cannon-es 物理歌詞
 * ==========================================
 * 歌詞は Cannon-es Body を持ち、船との物理衝突で動く。
 * 落下後は水面上に留まる。
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

function makeTexture(text) {
  const size = 44;
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  const font = `bold ${size}px "Yu Gothic","Hiragino Sans",sans-serif`;
  x.font = font;
  const m = x.measureText(text);
  const pad = 24;
  c.width = Math.ceil(m.width) + pad * 2;
  c.height = size * 1.5 + pad * 2;

  x.font = font;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.shadowColor = "rgba(255,255,255,0.6)";
  x.shadowBlur = 12;
  x.fillStyle = "#1a2a3a";
  x.fillText(text, c.width / 2, c.height / 2);
  x.shadowBlur = 0;
  x.fillStyle = "#0a1a2a";
  x.fillText(text, c.width / 2, c.height / 2);

  return { tex: new THREE.CanvasTexture(c), w: c.width, h: c.height };
}

class LyricObject {
  constructor(text, engine, worldPos) {
    this.engine = engine;
    this.alive = true;

    const t = makeTexture(text);
    const sc = 0.008;

    // Three.js sprite
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: t.tex, transparent: true, depthWrite: false,
    }));
    this.sprite.scale.set(t.w * sc, t.h * sc, 1);
    this.sprite.renderOrder = 10;
    engine.scene.add(this.sprite);

    // Cannon-es body (箱)
    const hw = t.w * sc * 0.5;
    const hh = t.h * sc * 0.5;
    this.body = new CANNON.Body({
      mass: 0.5,
      position: new CANNON.Vec3(worldPos.x, 8 + Math.random() * 3, worldPos.z),
      linearDamping: 0.7,
      angularDamping: 0.95,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(hw, 0.05, hh)));
    engine.world.addBody(this.body);

    // 落下後に水面で止まる
    this.landed = false;
    this.fadeOut = false;
    this.opacity = 1;
  }

  /** update — 物理演算後: メッシュ同期 + 水面クランプ */
  update(dt, elapsed) {
    const p = this.body.position;

    // 水面で止まる (y=0.25)
    if (!this.landed && p.y <= 0.3) {
      this.landed = true;
      p.y = 0.25;
      this.body.velocity.set(
        this.body.velocity.x * 0.3,
        0,
        this.body.velocity.z * 0.3
      );
      // 着水後は軽い質量に
      this.body.mass = 2;
      this.body.updateMassProperties();
    }

    if (this.landed) {
      // 水面に固定
      if (p.y < 0.15) { p.y = 0.15; this.body.velocity.y = 0; }
      if (p.y > 0.5)  { this.body.velocity.y = -0.5; }

      // ボブ
      p.y = 0.25 + Math.sin(elapsed * 0.7 + p.x) * 0.01;

      // Y軸以外の回転抑制
      this.body.angularVelocity.x *= 0.8;
      this.body.angularVelocity.z *= 0.8;
    }

    // Three.js同期
    this.sprite.position.set(p.x, p.y + 0.15, p.z);

    // フェードアウト
    if (this.fadeOut) {
      this.opacity -= dt * 0.3;
      if (this.opacity <= 0) { this.opacity = 0; this.alive = false; }
      this.sprite.material.opacity = this.opacity;
    }
  }

  startFade() {
    this.fadeOut = true;
  }

  dispose() {
    this.engine.scene.remove(this.sprite);
    this.engine.world.removeBody(this.body);
    this.engine.removeUpdatable(this);  // ← #2 fix: 从 updatables 移除
    this.sprite.material.map.dispose();
    this.sprite.material.dispose();
  }
}

export class LyricManager {
  constructor(engine) {
    this.engine = engine;
    this.lyrics = [];
    this.currentText = "";
    this.slotIdx = 0;
  }

  getNextPos(boatPos) {
    const angle = this.slotIdx * 1.3 + Math.random() * 0.5;
    const dist = 3 + Math.random() * 5;
    this.slotIdx++;
    return {
      x: (boatPos ? boatPos.x : 0) + Math.cos(angle) * dist,
      z: (boatPos ? boatPos.z : 0) + Math.sin(angle) * dist,
    };
  }

  addPhrase(text, boatPos) {
    if (!text || text === this.currentText) return;
    this.currentText = text;

    // 古い歌詞をフェード
    while (this.lyrics.length >= 6) {
      const old = this.lyrics.shift();
      old.dispose();
    }

    const pos = this.getNextPos(boatPos);
    const lyric = new LyricObject(text, this.engine, pos);
    this.lyrics.push(lyric);
    this.engine.addUpdatable(lyric);
  }

  cleanup() {
    this.lyrics = this.lyrics.filter(l => {
      if (!l.alive) { l.dispose(); return false; }
      return true;
    });
  }
}