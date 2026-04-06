/**
 * ==========================================
 * Water — ゲーム品質の水面
 * ==========================================
 * Three.js: ShaderMaterial の平面
 * Cannon-es: 静的な地面プレーン (y=0)
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";

const vertShader = /* glsl */ `
  uniform float uTime;
  varying vec2  vUv;
  varying vec3  vPos;

  void main() {
    vUv = uv;
    vec3 p = position;

    // 極めて微かなうねり
    p.y += sin(p.x * 0.15 + uTime * 0.3) * 0.01;
    p.y += sin(p.z * 0.12 + uTime * 0.25) * 0.01;

    vPos = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragShader = /* glsl */ `
  uniform float uTime;
  uniform vec3  uColor;
  uniform vec3  uColorDeep;

  varying vec2  vUv;
  varying vec3  vPos;

  void main() {
    // 中心から外への深さグラデーション
    float d = length(vPos.xz) * 0.012;
    vec3 col = mix(uColor, uColorDeep, clamp(d, 0.0, 1.0));

    // Caustics (光の模様 — 昼はもっと目立つ)
    float c1 = sin(vPos.x * 1.2 + uTime * 0.35) * sin(vPos.z * 1.0 + uTime * 0.28);
    float c2 = sin(vPos.x * 0.8 - uTime * 0.2) * sin(vPos.z * 1.5 + uTime * 0.18);
    float c3 = sin(vPos.x * 2.0 + uTime * 0.5) * sin(vPos.z * 1.8 - uTime * 0.35);
    float caustic = (c1 + c2 + c3 * 0.3) * 0.025 + 0.03;
    col += vec3(caustic * 0.5, caustic * 0.8, caustic);

    // スペキュラ風のハイライト (太陽の反射)
    float spec = pow(max(sin(vPos.x * 0.3 + uTime * 0.15) * sin(vPos.z * 0.25 + uTime * 0.12), 0.0), 8.0);
    col += vec3(1.0, 0.95, 0.85) * spec * 0.06;

    // 端の暗さ
    float edge = smoothstep(30.0, 45.0, length(vPos.xz));
    col = mix(col, uColorDeep * 0.7, edge);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Water {
  constructor(engine) {
    // === Three.js mesh ===
    this.uniforms = {
      uTime:      { value: 0 },
      uColor:     { value: new THREE.Color(0x0e2545) },
      uColorDeep: { value: new THREE.Color(0x060e1f) },
    };

    const geo = new THREE.PlaneGeometry(120, 120, 64, 64);
    geo.rotateX(-Math.PI / 2);

    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: vertShader,
      fragmentShader: fragShader,
      uniforms: this.uniforms,
    }));
    this.mesh.receiveShadow = true;
    engine.scene.add(this.mesh);

    // === Cannon-es physics body (infinite ground plane) ===
    this.body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
      material: engine.materials.water,
    });
    this.body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    engine.world.addBody(this.body);

    engine.addUpdatable(this);
  }

  setColors(color, deep) {
    this.uniforms.uColor.value.set(color);
    this.uniforms.uColorDeep.value.set(deep);
  }

  update(dt, elapsed) {
    this.uniforms.uTime.value = elapsed;
  }
}