/**
 * song-circles.js — Particle-based song selection system.
 */

import * as THREE from "three";
import { waveHeight } from "./boat.js";
import { SONGS } from "./songs.js";

// Pre-load fonts so canvas text sampling uses the correct glyphs.
document.fonts.load('bold 60px "Caveat"');
document.fonts.load('400 60px "KiwiMaru"');

// ── States ────────────────────────────────────────────────────────────────────

const STATE = Object.freeze({
  WAITING:          "waiting",          // pre-gather; updates skipped
  GATHERING:        "gathering",        // particles converge into orbit ring
  IDLE:             "idle",              // breathing orbit, waiting for boat
  ACTIVATING:       "activating",       // boat entered radius; collapsing into title
  ACTIVE:           "active",            // title fully formed, awaiting Enter
  RETURNING:        "returning",        // boat left radius; expanding back to idle
  SCATTERED:        "scattered",        // non-selected circle: blow apart and fade
  SELECTED_SCATTER: "selectedScatter", // not currently used as a triggered state
  TITLE_FADE:       "titleFade",        // selected circle: confirmation flash + dissolve
});

// Terminal states whose particle/ring fade is driven directly inside the state branch,
// not through the smooth-transition lerp helper.
const TERMINAL_STATES = new Set([STATE.TITLE_FADE, STATE.SCATTERED, STATE.SELECTED_SCATTER]);

// States that deactivate() must NOT interrupt — terminal/transient states must run to completion.
const NON_DEACTIVATABLE = new Set([
  STATE.IDLE, STATE.RETURNING, STATE.WAITING, STATE.GATHERING,
  STATE.TITLE_FADE, STATE.SCATTERED, STATE.SELECTED_SCATTER,
]);

// States in which the circle is eligible to be "near boat" for activation detection.
const ACTIVATION_ELIGIBLE = new Set([
  STATE.IDLE, STATE.ACTIVATING, STATE.ACTIVE, STATE.RETURNING, STATE.GATHERING,
]);

// ── Config ────────────────────────────────────────────────────────────────────

const COUNT         = 1200;
const CIRCLE_R      = 2.2;
const ORBIT_SPEED   = 0.38;
const TEXT_W        = 34.0;
const TEXT_H        = 7.2;
const TEXT_FORWARD  = -4.0;
const GATHER_SPEED  = 5.0;
const FORM_SPEED    = 9.0;
const ACTIVATE_DIST = CIRCLE_R;
const HINT_OFFSET   = 3.5;

// ── Particle shader ───────────────────────────────────────────────────────────

const _vert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform  float uPulse;
  varying  float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float pulse = 1.0 + uPulse * 0.28;
    gl_PointSize = aSize * pulse * (300.0 / -mv.z);
    gl_Position  = projectionMatrix * mv;
  }
`;

const _frag = /* glsl */ `
  uniform vec3  uColor;
  uniform float uAlphaMul;
  uniform float uPulse;
  varying float vAlpha;
  void main() {
    float d    = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float core = exp(-d * d * 28.0);
    float halo = exp(-d * d * 7.0) * 0.55;
    float glow = (core + halo) * 5.5;
    vec3  hotCol = mix(uColor, vec3(1.3, 1.3, 1.3), uPulse * 0.42);
    vec3  col  = hotCol * glow + vec3(1.0) * core * (0.4 + uPulse * 0.32);
    gl_FragColor = vec4(col, vAlpha * glow * uAlphaMul);
  }
`;

// ── Glow ring shader ──────────────────────────────────────────────────────────
// RingGeometry UV: u = angle 0..1, v = 0 (inner) .. 1 (outer).
// After rotateX(-PI/2) the geometry lies flat in XZ.
// Vertex shader adds traveling sine waves for a rhythmic rippling effect.

const _ringVert = /* glsl */ `
  varying vec2  vUv;
  uniform float uTime;
  uniform float uPulse;
  void main() {
    vUv = uv;
    vec3 pos = position;
    // Traveling wave rippling around the ring circumference
    float angle = atan(pos.z, pos.x);
    float wave  = sin(angle * 4.0 + uTime * 2.6) * 0.07
                + sin(angle * 2.0 - uTime * 1.8) * 0.045
                + sin(angle * 7.0 + uTime * 4.2) * 0.018;
    pos.y += wave * (1.0 + uPulse * 0.9);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const _ringFrag = /* glsl */ `
  varying vec2  vUv;
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uPulse;
  void main() {
    // vUv.y: 0 = inner rim, 1 = outer rim; 0.5 = centerline of the band
    float dist  = abs(vUv.y - 0.5) * 2.0;        // 0 at center, 1 at edges
    float core  = exp(-dist * dist * 14.0);        // tight bright core line
    float halo  = exp(-dist * dist * 3.0) * 0.55; // wide soft glow
    float glow  = core + halo;
    float bright = 1.7 + uPulse * 1.5;
    vec3  col   = uColor * bright * glow
                + vec3(1.0) * core * (0.55 + uPulse * 0.55);
    gl_FragColor = vec4(col, glow * uOpacity);
  }
`;

// ── Text sampling ─────────────────────────────────────────────────────────────

function sampleTextPoints(text, count) {
  const cw = 2048, ch = 256;
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);

  let sz = 72;
  const fnt = s => `bold ${s}px "Caveat","KiwiMaru","M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
  ctx.font = fnt(sz);
  while (ctx.measureText(text).width > cw * 0.88 && sz > 14) { sz -= 2; ctx.font = fnt(sz); }
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cw / 2, ch / 2);

  const px = ctx.getImageData(0, 0, cw, ch).data;
  const white = [];
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++)
      if (px[(y * cw + x) * 4] > 128) white.push({ x, y });

  if (!white.length) return [];
  const step = Math.max(1, white.length / count);
  const pts  = [];
  for (let i = 0; i < count && Math.floor(i * step) < white.length; i++) {
    const p = white[Math.floor(i * step)];
    pts.push({ lx: p.x / cw - 0.5, ly: 0.5 - p.y / ch });
  }
  return pts;
}

// ── SongCircle ────────────────────────────────────────────────────────────────

class SongCircle {
  constructor(engine, center, song, index) {
    this.engine    = engine;
    this.center    = center.clone();
    this.songIndex = index;
    this._disposed = false;

    this._state     = STATE.WAITING;
    this._stateTime = 0;
    this._alphaMul  = 0;

    const col = new THREE.Color(song.theme?.particle ?? 0x88e8ff);
    this._col          = col;
    this._songCol      = col.clone();
    this._gatherStartCol = new THREE.Color(0x88e8ff);
    this._white = new THREE.Color(1.3, 1.3, 1.3);
    this._tmpCol1 = new THREE.Color();
    this._ringFade = 0; // independent ring opacity tracker for titleFade dissolve

    // ── Smooth visual transition helpers ─────────────────────────────────
    // These smoothly lerp each frame so state switches never snap visually.
    this._pulseEnv     = 0;    // particle pulse envelope [0..1]
    this._pulseEnvTgt  = 0;
    this._compactBlend = 0;    // orbit compaction [0=loose full-radius, 1=tight 0.42x]
    this._compactTgt   = 0;
    this._ringOpTgt    = 0;    // ring opacity target
    this._ringScTgt    = 1.0;  // ring scale target
    this._ringPuTgt    = 0;    // ring pulse-tint target

    const n = COUNT;
    this._n          = n;
    this._posArr     = new Float32Array(n * 3);
    this._velArr     = new Float32Array(n * 3);
    this._sizeArr    = new Float32Array(n);
    this._alphaArr   = new Float32Array(n);
    this._orbitAng   = new Float32Array(n);
    this._orbitR     = new Float32Array(n);
    this._orbitDir   = new Float32Array(n);
    this._orbitPhase = new Float32Array(n);
    this._targets     = new Float32Array(n * 3);
    this._hasTarget   = new Uint8Array(n);
    this._gatherDelay = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 20;
      this._posArr[i * 3]     = Math.cos(a) * r;
      this._posArr[i * 3 + 1] = 0.15;
      this._posArr[i * 3 + 2] = Math.sin(a) * r;
      this._sizeArr[i]    = 0.12 + Math.random() * 0.09;
      this._alphaArr[i]   = 0.75 + Math.random() * 0.25;
      this._orbitAng[i]   = Math.random() * Math.PI * 2;
      this._orbitR[i]     = CIRCLE_R * (0.28 + Math.random() * 0.72);
      this._orbitDir[i]   = Math.random() < 0.5 ? 1 : -1;
      this._orbitPhase[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this._posArr, 3));
    geo.setAttribute("aSize",    new THREE.BufferAttribute(this._sizeArr,  1));
    geo.setAttribute("aAlpha",   new THREE.BufferAttribute(this._alphaArr, 1));

    this._uniforms = {
      uColor:    { value: col.clone() },
      uAlphaMul: { value: 0 },
      uPulse:    { value: 0 },
    };
    this._pts = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader:   _vert,
      fragmentShader: _frag,
      uniforms:       this._uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this._pts.frustumCulled = false;
    this._pts.renderOrder   = 1;
    engine.scene.add(this._pts);

    this._ring1 = this._makeGlowRing(engine, CIRCLE_R, col, 0.28);

    this._textPts = sampleTextPoints(song.title, n);
  }

  // Returns { mesh, uniforms, geo, mat } — a glowing ring lying flat in XZ.
  _makeGlowRing(engine, r, col, halfBand = 0.25) {
    const geo = new THREE.RingGeometry(r - halfBand, r + halfBand, 128, 1);
    geo.rotateX(-Math.PI / 2);

    const uniforms = {
      uTime:    { value: 0 },
      uColor:   { value: col.clone() },
      uOpacity: { value: 0 },
      uPulse:   { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader:   _ringVert,
      fragmentShader: _ringFrag,
      uniforms,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.center.x, 0, this.center.z);
    mesh.frustumCulled = false;
    mesh.renderOrder   = 1;
    engine.scene.add(mesh);
    return { mesh, uniforms, geo, mat };
  }

  // ── Public API ────────────────────────────────────────

  startGather() {
    if (this._state !== STATE.WAITING) return;
    this._state     = STATE.GATHERING;
    this._stateTime = 0;
  }

  activate() {
    const s = this._state;
    if (s === STATE.ACTIVE || s === STATE.ACTIVATING || s === STATE.WAITING) return;
    this._state     = STATE.ACTIVATING;
    this._stateTime = 0;
    this._assignTextTargets();
  }

  deactivate() {
    // Only ACTIVATING/ACTIVE roll back to RETURNING — every other state must run to completion.
    if (NON_DEACTIVATABLE.has(this._state)) return;
    this._hasTarget.fill(0);
    this._state     = STATE.RETURNING;
    this._stateTime = 0;
  }

  triggerScatter() {
    const BLAST = 11;
    const cx = this.center.x, cz = this.center.z;
    for (let i = 0; i < this._n; i++) {
      const i3 = i * 3;
      const dx = this._posArr[i3] - cx, dz = this._posArr[i3 + 2] - cz;
      const d  = Math.sqrt(dx * dx + dz * dz) || 0.1;
      const sp = BLAST * (0.4 + Math.random() * 0.8);
      this._velArr[i3]     = (dx / d) * sp;
      this._velArr[i3 + 2] = (dz / d) * sp;
    }
    this._state     = STATE.SCATTERED;
    this._stateTime = 0;
  }

  triggerSelectedScatter() {
    const BLAST = 20;
    const cx = this.center.x, cz = this.center.z;
    for (let i = 0; i < this._n; i++) {
      const i3 = i * 3;
      const dx = this._posArr[i3] - cx, dz = this._posArr[i3 + 2] - cz;
      const d  = Math.sqrt(dx * dx + dz * dz) || 0.5;
      const sp = BLAST * (0.5 + Math.random() * 1.2);
      this._velArr[i3]     = (dx / d) * sp + (Math.random() - 0.5) * 7;
      this._velArr[i3 + 2] = (dz / d) * sp + (Math.random() - 0.5) * 7;
    }
    this._ring1.uniforms.uOpacity.value = 1.3;
    this._state     = STATE.SELECTED_SCATTER;
    this._stateTime = 0;
  }

  // Gentle dissolve with hot-white confirmation flash.
  triggerTitleFade() {
    const DRIFT = 1.4;
    const cx = this.center.x, cz = this.center.z;
    for (let i = 0; i < this._n; i++) {
      const i3 = i * 3;
      const dx = this._posArr[i3] - cx, dz = this._posArr[i3 + 2] - cz;
      const d  = Math.sqrt(dx * dx + dz * dz) || 0.5;
      const sp = DRIFT * (0.3 + Math.random() * 0.9);
      this._velArr[i3]     = (dx / d) * sp + (Math.random() - 0.5) * 0.7;
      this._velArr[i3 + 2] = (dz / d) * sp + (Math.random() - 0.5) * 0.7;
    }
    // Particles: over-bright flash then slow dissolve
    this._alphaMul = 2.2;
    this._uniforms.uAlphaMul.value = 2.2;
    this._uniforms.uPulse.value    = 1.0;
    // Ring: independent graceful fade over ~2s
    this._ringFade = 1.0;
    this._ring1.uniforms.uColor.value.copy(this._white);
    this._ring1.uniforms.uOpacity.value = 1.8;
    this._ring1.uniforms.uPulse.value   = 1.0;
    this._state     = STATE.TITLE_FADE;
    this._stateTime = 0;
  }

  // ── Internal ──────────────────────────────────────────

  _assignTextTargets() {
    this._hasTarget.fill(0);
    const pts = this._textPts;
    if (!pts.length) return;

    const cx = this.center.x, cz = this.center.z + TEXT_FORWARD;
    const n = this._n, pos = this._posArr;
    const used = new Uint8Array(n);

    // Sort world targets and particles by X so we can binary-search for each
    // text point's nearest candidates — reduces O(n²) to O(n·W) where W=200.
    const worldTargets = pts.map((p, idx) => ({
      idx, tx: cx + p.lx * TEXT_W, tz: cz - p.ly * TEXT_H,
    }));
    worldTargets.sort((a, b) => a.tx - b.tx);

    const particlesByX = Array.from({ length: n }, (_, i) => ({ idx: i, x: pos[i * 3] }));
    particlesByX.sort((a, b) => a.x - b.x);

    const W = 200; // search window around the binary-search landing point
    for (const wt of worldTargets) {
      const { tx, tz, idx } = wt;
      const p = pts[idx];

      // Binary search for the first particle with x >= tx
      let lo = 0, hi = particlesByX.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (particlesByX[mid].x < tx) lo = mid + 1; else hi = mid;
      }

      let best = -1, bestD2 = Infinity;
      for (let fi = Math.max(0, lo - W); fi < Math.min(n, lo + W); fi++) {
        const fIdx = particlesByX[fi].idx;
        if (used[fIdx]) continue;
        const dx = pos[fIdx * 3] - tx, dz = pos[fIdx * 3 + 2] - tz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = fIdx; }
      }
      // Fallback: any remaining unassigned particle
      if (best < 0) {
        for (const f of particlesByX) { if (!used[f.idx]) { best = f.idx; break; } }
      }

      if (best >= 0) {
        used[best] = 1;
        this._hasTarget[best]      = 1;
        this._targets[best * 3]    = tx;
        this._targets[best * 3 + 1] = 0;
        this._targets[best * 3 + 2] = tz;
      }
    }
  }

  _setRingState(opacity, scale = 1.0, colorShift = 0) {
    this._tmpCol1.copy(this._songCol).lerp(this._white, colorShift * 0.55);
    this._ring1.uniforms.uColor.value.copy(this._tmpCol1);
    this._ring1.uniforms.uOpacity.value = opacity;
    this._ring1.uniforms.uPulse.value   = colorShift;
    this._ring1.mesh.scale.set(scale, 1, scale);
  }

  // ── Update ────────────────────────────────────────────

  update(dt, elapsed) {
    if (this._disposed || this._state === STATE.WAITING) return;

    this._ring1.uniforms.uTime.value = elapsed;
    this._stateTime += dt;

    const n = this._n, pos = this._posArr;
    const cx = this.center.x, cz = this.center.z;
    // Match the water shader's uEnergy so particles ride the actual visible
    // wave surface during loud passages.
    const energy = this.engine.env?.smoothedEnergy ?? 0;

    for (let i = 0; i < n; i++) {
      this._orbitAng[i] += ORBIT_SPEED * this._orbitDir[i] *
        (0.6 + 0.4 * Math.abs(Math.sin(elapsed * 0.3 + this._orbitPhase[i]))) * dt;
    }

    // ── Smooth transition envelopes ───────────────────────────────────────
    // Lerp pulse envelope and orbit compaction toward per-state targets so that
    // any state change produces a gradual visual transition instead of a snap.
    const _lrp = (a, b, s) => a + (b - a) * Math.min(1, dt * s);
    this._pulseEnv     = _lrp(this._pulseEnv,     this._pulseEnvTgt,  4.5);
    this._compactBlend = _lrp(this._compactBlend, this._compactTgt,   3.5);

    // Smooth ring visual params for all non-terminal states.
    // Terminal states (titleFade, scattered, selectedScatter) manage ring directly.
    if (!TERMINAL_STATES.has(this._state)) {
      const rf = Math.min(1, dt * 7);
      const ru = this._ring1.uniforms;
      ru.uOpacity.value += (this._ringOpTgt - ru.uOpacity.value) * rf;
      ru.uPulse.value   += (this._ringPuTgt - ru.uPulse.value)   * rf;
      const cs = this._ring1.mesh.scale.x;
      const ns = cs + (this._ringScTgt - cs) * rf;
      this._ring1.mesh.scale.set(ns, 1, ns);
      this._tmpCol1.copy(this._songCol).lerp(this._white, ru.uPulse.value * 0.55);
      ru.uColor.value.copy(this._tmpCol1);
    }

    if (this._state === STATE.GATHERING) {
      this._alphaMul = Math.min(1, this._alphaMul + dt * 0.55);
      this._uniforms.uAlphaMul.value = this._alphaMul;

      const colorT = Math.max(0, Math.min(1, (this._stateTime - 0.8) / 1.6));
      this._uniforms.uColor.value.lerpColors(this._gatherStartCol, this._songCol, colorT);

      let allClose = true;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        if (this._stateTime < this._gatherDelay[i]) {
          allClose = false;
          pos[i3 + 1] = waveHeight(pos[i3], pos[i3 + 2], elapsed, energy) + 0.12;
          continue;
        }
        const tx = cx + Math.cos(this._orbitAng[i]) * this._orbitR[i];
        const tz = cz + Math.sin(this._orbitAng[i]) * this._orbitR[i];
        const dx = tx - pos[i3], dz = tz - pos[i3 + 2];
        const d  = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.2) {
          allClose = false;
          const speed = Math.min(GATHER_SPEED * 2.4, d * 4.2 + 1.5);
          const m = Math.min(speed * dt, d - 0.18);
          pos[i3]     += (dx / d) * m;
          pos[i3 + 2] += (dz / d) * m;
        } else {
          pos[i3] = tx; pos[i3 + 2] = tz;
        }
        pos[i3 + 1] = waveHeight(pos[i3], pos[i3 + 2], elapsed, energy) + 0.12;
      }

      if (allClose || this._stateTime > 8.0) {
        this._uniforms.uColor.value.copy(this._songCol);
        this._state = STATE.IDLE; this._stateTime = 0;
      }
      this._pulseEnvTgt = 0;
      this._compactTgt  = 0;
      this._ringOpTgt   = Math.min(0.7, this._stateTime * 0.12);
      this._ringScTgt   = 1.0;
      this._ringPuTgt   = 0;

    } else if (this._state === STATE.IDLE) {
      const lf = Math.min(1, dt * 8.0);
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const wave = Math.sin(elapsed * 1.7 + this._orbitPhase[i]) * 0.12
                   + Math.sin(elapsed * 3.4 + this._orbitAng[i] * 1.7) * 0.05;
        const r  = this._orbitR[i] * (0.88 + wave);
        // Lerp toward wave target instead of direct assignment — eliminates the
        // position snap when entering from GATHERING (orbitR*1.0) or RETURNING.
        const tx = cx + Math.cos(this._orbitAng[i]) * r;
        const tz = cz + Math.sin(this._orbitAng[i]) * r;
        pos[i3]     += (tx - pos[i3])     * lf;
        pos[i3 + 2] += (tz - pos[i3 + 2]) * lf;
        pos[i3 + 1] = waveHeight(pos[i3], pos[i3 + 2], elapsed, energy) + 0.12;
      }
      this._pulseEnvTgt = 0;
      this._compactTgt  = 0;
      this._uniforms.uPulse.value    = 0;
      this._uniforms.uAlphaMul.value = this._alphaMul;
      const breathe = 0.55 + 0.18 * Math.sin(elapsed * 1.7) + 0.07 * Math.sin(elapsed * 4.3);
      const rScale  = 1.00 + 0.06 * Math.sin(elapsed * 1.7) + 0.02 * Math.sin(elapsed * 3.1);
      this._ringOpTgt = breathe;
      this._ringScTgt = rScale;
      this._ringPuTgt = 0;

    } else if (this._state === STATE.ACTIVATING) {
      this._pulseEnvTgt = 1.0;
      this._compactTgt  = 1.0;
      // orbitMul smoothly collapses from full radius (1.0) to tight (0.42)
      const orbitMul = 1.0 - 0.58 * this._compactBlend;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        if (this._hasTarget[i]) {
          const tx = this._targets[i3], tz = this._targets[i3 + 2];
          const dx = tx - pos[i3], dz = tz - pos[i3 + 2];
          const d  = Math.sqrt(dx * dx + dz * dz);
          if (d > 0.04) { const m = Math.min(FORM_SPEED * dt, d); pos[i3] += (dx/d)*m; pos[i3+2] += (dz/d)*m; }
          else           { pos[i3] = tx; pos[i3 + 2] = tz; }
        } else {
          // Lerp toward compact target — smooth entry from IDLE's 0.88*orbitR base.
          const r = this._orbitR[i] * orbitMul;
          const tx = cx + Math.cos(this._orbitAng[i]) * r;
          const tz = cz + Math.sin(this._orbitAng[i]) * r;
          const lf = Math.min(1, dt * 8.0);
          pos[i3]     += (tx - pos[i3])     * lf;
          pos[i3 + 2] += (tz - pos[i3 + 2]) * lf;
        }
        pos[i3 + 1] = waveHeight(pos[i3], pos[i3 + 2], elapsed, energy) + 0.12;
      }
      if (this._stateTime > 1.4) { this._state = STATE.ACTIVE; this._stateTime = 0; }
      this._uniforms.uPulse.value    = 0;
      this._uniforms.uAlphaMul.value = this._alphaMul;
      this._ringOpTgt = 0.75;
      this._ringScTgt = 1.06;
      this._ringPuTgt = 0.3;

    } else if (this._state === STATE.ACTIVE) {
      this._pulseEnvTgt = 1.0;
      this._compactTgt  = 1.0;
      const orbitMul = 1.0 - 0.58 * this._compactBlend;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        if (this._hasTarget[i]) {
          pos[i3]     = this._targets[i3];
          pos[i3 + 1] = waveHeight(this._targets[i3], this._targets[i3 + 2], elapsed, energy) + 0.12;
          pos[i3 + 2] = this._targets[i3 + 2];
        } else {
          const r = this._orbitR[i] * orbitMul;
          pos[i3]     = cx + Math.cos(this._orbitAng[i]) * r;
          pos[i3 + 1] = waveHeight(pos[i3], pos[i3 + 2], elapsed, energy) + 0.12;
          pos[i3 + 2] = cz + Math.sin(this._orbitAng[i]) * r;
        }
      }
      this._uniforms.uPulse.value    = 0;
      this._uniforms.uAlphaMul.value = this._alphaMul;
      this._ringOpTgt = 0.80;
      this._ringScTgt = 1.10;
      this._ringPuTgt = 0.4;

    } else if (this._state === STATE.RETURNING) {
      this._pulseEnvTgt = 0;
      this._compactTgt  = 0;
      let allClose = true;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const tx = cx + Math.cos(this._orbitAng[i]) * this._orbitR[i];
        const tz = cz + Math.sin(this._orbitAng[i]) * this._orbitR[i];
        const dx = tx - pos[i3], dz = tz - pos[i3 + 2];
        const d  = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.15) {
          allClose = false;
          const m = Math.min(FORM_SPEED * dt, d);
          pos[i3]     += (dx / d) * m;
          pos[i3 + 2] += (dz / d) * m;
        } else {
          pos[i3] = tx; pos[i3 + 2] = tz;
        }
        pos[i3 + 1] = waveHeight(pos[i3], pos[i3 + 2], elapsed, energy) + 0.12;
      }
      if (allClose) { this._state = STATE.IDLE; this._stateTime = 0; }
      this._uniforms.uPulse.value    = 0;
      this._uniforms.uAlphaMul.value = this._alphaMul;
      const breathe = 0.58 + 0.22 * Math.sin(elapsed * 1.7);
      this._ringOpTgt = breathe;
      this._ringScTgt = 1.0 + 0.04 * Math.sin(elapsed * 1.7);
      this._ringPuTgt = 0;

    } else if (this._state === STATE.SCATTERED) {
      this._alphaMul = Math.max(0, this._alphaMul - dt * 0.6);
      this._uniforms.uAlphaMul.value = this._alphaMul;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        this._velArr[i3]     *= 0.93;
        this._velArr[i3 + 2] *= 0.93;
        pos[i3]     += this._velArr[i3]     * dt;
        pos[i3 + 2] += this._velArr[i3 + 2] * dt;
        pos[i3 + 1]  = waveHeight(pos[i3], pos[i3 + 2], elapsed, energy) + 0.12;
      }
      const rScale = 1.0 + (1.0 - this._alphaMul) * 0.28;
      this._setRingState(this._alphaMul * 0.9, rScale);

    } else if (this._state === STATE.SELECTED_SCATTER) {
      this._alphaMul = Math.max(0, this._alphaMul - dt * 0.85);
      this._uniforms.uAlphaMul.value = this._alphaMul;
      const yBoost = Math.max(0, 0.55 - this._stateTime * 1.8);
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        this._velArr[i3]     *= 0.97;
        this._velArr[i3 + 2] *= 0.97;
        pos[i3]     += this._velArr[i3]     * dt;
        pos[i3 + 2] += this._velArr[i3 + 2] * dt;
        pos[i3 + 1]  = waveHeight(pos[i3], pos[i3 + 2], elapsed, energy) + 0.12 + yBoost;
      }
      const rScale = 1.0 + (1.0 - this._alphaMul) * 0.55;
      this._setRingState(Math.min(1.3, this._alphaMul * 1.8), rScale);

    } else if (this._state === STATE.TITLE_FADE) {
      // Particles: flash burst then slow dissolve
      const decayRate = this._alphaMul > 1.0 ? 7.0 : 0.55;
      this._alphaMul = Math.max(0, this._alphaMul - dt * decayRate);
      this._uniforms.uAlphaMul.value = this._alphaMul;
      const flashPulse = Math.max(0, this._uniforms.uPulse.value - dt * 5.0);
      this._uniforms.uPulse.value = flashPulse;

      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        this._velArr[i3]     *= 0.985;
        this._velArr[i3 + 2] *= 0.985;
        pos[i3]     += this._velArr[i3]     * dt;
        pos[i3 + 2] += this._velArr[i3 + 2] * dt;
        pos[i3 + 1]  = waveHeight(pos[i3], pos[i3 + 2], elapsed, energy) + 0.12;
      }

      // Ring: smooth independent fade (flash color → song color, opacity → 0)
      this._ringFade = Math.max(0, this._ringFade - dt * 0.48);
      this._tmpCol1.copy(this._songCol).lerp(this._white, flashPulse * 0.8);
      this._ring1.uniforms.uColor.value.copy(this._tmpCol1);
      this._ring1.uniforms.uOpacity.value = this._ringFade * (1.0 + flashPulse * 0.6);
      this._ring1.uniforms.uPulse.value   = flashPulse;
      const rScale = 1.0 + (1.0 - this._ringFade) * 0.35;
      this._ring1.mesh.scale.set(rScale, 1, rScale);
    }

    this._pts.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    const sc = this.engine.scene;
    sc.remove(this._pts);  this._pts.geometry.dispose();  this._pts.material.dispose();
    sc.remove(this._ring1.mesh); this._ring1.geo.dispose(); this._ring1.mat.dispose();
  }
}

// ── SongCircleSystem ──────────────────────────────────────────────────────────

export class SongCircleSystem {
  constructor(engine, boat, onSelect) {
    this.engine    = engine;
    this.boat      = boat;
    this.onSelect  = onSelect;
    this._circles  = [];
    this._activeIdx = -1;
    this._disposed  = false;

    this._hintWorldPos = new THREE.Vector3();

    const spacing = 5.5, total = (SONGS.length - 1) * spacing;
    SONGS.forEach((song, i) => {
      this._circles.push(
        new SongCircle(engine, new THREE.Vector3(i * spacing - total / 2, 0, -14), song, i)
      );
    });

    this._onKeyDown = (e) => {
      if (e.key === "Enter" && this._activeIdx >= 0 && !this._disposed) {
        this.onSelect?.(this._activeIdx);
      }
    };
    window.addEventListener("keydown", this._onKeyDown);

    this._enterHint = document.createElement("div");
    this._enterHint.id = "song-enter-hint";
    this._enterHint.innerHTML = `Press <kbd>&#9166; Enter</kbd> to start`;
    this._enterHint.style.display = "none";
    document.body.appendChild(this._enterHint);

    this._updatable = { update: (dt, el) => this._update(dt, el) };
    engine.addUpdatable(this._updatable);
  }

  startGather() {
    for (const c of this._circles) c.startGather();
  }

  triggerSelection() {
    for (let i = 0; i < this._circles.length; i++) {
      if (i === this._activeIdx) this._circles[i].triggerTitleFade();
      else                       this._circles[i].triggerScatter();
    }
  }

  startGatherFrom(introFormPosArray) {
    const numCircles = this._circles.length;
    const perCircle  = this._circles[0]._n;

    const bins   = Array.from({ length: numCircles }, () => []);
    const filled = new Int32Array(numCircles);

    if (introFormPosArray && introFormPosArray.length > 0) {
      const total = introFormPosArray.length / 3;
      for (let i = 0; i < total; i++) {
        const px = introFormPosArray[i * 3];
        const pz = introFormPosArray[i * 3 + 2];
        let bestCi = -1, bestD2 = Infinity;
        for (let ci = 0; ci < numCircles; ci++) {
          if (filled[ci] >= perCircle) continue;
          const c  = this._circles[ci];
          const dx = px - c.center.x, dz = pz - c.center.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; bestCi = ci; }
        }
        if (bestCi >= 0) { bins[bestCi].push(i); filled[bestCi]++; }
      }
    }

    const delayCircles = [];
    for (let ci = 0; ci < numCircles; ci++) {
      const circle = this._circles[ci];
      if (circle._state !== STATE.WAITING) { circle.startGather(); continue; }

      const bin = bins[ci];
      for (let j = 0; j < perCircle; j++) {
        if (j < bin.length) {
          const src = bin[j];
          circle._posArr[j * 3]     = introFormPosArray[src * 3];
          circle._posArr[j * 3 + 1] = 0.15;
          circle._posArr[j * 3 + 2] = introFormPosArray[src * 3 + 2];
        } else {
          const a = Math.random() * Math.PI * 2;
          const r = 1 + Math.random() * 9;
          circle._posArr[j * 3]     = Math.cos(a) * r;
          circle._posArr[j * 3 + 1] = 0.15;
          circle._posArr[j * 3 + 2] = 3 + Math.sin(a) * r;
        }
      }

      circle._alphaMul = 0;
      circle._uniforms.uAlphaMul.value = 0;
      circle._uniforms.uColor.value.set(0x88e8ff);
      circle._pts.geometry.attributes.position.needsUpdate = true;
      circle._state     = STATE.GATHERING;
      circle._stateTime = 0;
      delayCircles.push(circle);
    }

    if (delayCircles.length > 0) {
      const MAX_DELAY = 1.2;
      let globalMinZ = Infinity, globalMaxZ = -Infinity;
      for (const circle of delayCircles) {
        for (let j = 0; j < circle._n; j++) {
          const pz = circle._posArr[j * 3 + 2];
          if (pz < globalMinZ) globalMinZ = pz;
          if (pz > globalMaxZ) globalMaxZ = pz;
        }
      }
      const zRange = globalMaxZ - globalMinZ;
      for (const circle of delayCircles) {
        for (let j = 0; j < circle._n; j++) {
          const pz = circle._posArr[j * 3 + 2];
          circle._gatherDelay[j] = zRange > 0.5
            ? ((pz - globalMinZ) / zRange) * MAX_DELAY
            : 0;
        }
      }
    }
  }

  _update(dt, elapsed) {
    if (this._disposed) return;

    const bp = this.boat.getPosition();
    let nearIdx = -1, nearDist = Infinity;

    for (let i = 0; i < this._circles.length; i++) {
      const c  = this._circles[i];
      c.update(dt, elapsed);

      if (ACTIVATION_ELIGIBLE.has(c._state)) {
        const dx = bp.x - c.center.x, dz = bp.z - c.center.z;
        const d  = Math.sqrt(dx * dx + dz * dz);
        if (d < ACTIVATE_DIST && d < nearDist) { nearDist = d; nearIdx = i; }
      }
    }

    if (nearIdx !== this._activeIdx) {
      if (this._activeIdx >= 0) this._circles[this._activeIdx].deactivate();
      this._activeIdx = nearIdx;
      if (nearIdx >= 0)         this._circles[nearIdx].activate();
    }

    if (this._activeIdx >= 0) {
      const c = this._circles[this._activeIdx];
      this._hintWorldPos.set(c.center.x, 0, c.center.z + HINT_OFFSET);
      this._hintWorldPos.project(this.engine.camera);
      const sx = (this._hintWorldPos.x + 1) / 2 * window.innerWidth;
      const sy = (-this._hintWorldPos.y + 1) / 2 * window.innerHeight;
      this._enterHint.style.left    = sx + "px";
      this._enterHint.style.top     = sy + "px";
      this._enterHint.style.display = "block";
    } else {
      this._enterHint.style.display = "none";
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    window.removeEventListener("keydown", this._onKeyDown);
    this._enterHint.remove();
    this.engine.removeUpdatable(this._updatable);
    for (const c of this._circles) c.dispose();
    this._circles = [];
  }
}
