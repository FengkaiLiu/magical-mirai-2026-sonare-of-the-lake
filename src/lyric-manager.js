/**
 * LyricManager — troika-three-text based lyric rendering.
 *
 * WaterDecal (lake view):
 *   troika Text mesh lying flat on the wave surface. renderOrder=0 so THREE.js
 *   renders the opaque boat BEFORE these transparent meshes; the depth buffer
 *   written by the boat then correctly occludes the decals.
 *
 * SkyLyricSystem (sky/chorus view):
 *   InstancedMesh cloud particles sampled from canvas pixel data converge from
 *   random scatter positions into glyph shapes (original approach).
 *   No troika text layer — pure particle cloud for the sky effect.
 *
 * Note: fish-school.js and song-circles.js still use canvas pixel sampling to
 * extract point-cloud positions for their particle animations — that is a
 * particle-position generator, not a text renderer, and troika has no equivalent
 * "give me all filled pixels" API.
 */

import * as THREE from "three";
import { Text } from "troika-three-text";
import { waveHeight } from "./boat.js";

// ── Font asset URLs ───────────────────────────────────────────────────────────
// Vite resolves ?url imports into hashed public asset paths at build time.
// The paths are relative to this file (src/), so ../fonts/ = project-root/fonts/.
import _FONT_KIWIMARU from "../fonts/KiwiMaru-Regular.ttf?url";
import _FONT_CAVEAT   from "../fonts/Caveat-Regular.ttf?url";

// Preload CSS fonts so canvas 2D ctx.font uses Caveat/KiwiMaru for particle sampling
document.fonts.load('bold 70px "Caveat"');
document.fonts.load('400 70px "KiwiMaru"');

/**
 * Choose font by content: KiwiMaru for Japanese/CJK glyphs, Caveat for Latin.
 * Troika's unicode-font-resolver handles any remaining gaps automatically.
 */
function pickFont(text) {
  return /[\u3000-\u9FFF\uF900-\uFAFF]/.test(text) ? _FONT_KIWIMARU : _FONT_CAVEAT;
}

// Max world-coordinate for sky lyric formation center — keeps particles visible inside mountains.
// Tune this if particles still clip behind terrain from the edge.
const SKY_POS_BOUNDARY = 73;

// ── Shared sky particle geometry (session lifetime — never disposed per phrase) ──
// 0.07 side length: at canvas scale 0.06, sampling step 1.5 px → 0.09 world-unit
// spacing between particle centres. Particles are slightly smaller than the gap,
// giving each character a clean cloud of individual dots without kanji strokes
// mashing into an unreadable solid block.
let _skyParticleGeo = null;
function getSkyParticleGeo() {
  if (!_skyParticleGeo) _skyParticleGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  return _skyParticleGeo;
}

// Sky lyric canvas-sampling cache (avoids re-running pixel loop for repeated lyrics)
const _skyPointsCache = new Map();

/** Canvas pixel-sample text to glyph-shape XY target points. Module-level so the
 *  same cache can be primed during preload via LyricManager.prewarmPhrase(). */
function _sampleSkyPoints(text) {
  if (_skyPointsCache.has(text)) return _skyPointsCache.get(text);

  const canvas = document.createElement("canvas");
  canvas.width  = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, 1024, 256);

  const isJP  = /[　-鿿豈-﫿]/.test(text);
  const fName = isJP ? '"KiwiMaru"' : '"Caveat"';
  let fontSize = 70;
  const font = s => `bold ${s}px ${fName},"M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
  ctx.font = font(fontSize);
  while (ctx.measureText(text).width > 980 && fontSize > 20) {
    fontSize -= 5;
    ctx.font = font(fontSize);
  }

  ctx.fillStyle    = "white";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 512, 128);

  const data = ctx.getImageData(0, 0, 1024, 256).data;
  const pts  = [];
  for (let y = 0; y < 256; y += 1.5) {
    for (let x = 0; x < 1024; x += 1.5) {
      const i = (Math.floor(y) * 1024 + Math.floor(x)) * 4;
      if (data[i] > 128) pts.push({ tx: (x - 512) * 0.06, ty: -(y - 128) * 0.06 });
    }
  }

  if (_skyPointsCache.size >= 20) _skyPointsCache.delete(_skyPointsCache.keys().next().value);
  _skyPointsCache.set(text, pts);
  return pts;
}

// ── Step 1: WaterDecal ────────────────────────────────────────────────────────
//
// A troika Text mesh that lies flat on the wave surface and drifts outward from
// the boat.
//
// Occlusion fix: boat meshes (GLTF + trail particles) are set to renderOrder=1
// in boat.js.  THREE.js processes transparent objects bucket-by-bucket in
// renderOrder order, so renderOrder=1 bucket always renders after renderOrder=0.
// The boat therefore always paints over this decal, regardless of which is
// geometrically closer to the camera (which matters for transparent distance
// sorting within a single bucket but is irrelevant across buckets).

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

    this.vx = Math.cos(angle) * (0.3 + Math.random() * 0.4);
    this.vz = Math.sin(angle) * (0.3 + Math.random() * 0.4);

    const hexStr = "#" + colorHex.toString(16).padStart(6, "0");

    const mesh = new Text();
    mesh.text     = text;
    mesh.font     = pickFont(text);
    mesh.fontSize = 1.3;
    mesh.anchorX  = "center";
    mesh.anchorY  = "middle";
    mesh.color    = 0xffffff;

    // Glow: wide soft blur (outer halo) + thin solid outline (bright core ring)
    mesh.outlineBlur    = "28%";
    mesh.outlineWidth   = "3%";
    mesh.outlineColor   = hexStr;
    mesh.outlineOpacity = 0;   // driven by update()
    mesh.fillOpacity    = 0;   // driven by update()

    // Lay flat in XZ plane; random yaw so each decal faces a different direction
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.y = Math.random() * Math.PI * 2;

    // renderOrder=0: boat meshes are forced to renderOrder=1 in boat.js so they
    // always render AFTER this decal in the transparent pass, regardless of
    // distance-based sort. depthTest=true additionally ensures the decal is
    // clipped by any opaque hull geometry that writes to the depth buffer.
    mesh.renderOrder = 0;

    // Additive blending: text glows on top of the dark water without masking it
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest:   true,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });
    mesh.material = mat;

    const energy = (engine.env && engine.env.smoothedEnergy) || 0;
    const initY  = waveHeight(this.x, this.z, 0, energy) + 0.15;
    mesh.position.set(this.x, initY, this.z);

    // After troika derives its shader material from our base, re-affirm depthTest
    // so the derived material doesn't accidentally lose the property.
    mesh.sync(() => {
      if (mesh.material) {
        mesh.material.depthTest = true;
        mesh.material.needsUpdate = true;
      }
    });

    engine.scene.add(mesh);
    this.mesh = mesh;
  }

  update(dt, elapsed) {
    if (!this.alive) return;
    this.age += dt;
    if (this.age >= this.lifetime) { this.alive = false; return; }

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Strictly bind Y to wave surface — can never sink
    const energy = (this.engine.env && this.engine.env.smoothedEnergy) || 0;
    const wh     = waveHeight(this.x, this.z, elapsed, energy);
    this.mesh.position.set(this.x, wh + 0.15, this.z);

    // Opacity envelope: 0.4 s fade-in → hold → fade-out
    const fadeOut = this.fadeOutDuration ?? 1.5;
    let opacity = 1.0;
    if (this.age < 0.4) {
      opacity = this.age / 0.4;
    } else if (this.age > this.lifetime - fadeOut) {
      opacity = Math.max(0, (this.lifetime - this.age) / fadeOut);
    }

    // Pulse brightness with bass energy (same as old canvas version)
    const finalOp            = Math.min(1.0, opacity * (1.0 + energy * 0.35));
    this.mesh.fillOpacity    = finalOp;
    this.mesh.outlineOpacity = finalOp * 0.75;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.engine.scene.remove(this.mesh);
    this.mesh.dispose();
    this.engine = null;
  }
}

// ── Step 2: SkyLyricSystem ────────────────────────────────────────────────────
//
// InstancedMesh cloud particles (original canvas-sampling logic):
//   Canvas pixel-samples the text to produce glyph-shape point targets.
//   Particles start at random scatter origins and converge to target positions
//   over convergenceTime using cubic ease-out, then drift upward and fade out.

class SkyLyricSystem {
  constructor(engine, colorHex) {
    this.engine          = engine;
    this.colorHex        = colorHex;
    this.phrases         = [];
    this.convergenceTime = 1.5;
    this._dummy          = new THREE.Object3D(); // pre-allocated, no per-frame alloc
  }

  setConvergenceTime(t) {
    this.convergenceTime = Math.max(0.4, t);
  }

  addPhrase(text, boatPos) {
    if (!text) return;

    // Force existing phrases to fade out quickly before the new one appears
    const QUICK_FADE = 0.6;
    for (const p of this.phrases) {
      const remaining = p.life - p.age;
      if (remaining > QUICK_FADE) {
        p.life            = p.age + QUICK_FADE;
        p.fadeOutDuration = QUICK_FADE;
      }
    }

    const skyPos = new THREE.Vector3(
      Math.max(-SKY_POS_BOUNDARY, Math.min(SKY_POS_BOUNDARY, boatPos.x)),
      25,
      Math.max(-SKY_POS_BOUNDARY, Math.min(SKY_POS_BOUNDARY, boatPos.z - 40)),
    );

    const cachedPts = _sampleSkyPoints(text);
    const points    = cachedPts.map(p => ({
      tx: p.tx, ty: p.ty,
      sx: (Math.random() - 0.5) * 25,
      sy: (Math.random() - 0.5) * 25,
      sz: (Math.random() - 0.5) * 25,
    }));

    let particleMesh = null;
    if (points.length > 0) {
      const mat = new THREE.MeshBasicMaterial({
        color:       this.colorHex,
        transparent: true,
        opacity:     0.0,
      });
      particleMesh = new THREE.InstancedMesh(getSkyParticleGeo(), mat, points.length);
      particleMesh.position.copy(skyPos);
      this.engine.scene.add(particleMesh);
    }

    this.phrases.push({
      particleMesh,
      points,
      life:            6.0,
      age:             0,
      fadeOutDuration: 1.5,
      convergenceTime: this.convergenceTime,
    });
  }

  update(dt) {
    const dummy = this._dummy;

    for (const p of this.phrases) {
      p.age += dt;

      const conv = Math.min(1.0, p.age / p.convergenceTime);
      const ease = 1.0 - Math.pow(1.0 - conv, 3); // cubic ease-out

      const fadeOut = p.fadeOutDuration ?? 1.5;
      let opacity = 1.0;
      if (p.age < 0.25) {
        opacity = p.age / 0.25;
      } else if (p.age > p.life - fadeOut) {
        opacity = Math.max(0, (p.life - p.age) / fadeOut);
      }

      if (p.particleMesh) {
        p.particleMesh.material.opacity = opacity;
        p.particleMesh.position.y += dt * 0.3;

        for (let i = 0; i < p.points.length; i++) {
          const pt = p.points[i];
          dummy.position.set(
            THREE.MathUtils.lerp(pt.sx, pt.tx, ease),
            THREE.MathUtils.lerp(pt.sy, pt.ty, ease),
            THREE.MathUtils.lerp(pt.sz, 0,     ease),
          );
          dummy.scale.setScalar(1.2 + Math.sin(p.age * 3 + i) * 0.4);
          dummy.updateMatrix();
          p.particleMesh.setMatrixAt(i, dummy.matrix);
        }
        p.particleMesh.instanceMatrix.needsUpdate = true;
      }

    }

    // Dispose expired phrases
    this.phrases = this.phrases.filter(p => {
      if (p.age > p.life) {
        if (p.particleMesh) {
          this.engine.scene.remove(p.particleMesh);
          p.particleMesh.material.dispose();
          // getSkyParticleGeo() is shared — must NOT dispose it here
          p.particleMesh.dispose();
        }
        return false;
      }
      return true;
    });
  }

  clearAll() {
    for (const p of this.phrases) {
      if (p.particleMesh) {
        this.engine.scene.remove(p.particleMesh);
        p.particleMesh.material.dispose();
        p.particleMesh.dispose();
      }
    }
    this.phrases = [];
  }

  dispose() {
    this.clearAll();
  }
}

// ── LyricManager (public API unchanged) ──────────────────────────────────────

export class LyricManager {
  /**
   * Prime the sky-mode glyph-sampling cache so the first chorus phrase doesn't
   * pay the 1024×256 getImageData cost inline (which stalls the frame and shows
   * as a camera jitter on phrase entry).
   */
  static prewarmPhrase(text) {
    _sampleSkyPoints(text);
  }

  constructor(engine, boat, colorHex = 0xffffff) {
    this.engine      = engine;
    this.boat        = boat;
    this.colorHex    = colorHex;
    this.isChorus    = false;
    this.skySystem   = new SkyLyricSystem(engine, colorHex);
    this.sprites     = [];
    this.currentText = "";
    this._updatable  = { update: (dt, elapsed) => this._update(dt, elapsed) };
    engine.addUpdatable(this._updatable);
  }

  setChorusMode(isChorus) {
    this.isChorus = isChorus;
  }

  setActiveColor(hexColor) {
    this.colorHex = hexColor;
    // Sky lyric colour stays white — matches original behaviour
  }

  setSkyConvergenceTime(t) {
    this.skySystem.setConvergenceTime(t);
  }

  /** Remove all queued/visible lyrics immediately — used when returning from background. */
  clear() {
    for (const s of this.sprites) s.dispose();
    this.sprites     = [];
    this.currentText = "";
    this.skySystem.clearAll();
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
          s.lifetime        = s.age + BOARD_QUICK_FADE;
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
