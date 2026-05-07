/**
 * LyricGate — the last lyric phrase rises from the lake as a vertical portal.
 * Boat drives through it to return to song selection.
 */

import * as THREE from "three";
import { glowVert, glowFrag, sampleTextPoints } from "./fish-school.js";

const GATE_DIST            = 16;   // world units ahead of boat at spawn
const RISE_DURATION        = 3.5;  // seconds for particles to reach full height
const TEXT_PARTICLE_COUNT  = 1200;
const FRAME_PTS_PER_EDGE   = 70;   // 4 × 70 = 280 border particles
const FWD_TOLERANCE        = 1.8;  // metres either side of gate plane to trigger
const FONT_FAMILY = '"KiwiMaru","M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif';

export class LyricGate {
  /**
   * @param {object}        engine
   * @param {object}        boat
   * @param {string}        text            — last lyric phrase (or song title)
   * @param {number}        particleColor   — hex, from song.theme.particle
   * @param {number}        collectedCount  — plank/note score, scales gate size
   * @param {Function}      onEnter         — called when boat crosses the gate
   */
  constructor(engine, boat, text, particleColor, collectedCount = 0, onEnter) {
    this.engine    = engine;
    this.boat      = boat;
    this._onEnter  = onEnter;
    this._entered  = false;
    this._disposed = false;
    this._riseT    = 0;

    // Gate dimensions — more collected → taller, wider, brighter
    const bonus      = Math.min(collectedCount * 0.15, 2.5);
    this._gateW      = 14.0 + bonus * 0.5;
    this._gateH      = 4.5  + bonus;
    this._centerY    = this._gateH * 0.5 + 1.2; // center height above water

    // Compute gate orientation from boat heading at spawn time
    const boatPos = boat.getPosition();
    const q = boat.body.quaternion;
    const rawFX = -2 * (q.x * q.z + q.w * q.y);
    const rawFZ = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const fLen  = Math.sqrt(rawFX * rawFX + rawFZ * rawFZ) || 1;
    this._fx =  rawFX / fLen;   // forward
    this._fz =  rawFZ / fLen;
    this._rx = -this._fz;       // right (perpendicular in XZ)
    this._rz =  this._fx;

    this._center = new THREE.Vector3(
      boatPos.x + this._fx * GATE_DIST,
      0,
      boatPos.z + this._fz * GATE_DIST,
    );

    const pts2D = sampleTextPoints(text, "", TEXT_PARTICLE_COUNT, true, FONT_FAMILY, "400");
    this._buildMesh(pts2D, particleColor);

    engine.addUpdatable(this);
  }

  _buildMesh(pts2D, color) {
    const frameCount = FRAME_PTS_PER_EDGE * 4;
    const total      = pts2D.length + frameCount;
    this._count      = total;
    this._textCount  = pts2D.length;

    const pos    = new Float32Array(total * 3);
    const tgtY   = new Float32Array(total);
    const tgtX   = new Float32Array(total);
    const tgtZ   = new Float32Array(total);
    const sizes  = new Float32Array(total);
    const alphas = new Float32Array(total);

    const cx = this._center.x, cz = this._center.z, cy = this._centerY;

    // ── Text particles ────────────────────────────────────────
    for (let i = 0; i < pts2D.length; i++) {
      const { lx, ly } = pts2D[i];
      const wx = cx + this._rx * lx * this._gateW;
      const wy = cy + ly * this._gateH;
      const wz = cz + this._rz * lx * this._gateW;
      tgtX[i] = wx; tgtY[i] = wy; tgtZ[i] = wz;
      pos[i*3]     = wx;
      pos[i*3 + 1] = 0;   // start at water surface
      pos[i*3 + 2] = wz;
      sizes[i]  = 0.15 + Math.random() * 0.10;
      alphas[i] = 0.80 + Math.random() * 0.20;
    }

    // ── Frame particles (4 edges of the gate rectangle) ──────
    const o = pts2D.length;
    for (let e = 0; e < 4; e++) {
      for (let j = 0; j < FRAME_PTS_PER_EDGE; j++) {
        const t   = (j / (FRAME_PTS_PER_EDGE - 1)) * 2 - 1; // [-1, 1]
        const idx = o + e * FRAME_PTS_PER_EDGE + j;
        let lx, ly;
        switch (e) {
          case 0: lx =  t * 0.5; ly =  0.5; break; // top
          case 1: lx =  t * 0.5; ly = -0.5; break; // bottom
          case 2: lx = -0.5;     ly =  t * 0.5; break; // left
          case 3: lx =  0.5;     ly =  t * 0.5; break; // right
        }
        const wx = cx + this._rx * lx * this._gateW;
        const wy = cy + ly * this._gateH;
        const wz = cz + this._rz * lx * this._gateW;
        tgtX[idx] = wx; tgtY[idx] = wy; tgtZ[idx] = wz;
        pos[idx*3]     = wx;
        pos[idx*3 + 1] = 0;
        pos[idx*3 + 2] = wz;
        sizes[idx]  = 0.28 + Math.random() * 0.10;
        alphas[idx] = 1.0;
      }
    }

    this._pos      = pos;
    this._tgtX     = tgtX;
    this._tgtY     = tgtY;
    this._tgtZ     = tgtZ;
    this._alphas   = alphas;

    const geo = new THREE.BufferGeometry();
    this._posAttr   = new THREE.BufferAttribute(pos,    3);
    this._alphaAttr = new THREE.BufferAttribute(alphas, 1);
    geo.setAttribute("position", this._posAttr);
    geo.setAttribute("aSize",    new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha",   this._alphaAttr);

    this._uniforms = {
      uColor:       { value: new THREE.Color(color) },
      uTargetColor: { value: new THREE.Color(0xffffff) },
      uColorBlend:  { value: 0 },
      uIntensity:   { value: 1.0 },
      uAlphaMul:    { value: 0 },
      uTime:        { value: 0 },
      uGlowMin:     { value: 7.0 },
      uGlowMax:     { value: 18.0 },
    };

    this.mesh = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader:   glowVert,
      fragmentShader: glowFrag,
      uniforms:       this._uniforms,
      transparent:    true,
      depthWrite:     false,
      depthTest:      false,
      blending:       THREE.AdditiveBlending,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder   = 2;
    this.engine.scene.add(this.mesh);
  }

  update(dt, elapsed) {
    if (this._disposed) return;

    // Fade in
    const u = this._uniforms;
    u.uAlphaMul.value = Math.min(1, u.uAlphaMul.value + dt * 1.0);
    u.uTime.value     = elapsed;

    // Rise: easeOutCubic over RISE_DURATION
    if (this._riseT < 1) this._riseT = Math.min(1, this._riseT + dt / RISE_DURATION);
    const ease = 1 - Math.pow(1 - this._riseT, 3);

    // Smoothly approach target positions (X/Z already correct; Y rises with ease)
    const pos  = this._pos;
    const tgtX = this._tgtX, tgtY = this._tgtY, tgtZ = this._tgtZ;
    const lerpK = Math.min(1, dt * 4.5);

    for (let i = 0; i < this._count; i++) {
      const i3 = i * 3;
      pos[i3]     += (tgtX[i] - pos[i3])         * lerpK;
      pos[i3 + 1] += (tgtY[i] * ease - pos[i3+1]) * lerpK;
      pos[i3 + 2] += (tgtZ[i] - pos[i3 + 2])     * lerpK;
    }
    this._posAttr.needsUpdate = true;

    // Frame border shimmer
    const pulse = 0.65 + 0.35 * Math.sin(elapsed * 2.8);
    const alphas = this._alphas;
    for (let i = this._textCount; i < this._count; i++) alphas[i] = pulse;
    this._alphaAttr.needsUpdate = true;

    // Boat collision: check if boat crosses the gate plane within gate width
    if (!this._entered) {
      const bp   = this.boat.getPosition();
      const relX = bp.x - this._center.x;
      const relZ = bp.z - this._center.z;
      // Distance along gate normal (forward dir)
      const fDist = Math.abs(relX * this._fx + relZ * this._fz);
      // Distance along gate's right axis (lateral)
      const lDist = Math.abs(relX * this._rx + relZ * this._rz);
      if (fDist < FWD_TOLERANCE && lDist < this._gateW * 0.5 + 0.5) {
        this._entered = true;
        this._triggerEnter();
      }
    }
  }

  _triggerEnter() {
    // Burst all particles radially outward
    const BURST = 18;
    const pos = this._pos;
    for (let i = 0; i < this._count; i++) {
      const i3  = i * 3;
      const dx  = pos[i3]     - this._center.x;
      const dz  = pos[i3 + 2] - this._center.z;
      const d   = Math.sqrt(dx * dx + dz * dz) || 0.1;
      const spd = BURST * (0.5 + Math.random() * 0.8);
      this._tgtX[i] = pos[i3]     + (dx / d) * spd * 1.5;
      this._tgtY[i] = pos[i3 + 1] + (Math.random() * 2 - 0.5) * spd;
      this._tgtZ[i] = pos[i3 + 2] + (dz / d) * spd * 1.5;
    }
    // Fade out quickly after burst
    setTimeout(() => {
      if (this._disposed) return;
      const u = this._uniforms;
      const startAlpha = u.uAlphaMul.value;
      const start = performance.now();
      const dur = 800;
      const tick = () => {
        if (this._disposed) return;
        const t = Math.min(1, (performance.now() - start) / dur);
        u.uAlphaMul.value = startAlpha * (1 - t);
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, 100);

    this._onEnter?.();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.engine.removeUpdatable(this);
    this.engine.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
