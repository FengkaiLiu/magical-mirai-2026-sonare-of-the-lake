/**
 * Water — Low-Poly Stylized Lake
 * Adds shader-driven cloud shadows over src_beta version.
 */

import * as THREE from "three";

const vertShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

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

    float d = 0.5;
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
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uSunDir;
  uniform vec3  uCamPos;
  uniform vec2  uCloudOffset;
  uniform float uCloudScale;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(uCamPos - vWorldPos);

    // Base color
    float depth = smoothstep(0.0, 40.0, length(vWorldPos.xz));
    vec3 col = mix(uShallow, uDeep, depth);

    // Wave-based color variation
    col += vec3(0.02, 0.04, 0.05) * (vWorldPos.y * 2.0);

    // Fresnel rim
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col = mix(col, vec3(0.6, 0.8, 0.95), fresnel * 0.3);

    // Sun specular
    vec3 R = reflect(-V, N);
    float spec = pow(max(dot(R, uSunDir), 0.0), 256.0);
    col += vec3(1.0, 0.95, 0.85) * spec * 0.6;

    // Caustics
    float c1 = sin(vWorldPos.x * 0.8 + uTime * 0.3) * sin(vWorldPos.z * 0.7 + uTime * 0.25);
    float c2 = sin(vWorldPos.x * 1.1 - uTime * 0.2) * sin(vWorldPos.z * 0.9 + uTime * 0.15);
    float caustic = (c1 + c2) * 0.015 + 0.02;
    col += vec3(caustic * 0.3, caustic * 0.6, caustic * 0.8);

    // Cloud shadow (two sin/cos noise layers, no texture needed)
    vec2 uv1 = vWorldPos.xz * uCloudScale + uCloudOffset;
    vec2 uv2 = vWorldPos.xz * uCloudScale * 0.55 + uCloudOffset * 1.4 + vec2(3.7, 1.9);
    float n1 = sin(uv1.x * 2.1) * cos(uv1.y * 1.7);
    float n2 = sin(uv2.x * 1.8 + 1.3) * cos(uv2.y * 2.2 + 0.7);
    float cloudShadow = smoothstep(-0.1, 0.6, (n1 + n2) * 0.5);
    col *= mix(1.0, 0.72, cloudShadow * 0.45);

    // Distance fog
    float fog = smoothstep(35.0, 55.0, length(vWorldPos.xz));
    col = mix(col, uDeep * 0.8, fog);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Water {
  constructor(engine) {
    this.engine = engine;
    this.camera = engine.camera;

    this.uniforms = {
      uTime:        { value: 0 },
      uShallow:     { value: new THREE.Color(0x3aadba) },
      uDeep:        { value: new THREE.Color(0x1a6080) },
      uSunDir:      { value: new THREE.Vector3(0.3, 0.8, -0.5).normalize() },
      uCamPos:      { value: new THREE.Vector3() },
      uCloudOffset: { value: new THREE.Vector2(0, 0) },
      uCloudScale:  { value: 0.015 },
    };

    const geo = new THREE.PlaneGeometry(120, 120, 50, 50);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      vertexShader: vertShader,
      fragmentShader: fragShader,
      uniforms: this.uniforms,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
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
    // Advance cloud offset — drives shadow drift
    this.uniforms.uCloudOffset.value.x = elapsed * 0.008;
    this.uniforms.uCloudOffset.value.y = elapsed * 0.005;
  }

  dispose() {
    this.engine.removeUpdatable(this);
    this.engine.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
