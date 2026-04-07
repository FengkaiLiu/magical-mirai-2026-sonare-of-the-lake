/**
 * ==========================================
 * Water — Low-Poly Stylized Lake
 * ==========================================
 * Clean, bright, game-quality water:
 *   - Low-res mesh + flat shading = faceted low-poly look
 *   - Vertex displacement for waves (GPU)
 *   - Simple color gradient (shallow → deep)
 *   - Soft Fresnel rim light
 *   - Subtle sun specular (one clean highlight)
 *   - No noisy sparkles, no blocky artifacts
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

const vertShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  // Dual wave system
  float wave(vec2 pos, vec2 dir, float len, float amp, float spd) {
    return amp * sin(3.1416 * dot(pos, dir) / len + spd * uTime);
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

    // Finite-difference normal for flat shading
    float d = 0.5; // larger step = more faceted
    float hR = waveHeight(p.xz + vec2(d, 0.0));
    float hF = waveHeight(p.xz + vec2(0.0, d));
    float hC = waveHeight(p.xz);
    vec3 T = normalize(vec3(d, hR - hC, 0.0));
    vec3 B = normalize(vec3(0.0, hF - hC, d));
    vWorldNormal = normalize(cross(T, B));

    vec4 worldPos = modelMatrix * vec4(p, 1.0);
    vWorldPos = worldPos.xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragShader = /* glsl */ `
  uniform float uTime;
  uniform vec3  uShallow;    // shallow water color
  uniform vec3  uDeep;       // deep water color
  uniform vec3  uSunDir;
  uniform vec3  uCamPos;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(uCamPos - vWorldPos);

    // --- Base color: center=shallow, edge=deep ---
    float depth = smoothstep(0.0, 40.0, length(vWorldPos.xz));
    vec3 col = mix(uShallow, uDeep, depth);

    // --- Slight wave-based color variation ---
    float waveColor = vWorldPos.y * 2.0;
    col += vec3(0.02, 0.04, 0.05) * waveColor;

    // --- Fresnel rim (sky reflection) ---
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 skyColor = vec3(0.6, 0.8, 0.95);
    col = mix(col, skyColor, fresnel * 0.3);

    // --- Sun specular (single clean highlight) ---
    vec3 R = reflect(-V, N);
    float spec = pow(max(dot(R, uSunDir), 0.0), 256.0);
    col += vec3(1.0, 0.95, 0.85) * spec * 0.6;

    // --- Subtle caustics (smooth, not blocky) ---
    float c1 = sin(vWorldPos.x * 0.8 + uTime * 0.3) * sin(vWorldPos.z * 0.7 + uTime * 0.25);
    float c2 = sin(vWorldPos.x * 1.1 - uTime * 0.2) * sin(vWorldPos.z * 0.9 + uTime * 0.15);
    float caustic = (c1 + c2) * 0.015 + 0.02;
    col += vec3(caustic * 0.3, caustic * 0.6, caustic * 0.8);

    // --- Distance fog (blend to sky at far edges) ---
    float fog = smoothstep(100.0, 160.0, length(vWorldPos.xz));
    col = mix(col, uDeep * 0.8, fog);

    gl_FragColor = vec4(col, 0.75);
  }
`;

export class Water {
  constructor(engine) {
    this.uniforms = {
      uTime:    { value: 0 },
      uShallow: { value: new THREE.Color(0x3aadba) },
      uDeep:    { value: new THREE.Color(0x1a6080) },
      uSunDir:  { value: new THREE.Vector3(0.3, 0.8, -0.5).normalize() },
      uCamPos:  { value: new THREE.Vector3() },
    };

    // Low-poly mesh: fewer subdivisions + flat shading = faceted look
    const geo = new THREE.PlaneGeometry(300, 300, 50, 50);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      vertexShader: vertShader,
      fragmentShader: fragShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    engine.scene.add(this.mesh);

    // No physics body — buoyancy is handled in code by each floating object

    this.camera = engine.camera;
    engine.addUpdatable(this);
  }

  setColors(shallow, deep) {
    this.uniforms.uShallow.value.set(shallow);
    this.uniforms.uDeep.value.set(deep);
  }

  update(dt, elapsed) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uCamPos.value.copy(this.camera.position);
  }
}