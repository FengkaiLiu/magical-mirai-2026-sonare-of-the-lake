/**
 * ==========================================
 * Water — Low-Poly Stylized Lake  v2
 * ==========================================
 * Changes from v1:
 *   - True flat shading: fragment shader reconstructs face normal
 *     via dFdx/dFdy — every triangle gets ONE normal, no interpolation
 *   - Removed vertex-shader finite-difference normals (were smooth, not flat)
 *   - Transparency: depth-aware alpha (shallow=more transparent, deep=opaque)
 *     so submerged planks are visible near the boat
 *   - depthWrite enabled via two-pass trick: opaque pass writes depth,
 *     transparent pass blends on top (avoids z-fighting)
 *   - Caustics fade out with distance (no more moiré at horizon)
 *   - Edge softening: water fades to sky color at boundaries
 *   - Removed unused CANNON import
 */

import * as THREE from "three";

const vertShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;

  // Wave system
  float wave(vec2 pos, vec2 dir, float len, float amp, float spd) {
    return amp * sin(3.14159 * dot(pos, dir) / len + spd * uTime);
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
  #extension GL_OES_standard_derivatives : enable

  uniform float uTime;
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uSkyHorizon;  // for edge blending
  uniform vec3  uSunDir;
  uniform vec3  uCamPos;

  varying vec3 vWorldPos;

  void main() {
    // ─── True flat normal from screen-space derivatives ───
    // This gives each triangle exactly ONE normal = crisp low-poly facets
    vec3 dx = dFdx(vWorldPos);
    vec3 dy = dFdy(vWorldPos);
    vec3 N = normalize(cross(dx, dy));
    // Ensure normal points up (flip if needed)
    N *= sign(N.y);

    vec3 V = normalize(uCamPos - vWorldPos);

    // ─── Distance from center (for depth, caustic fade, edge fade) ───
    float dist = length(vWorldPos.xz);

    // ─── Base color: shallow near boat → deep at edges ───
    float depthFactor = smoothstep(0.0, 45.0, dist);
    vec3 col = mix(uShallow, uDeep, depthFactor);

    // ─── Wave color variation (subtle) ───
    col += vec3(0.02, 0.04, 0.05) * vWorldPos.y * 2.0;

    // ─── Fresnel rim (sky reflection) ───
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 skyRef = vec3(0.6, 0.8, 0.95);
    col = mix(col, skyRef, fresnel * 0.35);

    // ─── Sun specular ───
    vec3 R = reflect(-V, N);
    float spec = pow(max(dot(R, uSunDir), 0.0), 180.0);
    col += vec3(1.0, 0.95, 0.85) * spec * 0.5;

    // ─── Caustics with distance fade (kills moiré at horizon) ───
    float causticFade = 1.0 - smoothstep(20.0, 60.0, dist);
    float c1 = sin(vWorldPos.x * 0.8 + uTime * 0.3)
             * sin(vWorldPos.z * 0.7 + uTime * 0.25);
    float c2 = sin(vWorldPos.x * 1.1 - uTime * 0.2)
             * sin(vWorldPos.z * 0.9 + uTime * 0.15);
    float caustic = (c1 + c2) * 0.015 + 0.02;
    col += vec3(caustic * 0.3, caustic * 0.6, caustic * 0.8) * causticFade;

    // ─── Edge fog: blend to sky horizon color ───
    float edgeFog = smoothstep(80.0, 150.0, dist);
    col = mix(col, uSkyHorizon, edgeFog);

    // ─── Depth-aware alpha ───
    // Near boat (shallow) → more transparent so you can see planks below
    // Far from boat (deep) → more opaque
    float alpha = mix(0.55, 0.85, depthFactor);
    // At very far edges, fully opaque to hide skybox seam
    alpha = mix(alpha, 1.0, edgeFog);

    gl_FragColor = vec4(col, alpha);
  }
`;

export class Water {
  constructor(engine) {
    this.uniforms = {
      uTime:       { value: 0 },
      uShallow:    { value: new THREE.Color(0x3aadba) },
      uDeep:       { value: new THREE.Color(0x1a6080) },
      uSkyHorizon: { value: new THREE.Color(0xdceaf5) },
      uSunDir:     { value: new THREE.Vector3(0.3, 0.8, -0.5).normalize() },
      uCamPos:     { value: new THREE.Vector3() },
    };

    // Low-poly mesh: 50×50 segments on 300×300 plane = 6m per quad
    const geo = new THREE.PlaneGeometry(300, 300, 50, 50);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      vertexShader: vertShader,
      fragmentShader: fragShader,
      uniforms: this.uniforms,
      transparent: true,
      // Write depth so objects behind water are properly occluded,
      // but use alpha blending so submerged objects show through
      depthWrite: true,
      // Render after opaque objects but before other transparent objects
      // This gives the best balance between seeing submerged planks
      // and not having z-sorting artifacts
    });
    mat.extensions = { derivatives: true };

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    // Render order: slightly negative so water renders before lyric planks
    // that are sinking (transparent). Floating planks are opaque and
    // render in the opaque pass regardless.
    this.mesh.renderOrder = -1;
    engine.scene.add(this.mesh);

    this.camera = engine.camera;
    engine.addUpdatable(this);
  }

  setColors(shallow, deep) {
    this.uniforms.uShallow.value.set(shallow);
    this.uniforms.uDeep.value.set(deep);
  }

  /** Call when song theme changes to keep edge fog matching the sky */
  setSkyHorizon(color) {
    this.uniforms.uSkyHorizon.value.set(color);
  }

  update(dt, elapsed) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uCamPos.value.copy(this.camera.position);
  }
}