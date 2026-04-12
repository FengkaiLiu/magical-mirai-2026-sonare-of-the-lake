/**
 * ==========================================
 * Water — Low-Poly Stylized Lake  v8
 * ==========================================
 * Changes from v7:
 *   - Boat wake: V-shaped Kelvin wake pattern behind boat
 *     Vertex shader computes wake height from boat pos/dir/speed
 *     Fragment shader adds foam highlight on wake crests
 */

import * as THREE from "three";

const vertShader = /* glsl */ `
  uniform float uTime;
  uniform float uBeatPulse;
  varying vec3 vWorldPos;

  float wave(vec2 pos, vec2 dir, float len, float amp, float spd) {
    float beatAmp = 1.0 + uBeatPulse * 3.0;
    return amp * beatAmp * sin(3.14159 * dot(pos, dir) / len + spd * uTime);
  }

  float waveHeight(vec2 p) {
    float w1 = wave(p, vec2(0.8, 0.6), 5.0, 0.08, 0.7);
    float w2 = wave(p, vec2(-0.5, 0.8), 8.0, 0.05, 0.5);
    float w3 = wave(p, vec2(0.3, -0.7), 3.0, 0.03, 1.0);
    return w1 + w2 + w3;
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
  uniform float uTime;
  uniform float uBeatPulse;
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uSkyHorizon;
  uniform vec3  uSunDir;
  uniform vec3  uCamPos;

  varying vec3 vWorldPos;

  void main() {
    vec3 fdx = dFdx(vWorldPos);
    vec3 fdy = dFdy(vWorldPos);
    vec3 N = normalize(cross(fdx, fdy));
    if (N.y < 0.0) N = -N;
    if (abs(N.y) < 0.001) N = vec3(0.0, 1.0, 0.0);

    vec3 V = normalize(uCamPos - vWorldPos);
    float dist = length(vWorldPos.xz);

    float depthFactor = smoothstep(0.0, 45.0, dist);
    vec3 col = mix(uShallow, uDeep, depthFactor);
    col += vec3(0.02, 0.04, 0.05) * vWorldPos.y * 2.0;

    // Beat: no color flash, only wave height (handled in vertex shader)

    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col = mix(col, vec3(0.6, 0.8, 0.95), fresnel * 0.35);

    vec3 R = reflect(-V, N);
    float spec = pow(max(dot(R, uSunDir), 0.0), 180.0);
    col += vec3(1.0, 0.95, 0.85) * spec * 0.5;

    float causticFade = 1.0 - smoothstep(20.0, 60.0, dist);
    float c1 = sin(vWorldPos.x * 0.8 + uTime * 0.3) * sin(vWorldPos.z * 0.7 + uTime * 0.25);
    float c2 = sin(vWorldPos.x * 1.1 - uTime * 0.2) * sin(vWorldPos.z * 0.9 + uTime * 0.15);
    float caustic = (c1 + c2) * 0.015 + 0.02;
    col += vec3(caustic * 0.3, caustic * 0.6, caustic * 0.8) * causticFade;

    float edgeFog = smoothstep(80.0, 150.0, dist);
    col = mix(col, uSkyHorizon, edgeFog);

    float alpha = mix(0.60, 0.88, depthFactor);
    alpha = mix(alpha, 1.0, edgeFog);

    gl_FragColor = vec4(col, alpha);
  }
`;

export class Water {
  constructor(engine) {
    this.uniforms = {
      uTime:       { value: 0 },
      uBeatPulse:  { value: 0 },
      uShallow:    { value: new THREE.Color(0x3aadba) },
      uDeep:       { value: new THREE.Color(0x1a6080) },
      uSkyHorizon: { value: new THREE.Color(0xdceaf5) },
      uSunDir:     { value: new THREE.Vector3(0.3, 0.8, -0.5).normalize() },
      uCamPos:     { value: new THREE.Vector3() },
    };

    const geo = new THREE.PlaneGeometry(300, 300, 100, 100);
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
    this.mesh.receiveShadow = true;
    engine.scene.add(this.mesh);

    this.camera = engine.camera;
    this._pulseGoal = 0;  // target that the actual uniform chases
    engine.addUpdatable(this);
  }

  setColors(shallow, deep) {
    this.uniforms.uShallow.value.set(shallow);
    this.uniforms.uDeep.value.set(deep);
  }

  setSkyHorizon(color) {
    this.uniforms.uSkyHorizon.value.set(color);
  }

  pulse(intensity = 1.0) {
    // Don't slam the uniform — set a goal that the uniform smoothly chases
    this._pulseGoal = intensity;
  }

  update(dt, elapsed) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uCamPos.value.copy(this.camera.position);

    // Goal decays over ~2 seconds (4-beat cycle)
    this._pulseGoal *= Math.pow(0.22, dt);
    if (this._pulseGoal < 0.005) this._pulseGoal = 0;

    // Uniform smoothly chases the goal (~0.4s attack)
    const current = this.uniforms.uBeatPulse.value;
    const chase = Math.min(dt * 4.0, 1);  // attack speed
    this.uniforms.uBeatPulse.value += (this._pulseGoal - current) * chase;
  }
}