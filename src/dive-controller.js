/**
 * ==========================================
 * DiveController v6
 * ==========================================
 * Changes from v5:
 *   - Fog color unified with ClearColor (no seam at distance)
 *   - Ceiling: animated caustic ripple shader (replaces flat color)
 *   - God rays: 6 semi-transparent light shafts, sway gently
 *   - All controlled by same transition value
 */

import * as THREE from "three";

const TRANSITION_SPEED = 0.8;

// Colors — fog and clear are now the SAME
const SURFACE_CLEAR = new THREE.Color(0xb8daf0);
const UNDERWATER_CLEAR = new THREE.Color(0x0a1a2e);

// ─── Ceiling caustic shader ─────────────────────────────

const ceilVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ceilFrag = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv * 18.0;

    // Overlapping sine waves → fake caustic pattern
    float c1 = sin(uv.x * 1.2 + uTime * 0.4) * sin(uv.y * 0.9 + uTime * 0.3);
    float c2 = sin(uv.x * 0.7 - uTime * 0.25) * sin(uv.y * 1.3 + uTime * 0.2);
    float c3 = sin((uv.x + uv.y) * 0.5 + uTime * 0.35)
             * sin((uv.x - uv.y) * 0.8 - uTime * 0.15);

    float caustic = (c1 + c2 + c3) * 0.33 + 0.5;
    caustic = caustic * caustic;  // sharpen bright spots

    vec3 dark  = vec3(0.06, 0.15, 0.28);
    vec3 bright = vec3(0.20, 0.50, 0.65);
    vec3 color = mix(dark, bright, caustic);

    float alpha = uOpacity * (0.25 + caustic * 0.20);
    gl_FragColor = vec4(color, alpha);
  }
`;

// ─── God ray shader ─────────────────────────────────────

const rayVert = /* glsl */ `
  varying vec2 vUv;
  varying float vFogFade;
  uniform float uFogDensity;

  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float dist = length(mvPos.xyz);
    vFogFade = exp(-(uFogDensity * dist) * (uFogDensity * dist));
    gl_Position = projectionMatrix * mvPos;
  }
`;

const rayFrag = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFogFade;

  void main() {
    float vert = smoothstep(0.0, 0.15, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
    float horiz = 1.0 - pow(abs(vUv.x - 0.5) * 2.0, 3.0);

    float alpha = vert * horiz * uOpacity * 0.22 * vFogFade;
    vec3 color = vec3(0.35, 0.60, 0.80);

    gl_FragColor = vec4(color, alpha);
  }
`;

// ─── DiveController ─────────────────────────────────────

export class DiveController {
  constructor(engine, boat, camera, environment, fishSchool, lyrics) {
    this.engine = engine;
    this.boat = boat;
    this.camera = camera;
    this.environment = environment;
    this.fishSchool = fishSchool;
    this.lyrics = lyrics;

    this.isDiving = false;
    this.transition = 0;
    this.forceDive = false;

    // Underwater ambient light
    this._underwaterAmbient = new THREE.AmbientLight(0x1a3a6a, 0);
    engine.scene.add(this._underwaterAmbient);

    // Find surface lights
    this._surfaceAmbient = null;
    this._surfaceSun = environment.sunLight || null;
    engine.scene.traverse(child => {
      if (child.isAmbientLight && child !== this._underwaterAmbient && !this._surfaceAmbient) {
        this._surfaceAmbient = child;
      }
    });

    this._surfaceClearColor = SURFACE_CLEAR.clone();

    // === Ceiling with caustic shader ===
    const ceilGeo = new THREE.PlaneGeometry(300, 300);
    ceilGeo.rotateX(Math.PI / 2);
    this._ceilUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
    };
    const ceilMat = new THREE.ShaderMaterial({
      vertexShader: ceilVert,
      fragmentShader: ceilFrag,
      uniforms: this._ceilUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this._ceilingMesh = new THREE.Mesh(ceilGeo, ceilMat);
    this._ceilingMesh.position.y = 0.1;
    this._ceilingMesh.renderOrder = -1;
    this._ceilingMesh.visible = false;
    engine.scene.add(this._ceilingMesh);

    // === God rays ===
    this._rayUniforms = { uOpacity: { value: 0 }, uFogDensity: { value: 0 } };
    this._rays = this._createGodRays(engine.scene);

    // === Fog — same color as clearColor ===
    this._fog = new THREE.FogExp2(UNDERWATER_CLEAR, 0);

    this._lerpColor = new THREE.Color();

    engine.addUpdatable(this);
  }

  // ─── God rays setup ────────────────────────────────────

  _createGodRays(scene) {
    const rayMat = new THREE.ShaderMaterial({
      vertexShader: rayVert,
      fragmentShader: rayFrag,
      uniforms: this._rayUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    const rays = [];
    const RAY_COUNT = 12;

    for (let i = 0; i < RAY_COUNT; i++) {
      const width = 1.2 + Math.random() * 3.0;
      const height = 5 + Math.random() * 5;
      const geo = new THREE.PlaneGeometry(width, height);

      const mesh = new THREE.Mesh(geo, rayMat);

      // Scatter across the map (fixed positions, like real light gaps)
      const angle = (i / RAY_COUNT) * Math.PI * 2 + Math.random() * 0.5;
      const radius = 6 + Math.random() * 25;
      mesh.position.set(
        Math.cos(angle) * radius,
        -2,
        Math.sin(angle) * radius
      );
      mesh.rotation.y = Math.random() * Math.PI; // random facing
      mesh.rotation.z = (Math.random() - 0.5) * 0.2; // slight lean

      mesh.visible = false;
      scene.add(mesh);

      rays.push({
        mesh,
        baseAngle: angle,
        swaySpeed: 0.05 + Math.random() * 0.05,
        swayAmount: 0.02 + Math.random() * 0.03,
      });
    }

    return rays;
  }

  // ─── Public API ────────────────────────────────────────

  toggle() {
    if (this.forceDive) return;
    this.isDiving = !this.isDiving;
    if (!this.isDiving) {
      this.fishSchool.clearPhrase();
    }
  }

  forceDiveStart() { this.forceDive = true; this.isDiving = true; }
  forceDiveEnd() {
    this.forceDive = false;
    this.isDiving = false;  // auto-surface
    this.fishSchool.clearPhrase();
  }

  get isUnderwater() { return this.transition > 0.5; }

  // ─── Update ────────────────────────────────────────────

  update(dt, elapsed) {
    const target = this.isDiving ? 1 : 0;
    if (this.transition !== target) {
      const dir = target > this.transition ? 1 : -1;
      this.transition = Math.max(0, Math.min(1, this.transition + dir * TRANSITION_SPEED * dt));
    }

    const t = this.transition;
    const ease = t * t * (3 - 2 * t);

    // ─── Boat waterLevel ───
    this.boat._diveWaterLevel = THREE.MathUtils.lerp(0.35, -4.0, ease);

    // ─── Camera ───
    this.camera._diveBlend = t;

    // ─── Lighting ───
    if (this._surfaceAmbient) {
      this._surfaceAmbient.intensity = THREE.MathUtils.lerp(1.2, 0.15, ease);
    }
    if (this._surfaceSun) {
      this._surfaceSun.intensity = THREE.MathUtils.lerp(1.8, 0.3, ease);
    }
    this._underwaterAmbient.intensity = ease * 0.6;

    // ─── Fog (same color as clearColor) ───
    if (ease > 0.01) {
      this.engine.scene.fog = this._fog;
      this._fog.density = ease * 0.045;
    } else {
      this.engine.scene.fog = null;
    }

    // ─── Clear color ───
    this._lerpColor.copy(this._surfaceClearColor).lerp(UNDERWATER_CLEAR, ease);
    this.engine.renderer.setClearColor(this._lerpColor);

    // ─── Ceiling caustic ───
    if (ease > 0.01) {
      this._ceilingMesh.visible = true;
      this._ceilUniforms.uTime.value = elapsed;
      this._ceilUniforms.uOpacity.value = ease;
    } else {
      this._ceilingMesh.visible = false;
    }

    // ─── God rays (static positions, gentle sway only) ───
    this._rayUniforms.uOpacity.value = ease;
    this._rayUniforms.uFogDensity.value = ease * 0.045;

    for (const r of this._rays) {
      r.mesh.visible = ease > 0.05;
      if (!r.mesh.visible) continue;
      r.mesh.rotation.z = Math.sin(elapsed * r.swaySpeed + r.baseAngle) * r.swayAmount;
    }

    // ─── Tell environment ───
    this.environment.underwaterAmount = ease;
  }
}