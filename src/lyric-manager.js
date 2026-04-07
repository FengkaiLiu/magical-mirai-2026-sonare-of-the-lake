/**
 * LyricManager — rising 3D lyric slab system.
 * Each lyric phrase spawns a billboarded BoxGeometry mesh with CanvasTexture near the boat.
 * Slabs rise upward, decelerate, then fade out. No physics.
 */

import * as THREE from "three";

function makeTextTexture(text, colorHex) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 256);

  const hexStr = "#" + colorHex.toString(16).padStart(6, "0");

  // Radial gradient fill: bright highlight at top-left → translucent blue at edge
  const grad = ctx.createRadialGradient(85, 85, 8, 128, 128, 120);
  grad.addColorStop(0,   "rgba(255, 255, 255, 0.65)");
  grad.addColorStop(0.4, "rgba(180, 220, 255, 0.35)");
  grad.addColorStop(1,   "rgba(100, 180, 255, 0.18)");

  // Clip to circle, fill bubble
  ctx.save();
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  ctx.restore();

  // Border ring
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(200, 235, 255, 0.7)";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Glossy highlight: small rotated ellipse at top-left
  ctx.save();
  ctx.translate(55, 50);
  ctx.rotate(-0.6);
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fill();
  ctx.restore();

  // Text centered in bubble, auto-sized to fit within 200px diameter
  let fontSize = 52;
  const fontFace = (s) =>
    `bold ${s}px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
  ctx.font = fontFace(fontSize);
  while (ctx.measureText(text).width > 180 && fontSize > 24) {
    fontSize -= 2;
    ctx.font = fontFace(fontSize);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = hexStr;
  ctx.shadowBlur = 10;
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fillText(text, 128, 128);

  return new THREE.CanvasTexture(canvas);
}

class LyricSprite {
  constructor(text, engine, colorHex, boatPos) {
    this.engine = engine;
    this.camera = engine.camera;
    this.alive = true;
    this.age = 0;
    this.lifetime = 3.0;

    this.texture = makeTextTexture(text, colorHex);

    // Side faces: solid blue edge matching bubble rim
    const sideMat = new THREE.MeshBasicMaterial({
      color: 0x4090c0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    // Front (+z) and back (-z) faces: the bubble canvas
    const faceMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    // BoxGeometry face order: right(+x), left(-x), top(+y), bottom(-y), front(+z), back(-z)
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 2.5, 0.12),
      [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat]
    );

    // Start near-zero (pop in over 150ms); depth (Z scale) stays fixed at 1
    this.mesh.scale.set(0.01, 0.01, 1);

    // Random scatter within 3 units of boat
    const angle = Math.random() * Math.PI * 2;
    const r = 0.5 + Math.random() * 2.5;
    this.mesh.position.set(
      boatPos.x + Math.cos(angle) * r,
      boatPos.y + 0.3,
      boatPos.z + Math.sin(angle) * r
    );

    // Upward + gentle lateral velocity
    this.vel = new THREE.Vector3(
      (Math.random() - 0.5) * 0.8,
      2.0 + Math.random() * 1.0,
      (Math.random() - 0.5) * 0.8
    );

    engine.scene.add(this.mesh);
  }

  update(dt) {
    if (!this.alive) return;
    this.age += dt;
    const t = this.age / this.lifetime;

    if (t >= 1) { this.alive = false; return; }

    // Billboard: always face the camera
    this.mesh.quaternion.copy(this.camera.quaternion);

    // Decelerate: exponential drag on velocity
    const drag = Math.exp(-this.age * 1.2);
    this.mesh.position.x += this.vel.x * drag * dt;
    this.mesh.position.y += this.vel.y * drag * dt;
    this.mesh.position.z += this.vel.z * drag * dt;

    // Scale pop: X and Y grow 0→2.5 over first 150ms; Z (depth 0.12) stays fixed
    const scaleFactor = Math.min(this.age / 0.15, 1.0);
    const w = 2.5 * scaleFactor;
    this.mesh.scale.set(w, w, 1);

    // Opacity: fade in 0→1 over 150ms, hold, fade out over last 1s
    let opacity;
    if (this.age < 0.15) {
      opacity = this.age / 0.15;
    } else if (this.age > this.lifetime - 1.0) {
      opacity = Math.max(0, (this.lifetime - this.age) / 1.0);
    } else {
      opacity = 1.0;
    }

    // Apply opacity to all materials (sideMat shared by indices 0-3, faceMat by 4-5)
    const seen = new Set();
    for (const mat of this.mesh.material) {
      if (!seen.has(mat)) { mat.opacity = opacity; seen.add(mat); }
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.engine.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    const seen = new Set();
    for (const mat of this.mesh.material) {
      if (!seen.has(mat)) { mat.dispose(); seen.add(mat); }
    }
    this.texture.dispose();
    this.engine = null;
    this.camera = null;
  }
}

export class LyricManager {
  constructor(engine, boat, colorHex = 0xffffff) {
    this.engine = engine;
    this.boat = boat;
    this.colorHex = colorHex;
    this.sprites = [];
    this.currentText = "";
    this._updatable = { update: (dt) => this._update(dt) };
    engine.addUpdatable(this._updatable);
  }

  addPhrase(text) {
    if (!text || text === this.currentText) return;
    this.currentText = text;

    // Cull oldest if at cap
    while (this.sprites.length >= 40) {
      this.sprites[0].dispose();
      this.sprites.shift();
    }

    const boatPos = this.boat.getPosition();
    this.sprites.push(new LyricSprite(text, this.engine, this.colorHex, boatPos));
  }

  _update(dt) {
    for (const s of this.sprites) s.update(dt);
    this.sprites = this.sprites.filter(s => {
      if (!s.alive) { s.dispose(); return false; }
      return true;
    });
  }

  dispose() {
    this.engine.removeUpdatable(this._updatable);
    for (const s of this.sprites) s.dispose();
    this.sprites = [];
  }
}
