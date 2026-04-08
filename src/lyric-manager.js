/**
 * ==========================================
 * LyricManager v7 — Draw Call Optimized
 * ==========================================
 * Changes from v6:
 *   - Shared geometry pool: 3 BoxGeometry (short/mid/long) reused by all planks
 *   - Shared wood materials: side + bottom are global singletons
 *     Only the top-face material is unique per plank (lyric texture)
 *   - Canvas downsized: 512 → 256px (viewed from 8m+, no visible diff)
 *   - Texture: mipmaps disabled (256px doesn't need them)
 *   - Shared CANNON.Box shapes per size (Cannon-es allows shape reuse)
 *   - Floating count tracked as counter, not .filter() per addPhrase
 *   - update() uses swap-remove instead of .filter() — O(1) per dead plank
 *   - Sinking: clones shared materials only when sink starts (lazy clone)
 *     so floating planks share everything
 *   - dispose() only releases owned resources
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

// ─── Helpers ─────────────────────────────────────────────

function damp(factor, dt) {
  return Math.pow(factor, dt * 60);
}

// ─── Lyric texture (256px) ───────────────────────────────

function makeLyricTexture(text, canvasW, canvasH) {
  const c = document.createElement("canvas");
  c.width = canvasW;
  c.height = canvasH;
  const x = c.getContext("2d");

  x.fillStyle = "#a07848";
  x.fillRect(0, 0, c.width, c.height);

  // Wood grain
  x.strokeStyle = "rgba(80,50,20,0.15)";
  x.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    const y = c.height * (0.15 + Math.random() * 0.7);
    x.beginPath();
    x.moveTo(0, y);
    x.lineTo(c.width, y + (Math.random() - 0.5) * 6);
    x.stroke();
  }

  // Font sizing (binary search)
  const font = (s) => `bold ${s}px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
  const targetW = c.width * 0.88;
  let lo = 10, hi = c.height * 0.5;
  while (hi - lo > 2) {
    const mid = (lo + hi) / 2;
    x.font = font(mid);
    if (x.measureText(text).width > targetW) hi = mid;
    else lo = mid;
  }
  x.font = font(Math.floor(lo));
  x.textAlign = "center";
  x.textBaseline = "middle";

  x.strokeStyle = "rgba(255,255,255,0.85)";
  x.lineWidth = 2.5;
  x.strokeText(text, c.width / 2, c.height / 2);

  x.fillStyle = "#1a1020";
  x.fillText(text, c.width / 2, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

// ─── Shared resources (created once, never disposed) ─────

const PLANK_DIMS = {
  short: { w: 1.8, h: 0.08, d: 0.5 },
  mid:   { w: 2.8, h: 0.08, d: 0.5 },
  long:  { w: 4.0, h: 0.08, d: 0.5 },
};

const sharedGeo = {};
const sharedShape = {};
for (const [key, { w, h, d }] of Object.entries(PLANK_DIMS)) {
  sharedGeo[key] = new THREE.BoxGeometry(w, h, d);
  sharedShape[key] = new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2));
}

const matWoodSide   = new THREE.MeshLambertMaterial({ color: 0x8B6914 });
const matWoodBottom = new THREE.MeshLambertMaterial({ color: 0x6B4E31 });

const _plankForce = new CANNON.Vec3();

// ─── Single Plank ────────────────────────────────────────

class LyricPlank {
  constructor(text, engine, sizeKey, dropPos) {
    this.engine = engine;
    this.alive = true;
    this.sinking = false;
    this.sinkTimer = 0;

    const dims = PLANK_DIMS[sizeKey];

    // Unique per plank: lyric texture + top material
    this.lyricTex = makeLyricTexture(text, 256, Math.round(256 * (dims.d / dims.w)));
    this.topMat = new THREE.MeshLambertMaterial({ map: this.lyricTex });

    // [+x, -x, +y, -y, +z, -z] — shared sides/bottom, unique top
    this.materials = [
      matWoodSide, matWoodSide,
      this.topMat, matWoodBottom,
      matWoodSide, matWoodSide,
    ];

    // Mesh (shared geometry)
    this.mesh = new THREE.Mesh(sharedGeo[sizeKey], this.materials);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    engine.scene.add(this.mesh);

    // Physics body (shared shape)
    this.body = new CANNON.Body({
      mass: 2,
      position: new CANNON.Vec3(dropPos.x, 5 + Math.random() * 2, dropPos.z),
      material: engine.materials.lyric,
      linearDamping: 0.6,
      angularDamping: 0.85,
      allowSleep: false,  // MUST stay awake — sleeping bodies don't collide
    });
    this.body.addShape(sharedShape[sizeKey]);
    engine.world.addBody(this.body);

    // Sink-specific cloned materials (created lazily in startSink)
    this._sinkSide = null;
    this._sinkBottom = null;
  }

  update(dt) {
    if (!this.alive) return;

    const body = this.body;
    const p = body.position;
    const vel = body.velocity;

    if (!this.sinking) {
      // Buoyancy spring — waterLevel must match boat.js
      _plankForce.set(0, 125 * (0.35 - p.y) - 20 * vel.y, 0);
      body.applyForce(_plankForce);

      // Restoring torque
      const q = body.quaternion;
      body.angularVelocity.x += (-q.x * 40 - body.angularVelocity.x * 4) * dt;
      body.angularVelocity.z += (-q.z * 40 - body.angularVelocity.z * 4) * dt;

      // Water drag
      if (p.y < 0.2) {
        const d = damp(0.995, dt);
        vel.x *= d;
        vel.z *= d;
      }
    } else {
      // Sinking
      this.sinkTimer += dt;

      _plankForce.set(0, -2.5, 0);
      body.applyForce(_plankForce);

      const d = damp(0.98, dt);
      vel.x *= d;
      vel.z *= d;

      body.angularVelocity.x += (Math.random() - 0.5) * 0.6 * dt;
      body.angularVelocity.z += (Math.random() - 0.5) * 0.3 * dt;

      // Fade all cloned materials
      const opacity = Math.max(0, 1 - this.sinkTimer * 0.3);
      for (const mat of this.materials) {
        mat.transparent = true;
        mat.opacity = opacity;
      }
      if (opacity <= 0) this.alive = false;
    }

    // Sync mesh
    this.mesh.position.copy(p);
    this.mesh.quaternion.set(
      body.quaternion.x, body.quaternion.y,
      body.quaternion.z, body.quaternion.w
    );
  }

  startSink() {
    if (this.sinking) return;
    this.sinking = true;
    this.body.collisionResponse = false;

    // Clone shared materials so fading doesn't affect other planks
    this._sinkSide = matWoodSide.clone();
    this._sinkBottom = matWoodBottom.clone();
    this.materials = [
      this._sinkSide, this._sinkSide,
      this.topMat, this._sinkBottom,
      this._sinkSide, this._sinkSide,
    ];
    this.mesh.material = this.materials;
  }

  dispose() {
    this.engine.scene.remove(this.mesh);
    this.engine.world.removeBody(this.body);
    // Only dispose owned resources
    this.lyricTex.dispose();
    this.topMat.dispose();
    if (this._sinkSide) this._sinkSide.dispose();
    if (this._sinkBottom) this._sinkBottom.dispose();
    // sharedGeo, matWoodSide, matWoodBottom, sharedShape are NEVER disposed
  }
}

// ─── LyricManager ────────────────────────────────────────

export class LyricManager {
  constructor(engine, boat) {
    this.engine = engine;
    this.boat = boat;
    this.planks = [];
    this.floatingCount = 0;
    this.lastPhraseTime = -1;
    this.ready = false;

    this._loadModels();
    this._fwdVec = new CANNON.Vec3();

    engine.addUpdatable(this);
  }

  async _loadModels() {
    this.ready = true;
  }

  _pickSizeKey(text) {
    const len = [...text].filter(c => c.trim()).length;
    if (len <= 4) return "short";
    if (len <= 8) return "mid";
    return "long";
  }

  _getDropPos() {
    const boatPos = this.boat.getPosition();
    const boatQuat = this.boat.body.quaternion;

    const fwd = this._fwdVec;
    fwd.set(0, 0, -1);
    boatQuat.vmult(fwd, fwd);
    fwd.y = 0;
    fwd.normalize();

    const dist = 4 + Math.random() * 4;
    const angle = (Math.random() - 0.5) * Math.PI * 0.4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    return {
      x: boatPos.x + (fwd.x * cos - fwd.z * sin) * dist,
      z: boatPos.z + (fwd.x * sin + fwd.z * cos) * dist,
    };
  }

  addPhrase(phrase) {
    if (!this.ready || !phrase) return;

    const text = typeof phrase === "string" ? phrase : phrase.text;
    const startTime = typeof phrase === "object" ? phrase.startTime : -1;
    if (!text) return;

    if (startTime >= 0) {
      if (startTime === this.lastPhraseTime) return;
      this.lastPhraseTime = startTime;
    }

    // Sink oldest floating if 2+ are afloat (linear scan, but only 2-3 items)
    if (this.floatingCount >= 2) {
      for (const p of this.planks) {
        if (!p.sinking && p.alive) {
          p.startSink();
          this.floatingCount--;
          break;
        }
      }
    }

    const sizeKey = this._pickSizeKey(text);
    const dropPos = this._getDropPos();
    this.planks.push(new LyricPlank(text, this.engine, sizeKey, dropPos));
    this.floatingCount++;
  }

  update(dt, elapsed) {
    for (const p of this.planks) p.update(dt);

    // Swap-remove dead planks: O(1) per removal, no array rebuild
    let i = 0;
    while (i < this.planks.length) {
      const p = this.planks[i];
      if (!p.alive) {
        if (!p.sinking) this.floatingCount--; // safety
        p.dispose();
        // Swap last element into this slot
        this.planks[i] = this.planks[this.planks.length - 1];
        this.planks.pop();
        // Don't increment i — re-check the swapped element
      } else {
        i++;
      }
    }
  }
}