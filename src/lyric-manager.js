/**
 * ==========================================
 * LyricManager — 3D Per-Character Physics
 * ==========================================
 *
 * v3 changes:
 *   - 3D BoxGeometry chars (厚みあり、光を受ける)
 *   - Thicker collision body (0.12 height, no more clipping)
 *   - collisionResponse=false on chars while constrained (船が引っかからない)
 *   - Shatter re-enables collision → chars fly naturally
 *   - Long phrases chunked to max 8 chars (chain stability)
 *   - Boat collision uses isTrigger-style detection
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

// ─── Texture helper ───────────────────────────────────────

function makeCharTexture(char) {
  const size = 56;
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  const font = `bold ${size}px "Yu Gothic","Hiragino Sans",sans-serif`;
  x.font = font;
  const m = x.measureText(char);
  const pad = 12;
  c.width = Math.ceil(m.width) + pad * 2;
  c.height = size * 1.3 + pad * 2;

  x.font = font;
  x.textAlign = "center";
  x.textBaseline = "middle";

  // 白い縁取り (3D上で読みやすく)
  x.strokeStyle = "rgba(255,255,255,0.8)";
  x.lineWidth = 3;
  x.strokeText(char, c.width / 2, c.height / 2);

  // 本体
  x.fillStyle = "#0e1e30";
  x.fillText(char, c.width / 2, c.height / 2);

  return { tex: new THREE.CanvasTexture(c), w: c.width, h: c.height };
}

// ─── 3D Character Block ──────────────────────────────────

const CHAR_SCALE = 0.006;
const BLOCK_DEPTH = 0.08;  // 3Dの厚み

class CharBody {
  constructor(char, engine, position) {
    this.engine = engine;
    this.alive = true;
    this.sinking = false;
    this.sinkTimer = 0;
    this.opacity = 1;

    const t = makeCharTexture(char);
    const w = t.w * CHAR_SCALE;
    const h = t.h * CHAR_SCALE;

    // === Three.js — 3D Box with texture on front ===
    const geo = new THREE.BoxGeometry(w, h, BLOCK_DEPTH);
    const texMat = new THREE.MeshLambertMaterial({
      map: t.tex,
      transparent: true,
    });
    const sideMat = new THREE.MeshLambertMaterial({
      color: 0xc8dce8,
      transparent: true,
    });
    // [+x, -x, +y, -y, +z(front), -z(back)]
    this.materials = [sideMat, sideMat, sideMat, sideMat, texMat, texMat];
    this.mesh = new THREE.Mesh(geo, this.materials);
    this.mesh.castShadow = true;
    this.mesh.renderOrder = 10;
    engine.scene.add(this.mesh);

    // === Cannon-es body — thicker for stable collision ===
    const hw = w * 0.5;
    const hh = h * 0.5;
    const hd = BLOCK_DEPTH * 0.5;
    this.body = new CANNON.Body({
      mass: 0.5,
      position: new CANNON.Vec3(position.x, position.y, position.z),
      material: engine.materials.lyric,
      linearDamping: 0.5,
      angularDamping: 0.85,
      // 着水・連結中は船との物理応答を切る (すり抜ける)
      // shatter 時に true に戻す
      collisionResponse: false,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(hw, hh, hd)));

    this.landed = false;
    this._tex = t.tex;
    engine.world.addBody(this.body);
  }

  update(dt, elapsed) {
    if (!this.alive) return;

    const p = this.body.position;

    // 着水チェック
    if (!this.landed && p.y <= 0.4) {
      this.landed = true;
      this.body.velocity.set(
        this.body.velocity.x * 0.2,
        0,
        this.body.velocity.z * 0.2
      );
      p.y = 0.3;

      // Y 移動制限、Y 軸回転のみ
      this.body.linearFactor.set(1, 0, 1);
      this.body.angularFactor.set(0, 1, 0);
    }

    // 水面ボブ
    if (this.landed && !this.sinking) {
      p.y = 0.3 + Math.sin(elapsed * 0.7 + p.x * 2) * 0.01;
    }

    // 沈水
    if (this.sinking) {
      this.sinkTimer += dt;
      this.body.linearFactor.set(1, 1, 1);
      this.body.angularFactor.set(1, 1, 1);
      this.body.velocity.y = -0.5;
      this.body.velocity.x *= 0.97;
      this.body.velocity.z *= 0.97;

      // 回転しながら沈む
      this.body.angularVelocity.x += (Math.random() - 0.5) * 0.02;

      this.opacity = Math.max(0, 1 - this.sinkTimer * 0.35);
      for (const mat of this.materials) {
        mat.opacity = this.opacity;
      }

      if (this.opacity <= 0) this.alive = false;
    }

    // メッシュ同期
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(
      this.body.quaternion.x,
      this.body.quaternion.y,
      this.body.quaternion.z,
      this.body.quaternion.w
    );
  }

  /** 撞散時: 物理応答を有効化して弾き飛ばされるようにする */
  enableCollision() {
    this.body.collisionResponse = true;
  }

  startSink() {
    this.sinking = true;
    this.body.collisionResponse = false; // 沈む時は通り抜ける
  }

  dispose() {
    this.engine.scene.remove(this.mesh);
    this.engine.world.removeBody(this.body);
    this._tex.dispose();
    for (const mat of this.materials) mat.dispose();
    this.mesh.geometry.dispose();
  }
}

// ─── Phrase Group ─────────────────────────────────────────

class PhraseGroup {
  constructor(text, engine, dropPos) {
    this.engine = engine;
    this.text = text;
    this.chars = [];
    this.constraints = [];
    this.shattered = false;
    this.sinking = false;
    this.allDead = false;
    this.scatterTimer = 0;
    this.scatterSinkDelay = 5;

    // 文字分割 (スペース除外)
    const charArray = [...text].filter(c => c.trim() !== "");

    // 長い句は 8 文字ごとに分割配置 (chain stability)
    const charSpacing = 0.4;
    const maxPerRow = 8;
    const rows = Math.ceil(charArray.length / maxPerRow);

    for (let i = 0; i < charArray.length; i++) {
      const row = Math.floor(i / maxPerRow);
      const col = i % maxPerRow;
      const rowLen = Math.min(maxPerRow, charArray.length - row * maxPerRow);
      const rowWidth = (rowLen - 1) * charSpacing;

      const pos = {
        x: dropPos.x - rowWidth * 0.5 + col * charSpacing,
        y: 7 + Math.random() * 1.5 - row * 0.5, // 行ごとに少しずらす
        z: dropPos.z + row * 0.6 + (Math.random() - 0.5) * 0.2,
      };
      this.chars.push(new CharBody(charArray[i], engine, pos));
    }

    this.constraintsCreated = false;
    this.maxPerRow = maxPerRow;
  }

  createConstraints() {
    if (this.constraintsCreated || this.chars.length < 2) return;

    const allLanded = this.chars.every(c => c.landed);
    if (!allLanded) return;

    this.constraintsCreated = true;

    // 同じ行内のみ連結 (行をまたがない)
    for (let i = 0; i < this.chars.length - 1; i++) {
      // 行境界チェック
      if ((i + 1) % this.maxPerRow === 0) continue;

      const a = this.chars[i].body;
      const b = this.chars[i + 1].body;
      const dist = a.position.distanceTo(b.position);
      const constraint = new CANNON.DistanceConstraint(a, b, dist, 5e3);
      this.engine.world.addConstraint(constraint);
      this.constraints.push(constraint);
    }
  }

  shatter() {
    if (this.shattered) return;
    this.shattered = true;

    // Constraint 解除
    for (const c of this.constraints) {
      this.engine.world.removeConstraint(c);
    }
    this.constraints = [];

    // 衝突応答を有効化 + 散らす力
    for (const ch of this.chars) {
      ch.enableCollision();
      ch.body.linearFactor.set(1, 0, 1);
      ch.body.angularFactor.set(0.3, 1, 0.3);
      ch.body.velocity.x += (Math.random() - 0.5) * 4;
      ch.body.velocity.z += (Math.random() - 0.5) * 4;
      ch.body.angularVelocity.y += (Math.random() - 0.5) * 5;
    }
  }

  startSink() {
    if (this.sinking) return;
    this.sinking = true;

    for (const c of this.constraints) {
      this.engine.world.removeConstraint(c);
    }
    this.constraints = [];

    for (const ch of this.chars) {
      ch.startSink();
    }
  }

  update(dt, elapsed) {
    if (!this.constraintsCreated && !this.shattered) {
      this.createConstraints();
    }

    if (this.shattered && !this.sinking) {
      this.scatterTimer += dt;
      if (this.scatterTimer >= this.scatterSinkDelay) {
        this.startSink();
      }
    }

    for (const ch of this.chars) {
      ch.update(dt, elapsed);
    }

    this.allDead = this.chars.every(c => !c.alive);
  }

  dispose() {
    for (const c of this.constraints) {
      this.engine.world.removeConstraint(c);
    }
    this.constraints = [];
    for (const ch of this.chars) ch.dispose();
    this.chars = [];
  }
}

// ─── LyricManager ────────────────────────────────────────

export class LyricManager {
  constructor(engine, boat) {
    this.engine = engine;
    this.boat = boat;
    this.phrases = [];
    this.currentText = "";

    // 船との衝突検知 (collide イベントは collisionResponse=false でも発火する)
    this.boat.body.addEventListener("collide", (e) => {
      this.onBoatCollide(e);
    });

    engine.addUpdatable(this);
  }

  onBoatCollide(event) {
    const hitBody = event.body;
    for (const phrase of this.phrases) {
      if (phrase.shattered || phrase.sinking) continue;
      for (const ch of phrase.chars) {
        if (ch.body === hitBody) {
          phrase.shatter();
          return;
        }
      }
    }
  }

  getDropPos() {
    const boatPos = this.boat.getPosition();
    const boatQuat = this.boat.body.quaternion;

    const forward = new CANNON.Vec3(0, 0, -1);
    boatQuat.vmult(forward, forward);
    forward.y = 0;
    forward.normalize();

    const dist = 5 + Math.random() * 5;
    const angle = (Math.random() - 0.5) * Math.PI * 0.33;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = forward.x * cos - forward.z * sin;
    const dz = forward.x * sin + forward.z * cos;

    return {
      x: boatPos.x + dx * dist,
      z: boatPos.z + dz * dist,
    };
  }

  addPhrase(text) {
    if (!text || text === this.currentText) return;
    this.currentText = text;

    const floating = this.phrases.filter(p => !p.sinking);
    if (floating.length >= 2) {
      floating[0].startSink();
    }

    const dropPos = this.getDropPos();
    const phrase = new PhraseGroup(text, this.engine, dropPos);
    this.phrases.push(phrase);
  }

  update(dt, elapsed) {
    for (const phrase of this.phrases) {
      phrase.update(dt, elapsed);
    }

    this.phrases = this.phrases.filter(p => {
      if (p.allDead) {
        p.dispose();
        return false;
      }
      return true;
    });
  }
}