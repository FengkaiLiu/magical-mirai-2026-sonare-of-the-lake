/**
 * Water — Low-Poly Stylized Lake
 * Adds shader-driven cloud shadows over src_beta version.
 */

import * as THREE from "three";

const vertShader = /* glsl */ `
  uniform float uPhaseT;  // CPU-accumulated: integral of spdMod dt — phase-continuous across energy changes
  uniform float uEnergy;
  varying vec3 vWorldPos;

  float wave(vec2 pos, vec2 dir, float len, float amp, float spd) {
    return amp * sin(3.1416 * dot(pos, dir) / len + spd * uPhaseT);
  }

  float waveHeight(vec2 p) {
    float ampMod = 1.0 + uEnergy * 2.0;
    // Speed modulation is baked into uPhaseT on the CPU — only amplitude varies per-frame here.
    float w1 = wave(p, vec2(0.8, 0.6), 5.0, 0.08 * ampMod, 0.7);
    float w2 = wave(p, vec2(-0.5, 0.8), 8.0, 0.05 * ampMod, 0.5);
    float w3 = wave(p, vec2(0.3, -0.7), 3.0, 0.03 * ampMod, 1.0);
    float w4 = wave(p, vec2(0.6, -0.4), 1.5, 0.012 * ampMod, 1.8);
    float w5 = wave(p, vec2(-0.3, 0.9), 2.0, 0.015 * ampMod, 1.4);
    return w1 + w2 + w3 + w4 + w5;
  }

  void main() {
    vec3 p = position;
    p.y += waveHeight(p.xz);
    vec4 worldPos = modelMatrix * vec4(p, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragShader = /* glsl */ `
  uniform float uCausticT; // CPU-accumulated caustic phase — continuous across energy changes
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uSunDir;
  uniform vec3  uCamPos;
  uniform vec2  uCloudOffset;
  uniform float uCloudScale;
  uniform vec3  uSkyTop;
  uniform vec3  uSkyHorizon;
  uniform float uEnergy;
  varying vec3 vWorldPos;

  void main() {
    vec3 fdx = dFdx(vWorldPos);
    vec3 fdy = dFdy(vWorldPos);
    vec3 N = normalize(cross(fdx, fdy));
    if (N.y < 0.0) N = -N;
    if (abs(N.y) < 0.001) N = vec3(0.0, 1.0, 0.0);
    vec3 V = normalize(uCamPos - vWorldPos);

    // Base color: center = deep (dark), edges = shallow (light)
    float depth = smoothstep(0.0, 40.0, length(vWorldPos.xz));
    vec3 col = mix(uDeep, uShallow, depth);

    // Wave-based color variation
    col += vec3(0.02, 0.04, 0.05) * (vWorldPos.y * 2.0);

    // Fresnel + sky reflection (R reused for sun specular below)
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 R = reflect(-V, N);
    float skyT = smoothstep(-0.1, 0.4, R.y);
    vec3 skyRefl = mix(uSkyHorizon, uSkyTop, skyT);
    col = mix(col, skyRefl, fresnel * 0.55);

    // Sun specular
    float spec = pow(max(dot(R, uSunDir), 0.0), 256.0);
    col += vec3(1.0, 0.95, 0.85) * spec * 0.6;

    // Caustics
    float cSpd = uCausticT;
    float c1 = sin(vWorldPos.x * 0.8 + cSpd) * sin(vWorldPos.z * 0.7 + cSpd * 0.8);
    float c2 = sin(vWorldPos.x * 1.1 - cSpd * 0.7) * sin(vWorldPos.z * 0.9 + cSpd * 0.5);
    float caustic = (c1 + c2) * 0.015 + 0.02;
    caustic *= 1.0 + uEnergy * 2.5; // Boost caustics wildly with bass
    col += vec3(caustic * 0.3, caustic * 0.6, caustic * 0.8);

    // Foam at wave peaks
    float foam = smoothstep(0.08, 0.16, vWorldPos.y);
    col = mix(col, vec3(0.95, 0.97, 1.0), foam * 0.6);

    // Cloud shadow (two sin/cos noise layers, no texture needed)
    vec2 uv1 = vWorldPos.xz * uCloudScale + uCloudOffset;
    vec2 uv2 = vWorldPos.xz * uCloudScale * 0.55 + uCloudOffset * 1.4 + vec2(3.7, 1.9);
    float n1 = sin(uv1.x * 2.1) * cos(uv1.y * 1.7);
    float n2 = sin(uv2.x * 1.8 + 1.3) * cos(uv2.y * 2.2 + 0.7);
    float cloudShadow = smoothstep(-0.1, 0.6, (n1 + n2) * 0.5);
    col *= mix(1.0, 0.72, cloudShadow * 0.45);

    // Distance haze toward horizon — blend into sky horizon color, not deep dark
    float fog = smoothstep(35.0, 55.0, length(vWorldPos.xz));
    col = mix(col, uSkyHorizon * 0.9, fog * 0.5);

    // Transparency: deep center more opaque, shallow edges more transparent
    float alpha = 0.98 - depth * 0.12;
    gl_FragColor = vec4(col, alpha);
  }
`;

export class Water {
  constructor(engine) {
    this.engine = engine;
    this.camera = engine.camera;

    this.uniforms = {
      uTime:        { value: 0 },
      uPhaseT:      { value: 0 },   // accumulated wave phase — avoids jump when energy changes
      uCausticT:    { value: 0 },   // accumulated caustic phase — same reason
      uShallow:     { value: new THREE.Color(0x5bc8d8) },
      uDeep:        { value: new THREE.Color(0x2478a0) },
      uSunDir:      { value: new THREE.Vector3(0.3, 0.8, -0.5).normalize() },
      uCamPos:      { value: new THREE.Vector3() },
      uCloudOffset: { value: new THREE.Vector2(0, 0) },
      uCloudScale:  { value: 0.015 },
      uSkyTop:      { value: new THREE.Color(0x1a7ad4) },
      uSkyHorizon:  { value: new THREE.Color(0xe8f4ff) },
      uEnergy:      { value: 0 },
    };

    // Accumulated phase times — integrated on the CPU each frame.
    // Using integral(spdMod * dt) instead of spdMod * t means phase is
    // always continuous even when energy (and spdMod) changes suddenly.
    this._phaseT   = 0;
    this._causticT = 0;
    this._cloudX   = 0;
    this._cloudY   = 0;

    const geo = new THREE.PlaneGeometry(120, 120, 50, 50);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      vertexShader: vertShader,
      fragmentShader: fragShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mat.extensions.derivatives = true;

    this.mesh = new THREE.Mesh(geo, mat);
    // ShaderMaterial does not auto-receive shadows without manual shadow map sampling
    engine.scene.add(this.mesh);

    engine.addUpdatable(this);
  }

  setColors(shallow, deep) {
    this.uniforms.uShallow.value.set(shallow);
    this.uniforms.uDeep.value.set(deep);
  }

  update(dt, elapsed) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uCamPos.value.copy(this.camera.position);

    const energy = this.engine.env?.smoothedEnergy ?? 0;
    this.uniforms.uEnergy.value = energy;

    // Accumulate phase times: integrate spdMod/causticRate over dt so that
    // any mid-flight energy change doesn't create a phase discontinuity.
    this._phaseT   += (1.0 + energy * 1.5) * dt;
    this._causticT += (0.3 + energy * 0.5) * dt;
    this._cloudX   += (0.008 + energy * 0.01) * dt;
    this._cloudY   += (0.005 + energy * 0.01) * dt;

    this.uniforms.uPhaseT.value          = this._phaseT;
    this.uniforms.uCausticT.value        = this._causticT;
    this.uniforms.uCloudOffset.value.x   = this._cloudX;
    this.uniforms.uCloudOffset.value.y   = this._cloudY;
  }

  dispose() {
    this.engine.removeUpdatable(this);
    this.engine.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.engine = null;
    this.camera = null;
  }
}
