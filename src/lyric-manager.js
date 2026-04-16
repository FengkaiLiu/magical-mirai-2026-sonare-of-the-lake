/**
 * LyricManager — Glowing Water Decal system.
 * Each lyric phrase spawns a luminous plane that rides the wave surface.
 * No physics — Y position is computed directly from waveHeight each frame,
 * so the text can never sink below the water.
 */

import * as THREE from "three";

function waveHeight(x, z, t, energy = 0) {
  const ampMod = 1.0 + energy * 2.0;
  const spdMod = 1.0 + energy * 1.5;
  const w = (px, pz, dx, dz, len, amp, spd) =>
    amp * ampMod * Math.sin(Math.PI * (px * dx + pz * dz) / len + spd * spdMod * t);
  return w(x, z,  0.8,  0.6, 5.0, 0.08, 0.7)
       + w(x, z, -0.5,  0.8, 8.0, 0.05, 0.5)
       + w(x, z,  0.3, -0.7, 3.0, 0.03, 1.0)
       + w(x, z,  0.6, -0.4, 1.5, 0.012, 1.8)
       + w(x, z, -0.3,  0.9, 2.0, 0.015, 1.4);
}

/**
 * Renders luminous text onto a 512×256 canvas using four glow passes.
 * The canvas background is fully transparent so AdditiveBlending on the
 * mesh only adds light where the glow/text pixels are.
 */
function makeGlowTexture(text, colorHex = 0x00eeff) {
  const W = 512, H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  const r = (colorHex >> 16) & 255;
  const g = (colorHex >>  8) & 255;
  const b =  colorHex        & 255;
  const hexStr = `#${colorHex.toString(16).padStart(6, "0")}`;

  let fontSize = 56;
  const fontFace = (s) => `bold ${s}px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
  ctx.font = fontFace(fontSize);
  while (ctx.measureText(text).width > 480 && fontSize > 22) {
    fontSize -= 2;
    ctx.font = fontFace(fontSize);
  }
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  // Pass 1 — wide outer halo in theme colour
  ctx.shadowColor = hexStr;
  ctx.shadowBlur  = 32;
  ctx.fillStyle   = `rgba(${r},${g},${b},0.18)`;
  ctx.fillText(text, W / 2, H / 2);

  // Pass 2 — mid glow
  ctx.shadowBlur = 16;
  ctx.fillStyle  = `rgba(${r},${g},${b},0.45)`;
  ctx.fillText(text, W / 2, H / 2);

  // Pass 3 — tight inner glow
  ctx.shadowColor = "white";
  ctx.shadowBlur  = 8;
  ctx.fillStyle   = `rgba(${r},${g},${b},0.8)`;
  ctx.fillText(text, W / 2, H / 2);

  // Pass 4 — sharp white core
  ctx.shadowBlur = 3;
  ctx.fillStyle  = "rgba(255,255,255,0.95)";
  ctx.fillText(text, W / 2, H / 2);

  return new THREE.CanvasTexture(canvas);
}

// Shared horizontal plane geometry (2:1 aspect matches the 512×256 canvas).
// rotateX is baked into the vertices so each mesh transform is independent.
let _decalGeo = null;
function getDecalGeo() {
  if (!_decalGeo) {
    _decalGeo = new THREE.PlaneGeometry(2.8, 1.4);
    _decalGeo.rotateX(-Math.PI / 2); // lay flat in XZ plane
  }
  return _decalGeo;
}

class WaterDecal {
  constructor(text, engine, colorHex, boatPos) {
    this.engine   = engine;
    this.alive    = true;
    this.age      = 0;
    this.lifetime = 8.0;

    // Spawn at a random offset around the boat
    const angle = Math.random() * Math.PI * 2;
    const dist  = 3.0 + Math.random() * 2.0;
    this.x = boatPos.x + Math.cos(angle) * dist;
    this.z = boatPos.z + Math.sin(angle) * dist;

    // Drift slowly outward
    this.vx = Math.cos(angle) * (0.3 + Math.random() * 0.4);
    this.vz = Math.sin(angle) * (0.3 + Math.random() * 0.4);

    const texture = makeGlowTexture(text, colorHex);

    this.material = new THREE.MeshBasicMaterial({
      map:         texture,
      transparent: true,
      opacity:     0,
      depthWrite:  false,
      side:        THREE.DoubleSide,
      blending:    THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(getDecalGeo(), this.material);
    // Random yaw so each decal faces a different direction on the water
    this.mesh.rotation.y = Math.random() * Math.PI * 2;
    this.mesh.renderOrder = 1; // render after water (renderOrder 0)

    const energy = (engine.env && engine.env.smoothedEnergy) || 0;
    const initY  = waveHeight(this.x, this.z, 0, energy) + 0.15;
    this.mesh.position.set(this.x, initY, this.z);

    engine.scene.add(this.mesh);
  }

  update(dt, elapsed) {
    if (!this.alive) return;
    this.age += dt;
    if (this.age >= this.lifetime) {
      this.alive = false;
      return;
    }

    // Drift
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Strictly bind Y to the wave surface — can never sink
    const energy = (this.engine.env && this.engine.env.smoothedEnergy) || 0;
    const wh = waveHeight(this.x, this.z, elapsed, energy);
    this.mesh.position.set(this.x, wh + 0.15, this.z);

    // Opacity: 0.4 s fade-in → hold → fade-out
    const fadeOut = this.fadeOutDuration ?? 1.5;
    let opacity = 1.0;
    if (this.age < 0.4) {
      opacity = this.age / 0.4;
    } else if (this.age > this.lifetime - fadeOut) {
      opacity = Math.max(0, (this.lifetime - this.age) / fadeOut);
    }
    // Pulse brightness with bass energy
    this.material.opacity = Math.min(1.0, opacity * (1.0 + energy * 0.35));
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.engine.scene.remove(this.mesh);
    this.material.map?.dispose();
    this.material.dispose();
    // _decalGeo is shared — do NOT dispose it here
    this.engine = null;
  }
}

class SkyLyricSystem {
  constructor(engine, colorHex) {
    this.engine   = engine;
    this.colorHex = colorHex;
    this.phrases  = [];

    this.particleGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  }

  addPhrase(text, boatPos) {
    // Force existing phrases to fade out quickly before the new one appears
    const QUICK_FADE = 0.6;
    for (const p of this.phrases) {
      const remaining = p.life - p.age;
      if (remaining > QUICK_FADE) {
        p.life = p.age + QUICK_FADE;
        p.fadeOutDuration = QUICK_FADE;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width  = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, 1024, 256);

    // Auto-scale font size to fit long lyrics
    let fontSize = 70;
    const font = (s) => `bold ${s}px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
    ctx.font = font(fontSize);
    while (ctx.measureText(text).width > 980 && fontSize > 20) {
      fontSize -= 5;
      ctx.font = font(fontSize);
    }

    ctx.fillStyle    = "white";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 512, 128);

    const data   = ctx.getImageData(0, 0, 1024, 256).data;
    const points = [];

    for (let y = 0; y < 256; y += 1.5) {
      for (let x = 0; x < 1024; x += 1.5) {
        const i = (Math.floor(y) * 1024 + Math.floor(x)) * 4;
        if (data[i] > 128) {
          points.push({
            tx: (x - 512) * 0.06,
            ty: -(y - 128) * 0.06,
            sx: (Math.random() - 0.5) * 25,
            sy: (Math.random() - 0.5) * 25,
            sz: (Math.random() - 0.5) * 25,
          });
        }
      }
    }

    if (points.length === 0) return;

    const mat = new THREE.MeshBasicMaterial({
      color:       0xffffff,
      transparent: true,
      opacity:     0.0,
    });

    const particleGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const imesh = new THREE.InstancedMesh(particleGeo, mat, points.length);
    imesh.position.set(boatPos.x, 25, boatPos.z - 40);
    this.engine.scene.add(imesh);

    this.phrases.push({
      mesh: imesh,
      geo:  particleGeo,
      points,
      life: 6.0,
      age:  0,
    });
  }

  update(dt) {
    const dummy = new THREE.Object3D();
    for (const p of this.phrases) {
      p.age += dt;

      const progress = Math.min(1.0, p.age / 1.5);
      const ease = 1.0 - Math.pow(1.0 - progress, 3); // cubic ease-out

      for (let i = 0; i < p.points.length; i++) {
        const pt = p.points[i];
        dummy.position.set(
          THREE.MathUtils.lerp(pt.sx, pt.tx, ease),
          THREE.MathUtils.lerp(pt.sy, pt.ty, ease),
          THREE.MathUtils.lerp(pt.sz, 0, ease),
        );
        dummy.scale.setScalar(1.2 + Math.sin(p.age * 3 + i) * 0.4);
        dummy.updateMatrix();
        p.mesh.setMatrixAt(i, dummy.matrix);
      }
      p.mesh.instanceMatrix.needsUpdate = true;
      p.mesh.position.y += dt * 0.3;

      const fadeOut  = p.fadeOutDuration ?? 1.5;
      let   opacity  = 1.0;
      if (p.age < 0.25) opacity = p.age / 0.25;
      else if (p.age > p.life - fadeOut) opacity = Math.max(0, (p.life - p.age) / fadeOut);
      p.mesh.material.opacity = opacity;
    }

    this.phrases = this.phrases.filter(p => {
      if (p.age > p.life) {
        this.engine.scene.remove(p.mesh);
        p.mesh.material.dispose();
        if (p.geo) p.geo.dispose();
        p.mesh.dispose();
        return false;
      }
      return true;
    });
  }

  dispose() {
    for (const p of this.phrases) {
      if (p.mesh.parent) this.engine.scene.remove(p.mesh);
      p.mesh.material.dispose();
      if (p.geo) p.geo.dispose();
      p.mesh.dispose();
    }
  }
}

export class LyricManager {
  constructor(engine, boat, colorHex = 0xffffff) {
    this.engine    = engine;
    this.boat      = boat;
    this.colorHex  = colorHex;
    this.isChorus  = false;
    this.skySystem = new SkyLyricSystem(engine, colorHex);
    this.sprites   = [];
    this.currentText = "";
    this._updatable = {
      preStep: (dt, elapsed) => this._preStep(dt, elapsed),
      update:  (dt, elapsed) => this._update(dt, elapsed),
    };
    engine.addUpdatable(this._updatable);
  }

  _preStep(dt, elapsed) {
    for (const s of this.sprites) {
      if (s.preStep) s.preStep(dt, elapsed);
    }
  }

  setChorusMode(isChorus) {
    this.isChorus = isChorus;
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
    if (this.isChorus) {
      this.skySystem.addPhrase(text, boatPos);
    } else {
      // Quick-fade existing decals so new text feels fresh
      const BOARD_QUICK_FADE = 0.6;
      for (const s of this.sprites) {
        const remaining = s.lifetime - s.age;
        if (remaining > BOARD_QUICK_FADE) {
          s.lifetime = s.age + BOARD_QUICK_FADE;
          s.fadeOutDuration = BOARD_QUICK_FADE;
        }
      }
      this.sprites.push(new WaterDecal(text, this.engine, this.colorHex, boatPos));
    }
  }

  _update(dt, elapsed) {
    this.skySystem.update(dt);
    for (const s of this.sprites) s.update(dt, elapsed);
    this.sprites = this.sprites.filter(s => {
      if (!s.alive) { s.dispose(); return false; }
      return true;
    });
  }

  dispose() {
    this.engine.removeUpdatable(this._updatable);
    for (const s of this.sprites) s.dispose();
    this.skySystem.dispose();
    this.sprites = [];
  }
}
