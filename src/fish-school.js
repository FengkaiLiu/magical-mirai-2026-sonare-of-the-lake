/**
 * ==========================================
 * LyricFormation — Surface Lyric Particle System
 * ==========================================
 * Each instance represents ONE lyric phrase floating on the water surface.
 * - Spawns at a fixed world position (near boat at creation time)
 * - Particles ride the wave surface (Y = waveHeight + offset)
 * - Text formation is horizontal (flat in XZ plane)
 * - Fades out gracefully when replaced by newer phrases
 *
 * Managed by FishLyricSystem (max 3 active at once).
 */

import * as THREE from "three";
import { waveHeight } from "./boat.js";

// ─── Config ──────────────────────────────────────────────

const FISH_COUNT       = 2800;
const SCHOOL_RADIUS    = 14;
const SURFACE_OFFSET   = 0.18;   // how far above wave surface particles float
const TEXT_WIDTH       = 24;     // world-unit width of text formation
const FORM_Y_RANGE     = 3.5;    // world-unit depth of text formation (Z axis)
const MAX_SAMPLE_POINTS = 2800;
const FORM_SPEED       = 12.0;
const AVOID_RADIUS     = 5.5;    // boat avoidance radius
const AVOID_FORCE      = 20;     // explosive push when boat enters

// ─── Glow particle shader ────────────────────────────────

const glowVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uAlphaMul;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float pulse = 1.0 + 0.15 * sin(uTime * 2.0 + position.x * 3.0 + position.z * 2.0);
    float sizeBoost = mix(1.0, 1.5, uIntensity);
    gl_PointSize = aSize * pulse * sizeBoost * (280.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const glowFrag = /* glsl */ `
  uniform vec3  uColor;
  uniform vec3  uTargetColor;
  uniform float uColorBlend;
  uniform float uIntensity;
  uniform float uAlphaMul;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    float core = exp(-d * d * 28.0);
    float halo = exp(-d * d * 7.0) * 0.6;
    float glowBoost = mix(2.5, 6.0, uIntensity);
    float glow = (core + halo) * glowBoost;

    vec3 themeColor = mix(uColor, uTargetColor, uColorBlend);
    vec3 col = themeColor * glow + vec3(1.0) * core * 0.4;

    gl_FragColor = vec4(col, vAlpha * glow * uAlphaMul);
  }
`;

// ─── Text sampling (cached) ─────────────────────────────

const _textCache = new Map();

function sampleTextPoints(text) {
  if (_textCache.has(text)) return _textCache.get(text);

  const canvasW = 2048, canvasH = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvasW; canvas.height = canvasH;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvasW, canvasH);

  const font = (s) => `bold ${s}px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
  let fontSize = 80;
  ctx.font = font(fontSize);
  while (ctx.measureText(text).width > canvasW * 0.92 && fontSize > 12) {
    fontSize -= 4;
    ctx.font = font(fontSize);
  }
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvasW / 2, canvasH / 2);

  const pixels = ctx.getImageData(0, 0, canvasW, canvasH).data;
  const white = [];
  for (let y = 0; y < canvasH; y++)
    for (let x = 0; x < canvasW; x++)
      if (pixels[(y * canvasW + x) * 4] > 128) white.push({ x, y });

  const pts = [];
  if (white.length <= MAX_SAMPLE_POINTS) {
    pts.push(...white);
  } else {
    const step = white.length / MAX_SAMPLE_POINTS;
    for (let i = 0; i < MAX_SAMPLE_POINTS; i++) pts.push(white[Math.floor(i * step)]);
  }

  // lx ∈ [-0.5, 0.5] horizontal, ly ∈ [-0.5, 0.5] (Y flipped so top is positive)
  const result = pts.map(p => ({
    lx: p.x / canvasW - 0.5,
    ly: 0.5 - p.y / canvasH,
  }));

  _textCache.set(text, result);
  return result;
}

// ─── LyricFormation ──────────────────────────────────────

export class LyricFormation {
  /**
   * @param {object} engine
   * @param {THREE.Vector3} center  — world position to spawn at (on water surface)
   * @param {string} text           — lyric phrase
   * @param {number} color          — hex color (theme particle color)
   */
  constructor(engine, center, text, color) {
    this.engine  = engine;
    this.camera  = engine.camera;
    this._center = center.clone();
    this._center.y = 0; // Y driven by waveHeight per-frame

    this.posArray   = new Float32Array(FISH_COUNT * 3);
    this.velocities = new Float32Array(FISH_COUNT * 3);
    this.targets    = new Float32Array(FISH_COUNT * 3); // local [lx, 0, lz]
    this.hasTarget  = new Uint8Array(FISH_COUNT);
    this.phases     = new Float32Array(FISH_COUNT);
    this.sizes      = new Float32Array(FISH_COUNT);
    this.alphas     = new Float32Array(FISH_COUNT);

    const cx = this._center.x, cz = this._center.z;
    for (let i = 0; i < FISH_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r     = Math.random() * SCHOOL_RADIUS;
      this.posArray[i * 3]     = cx + Math.cos(angle) * r;
      this.posArray[i * 3 + 1] = SURFACE_OFFSET; // will be corrected each frame
      this.posArray[i * 3 + 2] = cz + Math.sin(angle) * r;

      this.velocities[i * 3]     = (Math.random() - 0.5) * 1.5;
      this.velocities[i * 3 + 1] = 0;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.5;

      this.phases[i] = Math.random() * Math.PI * 2;
      this.sizes[i]  = 0.12 + Math.random() * 0.14;
      this.alphas[i] = 0.8  + Math.random() * 0.2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.posArray, 3));
    geo.setAttribute("aSize",    new THREE.BufferAttribute(this.sizes,    1));
    geo.setAttribute("aAlpha",   new THREE.BufferAttribute(this.alphas,   1));

    this._uniforms = {
      uColor:       { value: new THREE.Color(color) },
      uTargetColor: { value: new THREE.Color(0xffffff) },
      uColorBlend:  { value: 0 },
      uIntensity:   { value: 0 },
      uAlphaMul:    { value: 0 },   // starts at 0, fades in on spawn
      uTime:        { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader:   glowVert,
      fragmentShader: glowFrag,
      uniforms:       this._uniforms,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder   = 1; // render above water
    engine.scene.add(this.mesh);

    // Set text formation targets
    this._setPhrase(text);

    // Fade in
    this._alphaMul  = 0;
    this._fadeState = "in";   // "in" | "hold" | "out"
    this._fadeDur   = 1.2;
    this._fadeTimer = 0;

    this._intensity = 0;
    this._textActive = true;

    // Color shift
    this._colorShiftTimer    = 0;
    this._colorShiftDuration = 1;

    this._disposed = false;
  }

  // ── Public ──────────────────────────────────────────────

  /** Trigger a fade-out. Returns true once fully faded (safe to dispose). */
  startFade() {
    if (this._fadeState !== "out") {
      this._fadeState = "out";
      this._fadeTimer = 0;
      this._fadeDur   = 1.5;
    }
  }

  get faded() {
    return this._fadeState === "out" && this._fadeTimer >= this._fadeDur;
  }

  triggerColorShift(hexColor, duration = 3.0) {
    this._colorShiftColor = new THREE.Color(hexColor);
    this._colorShiftTimer    = duration;
    this._colorShiftDuration = duration;
    this._uniforms.uTargetColor.value.set(hexColor);
  }

  // ── Internal ─────────────────────────────────────────────

  _setPhrase(text) {
    const points2D = sampleTextPoints(text);
    this._textPointsLocal = points2D.map(p => ({
      lx: p.lx * TEXT_WIDTH,
      lz: -p.ly * FORM_Y_RANGE, // negate: top of text faces camera
    }));
    this._assignTargets();
  }

  _assignTargets() {
    const pts = this._textPointsLocal;
    if (!pts || pts.length === 0) return;

    const sc = this._center;

    // World positions: fixed orientation, no billboard rotation
    const worldTargets = pts.map((p, idx) => ({
      idx,
      wx: sc.x + p.lx,
      wz: sc.z + p.lz,
    }));
    worldTargets.sort((a, b) => a.wx - b.wx);

    const fishByX = Array.from({ length: FISH_COUNT }, (_, i) => ({
      idx: i, x: this.posArray[i * 3],
    }));
    fishByX.sort((a, b) => a.x - b.x);

    for (let i = 0; i < FISH_COUNT; i++) this.hasTarget[i] = 0;
    const used = new Set();

    for (const wt of worldTargets) {
      const pt = pts[wt.idx];

      let lo = 0, hi = fishByX.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fishByX[mid].x < wt.wx) lo = mid + 1; else hi = mid;
      }

      let bestIdx = -1, bestDist = Infinity;
      const W = 200;
      for (let fi = Math.max(0, lo - W); fi < Math.min(fishByX.length, lo + W); fi++) {
        const fIdx = fishByX[fi].idx;
        if (used.has(fIdx)) continue;
        const dx = this.posArray[fIdx * 3] - wt.wx;
        const dz = this.posArray[fIdx * 3 + 2] - wt.wz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDist) { bestDist = d2; bestIdx = fIdx; }
      }
      if (bestIdx < 0) {
        for (const f of fishByX) { if (!used.has(f.idx)) { bestIdx = f.idx; break; } }
      }

      if (bestIdx >= 0) {
        used.add(bestIdx);
        this.hasTarget[bestIdx] = 1;
        this.targets[bestIdx * 3]     = pt.lx;
        this.targets[bestIdx * 3 + 1] = 0;
        this.targets[bestIdx * 3 + 2] = pt.lz;
      }
    }
  }

  // ── Update ───────────────────────────────────────────────

  update(dt, elapsed, boatPos) {
    if (this._disposed) return;

    const uniforms = this._uniforms;
    uniforms.uTime.value = elapsed;

    // Fade in / out
    this._fadeTimer += dt;
    if (this._fadeState === "in") {
      this._alphaMul = Math.min(1, this._fadeTimer / this._fadeDur);
      if (this._alphaMul >= 1) { this._fadeState = "hold"; this._fadeTimer = 0; }
    } else if (this._fadeState === "out") {
      this._alphaMul = Math.max(0, 1 - this._fadeTimer / this._fadeDur);
    }
    uniforms.uAlphaMul.value = this._alphaMul;

    // Intensity lerp (glow boost while text is showing)
    const targetInt = this._textActive ? 1.0 : 0.0;
    this._intensity += (targetInt - this._intensity) * Math.min(1, dt * 2.0);
    uniforms.uIntensity.value = this._intensity;

    // Color shift tween
    if (this._colorShiftTimer > 0) {
      this._colorShiftTimer = Math.max(0, this._colorShiftTimer - dt);
      const t = 1 - this._colorShiftTimer / this._colorShiftDuration;
      uniforms.uColorBlend.value = Math.sin(Math.PI * t);
    } else {
      uniforms.uColorBlend.value = 0;
    }

    const sc  = this._center;
    const pos = this.posArray;
    const vel  = this.velocities;
    const tgt  = this.targets;
    const hasT = this.hasTarget;

    for (let i = 0; i < FISH_COUNT; i++) {
      const i3 = i * 3;
      let px = pos[i3], pz = pos[i3 + 2];
      let vx = vel[i3], vz = vel[i3 + 2];

      if (hasT[i]) {
        // Move toward formation target — fixed world position, no billboard
        const lx = tgt[i3], lz = tgt[i3 + 2];
        const wtx = sc.x + lx;
        const wtz = sc.z + lz;

        const dx = wtx - px, dz = wtz - pz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0.05) {
          const factor = Math.min(FORM_SPEED * dt / dist, 1);
          px += dx * factor;
          pz += dz * factor;
        }
        vx *= 0.9; vz *= 0.9;

      } else {
        // Idle drift around center
        vx += (Math.random() - 0.5) * 2.0 * dt;
        vz += (Math.random() - 0.5) * 2.0 * dt;

        const tcx = sc.x - px, tcz = sc.z - pz;
        const dCenter = Math.sqrt(tcx * tcx + tcz * tcz);
        if (dCenter > SCHOOL_RADIUS * 0.7) {
          const pull = 0.5 * dt;
          vx += (tcx / dCenter) * pull;
          vz += (tcz / dCenter) * pull;
        }

        const speed = Math.sqrt(vx * vx + vz * vz);
        if (speed > 2.0) { const r = 2.0 / speed; vx *= r; vz *= r; }

        px += vx * dt;
        pz += vz * dt;

        // Clamp to circle around center
        const dx2 = px - sc.x, dz2 = pz - sc.z;
        const d2  = Math.sqrt(dx2 * dx2 + dz2 * dz2);
        if (d2 > SCHOOL_RADIUS) {
          px = sc.x + dx2 * (SCHOOL_RADIUS / d2);
          pz = sc.z + dz2 * (SCHOOL_RADIUS / d2);
          vx *= -0.5; vz *= -0.5;
        }
      }

      // Boat avoidance — exponential push so particles scatter visibly
      if (boatPos) {
        const bx = px - boatPos.x, bz = pz - boatPos.z;
        const bd = Math.sqrt(bx * bx + bz * bz);
        if (bd < AVOID_RADIUS && bd > 0.01) {
          const t    = 1 - bd / AVOID_RADIUS;          // 0 at edge, 1 at center
          const push = t * t * AVOID_FORCE * dt;        // quadratic: much stronger up close
          px += (bx / bd) * push;
          pz += (bz / bd) * push;
          vx += (bx / bd) * push * 8;                  // impart lasting velocity
          vz += (bz / bd) * push * 8;
        }
      }

      // Y: ride wave surface
      const py = waveHeight(px, pz, elapsed) + SURFACE_OFFSET;

      pos[i3]     = px;
      pos[i3 + 1] = py;
      pos[i3 + 2] = pz;
      vel[i3]     = vx;
      vel[i3 + 2] = vz;
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.engine.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
