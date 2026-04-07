/**
 * LyricManager — floating wooden board system.
 * Each lyric phrase spawns a wooden board mesh that floats on the water surface with physics.
 * Boards bob with the waves, have buoyancy, and fade out over time.
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

function waveHeight(x, z, t) {
  const w = (px, pz, dx, dz, len, amp, spd) =>
    amp * Math.sin(Math.PI * (px * dx + pz * dz) / len + spd * t);
  return w(x, z,  0.8,  0.6, 5.0, 0.08, 0.7)
       + w(x, z, -0.5,  0.8, 8.0, 0.05, 0.5)
       + w(x, z,  0.3, -0.7, 3.0, 0.03, 1.0)
       + w(x, z,  0.6, -0.4, 1.5, 0.012, 1.8)
       + w(x, z, -0.3,  0.9, 2.0, 0.015, 1.4);
}

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

function makeBoardTexture(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  // Wood background
  ctx.fillStyle = "#c09060";
  ctx.fillRect(0, 0, 512, 256);

  // Wood grain lines
  ctx.strokeStyle = "rgba(70,40,10,0.18)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const gy = 256 * (0.1 + Math.random() * 0.8);
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(512, gy + (Math.random() - 0.5) * 20);
    ctx.stroke();
  }

  // Border
  ctx.strokeStyle = "rgba(50,25,8,0.55)";
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 240);

  // Text centered, auto-sized to fit
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let fontSize = 40;
  const fontFace = (s) => `bold ${s}px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
  ctx.font = fontFace(fontSize);
  while (ctx.measureText(text).width > 480 && fontSize > 18) {
    fontSize -= 2;
    ctx.font = fontFace(fontSize);
  }
  ctx.fillStyle = "#18080a";
  ctx.strokeStyle = "rgba(255,230,180,0.5)";
  ctx.lineWidth = 2;
  ctx.strokeText(text, 256, 128);
  ctx.fillText(text, 256, 128);

  return new THREE.CanvasTexture(canvas);
}

class LyricBoard {
  constructor(text, engine, colorHex, boatPos) {
    this.engine = engine;
    this.alive = true;
    this.age = 0;
    this.lifetime = 8.0;

    this.texture = makeBoardTexture(text);

    // Materials: wood sides + textured top
    const woodSide = new THREE.MeshLambertMaterial({ color: 0x8b6030 });
    const topMat = new THREE.MeshLambertMaterial({ map: this.texture });
    // BoxGeometry face order: [+x, -x, +y (top), -y, +z, -z]
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 0.1, 1.2),
      [woodSide, woodSide, topMat, woodSide, woodSide, woodSide]
    );
    this.mesh.castShadow = true;

    // Initial position: at water surface
    const initY = waveHeight(boatPos.x, boatPos.z, 0) + 0.05;
    this.mesh.position.set(boatPos.x, initY, boatPos.z);

    // Physics body
    const shape = new CANNON.Box(new CANNON.Vec3(1.25, 0.05, 0.6));
    this.body = new CANNON.Body({
      mass: 0.5,
      material: engine.materials.lyric,
      linearDamping: 0.7,
      angularDamping: 0.9,
    });
    this.body.addShape(shape);
    // Lock rotation on X and Z axes — board stays flat
    this.body.angularFactor.set(0, 1, 0);
    this.body.position.copy(this.mesh.position);

    // Small random kick away from boat
    const angle = Math.random() * Math.PI * 2;
    const kickDist = 1.0 + Math.random() * 0.5;
    this.body.velocity.set(
      Math.cos(angle) * kickDist,
      0,
      Math.sin(angle) * kickDist
    );

    engine.world.addBody(this.body);
    engine.scene.add(this.mesh);
  }

  preStep(dt, elapsed) {
    if (!this.alive) return;

    // Buoyancy: strong spring force toward wave surface
    const wx = this.body.position.x;
    const wz = this.body.position.z;
    const targetY = waveHeight(wx, wz, elapsed) + 0.05;
    const diff = targetY - this.body.position.y;
    // Strong spring constant + damping
    const springF = diff * 50 - this.body.velocity.y * 5;
    this.body.applyForce(
      new CANNON.Vec3(0, springF * this.body.mass, 0),
      this.body.position
    );

    // Hard clamp: never sink below water surface
    if (this.body.position.y < 0.0) {
      this.body.position.y = 0.0;
      this.body.velocity.y = Math.max(this.body.velocity.y, 0);
    }
  }

  update(dt, elapsed) {
    if (!this.alive) return;
    this.age += dt;

    if (this.age >= this.lifetime) {
      this.alive = false;
      return;
    }

    // Sync mesh to physics body
    this.mesh.position.copy(this.body.position);
    this.mesh.quaternion.copy(this.body.quaternion);

    // Opacity: fade in 0.5s, hold, fade out last 2s
    let opacity = 1.0;
    if (this.age < 0.5) {
      opacity = this.age / 0.5;
    } else if (this.age > this.lifetime - 2.0) {
      opacity = Math.max(0, (this.lifetime - this.age) / 2.0);
    }

    // Apply opacity to all unique materials
    const seen = new Set();
    for (const mat of this.mesh.material) {
      if (!seen.has(mat)) {
        mat.transparent = true;
        mat.opacity = opacity;
        seen.add(mat);
      }
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.engine.scene.remove(this.mesh);
    this.engine.world.removeBody(this.body);
    this.mesh.geometry.dispose();
    const seen = new Set();
    for (const mat of this.mesh.material) {
      if (!seen.has(mat)) { mat.dispose(); seen.add(mat); }
    }
    this.texture.dispose();
    this.engine = null;
  }
}

export class LyricManager {
  constructor(engine, boat, colorHex = 0xffffff) {
    this.engine = engine;
    this.boat = boat;
    this.colorHex = colorHex;
    this.sprites = [];
    this.currentText = "";
    this._updatable = {
      preStep: (dt, elapsed) => this._preStep(dt, elapsed),
      update: (dt, elapsed) => this._update(dt, elapsed),
    };
    engine.addUpdatable(this._updatable);
  }

  _preStep(dt, elapsed) {
    for (const s of this.sprites) {
      if (s.preStep) s.preStep(dt, elapsed);
    }
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
    this.sprites.push(new LyricBoard(text, this.engine, this.colorHex, boatPos));
  }

  _update(dt, elapsed) {
    for (const s of this.sprites) s.update(dt, elapsed);
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
