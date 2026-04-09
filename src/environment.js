/**
 * ==========================================
 * Environment — 環境演出 v4
 * ==========================================
 * Changes from v3:
 *   - underwaterAmount property: set by DiveController
 *   - Particles switch to bubble mode when underwater:
 *     · respawn below water surface around boat
 *     · rise upward (positive Y velocity)
 *     · color shifts to blue-cyan
 *     · slightly larger, rounder
 *   - Surface particles: unchanged (warm motes floating up)
 *   - Clouds hidden underwater
 */

import * as THREE from "three";

// ─── Particle ShaderMaterial ───

const particleVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (200.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const particleFrag = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float soft = 1.0 - smoothstep(0.3, 0.5, d);
    gl_FragColor = vec4(uColor, vAlpha * soft);
  }
`;

// Colors
const SURFACE_PARTICLE_COLOR = new THREE.Color(0xfff8d0);
const BUBBLE_COLOR = new THREE.Color(0x60ccee);

export class Environment {
  constructor(engine) {
    this.engine = engine;
    const scene = engine.scene;

    this.boat = null;
    this.underwaterAmount = 0; // set by DiveController each frame

    // === Lighting ===
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

    const fill = new THREE.DirectionalLight(0xffe0b0, 0.4);
    fill.position.set(-8, 12, 10);
    scene.add(fill);

    const bounce = new THREE.HemisphereLight(0x87ceeb, 0x3a6b35, 0.3);
    scene.add(bounce);

    // === Sky dome ===
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
    this._skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(this._skyMesh);

    // === Sun ===
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

    // === Clouds ===
    this._initClouds(scene);

    // === Particles ===
    this._initParticles(scene);

    // Store base theme particle color (set by setTheme)
    this._themeParticleColor = new THREE.Color(0xfff8d0);

    engine.addUpdatable(this);
  }

  // ─── Clouds ────────────────────────────────────────────

  _initClouds(scene) {
    const cloudMat = new THREE.SpriteMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      fog: false,
    });

    this.clouds = [];
    const CLOUD_COUNT = 14;

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const band = i % 3;
      const opacityBands = [0.15, 0.22, 0.30];
      let mat;
      if (i < 3) {
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
        baseOpacity: opacityBands[band],
      });
    }
  }

  // ─── Particles ─────────────────────────────────────────

  _initParticles(scene) {
    this.particleCount = 80;
    const count = this.particleCount;

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    this._particleVel = new Float32Array(count * 3);
    this._particlePhase = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 50;
      positions[i * 3 + 1] = 0.2 + Math.random() * 5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 50;

      sizes[i] = 0.03 + Math.random() * 0.08;
      alphas[i] = 0.15 + Math.random() * 0.35;

      this._particleVel[i * 3]     = (Math.random() - 0.5) * 0.12;
      this._particleVel[i * 3 + 1] = 0.1 + Math.random() * 0.2;
      this._particleVel[i * 3 + 2] = (Math.random() - 0.5) * 0.12;

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

  _respawnParticle(p, v, s, a, i, underwater) {
    let cx = 0, cz = 0;
    if (this.boat) {
      const bp = this.boat.getPosition();
      cx = bp.x;
      cz = bp.z;
    }

    if (underwater) {
      // Bubble: spawn below boat, rise up
      p[i * 3]     = cx + (Math.random() - 0.5) * 20;
      p[i * 3 + 1] = -6 + Math.random() * 2;  // deep below water
      p[i * 3 + 2] = cz + (Math.random() - 0.5) * 20;
      v[i * 3]     = (Math.random() - 0.5) * 0.06;
      v[i * 3 + 1] = 0.3 + Math.random() * 0.4;  // rise upward
      v[i * 3 + 2] = (Math.random() - 0.5) * 0.06;
      s[i] = 0.04 + Math.random() * 0.06;  // bubble size
      a[i] = 0.2 + Math.random() * 0.4;
    } else {
      // Surface mote
      p[i * 3]     = cx + (Math.random() - 0.5) * 40;
      p[i * 3 + 1] = 0.1 + Math.random() * 0.5;
      p[i * 3 + 2] = cz + (Math.random() - 0.5) * 40;
      v[i * 3]     = (Math.random() - 0.5) * 0.12;
      v[i * 3 + 1] = 0.1 + Math.random() * 0.2;
      v[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
      s[i] = 0.03 + Math.random() * 0.08;
      a[i] = 0.15 + Math.random() * 0.35;
    }
  }

  // ─── Public API ────────────────────────────────────────

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
    this._themeParticleColor.set(theme.particle);
    this._particleColor.set(theme.particle);
  }

  /** Beat pulse: boost a batch of particles */
  beatPulse() {
    const v = this._particleVel;
    const a = this.particles.geometry.attributes.aAlpha.array;
    const s = this.particles.geometry.attributes.aSize.array;
    const count = Math.floor(this.particleCount * 0.25);

    for (let n = 0; n < count; n++) {
      const i = Math.floor(Math.random() * this.particleCount);
      v[i * 3 + 1] += 0.6 + Math.random() * 0.4;
      a[i] = Math.min(1.0, a[i] + 0.35);
      s[i] = Math.min(0.15, s[i] + 0.04);
    }
    this.particles.geometry.attributes.aAlpha.needsUpdate = true;
    this.particles.geometry.attributes.aSize.needsUpdate = true;
  }

  // ─── Update ────────────────────────────────────────────

  update(dt, elapsed) {
    const uw = this.underwaterAmount; // 0 = surface, 1 = full underwater
    const isUW = uw > 0.5;

    // Sun bob
    this.sun.position.y = 35 + Math.sin(elapsed * 0.15) * 0.05;
    this.halo.position.copy(this.sun.position);

    // Hide sun/halo/clouds underwater
    this.sun.visible = uw < 0.8;
    this.halo.visible = uw < 0.8;
    for (const c of this.clouds) {
      c.sprite.visible = uw < 0.5;
    }

    // Shadow camera follows boat
    if (this.boat) {
      const bp = this.boat.getPosition();
      this.sunLight.target.position.set(bp.x, 0, bp.z);
      this.sunLight.target.updateMatrixWorld();
      this.sunLight.position.set(bp.x + 15, 30, bp.z - 20);
    }

    // Clouds (only update if visible)
    if (uw < 0.5) {
      for (const c of this.clouds) {
        c.angle += c.speed * dt;
        c.sprite.position.x = Math.cos(c.angle) * c.radius;
        c.sprite.position.z = Math.sin(c.angle) * c.radius;
        c.sprite.position.y = c.yBase + Math.sin(elapsed * 0.1 + c.angle) * 0.3;
      }
    }

    // ─── Particle color: blend between theme color and bubble color ───
    this._particleColor.copy(this._themeParticleColor).lerp(BUBBLE_COLOR, uw);

    // ─── Particles ───
    const p = this.particles.geometry.attributes.position.array;
    const v = this._particleVel;
    const phase = this._particlePhase;
    const a = this.particles.geometry.attributes.aAlpha.array;
    const s = this.particles.geometry.attributes.aSize.array;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      p[i3]     += v[i3] * dt;
      p[i3 + 1] += v[i3 + 1] * dt;
      p[i3 + 2] += v[i3 + 2] * dt;

      // Horizontal drift
      p[i3]     += Math.sin(elapsed * 0.5 + phase[i]) * 0.02 * dt;
      p[i3 + 2] += Math.cos(elapsed * 0.4 + phase[i] * 1.3) * 0.015 * dt;

      // Decay beat-boosted velocity
      v[i3 + 1] *= Math.pow(0.95, dt * 60);
      const baseVelY = isUW ? 0.35 : 0.15;
      if (v[i3 + 1] < baseVelY) v[i3 + 1] = baseVelY * (0.5 + Math.random() * 1.0);

      // Decay alpha and size
      a[i] *= Math.pow(0.98, dt * 60);
      if (a[i] < 0.15) a[i] = 0.15 + Math.random() * 0.35;
      s[i] *= Math.pow(0.99, dt * 60);
      const baseSize = isUW ? 0.04 : 0.03;
      if (s[i] < baseSize) s[i] = baseSize + Math.random() * 0.06;

      // Respawn conditions
      let needRespawn = false;

      if (isUW) {
        // Bubble mode: respawn when rising above water surface or too far
        if (p[i3 + 1] > 0.5) needRespawn = true;
      } else {
        // Surface mode: respawn when too high
        if (p[i3 + 1] > 6) needRespawn = true;
      }

      // Distance check (both modes)
      if (!needRespawn && this.boat) {
        const bp = this.boat.getPosition();
        const dx = p[i3] - bp.x;
        const dz = p[i3 + 2] - bp.z;
        if (dx * dx + dz * dz > 30 * 30) needRespawn = true;
      }

      if (needRespawn) {
        this._respawnParticle(p, v, s, a, i, isUW);
      }
    }

    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.aAlpha.needsUpdate = true;
    this.particles.geometry.attributes.aSize.needsUpdate = true;
  }
}