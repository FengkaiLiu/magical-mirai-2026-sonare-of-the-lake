/**
 * ==========================================
 * Environment — 環境演出 (昼バージョン)
 * ==========================================
 * 空、太陽、雲、木立、パーティクル、ライティング
 */

import * as THREE from "three";

export class Environment {
  constructor(engine) {
    this.engine = engine;
    const scene = engine.scene;

    // === ライティング (昼) ===
    scene.add(new THREE.AmbientLight(0x8ec5e8, 1.2));

    this.sunLight = new THREE.DirectionalLight(0xfff4d6, 1.8);
    this.sunLight.position.set(15, 30, -20);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 60;
    this.sunLight.shadow.camera.left = -20;
    this.sunLight.shadow.camera.right = 20;
    this.sunLight.shadow.camera.top = 20;
    this.sunLight.shadow.camera.bottom = -20;
    scene.add(this.sunLight);

    // 暖色fill (stronger for day)
    const fill = new THREE.DirectionalLight(0xffe0b0, 0.4);
    fill.position.set(-8, 12, 10);
    scene.add(fill);

    // 底部微弱反射光
    const bounce = new THREE.HemisphereLight(0x87ceeb, 0x3a6b35, 0.3);
    scene.add(bounce);

    // === スカイドーム (昼空グラデーション) ===
    const skyGeo = new THREE.SphereGeometry(400, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTopColor:    { value: new THREE.Color(0x4a90d9) },
        uBottomColor: { value: new THREE.Color(0xb8daf0) },
        uHorizonColor:{ value: new THREE.Color(0xdceaf5) },
        uOffset:      { value: 0.0 },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uTopColor;
        uniform vec3 uBottomColor;
        uniform vec3 uHorizonColor;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos).y;
          vec3 col;
          if (h > 0.0) {
            // 上半分: horizon → top
            float t = smoothstep(0.0, 0.6, h);
            col = mix(uHorizonColor, uTopColor, t);
          } else {
            // 下半分 (水面反射用): horizon → bottom
            col = uHorizonColor;
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyMat = skyMat;
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    // === 太陽 ===
    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(2.0, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff8d0 })
    );
    this.sun.position.set(15, 35, -60);
    scene.add(this.sun);

    // 太陽グロー
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(6, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0xfffae0, transparent: true, opacity: 0.08, side: THREE.BackSide,
      })
    );
    halo.position.copy(this.sun.position);
    scene.add(halo);
    this.halo = halo;

    // === 雲 (簡易ビルボード) ===
    this.clouds = [];
    const cloudMat = new THREE.SpriteMaterial({
      color: 0xffffff, transparent: true, opacity: 0.3,
    });
    for (let i = 0; i < 12; i++) {
      const cloud = new THREE.Sprite(cloudMat.clone());
      const angle = Math.random() * Math.PI * 2;
      const r = 60 + Math.random() * 50;
      cloud.position.set(
        Math.cos(angle) * r,
        18 + Math.random() * 15,
        Math.sin(angle) * r
      );
      cloud.scale.set(8 + Math.random() * 12, 2 + Math.random() * 3, 1);
      cloud.material.opacity = 0.15 + Math.random() * 0.2;
      scene.add(cloud);
      this.clouds.push({ sprite: cloud, speed: 0.005 + Math.random() * 0.01, angle });
    }

    // === 木立 removed — terrain model provides scenery ===

    // === 浮遊パーティクル (光の粒子、ホタルじゃなく光の反射) ===
    this.particleCount = 50;
    const pPos = new Float32Array(this.particleCount * 3);
    this.particleVel = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      pPos[i*3]   = (Math.random() - 0.5) * 40;
      pPos[i*3+1] = 0.3 + Math.random() * 4;
      pPos[i*3+2] = (Math.random() - 0.5) * 40;
      this.particleVel[i*3]   = (Math.random() - 0.5) * 0.002;
      this.particleVel[i*3+1] = 0.002 + Math.random() * 0.003;
      this.particleVel[i*3+2] = (Math.random() - 0.5) * 0.002;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    this.particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
      color: 0xfff8d0, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.35,
    }));
    scene.add(this.particles);

    engine.addUpdatable(this);
  }

  setTheme(theme) {
    if (theme.sky) {
      this.skyMat.uniforms.uTopColor.value.set(theme.sky);
    }
    this.engine.renderer.setClearColor(theme.skyHorizon || 0xb8daf0);
    this.particles.material.color.set(theme.particle);
  }

  update(dt, elapsed) {
    // 太陽ボブ
    this.sun.position.y = 35 + Math.sin(elapsed * 0.15) * 0.05;
    this.halo.position.copy(this.sun.position);

    // 雲の移動
    for (const c of this.clouds) {
      c.angle += c.speed * dt;
      const r = 60 + Math.sin(c.angle * 0.3) * 20;
      c.sprite.position.x += Math.cos(c.angle) * c.speed;
      c.sprite.position.z += Math.sin(c.angle) * c.speed * 0.3;
    }

    // パーティクル
    const p = this.particles.geometry.attributes.position.array;
    const v = this.particleVel;
    for (let i = 0; i < this.particleCount; i++) {
      p[i*3] += v[i*3]; p[i*3+1] += v[i*3+1]; p[i*3+2] += v[i*3+2];
      if (p[i*3+1] > 5) {
        p[i*3] = (Math.random()-0.5) * 40;
        p[i*3+1] = 0.3;
        p[i*3+2] = (Math.random()-0.5) * 40;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }
}