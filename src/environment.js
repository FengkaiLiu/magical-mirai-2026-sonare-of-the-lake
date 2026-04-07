/**
 * Environment — sky, sun, clouds, trees, particles.
 * Cloud drift direction matches water shader cloud shadow.
 */

import * as THREE from "three";

export class Environment {
  constructor(engine) {
    this.engine = engine;
    const scene = engine.scene;
    this._sceneObjects = [];

    // === Lighting ===
    this.ambientLight = new THREE.AmbientLight(0x8ec5e8, 1.2);
    scene.add(this.ambientLight);

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

    this.fillLight = new THREE.DirectionalLight(0xffe0b0, 0.4);
    this.fillLight.position.set(-8, 12, 10);
    scene.add(this.fillLight);

    this.bounceLight = new THREE.HemisphereLight(0x87ceeb, 0x3a6b35, 0.3);
    scene.add(this.bounceLight);

    // === Sky dome ===
    const skyGeo = new THREE.SphereGeometry(150, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTopColor:     { value: new THREE.Color(0x4a90d9) },
        uBottomColor:  { value: new THREE.Color(0xb8daf0) },
        uHorizonColor: { value: new THREE.Color(0xdceaf5) },
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
            float t = smoothstep(0.0, 0.6, h);
            col = mix(uHorizonColor, uTopColor, t);
          } else {
            col = uHorizonColor;
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMat);
    scene.add(this.skyMesh);
    this._sceneObjects.push(this.skyMesh);

    // === Sun ===
    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(2.0, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff8d0 })
    );
    this.sun.position.set(15, 35, -60);
    scene.add(this.sun);
    this._sceneObjects.push(this.sun);

    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(6, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0xfffae0, transparent: true, opacity: 0.08, side: THREE.BackSide,
      })
    );
    this.halo.position.copy(this.sun.position);
    scene.add(this.halo);
    this._sceneObjects.push(this.halo);

    // === Clouds — drift in +X/+Z to match water shadow ===
    this.clouds = [];
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.SpriteMaterial({
        color: 0xffffff, transparent: true,
        opacity: 0.15 + Math.random() * 0.2,
      });
      const cloud = new THREE.Sprite(mat);
      cloud.position.set(
        (Math.random() - 0.5) * 200,
        18 + Math.random() * 15,
        (Math.random() - 0.5) * 200
      );
      cloud.scale.set(10 + Math.random() * 14, 2.5 + Math.random() * 3, 1);
      scene.add(cloud);
      this._sceneObjects.push(cloud);
      // Drift at speeds matching water's uCloudOffset advancement
      this.clouds.push({
        sprite: cloud,
        driftX: 0.3 + Math.random() * 0.4,   // → 0.3–0.7, centered on ~0.5 world units/s
        driftZ: 0.15 + Math.random() * 0.3,  // → 0.15–0.45, centered on ~0.3 world units/s
      });
    }

    // === Trees ===
    const treeCount = 80;
    const treeGeo = new THREE.ConeGeometry(0.5, 2, 4);
    const treeMat = new THREE.MeshLambertMaterial({ color: 0x2d5a27 });
    this.trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2;
      const radius = 42 + Math.sin(i * 2.5) * 4;
      const h = 1.5 + Math.abs(Math.sin(i * 1.6)) * 3;
      const s = 0.6 + Math.abs(Math.sin(i * 0.9)) * 0.7;
      dummy.position.set(Math.cos(angle) * radius, h * 0.5, Math.sin(angle) * radius);
      dummy.scale.set(s, h, s);
      dummy.updateMatrix();
      this.trees.setMatrixAt(i, dummy.matrix);
    }
    this.trees.instanceMatrix.needsUpdate = true;
    this.trees.castShadow = true;
    scene.add(this.trees);
    this._sceneObjects.push(this.trees);

    // === Floating particles ===
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
    this._sceneObjects.push(this.particles);

    engine.addUpdatable(this);
  }

  setTheme(theme) {
    if (theme.sky) this.skyMat.uniforms.uTopColor.value.set(theme.sky);
    this.engine.renderer.setClearColor(theme.skyHorizon || 0xb8daf0);
    this.particles.material.color.set(theme.particle);
  }

  update(dt, elapsed) {
    // Sun bob
    this.sun.position.y = 35 + Math.sin(elapsed * 0.15) * 0.05;
    this.halo.position.copy(this.sun.position);

    // Cloud linear drift (matches water shader direction)
    for (const c of this.clouds) {
      c.sprite.position.x += c.driftX * dt;
      c.sprite.position.z += c.driftZ * dt;
      // Wrap clouds to stay in visible range
      if (c.sprite.position.x > 120) c.sprite.position.x -= 240;
      if (c.sprite.position.z > 120) c.sprite.position.z -= 240;
    }

    // Particles rise and reset
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

  dispose() {
    this.engine.removeUpdatable(this);
    const scene = this.engine.scene;
    scene.remove(this.ambientLight);
    scene.remove(this.sunLight);
    scene.remove(this.fillLight);
    scene.remove(this.bounceLight);
    for (const obj of this._sceneObjects) scene.remove(obj);
    // Dispose geometries and materials
    this.skyMesh.geometry.dispose();
    this.skyMat.dispose();
    this.sun.geometry.dispose(); this.sun.material.dispose();
    this.halo.geometry.dispose(); this.halo.material.dispose();
    this.trees.geometry.dispose(); this.trees.material.dispose();
    this.particles.geometry.dispose(); this.particles.material.dispose();
    for (const c of this.clouds) c.sprite.material.dispose();
    this.engine = null;
  }
}
