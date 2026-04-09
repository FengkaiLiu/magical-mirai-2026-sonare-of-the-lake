/**
 * ==========================================
 * FishSchool v8 — 発光浮遊生物 (bioluminescent)
 * ==========================================
 * v8: FISH_COUNT == TEXT_SAMPLE_POINTS (all fish form text, no idle fish)
 *   - 3500 fish / 3500 sample points
 *   - No frame mode, no idle push — every fish is assigned to a glyph point
 *   - Canvas 2048, minFontSize 12 for long lyrics
 *   - FORM_SPEED 15 for fast formation
 */

import * as THREE from "three";

// ─── Config ──────────────────────────────────────────────

const FISH_COUNT = 3500;
const SCHOOL_CENTER = new THREE.Vector3(0, -3, 0);
const SCHOOL_RADIUS = 18;
const SCHOOL_Y_MIN = -7;
const SCHOOL_Y_MAX = -0.3;
const TEXT_WIDTH = 28;
const TEXT_HEIGHT = 5;
const TEXT_SAMPLE_POINTS = 3500;
const FORM_SPEED = 15.0;
const AVOID_RADIUS = 2.5;
const AVOID_FORCE = 8;
const WOBBLE_AMOUNT = 0.15;

// ─── Glow particle shader ────────────────────────────────

const glowVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uTime;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float pulse = 1.0 + 0.15 * sin(uTime * 2.0 + position.x * 3.0 + position.z * 2.0);
    gl_PointSize = aSize * pulse * (400.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const glowFrag = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    float core = exp(-d * d * 30.0);
    float halo = exp(-d * d * 8.0) * 0.5;
    float glow = core + halo;
    vec3 col = uColor * glow + vec3(1.0) * core * 0.3;

    gl_FragColor = vec4(col, vAlpha * glow);
  }
`;

// ─── Text sampling ───────────────────────────────────────

function sampleTextPoints(text, maxPoints = TEXT_SAMPLE_POINTS) {
  const canvas = document.createElement("canvas");
  const canvasW = 2048;
  const canvasH = 256;
  canvas.width = canvasW;
  canvas.height = canvasH;
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

  const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
  const pixels = imageData.data;
  const whitePixels = [];

  for (let y = 0; y < canvasH; y += 1) {
    for (let x = 0; x < canvasW; x += 1) {
      const idx = (y * canvasW + x) * 4;
      if (pixels[idx] > 128) whitePixels.push({ x, y });
    }
  }

  const points = [];
  if (whitePixels.length <= maxPoints) {
    for (const p of whitePixels) points.push(p);
  } else {
    const step = whitePixels.length / maxPoints;
    for (let i = 0; i < maxPoints; i++) {
      points.push(whitePixels[Math.floor(i * step)]);
    }
  }

  return points.map(p => ({
    x: (p.x / canvasW - 0.5),
    y: (0.5 - p.y / canvasH),
  }));
}

// ─── FishSchool ──────────────────────────────────────────

export class FishSchool {
  constructor(engine, boat) {
    this.engine = engine;
    this.boat = boat;
    this.active = true;
    this.camera = engine.camera;

    this.posArray = new Float32Array(FISH_COUNT * 3);
    this.velocities = new Float32Array(FISH_COUNT * 3);
    this.targets = new Float32Array(FISH_COUNT * 3);
    this.hasTarget = new Uint8Array(FISH_COUNT);
    this.phases = new Float32Array(FISH_COUNT);
    this.sizes = new Float32Array(FISH_COUNT);
    this.alphas = new Float32Array(FISH_COUNT);

    for (let i = 0; i < FISH_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = Math.random() * SCHOOL_RADIUS;

      this.posArray[i * 3]     = SCHOOL_CENTER.x + Math.sin(phi) * Math.cos(theta) * r;
      this.posArray[i * 3 + 1] = Math.max(SCHOOL_Y_MIN, Math.min(SCHOOL_Y_MAX,
        SCHOOL_CENTER.y + Math.sin(phi) * Math.sin(theta) * r * 0.4));
      this.posArray[i * 3 + 2] = SCHOOL_CENTER.z + Math.cos(phi) * r;

      this.velocities[i * 3]     = (Math.random() - 0.5) * 1.5;
      this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.3;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.5;

      this.hasTarget[i] = 0;
      this.phases[i] = Math.random() * Math.PI * 2;
      this.sizes[i] = 0.12 + Math.random() * 0.2;
      this.alphas[i] = 0.55 + Math.random() * 0.4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.posArray, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: glowVert,
      fragmentShader: glowFrag,
      uniforms: {
        uColor: { value: new THREE.Color(0x55ddff) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    engine.scene.add(this.mesh);

    this._boatPos = new THREE.Vector3();
    this._textPointsLocal = [];
    this._currentText = "";
    this._billboardAngle = 0;

    engine.addUpdatable(this);
  }

  // ─── Public API ────────────────────────────────────────

  setActive(active) {
    this.active = active;
    if (!active) this.clearPhrase();
  }

  setPhrase(text) {
    if (!text || text === this._currentText) return;
    this._currentText = text;

    const points2D = sampleTextPoints(text);
    this._textPointsLocal = points2D.map(p => new THREE.Vector3(
      p.x * TEXT_WIDTH,
      SCHOOL_CENTER.y + p.y * TEXT_HEIGHT,
      0
    ));
    this._assignTargets();
  }

  clearPhrase() {
    this._currentText = "";
    this._textPointsLocal = [];
    for (let i = 0; i < FISH_COUNT; i++) this.hasTarget[i] = 0;
  }

  _assignTargets() {
    const points = this._textPointsLocal;
    if (points.length === 0) { this.clearPhrase(); return; }

    for (let i = 0; i < FISH_COUNT; i++) this.hasTarget[i] = 0;

    const camPos = this.camera.position;
    const angle = Math.atan2(
      camPos.x - SCHOOL_CENTER.x,
      camPos.z - SCHOOL_CENTER.z
    );
    const sinB = Math.sin(angle);
    const cosB = Math.cos(angle);

    const worldTargets = [];
    for (let j = 0; j < points.length; j++) {
      const lx = points[j].x, lz = points[j].z || 0;
      worldTargets.push({
        idx: j,
        wx: SCHOOL_CENTER.x + lx * cosB + lz * sinB,
        wy: points[j].y,
        wz: SCHOOL_CENTER.z - lx * sinB + lz * cosB,
      });
    }
    worldTargets.sort((a, b) => a.wx - b.wx);

    const fishByX = [];
    for (let i = 0; i < FISH_COUNT; i++) {
      fishByX.push({ idx: i, x: this.posArray[i * 3] });
    }
    fishByX.sort((a, b) => a.x - b.x);

    const usedFish = new Set();

    for (let pi = 0; pi < worldTargets.length; pi++) {
      const wt = worldTargets[pi];
      const pt = points[wt.idx];

      let lo = 0, hi = fishByX.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fishByX[mid].x < wt.wx) lo = mid + 1;
        else hi = mid;
      }

      let bestIdx = -1, bestDist = Infinity;
      const SEARCH_WINDOW = 200;
      const start = Math.max(0, lo - SEARCH_WINDOW);
      const end = Math.min(fishByX.length, lo + SEARCH_WINDOW);

      for (let fi = start; fi < end; fi++) {
        const fIdx = fishByX[fi].idx;
        if (usedFish.has(fIdx)) continue;
        const dx = this.posArray[fIdx * 3]     - wt.wx;
        const dy = this.posArray[fIdx * 3 + 1] - wt.wy;
        const dz = this.posArray[fIdx * 3 + 2] - wt.wz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestDist) {
          bestDist = d2;
          bestIdx = fIdx;
        }
      }

      if (bestIdx < 0) {
        for (let fi = 0; fi < fishByX.length; fi++) {
          const fIdx = fishByX[fi].idx;
          if (!usedFish.has(fIdx)) {
            bestIdx = fIdx;
            break;
          }
        }
      }

      if (bestIdx >= 0) {
        usedFish.add(bestIdx);
        this.hasTarget[bestIdx] = 1;
        this.targets[bestIdx * 3]     = pt.x;
        this.targets[bestIdx * 3 + 1] = pt.y;
        this.targets[bestIdx * 3 + 2] = pt.z || 0;
      }
    }
  }

  // ─── Update (always runs) ──────────────────────────────

  update(dt, elapsed) {
    this.mesh.material.uniforms.uTime.value = elapsed;

    const camPos = this.camera.position;
    this._billboardAngle = Math.atan2(
      camPos.x - SCHOOL_CENTER.x,
      camPos.z - SCHOOL_CENTER.z
    );
    const sinB = Math.sin(this._billboardAngle);
    const cosB = Math.cos(this._billboardAngle);

    this._boatPos.copy(this.boat.getPosition());

    const pos = this.posArray;
    const vel = this.velocities;
    const tgt = this.targets;
    const hasT = this.hasTarget;
    const phase = this.phases;

    for (let i = 0; i < FISH_COUNT; i++) {
      const i3 = i * 3;
      let px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      let vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];

      if (hasT[i]) {
        // ─── Text formation ───
        const localX = tgt[i3], localZ = tgt[i3 + 2];
        const wtx = SCHOOL_CENTER.x + localX * cosB + localZ * sinB;
        const wty = tgt[i3 + 1];
        const wtz = SCHOOL_CENTER.z - localX * sinB + localZ * cosB;

        const dx = wtx - px, dy = wty - py, dz = wtz - pz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist > 0.05) {
          const factor = Math.min(FORM_SPEED * dt / dist, 1);
          px += dx * factor; py += dy * factor; pz += dz * factor;
        }

        const wt = elapsed * 3 + phase[i];
        px += Math.sin(wt) * WOBBLE_AMOUNT * dt;
        py += Math.cos(wt * 1.3) * WOBBLE_AMOUNT * 0.6 * dt;
        pz += Math.sin(wt * 0.7) * WOBBLE_AMOUNT * dt;

        vx *= 0.9; vy *= 0.9; vz *= 0.9;
      } else {
        // ─── Free swim (only when no text is active) ───
        vx += (Math.random() - 0.5) * 2.0 * dt;
        vy += (Math.random() - 0.5) * 0.5 * dt;
        vz += (Math.random() - 0.5) * 2.0 * dt;

        const tcx = SCHOOL_CENTER.x - px;
        const tcy = SCHOOL_CENTER.y - py;
        const tcz = SCHOOL_CENTER.z - pz;
        const dCenter = Math.sqrt(tcx * tcx + tcy * tcy + tcz * tcz);

        if (dCenter > SCHOOL_RADIUS * 0.7) {
          const pull = 0.5 * dt;
          vx += (tcx / dCenter) * pull;
          vy += (tcy / dCenter) * pull;
          vz += (tcz / dCenter) * pull;
        }

        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed > 2.0) { const r = 2.0 / speed; vx *= r; vy *= r; vz *= r; }

        px += vx * dt; py += vy * dt; pz += vz * dt;

        // Clamp to sphere
        const dx2 = px - SCHOOL_CENTER.x, dy2 = py - SCHOOL_CENTER.y, dz2 = pz - SCHOOL_CENTER.z;
        const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);
        if (d2 > SCHOOL_RADIUS) {
          const s = SCHOOL_RADIUS / d2;
          px = SCHOOL_CENTER.x + dx2 * s;
          py = SCHOOL_CENTER.y + dy2 * s;
          pz = SCHOOL_CENTER.z + dz2 * s;
          vx *= -0.5; vy *= -0.5; vz *= -0.5;
        }
      }

      py = Math.max(SCHOOL_Y_MIN, Math.min(SCHOOL_Y_MAX, py));

      // Boat avoidance
      const bx = px - this._boatPos.x, by = py - this._boatPos.y, bz = pz - this._boatPos.z;
      const bd = Math.sqrt(bx * bx + by * by + bz * bz);
      if (bd < AVOID_RADIUS && bd > 0.01) {
        const push = (1 - bd / AVOID_RADIUS) * AVOID_FORCE * dt;
        px += (bx / bd) * push; py += (by / bd) * push; pz += (bz / bd) * push;
      }

      pos[i3] = px; pos[i3 + 1] = py; pos[i3 + 2] = pz;
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

export const SCHOOL_CENTER_EXPORT = SCHOOL_CENTER;