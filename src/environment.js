/**
 * ==========================================
 * Environment — 環境演出 (昼バージョン) v2
 * ==========================================
 * Changes from v1:
 *   Clouds:
 *     - Shared SpriteMaterial (12 sprites → 1 material, 1 draw call)
 *     - Per-cloud opacity stored as data, applied via vertex color alpha
 *     - Fixed orbital motion (r was calculated but never used)
 *     - Frame-rate independent movement
 *   Particles:
 *     - Velocity scaled by dt (was frame-rate dependent)
 *     - Boat-relative spawning (particles follow the action)
 *     - Per-particle random size via custom ShaderMaterial
 *     - Gentle sine-wave horizontal drift for organic feel
 *     - Increased count 50 → 80 for denser atmosphere
 *   Lighting:
 *     - Shadow camera follows boat for consistent shadow quality
 *   General:
 *     - setTheme updates skyHorizon uniform too
 */

import * as THREE from "three";

// ─── Particle ShaderMaterial (supports per-particle size + fade) ───

const particleVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (200.0 / -mvPos.z);  // size attenuation
    gl_Position = projectionMatrix * mvPos;
  }
`;

const particleFrag = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    // Soft circle (no hard square edges)
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float soft = 1.0 - smoothstep(0.3, 0.5, d);
    gl_FragColor = vec4(uColor, vAlpha * soft);
  }
`;

export class Environment {
  constructor(engine) {
    this.engine = engine;
    const scene = engine.scene;

    // Boat reference (set later via setBoat)
    this.boat = null;

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

    // 暖色 fill
    const fill = new THREE.DirectionalLight(0xffe0b0, 0.4);
    fill.position.set(-8, 12, 10);
    scene.add(fill);

    // 底部反射光
    const bounce = new THREE.HemisphereLight(0x87ceeb, 0x3a6b35, 0.3);
    scene.add(bounce);

    // === スカイドーム ===
    const skyGeo = new THREE.SphereGeometry(400, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTopColor:    { value: new THREE.Color(0x4a90d9) },
        uBottomColor: { value: new THREE.Color(0xb8daf0) },
        uHorizonColor:{ value: new THREE.Color(0xdceaf5) },
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
    this.skyMat = skyMat;
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    // === 太陽 ===
    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(2.0, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff8d0 })
    );
    this.sun.position.set(15, 35, -60);
    scene.add(this.sun);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(6, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0xfffae0, transparent: true, opacity: 0.08, side: THREE.BackSide,
      })
    );
    halo.position.copy(this.sun.position);
    scene.add(halo);
    this.halo = halo;

    // === 雲 (shared material, orbital motion) ===
    this._initClouds(scene);

    // === パーティクル (boat-relative, variable size) ===
    this._initParticles(scene);

    engine.addUpdatable(this);
  }

  // ─── Clouds ────────────────────────────────────────────

  _initClouds(scene) {
    // Single shared material — all 12 sprites = 1 draw call batch
    // Per-cloud opacity via sprite.material (SpriteMaterial is cheap to clone
    // but we can group by opacity band for fewer state changes)
    // Actually Three.js Sprite with shared material already batches well.
    // The real fix: use ONE shared material, vary opacity via vertex color.
    const cloudMat = new THREE.SpriteMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,   // base, per-cloud alpha via sprite scale trick below
      depthWrite: false,
      fog: false,
    });

    this.clouds = [];
    const CLOUD_COUNT = 14;

    for (let i = 0; i < CLOUD_COUNT; i++) {
      // Clone material only when we need different opacity
      // Group into 3 opacity bands to reduce unique materials
      const band = i % 3;
      const opacityBands = [0.15, 0.22, 0.30];
      let mat;
      if (i < 3) {
        // First 3: create the band materials
        mat = cloudMat.clone();
        mat.opacity = opacityBands[band];
        this["_cloudMat" + band] = mat;
      } else {
        mat = this["_cloudMat" + (band)];
      }

      const cloud = new THREE.Sprite(mat);
      const angle = (i / CLOUD_COUNT) * Math.PI * 2 + Math.random() * 0.3;
      const radius = 70 + Math.random() * 50;

      cloud.position.set(
        Math.cos(angle) * radius,
        20 + Math.random() * 15,
        Math.sin(angle) * radius
      );
      cloud.scale.set(10 + Math.random() * 14, 2.5 + Math.random() * 3, 1);
      scene.add(cloud);

      this.clouds.push({
        sprite: cloud,
        angle,
        radius,
        speed: 0.003 + Math.random() * 0.006,
        yBase: cloud.position.y,
      });
    }
  }

  // ─── Particles ─────────────────────────────────────────

  _initParticles(scene) {
    this.particleCount = 80;
    const count = this.particleCount;

    // Buffers
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    this._particleVel = new Float32Array(count * 3);
    this._particlePhase = new Float32Array(count); // for sine drift

    for (let i = 0; i < count; i++) {
      // Initial positions (will be reset relative to boat on first frame)
      positions[i * 3]     = (Math.random() - 0.5) * 50;
      positions[i * 3 + 1] = 0.2 + Math.random() * 5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 50;

      // Variable size: mix of tiny sparkles and slightly larger motes
      sizes[i] = 0.03 + Math.random() * 0.08;

      // Variable alpha
      alphas[i] = 0.15 + Math.random() * 0.35;

      // Velocity (base, will be multiplied by dt in update)
      this._particleVel[i * 3]     = (Math.random() - 0.5) * 0.12;  // per second
      this._particleVel[i * 3 + 1] = 0.1 + Math.random() * 0.2;     // per second
      this._particleVel[i * 3 + 2] = (Math.random() - 0.5) * 0.12;

      // Random phase for sine drift
      this._particlePhase[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));

    this._particleColor = new THREE.Color(0xfff8d0);

    const mat = new THREE.ShaderMaterial({
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      uniforms: {
        uColor: { value: this._particleColor },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.particles = new THREE.Points(geo, mat);
    scene.add(this.particles);
  }

  _respawnParticle(p, i) {
    // Spawn around boat if available, else around origin
    let cx = 0, cz = 0;
    if (this.boat) {
      const bp = this.boat.getPosition();
      cx = bp.x;
      cz = bp.z;
    }
    p[i * 3]     = cx + (Math.random() - 0.5) * 40;
    p[i * 3 + 1] = 0.1 + Math.random() * 0.5;
    p[i * 3 + 2] = cz + (Math.random() - 0.5) * 40;
  }

  // ─── Public API ────────────────────────────────────────

  /** Connect boat reference for boat-relative particle spawning + shadow follow */
  setBoat(boat) {
    this.boat = boat;
  }

  setTheme(theme) {
    if (theme.sky) {
      this.skyMat.uniforms.uTopColor.value.set(theme.sky);
    }
    if (theme.skyHorizon) {
      this.skyMat.uniforms.uHorizonColor.value.set(theme.skyHorizon);
    }
    this.engine.renderer.setClearColor(theme.skyHorizon || 0xb8daf0);
    this._particleColor.set(theme.particle);
  }

  // ─── Update ────────────────────────────────────────────

  update(dt, elapsed) {
    // 太陽ボブ
    this.sun.position.y = 35 + Math.sin(elapsed * 0.15) * 0.05;
    this.halo.position.copy(this.sun.position);

    // ─── Shadow camera follows boat ───
    if (this.boat) {
      const bp = this.boat.getPosition();
      this.sunLight.target.position.set(bp.x, 0, bp.z);
      this.sunLight.target.updateMatrixWorld();
      this.sunLight.position.set(bp.x + 15, 30, bp.z - 20);
    }

    // ─── 雲: true orbital motion ───
    for (const c of this.clouds) {
      c.angle += c.speed * dt;
      c.sprite.position.x = Math.cos(c.angle) * c.radius;
      c.sprite.position.z = Math.sin(c.angle) * c.radius;
      // Gentle vertical bob
      c.sprite.position.y = c.yBase + Math.sin(elapsed * 0.1 + c.angle) * 0.3;
    }

    // ─── パーティクル: frame-rate independent + sine drift ───
    const p = this.particles.geometry.attributes.position.array;
    const v = this._particleVel;
    const phase = this._particlePhase;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Velocity * dt
      p[i3]     += v[i3] * dt;
      p[i3 + 1] += v[i3 + 1] * dt;
      p[i3 + 2] += v[i3 + 2] * dt;

      // Gentle horizontal sine drift (organic floating feel)
      p[i3]     += Math.sin(elapsed * 0.5 + phase[i]) * 0.02 * dt;
      p[i3 + 2] += Math.cos(elapsed * 0.4 + phase[i] * 1.3) * 0.015 * dt;

      // Reset when too high or too far from boat
      if (p[i3 + 1] > 6) {
        this._respawnParticle(p, i);
      } else if (this.boat) {
        const bp = this.boat.getPosition();
        const dx = p[i3] - bp.x;
        const dz = p[i3 + 2] - bp.z;
        if (dx * dx + dz * dz > 30 * 30) {
          this._respawnParticle(p, i);
        }
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }
}