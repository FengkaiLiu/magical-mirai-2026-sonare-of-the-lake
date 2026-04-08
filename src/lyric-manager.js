/**
 * ==========================================
 * LyricManager v5 — Wood Plank Lyrics
 * ==========================================
 * Uses BoxGeometry for rendering (reliable multi-material).
 * GLB model used only for plank dimensions.
 * Text rendered on top face via CanvasTexture.
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ─── Lyric texture ───────────────────────────────────────

function makeLyricTexture(text, canvasW, canvasH) {
  const c = document.createElement("canvas");
  c.width = canvasW;
  c.height = canvasH;
  const x = c.getContext("2d");

  // Wood-colored background
  x.fillStyle = "#a07848";
  x.fillRect(0, 0, c.width, c.height);

  // Simple wood grain lines
  x.strokeStyle = "rgba(80,50,20,0.15)";
  x.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const y = c.height * (0.15 + Math.random() * 0.7);
    x.beginPath();
    x.moveTo(0, y);
    x.lineTo(c.width, y + (Math.random() - 0.5) * 8);
    x.stroke();
  }

  // Calculate font size to fit
  const maxFont = c.height * 0.5;
  let fontSize = maxFont;
  const font = (s) => `bold ${s}px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
  x.font = font(fontSize);
  while (x.measureText(text).width > c.width * 0.88 && fontSize > 14) {
    fontSize -= 2;
    x.font = font(fontSize);
  }

  x.textAlign = "center";
  x.textBaseline = "middle";

  // White outline
  x.strokeStyle = "rgba(255,255,255,0.85)";
  x.lineWidth = 3;
  x.strokeText(text, c.width / 2, c.height / 2);

  // Dark text
  x.fillStyle = "#1a1020";
  x.fillText(text, c.width / 2, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  return tex;
}

// ─── Plank dimensions (fallback if GLB fails) ────────────

const PLANK_SIZES = {
  short: { w: 1.8, h: 0.08, d: 0.5 },
  mid:   { w: 2.8, h: 0.08, d: 0.5 },
  long:  { w: 4.0, h: 0.08, d: 0.5 },
};

// ─── Single Plank ────────────────────────────────────────

class LyricPlank {
  constructor(text, engine, size, dropPos) {
    this.engine = engine;
    this.alive = true;
    this.sinking = false;
    this.sinkTimer = 0;

    const { w, h, d } = size;

    // === Lyric texture for top face ===
    this.lyricTex = makeLyricTexture(text, 512, Math.round(512 * (d / w)));

    // === Materials: wood sides, textured top ===
    const woodSide = new THREE.MeshLambertMaterial({ color: 0x8B6914 });
    const woodBottom = new THREE.MeshLambertMaterial({ color: 0x6B4E31 });
    const topMat = new THREE.MeshLambertMaterial({ map: this.lyricTex });

    // BoxGeometry faces: [+x, -x, +y, -y, +z, -z]
    this.materials = [woodSide, woodSide, topMat, woodBottom, woodSide, woodSide];

    // === Three.js mesh ===
    const geo = new THREE.BoxGeometry(w, h, d);
    this.mesh = new THREE.Mesh(geo, this.materials);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    engine.scene.add(this.mesh);

    // === Cannon-es body (flat plank) ===
    this.body = new CANNON.Body({
      mass: 2,
      position: new CANNON.Vec3(dropPos.x, 5 + Math.random() * 2, dropPos.z),
      material: engine.materials.lyric,
      linearDamping: 0.6,
      angularDamping: 0.85,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
    engine.world.addBody(this.body);
  }

  update(dt, elapsed) {
    if (!this.alive) return;

    const p = this.body.position;
    const vel = this.body.velocity;

    if (!this.sinking) {
      // === Buoyancy: spring force toward water surface ===
      const waterLevel = 0.40;
      const buoyancy = (waterLevel - p.y) * 25;
      vel.y += buoyancy * dt;
      vel.y *= 0.85; // water damping

      // 水平ロック
      this.body.angularVelocity.x = 0;
      this.body.angularVelocity.z = 0;
      this.body.quaternion.x = 0;
      this.body.quaternion.z = 0;
      this.body.quaternion.normalize();

      // Slow down after landing (water drag)
      if (p.y < 0.2) {
        vel.x *= 0.995;
        vel.z *= 0.995;
      }
    } else {
      // === Sinking ===
      this.sinkTimer += dt;
      vel.y -= 0.5 * dt; // gentle pull down
      vel.x *= 0.98;
      vel.z *= 0.98;
      // Tilt while sinking
      this.body.angularVelocity.x += (Math.random() - 0.5) * 0.01;
      this.body.angularVelocity.z += (Math.random() - 0.5) * 0.005;

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
      this.body.quaternion.x, this.body.quaternion.y,
      this.body.quaternion.z, this.body.quaternion.w
    );
  }

  startSink() {
    if (this.sinking) return;
    this.sinking = true;
    this.body.collisionResponse = false;
  }

  dispose() {
    this.engine.scene.remove(this.mesh);
    this.engine.world.removeBody(this.body);
    this.lyricTex.dispose();
    this.mesh.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}

// ─── LyricManager ────────────────────────────────────────

export class LyricManager {
  constructor(engine, boat) {
    this.engine = engine;
    this.boat = boat;
    this.planks = [];
    this.currentText = "";
    this.sizes = { ...PLANK_SIZES };
    this.ready = false;

    this._loadModels();
    engine.addUpdatable(this);
  }

  async _loadModels() {
    this.ready = true;
  }

  _pickSize(text) {
    const len = [...text].filter(c => c.trim()).length;
    if (len <= 4) return this.sizes.short;
    if (len <= 8) return this.sizes.mid;
    return this.sizes.long;
  }

  _getDropPos() {
    const boatPos = this.boat.getPosition();
    const boatQuat = this.boat.body.quaternion;

    const forward = new CANNON.Vec3(0, 0, -1);
    boatQuat.vmult(forward, forward);
    forward.y = 0;
    forward.normalize();

    const dist = 4 + Math.random() * 4;
    const angle = (Math.random() - 0.5) * Math.PI * 0.4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    return {
      x: boatPos.x + (forward.x * cos - forward.z * sin) * dist,
      z: boatPos.z + (forward.x * sin + forward.z * cos) * dist,
    };
  }

  addPhrase(text) {
    if (!this.ready || !text || text === this.currentText) return;
    this.currentText = text;

    // Sink oldest if 2+ floating
    const floating = this.planks.filter(p => !p.sinking);
    if (floating.length >= 2) {
      floating[0].startSink();
    }

    const size = this._pickSize(text);
    const dropPos = this._getDropPos();
    this.planks.push(new LyricPlank(text, this.engine, size, dropPos));
  }

  update(dt, elapsed) {
    for (const p of this.planks) p.update(dt, elapsed);
    this.planks = this.planks.filter(p => {
      if (!p.alive) { p.dispose(); return false; }
      return true;
    });
  }
}