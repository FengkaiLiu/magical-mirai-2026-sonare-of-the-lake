/**
 * utility-circle.js — Reusable particle-portal for in-scene UI actions
 * (boat selection, settings) in the song-select scene.
 *
 * Visually identical to MenuReturnCircle (orbit ring + glow ring + text
 * formation + dotted guide line).  Key differences:
 *   • Color and label text are constructor parameters.
 *   • After confirmation the circle returns to orbit (RETURNING → IDLE)
 *     so it can be activated repeatedly without a scene transition.
 *   • Supports a floating 3D center object (boat preview, gear icon) via
 *     setCenterObject(obj).
 *
 * makeGearObject(color) — factory exported for game-scene to create the
 * gear-shaped settings icon.
 */

import * as THREE from "three";
import { waveHeight } from "./boat.js";
import { t, getLang, onLangChange } from "./i18n.js";

// ── Config ────────────────────────────────────────────────────────────────────

const COUNT        = 1200;
const CIRCLE_R     = 2.2;
const ORBIT_SPEED  = 0.38;
const GATHER_SPEED = 5.0;
const FORM_SPEED   = 9.0;
const TEXT_W       = 34.0;
const TEXT_H       = 7.2;
const TEXT_FORWARD = -4.0;

// ── States ────────────────────────────────────────────────────────────────────

const STATE = Object.freeze({
  GATHERING:  "gathering",
  IDLE:       "idle",
  ACTIVATING: "activating",
  ACTIVE:     "active",
  RETURNING:  "returning",
});

// ── Shaders (identical to MenuReturnCircle / SongCircle) ──────────────────────

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
    vec3  col    = hotCol * glow + vec3(1.0) * core * (0.4 + uPulse * 0.32);
    gl_FragColor = vec4(col, vAlpha * glow * uAlphaMul);
  }
`;

const _ringVert = /* glsl */ `
  varying vec2  vUv;
  uniform float uTime;
  uniform float uPulse;
  void main() {
    vUv = uv;
    vec3 pos = position;
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
    float dist  = abs(vUv.y - 0.5) * 2.0;
    float core  = exp(-dist * dist * 14.0);
    float halo  = exp(-dist * dist * 3.0) * 0.55;
    float glow  = core + halo;
    float bright = 1.7 + uPulse * 1.5;
    vec3  col   = uColor * bright * glow
                + vec3(1.0) * core * (0.55 + uPulse * 0.55);
    gl_FragColor = vec4(col, glow * uOpacity);
  }
`;

// ── Text sampling ─────────────────────────────────────────────────────────────

function sampleText(text, count) {
  const cw = 2048, ch = 256;
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);

  let sz = 72;
  const fnt = s => `bold ${s}px sans-serif`;
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

// ── Gear object factory ───────────────────────────────────────────────────────

/**
 * Creates a flat horizontal gear mesh group suitable as a center icon.
 * Lies in the XZ plane so it's visible from the overhead camera.
 */
export function makeGearObject(color) {
  const group = new THREE.Group();
  const mat   = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });

  // Outer ring
  const ringGeo = new THREE.TorusGeometry(0.40, 0.055, 6, 32);
  const ring = new THREE.Mesh(ringGeo, mat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // 8 teeth arranged radially
  const toothGeo = new THREE.BoxGeometry(0.09, 0.07, 0.18);
  for (let i = 0; i < 8; i++) {
    const a     = (i / 8) * Math.PI * 2;
    const tooth = new THREE.Mesh(toothGeo, mat);
    tooth.position.set(Math.cos(a) * 0.52, 0, Math.sin(a) * 0.52);
    tooth.rotation.y = -a;
    group.add(tooth);
  }

  // Center hub
  const hubGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.07, 12);
  group.add(new THREE.Mesh(hubGeo, mat));

  // 3 spokes crossing the hub
  const spokeGeo = new THREE.BoxGeometry(0.045, 0.07, 0.62);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(spokeGeo, mat);
    spoke.rotation.y = (i / 3) * Math.PI;
    group.add(spoke);
  }

  return group;
}

// ── UtilityCircle ─────────────────────────────────────────────────────────────

export class UtilityCircle {
  /**
   * @param {object}        engine
   * @param {object}        boat
   * @param {THREE.Vector3} position   fixed world-space center (y ignored, clamped to 0)
   * @param {object}        opts
   * @param {number}        opts.color       hex color for particles and ring
   * @param {string}        opts.textKey     i18n key for the text formation label
   * @param {Function}      opts.onActivate  fired when player confirms (Enter key)
   */
  constructor(engine, boat, position, { color = 0x88ccff, textKey = "boatBtn", onActivate = null } = {}) {
    this.engine      = engine;
    this.boat        = boat;
    this._onActivate = onActivate;
    this._textKey    = textKey;
    this._disposed   = false;
    this._state      = STATE.GATHERING;
    this._stateTime  = 0;
    this._alphaMul   = 0;

    const col = new THREE.Color(color);
    this._col   = col;
    this._white = new THREE.Color(1.3, 1.3, 1.3);
    this._tmp   = new THREE.Color();

    this._pulseEnv     = 0; this._pulseEnvTgt  = 0;
    this._compactBlend = 0; this._compactTgt   = 0;
    this._ringOpTgt    = 0; this._ringScTgt    = 1.0; this._ringPuTgt = 0;

    this.center = new THREE.Vector3(position.x, 0, position.z);

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
    this._targets    = new Float32Array(n * 3);
    this._hasTarget  = new Uint8Array(n);

    const cx = this.center.x, cz = this.center.z;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 12;
      this._posArr[i*3]     = cx + Math.cos(a) * r;
      this._posArr[i*3 + 1] = 0.12;
      this._posArr[i*3 + 2] = cz + Math.sin(a) * r;
      this._sizeArr[i]    = 0.12 + Math.random() * 0.09;
      this._alphaArr[i]   = 0.75 + Math.random() * 0.25;
      this._orbitAng[i]   = Math.random() * Math.PI * 2;
      this._orbitR[i]     = CIRCLE_R * (0.28 + Math.random() * 0.72);
      this._orbitDir[i]   = Math.random() < 0.5 ? 1 : -1;
      this._orbitPhase[i] = Math.random() * Math.PI * 2;
    }

    // ── Main particle mesh ────────────────────────────────────────────────────
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
      vertexShader: _vert, fragmentShader: _frag, uniforms: this._uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this._pts.frustumCulled = false;
    this._pts.renderOrder   = 1;
    engine.scene.add(this._pts);

    // ── Glow ring ─────────────────────────────────────────────────────────────
    this._ring = this._makeRing(col);

    // ── Text points — initial pre-warm + lazy re-sample on lang change ───────
    this._textPts     = null;
    this._textPtsLang = null;
    const _doSample = () => {
      this._textPts     = sampleText(t(textKey), n);
      this._textPtsLang = getLang();
    };
    // Background warm — same pattern as SongCircle. The rAF guard prevents
    // stacking if lang toggles in rapid succession. The next boat entry then
    // hits the cached sample rather than triggering a synchronous getImageData
    // during activate().
    this._bgSampleRaf = null;
    const _scheduleBgSample = () => {
      if (this._bgSampleRaf || this._disposed) return;
      this._bgSampleRaf = requestAnimationFrame(() => {
        this._bgSampleRaf = null;
        if (this._disposed) return;
        if (this._textPtsLang === getLang()) return;
        _doSample();
      });
    };
    _scheduleBgSample();

    // ── Screen-space hint ─────────────────────────────────────────────────────
    this._hintEl = document.createElement("div");
    this._hintEl.className = "return-hint-label";
    this._hintEl.innerHTML = t("enterStart");
    this._hintEl.style.display = "none";
    document.body.appendChild(this._hintEl);
    this._hintWorldPos = new THREE.Vector3();
    // INP optimisation: see SongCircle's onLangChange handler — same reasoning.
    // Sample eagerly only if text is currently visible (live morph); otherwise
    // schedule a background warm so the next entry hits cache.
    this._offLang = onLangChange(() => {
      if (this._hintEl) this._hintEl.innerHTML = t("enterStart");
      if (this._textPtsLang === getLang()) return;
      if (this._state === STATE.ACTIVATING || this._state === STATE.ACTIVE) {
        _doSample();
        this._assignTextTargets();
        if (this._state === STATE.ACTIVE) {
          this._state     = STATE.ACTIVATING;
          this._stateTime = 0;
        }
      } else {
        this._textPts     = null;
        this._textPtsLang = null;
        _scheduleBgSample();
      }
    });

    // ── Floating 3D center object ─────────────────────────────────────────────
    this._centerPivot = new THREE.Object3D();
    this._centerPivot.position.set(cx, 0.35, cz);
    engine.scene.add(this._centerPivot);
    this._centerObject  = null;
    this._centerAge     = 0;

    // ── Enter key listener ────────────────────────────────────────────────────
    this._onKeyDown = (e) => {
      if (e.key === "Enter" && (this._state === STATE.ACTIVATING || this._state === STATE.ACTIVE) && !this._disposed)
        this._triggerActivate();
    };
    window.addEventListener("keydown", this._onKeyDown);

    engine.addUpdatable(this);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Swap the 3D object displayed at the circle centre.
   * @param {THREE.Object3D} obj     The new centre object (or null).
   * @param {boolean}        owned   True if dispose() should release the object's
   *                                 geometry/materials. Use for self-built meshes
   *                                 (e.g. makeGearObject). Do NOT pass true for
   *                                 GLTF clones — those share material refs with
   *                                 the asset-cache and disposing them would
   *                                 blank every other instance.
   */
  setCenterObject(obj, owned = false) {
    if (this._centerObject) {
      this._centerPivot.remove(this._centerObject);
      if (this._ownsCenterObject) this._disposeCenterObject(this._centerObject);
    }
    this._centerObject     = obj ?? null;
    this._ownsCenterObject = !!obj && !!owned;
    if (obj) this._centerPivot.add(obj);
  }

  _disposeCenterObject(root) {
    const geo = new Set(), mat = new Set();
    root.traverse(o => {
      if (!o.isMesh) return;
      if (o.geometry && !geo.has(o.geometry)) { geo.add(o.geometry); o.geometry.dispose(); }
      // makeGearObject shares one material across every sub-mesh.
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && !mat.has(m)) { mat.add(m); m.dispose(); }
      }
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _makeRing(col) {
    const geo = new THREE.RingGeometry(CIRCLE_R - 0.28, CIRCLE_R + 0.28, 128, 1);
    geo.rotateX(-Math.PI / 2);
    const uniforms = {
      uTime:    { value: 0 },
      uColor:   { value: col.clone() },
      uOpacity: { value: 0 },
      uPulse:   { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: _ringVert, fragmentShader: _ringFrag, uniforms,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.center.x, 0, this.center.z);
    mesh.frustumCulled = false;
    mesh.renderOrder   = 1;
    this.engine.scene.add(mesh);
    return { mesh, uniforms, geo, mat };
  }

  _assignTextTargets() {
    if (!this._textPts?.length) return;
    this._hasTarget.fill(0);
    const pts = this._textPts;
    const cx  = this.center.x, cz = this.center.z + TEXT_FORWARD;
    const n   = this._n, pos = this._posArr;
    const used = new Uint8Array(n);

    const worldTargets = pts.map((p, idx) => ({
      idx, tx: cx + p.lx * TEXT_W, tz: cz - p.ly * TEXT_H,
    }));
    worldTargets.sort((a, b) => a.tx - b.tx);

    const byX = Array.from({ length: n }, (_, i) => ({ idx: i, x: pos[i * 3] }));
    byX.sort((a, b) => a.x - b.x);

    for (const { tx, tz } of worldTargets) {
      let lo = 0, hi = byX.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (byX[mid].x < tx) lo = mid + 1; else hi = mid;
      }
      let best = -1, bestD2 = Infinity;
      const W = 200;
      for (let fi = Math.max(0, lo - W); fi < Math.min(n, lo + W); fi++) {
        const fIdx = byX[fi].idx;
        if (used[fIdx]) continue;
        const dx = pos[fIdx*3] - tx, dz = pos[fIdx*3+2] - tz;
        const d2 = dx*dx + dz*dz;
        if (d2 < bestD2) { bestD2 = d2; best = fIdx; }
      }
      if (best < 0) for (const f of byX) { if (!used[f.idx]) { best = f.idx; break; } }
      if (best >= 0) {
        used[best] = 1;
        this._hasTarget[best]      = 1;
        this._targets[best*3]      = tx;
        this._targets[best*3 + 1]  = 0;
        this._targets[best*3 + 2]  = tz;
      }
    }
  }

  _triggerActivate() {
    this._onActivate?.();
    this._state     = STATE.RETURNING;
    this._stateTime = 0;
    if (this._hintEl) this._hintEl.style.display = "none";
  }

  // ── Update ────────────────────────────────────────────────────────────────

  update(dt, elapsed) {
    if (this._disposed) return;

    this._ring.uniforms.uTime.value = elapsed;
    this._stateTime += dt;

    // Center object: float + slow rotation, hidden during initial gather
    this._centerAge += dt;
    if (this._centerObject) {
      this._centerObject.visible = this._state !== STATE.GATHERING;
      const bob = Math.sin(this._centerAge * 1.3) * 0.05;
      this._centerPivot.position.y = 0.35 + bob;
      this._centerPivot.rotation.y += dt * 0.55;
    }

    const n  = this._n, pos = this._posArr;
    const cx = this.center.x, cz = this.center.z;
    const energy = this.engine.env?.smoothedEnergy ?? 0;

    for (let i = 0; i < n; i++) {
      this._orbitAng[i] += ORBIT_SPEED * this._orbitDir[i] *
        (0.6 + 0.4 * Math.abs(Math.sin(elapsed * 0.3 + this._orbitPhase[i]))) * dt;
    }

    const _lrp = (a, b, s) => a + (b - a) * Math.min(1, dt * s);
    this._pulseEnv     = _lrp(this._pulseEnv,     this._pulseEnvTgt, 4.5);
    this._compactBlend = _lrp(this._compactBlend, this._compactTgt,  3.5);

    const rf = Math.min(1, dt * 7);
    const ru = this._ring.uniforms;
    ru.uOpacity.value += (this._ringOpTgt - ru.uOpacity.value) * rf;
    ru.uPulse.value   += (this._ringPuTgt - ru.uPulse.value)   * rf;
    const ns = this._ring.mesh.scale.x + (this._ringScTgt - this._ring.mesh.scale.x) * rf;
    this._ring.mesh.scale.set(ns, 1, ns);
    this._tmp.copy(this._col).lerp(this._white, ru.uPulse.value * 0.55);
    ru.uColor.value.copy(this._tmp);

    // ── State machine ─────────────────────────────────────────────────────────

    if (this._state === STATE.GATHERING) {
      this._alphaMul = Math.min(1, this._alphaMul + dt * 0.55);
      this._uniforms.uAlphaMul.value = this._alphaMul;
      let allClose = true;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const tx = cx + Math.cos(this._orbitAng[i]) * this._orbitR[i];
        const tz = cz + Math.sin(this._orbitAng[i]) * this._orbitR[i];
        const dx = tx - pos[i3], dz = tz - pos[i3+2];
        const d  = Math.sqrt(dx*dx + dz*dz);
        if (d > 0.2) {
          allClose = false;
          const sp = Math.min(GATHER_SPEED * 2.4, d * 4.2 + 1.5);
          const m  = Math.min(sp * dt, d - 0.18);
          pos[i3]     += (dx/d) * m;
          pos[i3 + 2] += (dz/d) * m;
        } else {
          pos[i3] = tx; pos[i3+2] = tz;
        }
        pos[i3 + 1] = waveHeight(pos[i3], pos[i3+2], elapsed, energy) + 0.12;
      }
      if (allClose || this._stateTime > 9.0) {
        this._state = STATE.IDLE; this._stateTime = 0;
      }
      this._pulseEnvTgt = 0; this._compactTgt = 0;
      this._ringOpTgt = Math.min(0.7, this._stateTime * 0.12);
      this._ringScTgt = 1.0; this._ringPuTgt = 0;

    } else if (this._state === STATE.IDLE) {
      const lf = Math.min(1, dt * 8.0);
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const r  = this._orbitR[i] * (0.88 + Math.sin(elapsed * 1.7 + this._orbitPhase[i]) * 0.12);
        const tx = cx + Math.cos(this._orbitAng[i]) * r;
        const tz = cz + Math.sin(this._orbitAng[i]) * r;
        pos[i3]     += (tx - pos[i3])   * lf;
        pos[i3 + 2] += (tz - pos[i3+2]) * lf;
        pos[i3 + 1]  = waveHeight(pos[i3], pos[i3+2], elapsed, energy) + 0.12;
      }
      this._pulseEnvTgt = 0; this._compactTgt = 0;
      this._uniforms.uPulse.value    = 0;
      this._uniforms.uAlphaMul.value = this._alphaMul;
      const breathe = 0.55 + 0.18 * Math.sin(elapsed * 1.7) + 0.07 * Math.sin(elapsed * 4.3);
      this._ringOpTgt = breathe;
      this._ringScTgt = 1.00 + 0.06 * Math.sin(elapsed * 1.7);
      this._ringPuTgt = 0;

    } else if (this._state === STATE.ACTIVATING) {
      this._pulseEnvTgt = 1.0; this._compactTgt = 1.0;
      const orbitMul = 1.0 - 0.58 * this._compactBlend;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        if (this._hasTarget[i]) {
          const tx = this._targets[i3], tz = this._targets[i3+2];
          const dx = tx - pos[i3], dz = tz - pos[i3+2];
          const d  = Math.sqrt(dx*dx + dz*dz);
          if (d > 0.04) { const m = Math.min(FORM_SPEED * dt, d); pos[i3] += (dx/d)*m; pos[i3+2] += (dz/d)*m; }
          else           { pos[i3] = tx; pos[i3+2] = tz; }
        } else {
          const r = this._orbitR[i] * orbitMul;
          pos[i3]   += (cx + Math.cos(this._orbitAng[i]) * r - pos[i3])   * Math.min(1, dt * 8);
          pos[i3+2] += (cz + Math.sin(this._orbitAng[i]) * r - pos[i3+2]) * Math.min(1, dt * 8);
        }
        pos[i3 + 1] = waveHeight(pos[i3], pos[i3+2], elapsed, energy) + 0.12;
      }
      if (this._stateTime > 1.4) { this._state = STATE.ACTIVE; this._stateTime = 0; }
      this._uniforms.uPulse.value    = 0;
      this._uniforms.uAlphaMul.value = this._alphaMul;
      this._ringOpTgt = 0.75; this._ringScTgt = 1.06; this._ringPuTgt = 0.3;

    } else if (this._state === STATE.ACTIVE) {
      this._pulseEnvTgt = 1.0; this._compactTgt = 1.0;
      const orbitMul = 1.0 - 0.58 * this._compactBlend;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        if (this._hasTarget[i]) {
          pos[i3]     = this._targets[i3];
          pos[i3 + 1] = waveHeight(this._targets[i3], this._targets[i3+2], elapsed, energy) + 0.12;
          pos[i3 + 2] = this._targets[i3+2];
        } else {
          const r = this._orbitR[i] * orbitMul;
          pos[i3]     = cx + Math.cos(this._orbitAng[i]) * r;
          pos[i3 + 1] = waveHeight(pos[i3], pos[i3+2], elapsed, energy) + 0.12;
          pos[i3 + 2] = cz + Math.sin(this._orbitAng[i]) * r;
        }
      }
      this._uniforms.uPulse.value    = 0;
      this._uniforms.uAlphaMul.value = this._alphaMul;
      this._ringOpTgt = 0.80; this._ringScTgt = 1.10; this._ringPuTgt = 0.4;

    } else if (this._state === STATE.RETURNING) {
      this._pulseEnvTgt = 0; this._compactTgt = 0;
      this._hasTarget.fill(0);
      let allClose = true;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const tx = cx + Math.cos(this._orbitAng[i]) * this._orbitR[i];
        const tz = cz + Math.sin(this._orbitAng[i]) * this._orbitR[i];
        const dx = tx - pos[i3], dz = tz - pos[i3+2];
        const d  = Math.sqrt(dx*dx + dz*dz);
        if (d > 0.15) {
          allClose = false;
          const m = Math.min(FORM_SPEED * dt, d);
          pos[i3]   += (dx/d)*m; pos[i3+2] += (dz/d)*m;
        } else { pos[i3] = tx; pos[i3+2] = tz; }
        pos[i3 + 1] = waveHeight(pos[i3], pos[i3+2], elapsed, energy) + 0.12;
      }
      if (allClose) { this._state = STATE.IDLE; this._stateTime = 0; }
      this._uniforms.uPulse.value    = 0;
      this._uniforms.uAlphaMul.value = this._alphaMul;
      this._ringOpTgt = 0.58 + 0.22 * Math.sin(elapsed * 1.7);
      this._ringScTgt = 1.0; this._ringPuTgt = 0;
    }

    this._pts.geometry.attributes.position.needsUpdate = true;

    // ── Boat proximity detection ──────────────────────────────────────────────
    const boatPos = this.boat.getPosition();
    const dx = boatPos.x - cx, dz = boatPos.z - cz;
    const dist = Math.sqrt(dx*dx + dz*dz);

    if (this._state === STATE.IDLE || this._state === STATE.RETURNING) {
      if (dist < CIRCLE_R) {
        // Lazy sample: lang may have changed while this circle was idle.
        if (!this._textPts || this._textPtsLang !== getLang()) {
          this._textPts     = sampleText(t(this._textKey), this._n);
          this._textPtsLang = getLang();
        }
        this._state = STATE.ACTIVATING; this._stateTime = 0;
        this._assignTextTargets();
      }
    } else if (this._state === STATE.ACTIVATING || this._state === STATE.ACTIVE) {
      if (dist > CIRCLE_R * 1.4) {
        this._state = STATE.RETURNING; this._stateTime = 0;
      }
    }

    if (this._state === STATE.ACTIVATING || this._state === STATE.ACTIVE) {
      // Project a point below the circle's edge into screen space.
      // cz + CIRCLE_R + 1.0 places the hint just outside the bottom of the ring,
      // matching the HINT_OFFSET convention used by song circles.
      this._hintWorldPos.set(cx, 0, cz + CIRCLE_R + 1.0);
      this._hintWorldPos.project(this.engine.camera);
      const sx = (this._hintWorldPos.x + 1) / 2 * window.innerWidth;
      const sy = (-this._hintWorldPos.y + 1) / 2 * window.innerHeight;
      this._hintEl.style.left      = sx + "px";
      this._hintEl.style.top       = sy + "px";
      this._hintEl.style.transform = "translateX(-50%)";
      this._hintEl.style.display   = "block";
    } else {
      this._hintEl.style.display = "none";
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._bgSampleRaf) { cancelAnimationFrame(this._bgSampleRaf); this._bgSampleRaf = null; }
    this._offLang?.();
    window.removeEventListener("keydown", this._onKeyDown);
    this._hintEl?.remove();
    this._hintEl = null;
    if (this._centerObject) {
      this._centerPivot.remove(this._centerObject);
      if (this._ownsCenterObject) this._disposeCenterObject(this._centerObject);
    }
    this.engine.scene.remove(this._centerPivot);
    this.engine.removeUpdatable(this);
    this.engine.scene.remove(this._pts);
    this._pts.geometry.dispose();     this._pts.material.dispose();
    this.engine.scene.remove(this._ring.mesh);
    this._ring.geo.dispose();         this._ring.mat.dispose();
  }
}
