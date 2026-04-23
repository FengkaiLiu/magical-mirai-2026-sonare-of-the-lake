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

const FISH_COUNT       = 2400;
const SCHOOL_RADIUS    = 14;
const SURFACE_OFFSET   = 0.18;   // how far above wave surface particles float
const TEXT_WIDTH       = 24;     // world-unit width of text formation
const FORM_Y_RANGE     = 3.5;    // world-unit depth of text formation (Z axis)
const MAX_SAMPLE_POINTS = 2400;
const FORM_SPEED       = 12.0;
const AVOID_RADIUS     = 0.7;    // boat avoidance radius
const AVOID_FORCE      = 20;     // explosive push when boat enters

// Sand-kick scatter
const SCATTER_DURATION    = 1.2;   // seconds particle flies free after impact
const SCATTER_SIZE_BOOST  = 1.5;   // point size multiplier while scattered
const SCATTER_ALPHA_BOOST = 1.8;   // alpha multiplier while scattered
const SCATTER_VEL_DAMP    = 0.92;  // per-frame velocity damping while scattered
const DIRECTIONAL_BLEND   = 0.65;  // how much boat heading blends into kick direction

// Wave-height grid (pre-computed once per frame, bilinear-sampled per particle)
const GRID_N    = 16;                          // grid cells per axis
const GRID_SPAN = 80;                          // world-unit coverage (±40)
const GRID_STEP = GRID_SPAN / (GRID_N - 1);   // world units per cell
const _waveGrid = new Float32Array(GRID_N * GRID_N); // never re-allocated

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
  uniform float uGlowMin;
  uniform float uGlowMax;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    float core = exp(-d * d * 28.0);
    float halo = exp(-d * d * 7.0) * 0.6;
    float glowBoost = mix(uGlowMin, uGlowMax, uIntensity);
    float glow = (core + halo) * glowBoost;

    vec3 themeColor = mix(uColor, uTargetColor, uColorBlend);
    vec3 col = themeColor * glow + vec3(1.0) * core * 0.4;

    gl_FragColor = vec4(col, vAlpha * glow * uAlphaMul);
  }
`;

// ─── Text sampling (cached) ─────────────────────────────

const _textCache = new Map();

function sampleTextPoints(text, letterSpacing = "", maxPoints = MAX_SAMPLE_POINTS, outlineOnly = true) {
  const cacheKey = `${text}::${letterSpacing}::${maxPoints}::${outlineOnly}`;
  if (_textCache.has(cacheKey)) return _textCache.get(cacheKey);

  const canvasW = 1024, canvasH = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvasW; canvas.height = canvasH;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvasW, canvasH);

  const font = (s) => `bold ${s}px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
  let fontSize = 60;
  ctx.font = font(fontSize);
  ctx.letterSpacing = letterSpacing;
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
  if (outlineOnly) {
    // Keep pixels that are white AND touch at least one black neighbor (8-connected edge)
    for (let y = 1; y < canvasH - 1; y++) {
      for (let x = 1; x < canvasW - 1; x++) {
        if (pixels[(y * canvasW + x) * 4] <= 128) continue;
        const hasEdge =
          pixels[((y - 1) * canvasW + x - 1) * 4] <= 128 ||
          pixels[((y - 1) * canvasW + x    ) * 4] <= 128 ||
          pixels[((y - 1) * canvasW + x + 1) * 4] <= 128 ||
          pixels[(y       * canvasW + x - 1) * 4] <= 128 ||
          pixels[(y       * canvasW + x + 1) * 4] <= 128 ||
          pixels[((y + 1) * canvasW + x - 1) * 4] <= 128 ||
          pixels[((y + 1) * canvasW + x    ) * 4] <= 128 ||
          pixels[((y + 1) * canvasW + x + 1) * 4] <= 128;
        if (hasEdge) white.push({ x, y });
      }
    }
  } else {
    // Filled: keep all white pixels
    for (let y = 0; y < canvasH; y++) {
      for (let x = 0; x < canvasW; x++) {
        if (pixels[(y * canvasW + x) * 4] > 128) white.push({ x, y });
      }
    }
  }

  const pts = [];
  if (white.length <= maxPoints) {
    pts.push(...white);
  } else {
    const step = white.length / maxPoints;
    for (let i = 0; i < maxPoints; i++) pts.push(white[Math.floor(i * step)]);
  }

  // lx ∈ [-0.5, 0.5] horizontal, ly ∈ [-0.5, 0.5] (Y flipped so top is positive)
  const result = pts.map(p => ({
    lx: p.x / canvasW - 0.5,
    ly: 0.5 - p.y / canvasH,
  }));

  _textCache.set(cacheKey, result);
  return result;
}

// ─── LyricFormation ──────────────────────────────────────

export class LyricFormation {
  /**
   * @param {object} engine
   * @param {THREE.Vector3} center     — world position to spawn at (on water surface)
   * @param {string} text              — lyric phrase
   * @param {number} color             — hex color (theme particle color)
   * @param {object} [opts]              — optional overrides
   * @param {number} [opts.textScale]    — multiplier for TEXT_WIDTH / FORM_Y_RANGE (default 1)
   * @param {number} [opts.poolRadius]   — initial scatter radius for particles (default SCHOOL_RADIUS)
   * @param {number} [opts.particleCount]— number of particles (default FISH_COUNT)
   * @param {number} [opts.sizeBase]     — base particle size (default 0.22)
   * @param {number} [opts.sizeRange]    — random size range added to base (default 0.16)
   * @param {number} [opts.glowMin]      — min glow boost at low intensity (default 4.0)
   * @param {number} [opts.glowMax]      — max glow boost at high intensity (default 9.0)
   */
  constructor(engine, center, text, color, opts = {}) {
    this.engine  = engine;
    this.camera  = engine.camera;
    this._center = center.clone();
    this._center.y = 0; // Y driven by waveHeight per-frame

    this._textScale  = opts.textScale  ?? 1.0;
    this._poolRadius = opts.poolRadius ?? SCHOOL_RADIUS;

    const particleCount   = opts.particleCount   ?? FISH_COUNT;
    const sizeBase        = opts.sizeBase        ?? 0.22;
    const sizeRange       = opts.sizeRange       ?? 0.16;
    const glowMin         = opts.glowMin         ?? 4.0;
    const glowMax         = opts.glowMax         ?? 9.0;
    this._letterSpacing   = opts.letterSpacing   ?? "";
    this._outlineOnly     = opts.outlineOnly     ?? true;
    this._particleCount   = particleCount;

    this.posArray   = new Float32Array(particleCount * 3);
    this.velocities = new Float32Array(particleCount * 3);
    this.targets    = new Float32Array(particleCount * 3); // local [lx, 0, lz]
    this.hasTarget  = new Uint8Array(particleCount);
    this.phases      = new Float32Array(particleCount);
    this.sizes       = new Float32Array(particleCount);
    this.alphas      = new Float32Array(particleCount);
    this.scattered   = new Float32Array(particleCount); // scatter countdown per particle
    this._baseSizes  = new Float32Array(particleCount); // original sizes for restore
    this._baseAlphas = new Float32Array(particleCount); // original alphas for restore

    const cx = this._center.x, cz = this._center.z;

    // skipGather: place particles directly at their text positions so no gathering
    // animation is visible — particles fade in already formed.
    let skipGatherPts = null;
    if (opts.skipGather) {
      const tw  = TEXT_WIDTH   * this._textScale;
      const fyr = FORM_Y_RANGE * this._textScale;
      const pts2D = sampleTextPoints(text, this._letterSpacing, particleCount, this._outlineOnly);
      skipGatherPts = pts2D.map(p => ({ lx: p.lx * tw, lz: -p.ly * fyr }));
    }

    for (let i = 0; i < particleCount; i++) {
      if (skipGatherPts) {
        const pt = skipGatherPts[i % skipGatherPts.length];
        this.posArray[i * 3]     = cx + pt.lx;
        this.posArray[i * 3 + 1] = SURFACE_OFFSET;
        this.posArray[i * 3 + 2] = cz + pt.lz;
        this.targets[i * 3]     = pt.lx;
        this.targets[i * 3 + 1] = 0;
        this.targets[i * 3 + 2] = pt.lz;
        this.hasTarget[i] = 1;
        this.velocities[i * 3]     = 0;
        this.velocities[i * 3 + 1] = 0;
        this.velocities[i * 3 + 2] = 0;
      } else {
        const angle = Math.random() * Math.PI * 2;
        const r     = Math.random() * this._poolRadius;
        this.posArray[i * 3]     = cx + Math.cos(angle) * r;
        this.posArray[i * 3 + 1] = SURFACE_OFFSET; // will be corrected each frame
        this.posArray[i * 3 + 2] = cz + Math.sin(angle) * r;
        this.velocities[i * 3]     = (Math.random() - 0.5) * 1.5;
        this.velocities[i * 3 + 1] = 0;
        this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
      }

      this.phases[i] = Math.random() * Math.PI * 2;
      this.sizes[i]  = sizeBase + Math.random() * sizeRange;
      this.alphas[i] = 1.0;
      this._baseSizes[i]  = this.sizes[i];
      this._baseAlphas[i] = this.alphas[i];
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
      uGlowMin:     { value: glowMin },
      uGlowMax:     { value: glowMax },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader:   glowVert,
      fragmentShader: glowFrag,
      uniforms:       this._uniforms,
      transparent:    true,
      depthWrite:     false,
      depthTest:      false, // additive particles must never be occluded by clouds or geometry
      blending:       THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder   = 1; // render above water
    engine.scene.add(this.mesh);

    // Defer heavy text-sampling + particle assignment to the first update() call
    // so the frame that spawns this formation doesn't stutter.
    // skipGather already handled above — no deferred work needed in that case.
    this._pendingPhrase = skipGatherPts ? null : text;

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

    this._pendingAssign = false;
    this._disposed = false;
  }

  static prewarmPhrase(text, opts = {}) {
    sampleTextPoints(
      text,
      opts.letterSpacing ?? "",
      opts.particleCount ?? MAX_SAMPLE_POINTS,
      opts.outlineOnly   ?? true,
    );
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

  /**
   * Instantly scatter all particles radially outward — used for the intro
   * dive landing moment when the fish "burst" away to reveal the boat.
   * Also triggers a fade-out so the formation disappears naturally.
   */
  triggerScatter() {
    const BLAST_SPEED = 14;
    for (let i = 0; i < this._particleCount; i++) {
      const i3 = i * 3;
      const dx = this.posArray[i3]     - this._center.x;
      const dz = this.posArray[i3 + 2] - this._center.z;
      const d  = Math.sqrt(dx * dx + dz * dz) || 0.1;
      const speed = BLAST_SPEED * (0.6 + Math.random() * 0.8);
      this.velocities[i3]     = (dx / d) * speed;
      this.velocities[i3 + 2] = (dz / d) * speed;
      // Extend scatter timer so particles visibly fly outward
      this.scattered[i]   = SCATTER_DURATION * 2.5;
      this.sizes[i]       = this._baseSizes[i]  * SCATTER_SIZE_BOOST;
      this.alphas[i]      = Math.min(1.0, this._baseAlphas[i] * SCATTER_ALPHA_BOOST);
    }
    // Fade the whole formation out while particles scatter
    this.startFade();
  }

  triggerColorShift(hexColor, duration = 3.0) {
    this._colorShiftColor = new THREE.Color(hexColor);
    this._colorShiftTimer    = duration;
    this._colorShiftDuration = duration;
    this._uniforms.uTargetColor.value.set(hexColor);
  }

  // ── Internal ─────────────────────────────────────────────

  _setPhrase(text) {
    const tw  = TEXT_WIDTH   * this._textScale;
    const fyr = FORM_Y_RANGE * this._textScale;
    const points2D = sampleTextPoints(text, this._letterSpacing, this._particleCount, this._outlineOnly);
    this._textPointsLocal = points2D.map(p => ({
      lx: p.lx * tw,
      lz: -p.ly * fyr,
    }));
    // _assignTargets() is called the following frame via _pendingAssign
    // to spread the two heavy operations across separate frames.
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

    const fishByX = Array.from({ length: this._particleCount }, (_, i) => ({
      idx: i, x: this.posArray[i * 3],
    }));
    fishByX.sort((a, b) => a.x - b.x);

    for (let i = 0; i < this._particleCount; i++) this.hasTarget[i] = 0;
    const used = new Uint8Array(this._particleCount); // O(1) lookup vs Set

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
        if (used[fIdx]) continue;
        const dx = this.posArray[fIdx * 3] - wt.wx;
        const dz = this.posArray[fIdx * 3 + 2] - wt.wz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDist) { bestDist = d2; bestIdx = fIdx; }
      }
      if (bestIdx < 0) {
        for (const f of fishByX) { if (!used[f.idx]) { bestIdx = f.idx; break; } }
      }

      if (bestIdx >= 0) {
        used[bestIdx] = 1;
        this.hasTarget[bestIdx] = 1;
        this.targets[bestIdx * 3]     = pt.lx;
        this.targets[bestIdx * 3 + 1] = 0;
        this.targets[bestIdx * 3 + 2] = pt.lz;
      }
    }
  }

  // ── Update ───────────────────────────────────────────────

  update(dt, elapsed, boatPos, boatVel) {
    if (this._disposed) return;
    // Clamp dt so a frame hitch (canvas getImageData stall on first phrase render)
    // doesn't teleport particles or spike their alpha on that single large-dt frame.
    dt = Math.min(dt, 0.05);

    // Two-phase deferred processing — spreads the two expensive ops across frames:
    // Frame N+1: sampleTextPoints (getImageData readback) → stores _textPointsLocal
    // Frame N+2: _assignTargets (O(n×W) greedy sort/match) → particles get targets
    if (this._pendingPhrase) {
      this._setPhrase(this._pendingPhrase);
      this._pendingPhrase = null;
      this._pendingAssign = true;
    } else if (this._pendingAssign) {
      this._assignTargets();
      this._pendingAssign = false;
    }

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

    const sc         = this._center;
    const pos        = this.posArray;
    const vel        = this.velocities;
    const tgt        = this.targets;
    const hasT       = this.hasTarget;
    const scattered  = this.scattered;
    const baseSizes  = this._baseSizes;
    const baseAlphas = this._baseAlphas;

    // Pre-compute wave height grid (16×16) covering the formation area.
    // Reduces waveHeight() from 2800 calls/frame → 256 calls/frame (91% reduction).
    const gox = sc.x - GRID_SPAN / 2;
    const goz = sc.z - GRID_SPAN / 2;
    for (let gy = 0; gy < GRID_N; gy++) {
      for (let gx = 0; gx < GRID_N; gx++) {
        _waveGrid[gy * GRID_N + gx] = waveHeight(gox + gx * GRID_STEP, goz + gy * GRID_STEP, elapsed);
      }
    }

    // Pre-compute boat heading once per frame
    let boatDirX = 0, boatDirZ = 0;
    if (boatVel) {
      const spd = Math.sqrt(boatVel.x * boatVel.x + boatVel.z * boatVel.z);
      if (spd > 0.05) { boatDirX = boatVel.x / spd; boatDirZ = boatVel.z / spd; }
    }

    for (let i = 0; i < this._particleCount; i++) {
      const i3 = i * 3;
      let px = pos[i3], pz = pos[i3 + 2];
      let vx = vel[i3], vz = vel[i3 + 2];

      const isScattered = scattered[i] > 0;

      if (!isScattered) {
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

          const poolR = this._poolRadius;
          const tcx = sc.x - px, tcz = sc.z - pz;
          const dCenter = Math.sqrt(tcx * tcx + tcz * tcz);
          if (dCenter > poolR * 0.7) {
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
          if (d2 > poolR) {
            px = sc.x + dx2 * (poolR / d2);
            pz = sc.z + dz2 * (poolR / d2);
            vx *= -0.5; vz *= -0.5;
          }
        }
      } else {
        // Scattered: fly free, damp velocity, count down timer
        vx *= SCATTER_VEL_DAMP;
        vz *= SCATTER_VEL_DAMP;
        px += vx * dt;
        pz += vz * dt;
        scattered[i] -= dt;
        if (scattered[i] <= 0) {
          scattered[i] = 0;
          this.sizes[i]  = baseSizes[i];
          this.alphas[i] = baseAlphas[i];
        }
      }

      // Sand-kick: directional blast from boat
      if (boatPos) {
        const bx = px - boatPos.x, bz = pz - boatPos.z;
        const bd = Math.sqrt(bx * bx + bz * bz);
        if (bd < AVOID_RADIUS && bd > 0.01) {
          const t    = 1 - bd / AVOID_RADIUS;
          const push = t * t * AVOID_FORCE * dt;

          // Radial unit vector (away from boat center)
          const rx = bx / bd, rz = bz / bd;

          // Blend radial with boat heading: particles in path blast forward,
          // particles to the sides sweep outward, particles behind get no suck
          const dot   = rx * boatDirX + rz * boatDirZ;
          const blend = Math.max(0, dot) * DIRECTIONAL_BLEND;
          const kickX = rx * (1 - blend) + boatDirX * blend;
          const kickZ = rz * (1 - blend) + boatDirZ * blend;
          const kickLen = Math.sqrt(kickX * kickX + kickZ * kickZ) || 1;
          const knx = kickX / kickLen, knz = kickZ / kickLen;

          px += knx * push;
          pz += knz * push;
          vx += knx * push * 8;
          vz += knz * push * 8;

          // Trigger / refresh scatter + visual pop
          if (scattered[i] < SCATTER_DURATION) {
            scattered[i]   = SCATTER_DURATION;
            this.sizes[i]  = baseSizes[i]  * SCATTER_SIZE_BOOST;
            this.alphas[i] = Math.min(1.0, baseAlphas[i] * SCATTER_ALPHA_BOOST);
          }
        }
      }

      // Y: bilinear sample from pre-computed wave grid (no per-particle trig)
      const gu  = Math.max(0, Math.min(GRID_N - 1.001, (px - gox) / GRID_STEP));
      const gv  = Math.max(0, Math.min(GRID_N - 1.001, (pz - goz) / GRID_STEP));
      const gix = gu | 0, giy = gv | 0;
      const gfx = gu - gix, gfy = gv - giy;
      const wa  = _waveGrid[ giy      * GRID_N + gix    ];
      const wb  = _waveGrid[ giy      * GRID_N + gix + 1];
      const wc  = _waveGrid[(giy + 1) * GRID_N + gix    ];
      const wd  = _waveGrid[(giy + 1) * GRID_N + gix + 1];
      const py  = wa + (wb - wa) * gfx + (wc - wa) * gfy + (wd - wa + wb - wc) * gfx * gfy + SURFACE_OFFSET;

      pos[i3]     = px;
      pos[i3 + 1] = py;
      pos[i3 + 2] = pz;
      vel[i3]     = vx;
      vel[i3 + 2] = vz;
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aSize.needsUpdate    = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate   = true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.engine.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
