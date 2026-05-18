/**
 * wasd-hint.js — Interactive particle WASD hint for song selection.
 *
 * Particles gather into WASD keyboard-icon shapes + "to sail" text at a fixed
 * world position on the water surface.  When the boat passes through they
 * scatter and reform — same sand-kick mechanic as the fish lyrics.
 *
 * Shown once the boat finishes its entrance; fades out on song selection.
 */

import * as THREE from "three";
import { waveHeight } from "./boat.js";

// ── World position ────────────────────────────────────────────────────────────
// Right of and behind the boat's starting position (0,0,0): lower-right on screen.
const HINT_X = 3.2;
const HINT_Z = 2.6;

// ── Particle config ───────────────────────────────────────────────────────────
const PARTICLE_COUNT  = 2500;
const POOL_RADIUS     = 2.5;     // initial scatter radius
const SURFACE_OFFSET  = 0.15;   // above wave surface
const FORM_SPEED      = 9.0;
const AVOID_RADIUS    = 0.5   // boat kick radius
const AVOID_FORCE     = 15;
const SCATTER_DURATION    = 1.5;
const SCATTER_SIZE_BOOST  = 1.4;
const SCATTER_ALPHA_BOOST = 1.5;
const SCATTER_VEL_DAMP    = 0.91;
const DIRECTIONAL_BLEND   = 0.60;

// Wave-height grid (private to this module)
const GRID_N    = 16;
const GRID_SPAN = 24;
const GRID_STEP = GRID_SPAN / (GRID_N - 1);
const _waveGrid = new Float32Array(GRID_N * GRID_N);

// ── Shader ────────────────────────────────────────────────────────────────────
// Same style as fish-school; glowMin/Max kept low so hint doesn't bloom.

const _vert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uAlphaMul;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mvPos  = modelViewMatrix * vec4(position, 1.0);
    float pulse = 1.0 + 0.08 * sin(uTime * 2.0 + position.x * 3.0 + position.z * 2.0);
    float boost = mix(1.0, 1.20, uIntensity);
    gl_PointSize = aSize * pulse * boost * (280.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const _frag = /* glsl */ `
  uniform vec3  uColor;
  uniform float uIntensity;
  uniform float uAlphaMul;
  uniform float uGlowMin;
  uniform float uGlowMax;
  varying float vAlpha;
  void main() {
    float d    = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float core      = exp(-d * d * 14.0);
    float halo      = exp(-d * d *  5.0) * 0.45;
    float glowBoost = mix(uGlowMin, uGlowMax, uIntensity);
    float glow      = (core + halo) * glowBoost;
    gl_FragColor    = vec4(uColor * glow, vAlpha * glow * uAlphaMul);
  }
`;

// ── Canvas ────────────────────────────────────────────────────────────────────

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function _buildCanvas() {
  const CW = 640, CH = 200;
  const canvas = document.createElement("canvas");
  canvas.width  = CW;
  canvas.height = CH;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, CW, CH);

  // Arrow grid mirrors the WASD key positions.
  const KW = 72, KH = 66, GAP = 10;
  const aX    = 80;
  const sX    = aX + KW + GAP;
  const dX    = sX + KW + GAP;
  const r1Y = 12;
  const r2Y = r1Y + KH + GAP;

  // Triangle dimensions — equilateral-ish, fits inside the key cell with margin.
  const TW = 50, TH = 44;
  const R = 10;

  function tri(x1, y1, x2, y2, x3, y3) {
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
  }

  function key(x, y) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth   = 6;
    _roundRect(ctx, x, y, KW, KH, R);
    ctx.stroke();
  }

  ctx.fillStyle = "#ffffff";

  // ▲ Up  (where W was)
  const ux = sX + KW / 2, uy = r1Y + KH / 2;
  key(sX, r1Y);
  tri(ux, uy - TH / 2,  ux - TW / 2, uy + TH / 2,  ux + TW / 2, uy + TH / 2);

  // ◄ Left  (where A was)
  const lx = aX + KW / 2, ly = r2Y + KH / 2;
  key(aX, r2Y);
  tri(lx - TH / 2, ly,  lx + TH / 2, ly - TW / 2,  lx + TH / 2, ly + TW / 2);

  // ▼ Down  (where S was)
  const dx = sX + KW / 2, dy = r2Y + KH / 2;
  key(sX, r2Y);
  tri(dx, dy + TH / 2,  dx - TW / 2, dy - TH / 2,  dx + TW / 2, dy - TH / 2);

  // ► Right  (where D was)
  const rx = dX + KW / 2, ry = r2Y + KH / 2;
  key(dX, r2Y);
  tri(rx + TH / 2, ry,  rx - TH / 2, ry - TW / 2,  rx - TH / 2, ry + TW / 2);

  return { canvas, CW, CH };
}

/**
 * Sample bright pixels → flat [nx, ny, brightness] triples, nx/ny ∈ [-0.5, 0.5].
 * Skips every other pixel to thin density while keeping spatial coverage.
 */
function _sampleCanvas(canvas, CW, CH, maxPts = 1200) {
  const ctx  = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, CW, CH).data;
  const raw  = [];

  for (let y = 0; y < CH; y += 1) {
    for (let x = 0; x < CW; x += 1) {
      const i          = (y * CW + x) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (data[i + 3] > 40 && brightness > 35) {
        raw.push(x / CW - 0.5, y / CH - 0.5, brightness / 255);
      }
    }
  }

  const n = raw.length / 3;
  if (n <= maxPts) return raw;

  // Fisher-Yates shuffle so we subsample uniformly across all directions,
  // not in raster-scan order (which causes horizontal banding).
  for (let i = n - 1; i > 0; i--) {
    const j  = Math.floor(Math.random() * (i + 1));
    const i3 = i * 3, j3 = j * 3;
    const tx = raw[i3], ty = raw[i3 + 1], tb = raw[i3 + 2];
    raw[i3]     = raw[j3];     raw[i3 + 1] = raw[j3 + 1]; raw[i3 + 2] = raw[j3 + 2];
    raw[j3]     = tx;          raw[j3 + 1] = ty;           raw[j3 + 2] = tb;
  }

  return raw.slice(0, maxPts * 3);
}

// ── WASDHint ──────────────────────────────────────────────────────────────────

export class WASDHint {
  /**
   * @param {object} engine
   * @param {Boat}   boat    — needed for scatter interaction each frame
   */
  constructor(engine, boat) {
    this.engine = engine;
    this.boat   = boat;

    this._opacity = 0;
    this._target  = 0;
    this._built   = false;

    // Particle state (allocated in _build)
    this._n          = 0;
    this._posArr     = null;
    this._velArr     = null;
    this._targets    = null;
    this._scattered  = null;
    this._sizes      = null;
    this._alphas     = null;
    this._baseSizes  = null;
    this._baseAlphas = null;

    this._uniforms = null;
    this.mesh      = null;

    engine.addUpdatable(this);
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  _build() {
    if (this._built) return;
    this._built = true;

    const { canvas, CW, CH } = _buildCanvas();
    const raw = _sampleCanvas(canvas, CW, CH, PARTICLE_COUNT);
    const n   = raw.length / 3;
    this._n   = n;

    // World-space scale for the hint (canvas X→worldX, canvas Y→worldZ)
    // SCALE_Z inflated ~1.35× for camera-tilt foreshortening compensation.
    const SCALE_X = 4.0;
    const SCALE_Z = SCALE_X * (CH / CW) * 1.35;

    this._posArr     = new Float32Array(n * 3);
    this._velArr     = new Float32Array(n * 3);
    this._targets    = new Float32Array(n * 3);
    this._scattered  = new Float32Array(n);
    this._sizes      = new Float32Array(n);
    this._alphas     = new Float32Array(n);
    this._baseSizes  = new Float32Array(n);
    this._baseAlphas = new Float32Array(n);

    const cx = HINT_X, cz = HINT_Z;

    for (let i = 0; i < n; i++) {
      const nx  = raw[i * 3];
      const ny  = raw[i * 3 + 1];
      const bri = raw[i * 3 + 2];

      // Formation target (world offset from hint centre)
      const lx = nx * SCALE_X;
      const lz = ny * SCALE_Z;
      this._targets[i * 3]     = lx;
      this._targets[i * 3 + 1] = 0;
      this._targets[i * 3 + 2] = lz;

      // Start scattered in a pool around the hint centre
      const angle = Math.random() * Math.PI * 2;
      const r     = (0.3 + Math.random() * 0.7) * POOL_RADIUS;
      this._posArr[i * 3]     = cx + Math.cos(angle) * r;
      this._posArr[i * 3 + 1] = SURFACE_OFFSET;
      this._posArr[i * 3 + 2] = cz + Math.sin(angle) * r;

      this._velArr[i * 3]     = (Math.random() - 0.5) * 1.2;
      this._velArr[i * 3 + 1] = 0;
      this._velArr[i * 3 + 2] = (Math.random() - 0.5) * 1.2;

      const sz = 0.05 + bri * 0.04;
      this._sizes[i]       = sz;
      this._alphas[i]      = 0.55 + bri * 0.45;
      this._baseSizes[i]   = sz;
      this._baseAlphas[i]  = this._alphas[i];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this._posArr,  3));
    geo.setAttribute("aSize",    new THREE.BufferAttribute(this._sizes,   1));
    geo.setAttribute("aAlpha",   new THREE.BufferAttribute(this._alphas,  1));

    this._uniforms = {
      uColor:     { value: new THREE.Color(0xffffff) },
      uIntensity: { value: 0 },
      uAlphaMul:  { value: 0 },
      uTime:      { value: 0 },
      uGlowMin:   { value: 1.0 },
      uGlowMax:   { value: 1.8 },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader:   _vert,
      fragmentShader: _frag,
      uniforms:       this._uniforms,
      transparent:    true,
      depthWrite:     false,
      depthTest:      false,
      blending:       THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder   = 2;
    this.mesh.visible       = false;
    this.engine.scene.add(this.mesh);
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  show() {
    this._build();
    this._target = 1;
    if (this.mesh) this.mesh.visible = true;
  }

  hide() {
    this._target = 0;
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  update(dt, elapsed) {
    if (!this.mesh) return;

    // ── Fade in / out ──────────────────────────────────────────────────────
    const diff = this._target - this._opacity;
    const rate = diff > 0 ? 1.2 : 2.0;
    this._opacity += diff * Math.min(1, dt * rate);
    const op = Math.max(0, Math.min(1, this._opacity));

    if (op < 0.001 && this._target === 0) {
      this.mesh.visible = false;
      return;
    }
    if (!this.mesh.visible) this.mesh.visible = true;

    this._uniforms.uAlphaMul.value  = op;
    this._uniforms.uIntensity.value = Math.min(1, op * 1.4);
    this._uniforms.uTime.value      = elapsed;

    // ── Wave-height grid (bilinear, same as LyricFormation) ───────────────
    const energy = this.engine.env?.smoothedEnergy ?? 0;
    const gox = HINT_X - GRID_SPAN / 2;
    const goz = HINT_Z - GRID_SPAN / 2;
    for (let gy = 0; gy < GRID_N; gy++) {
      for (let gx = 0; gx < GRID_N; gx++) {
        _waveGrid[gy * GRID_N + gx] =
          waveHeight(gox + gx * GRID_STEP, goz + gy * GRID_STEP, elapsed, energy);
      }
    }

    // ── Boat heading ───────────────────────────────────────────────────────
    const boatPos = this.boat?.mesh?.position;
    const boatVel = this.boat?.body?.velocity;
    let boatDirX = 0, boatDirZ = 0;
    if (boatVel) {
      const spd = Math.sqrt(boatVel.x * boatVel.x + boatVel.z * boatVel.z);
      if (spd > 0.05) { boatDirX = boatVel.x / spd; boatDirZ = boatVel.z / spd; }
    }

    // ── Particle integration ───────────────────────────────────────────────
    const pos        = this._posArr;
    const vel        = this._velArr;
    const tgt        = this._targets;
    const scattered  = this._scattered;
    const baseSizes  = this._baseSizes;
    const baseAlphas = this._baseAlphas;
    const n          = this._n;

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      let px = pos[i3], pz = pos[i3 + 2];
      let vx = vel[i3], vz = vel[i3 + 2];

      if (scattered[i] > 0) {
        // ── Scattered: free-fly with damping ──
        vx *= SCATTER_VEL_DAMP;
        vz *= SCATTER_VEL_DAMP;
        px += vx * dt;
        pz += vz * dt;
        scattered[i] -= dt;
        if (scattered[i] <= 0) {
          scattered[i]        = 0;
          this._sizes[i]      = baseSizes[i];
          this._alphas[i]     = baseAlphas[i];
        }
      } else {
        // ── Gathering toward formation target ──
        const wtx = HINT_X + tgt[i3];
        const wtz = HINT_Z + tgt[i3 + 2];
        const dx  = wtx - px, dz = wtz - pz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0.04) {
          const f = Math.min(FORM_SPEED * dt / dist, 1);
          px += dx * f;
          pz += dz * f;
        }
        vx *= 0.88;
        vz *= 0.88;
      }

      // ── Boat sand-kick ────────────────────────────────────────────────
      if (boatPos) {
        const bx = px - boatPos.x, bz = pz - boatPos.z;
        const bd = Math.sqrt(bx * bx + bz * bz);
        if (bd < AVOID_RADIUS && bd > 0.01) {
          const t    = 1 - bd / AVOID_RADIUS;
          const push = t * t * AVOID_FORCE * dt;

          const rx = bx / bd, rz = bz / bd;
          const dot   = rx * boatDirX + rz * boatDirZ;
          const blend = Math.max(0, dot) * DIRECTIONAL_BLEND;
          const kickX = rx * (1 - blend) + boatDirX * blend;
          const kickZ = rz * (1 - blend) + boatDirZ * blend;
          const klen  = Math.sqrt(kickX * kickX + kickZ * kickZ) || 1;
          const knx = kickX / klen, knz = kickZ / klen;

          px += knx * push;
          pz += knz * push;
          vx += knx * push * 8;
          vz += knz * push * 8;

          if (scattered[i] < SCATTER_DURATION) {
            scattered[i]        = SCATTER_DURATION;
            this._sizes[i]      = baseSizes[i]  * SCATTER_SIZE_BOOST;
            this._alphas[i]     = Math.min(1, baseAlphas[i] * SCATTER_ALPHA_BOOST);
          }
        }
      }

      // ── Wave-height Y (bilinear from grid) ────────────────────────────
      const gu  = Math.max(0, Math.min(GRID_N - 1.001, (px - gox) / GRID_STEP));
      const gv  = Math.max(0, Math.min(GRID_N - 1.001, (pz - goz) / GRID_STEP));
      const gix = gu | 0, giy = gv | 0;
      const gfx = gu - gix, gfy = gv - giy;
      const wa  = _waveGrid[ giy      * GRID_N + gix    ];
      const wb  = _waveGrid[ giy      * GRID_N + gix + 1];
      const wc  = _waveGrid[(giy + 1) * GRID_N + gix    ];
      const wd  = _waveGrid[(giy + 1) * GRID_N + gix + 1];
      const py  = wa + (wb - wa) * gfx + (wc - wa) * gfy + (wa - wb - wc + wd) * gfx * gfy
                + SURFACE_OFFSET;

      pos[i3]     = px;
      pos[i3 + 1] = py;
      pos[i3 + 2] = pz;
      vel[i3]     = vx;
      vel[i3 + 2] = vz;
    }

    const attrs = this.mesh.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.aSize.needsUpdate    = true;
    attrs.aAlpha.needsUpdate   = true;
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  dispose() {
    this.engine.removeUpdatable(this);
    if (this.mesh) {
      this.engine.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
  }
}
