/**
 * ==========================================
 * WakeTrail — 船尾波粒子拖尾
 * ==========================================
 * Spawns foam particles behind boat at water level.
 * Two emitters (port + starboard) create natural V-shape.
 * Particles drift outward, scale up, and fade — no mesh dependency.
 */

import * as THREE from "three";

const MAX_PARTICLES = 200;
const PARTICLE_LIFE = 3.5;   // seconds before fully faded
const SPAWN_INTERVAL = 0.04; // seconds between spawns (25/sec)
const WATER_Y = 0.38;        // just above water surface
const SIDE_OFFSET = 0.35;    // how far from center to spawn (port/starboard)
const SPREAD_SPEED = 0.8;    // outward drift speed
const BEHIND_OFFSET = 0.7;   // how far behind boat center to spawn

const wakeVert = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const wakeFrag = /* glsl */ `
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float soft = 1.0 - smoothstep(0.2, 0.5, d);
    gl_FragColor = vec4(0.85, 0.92, 0.97, vAlpha * soft * 0.6);
  }
`;

export class WakeTrail {
  constructor(engine) {
    this.engine = engine;

    // Ring buffer arrays
    this._positions = new Float32Array(MAX_PARTICLES * 3);
    this._velocities = new Float32Array(MAX_PARTICLES * 3);
    this._alphas = new Float32Array(MAX_PARTICLES);
    this._sizes = new Float32Array(MAX_PARTICLES);
    this._ages = new Float32Array(MAX_PARTICLES);

    // Initialize all as dead
    this._ages.fill(PARTICLE_LIFE + 1);
    this._alphas.fill(0);
    for (let i = 0; i < MAX_PARTICLES; i++) this._sizes[i] = 0.01;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this._alphas, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this._sizes, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: wakeVert,
      fragmentShader: wakeFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    engine.scene.add(this.mesh);

    this._writeIdx = 0;
    this._spawnTimer = 0;
    this._boat = null;

    engine.addUpdatable(this);
  }

  setBoat(boat) {
    this._boat = boat;
  }

  update(dt) {
    if (!this._boat) return;

    const speed = this._boat.getSpeed();
    const pos = this._boat.getPosition();
    const heading = this._boat.getHeading();

    // Forward and right vectors in XZ
    const fwdX = -Math.sin(heading);
    const fwdZ = -Math.cos(heading);
    const rightX = -fwdZ;  // perpendicular
    const rightZ = fwdX;

    // Stern position (behind boat center)
    const sternX = pos.x - fwdX * BEHIND_OFFSET;
    const sternZ = pos.z - fwdZ * BEHIND_OFFSET;

    // ─── Spawn new particles ───
    if (speed > 0.5) {
      this._spawnTimer += dt;
      // Spawn faster at higher speed
      const interval = SPAWN_INTERVAL / Math.min(speed / 3, 2);

      while (this._spawnTimer >= interval) {
        this._spawnTimer -= interval;

        // Port side
        this._spawnParticle(
          sternX - rightX * SIDE_OFFSET,
          sternZ - rightZ * SIDE_OFFSET,
          -rightX * SPREAD_SPEED + (Math.random() - 0.5) * 0.2,
          -rightZ * SPREAD_SPEED + (Math.random() - 0.5) * 0.2,
          speed
        );

        // Starboard side
        this._spawnParticle(
          sternX + rightX * SIDE_OFFSET,
          sternZ + rightZ * SIDE_OFFSET,
          rightX * SPREAD_SPEED + (Math.random() - 0.5) * 0.2,
          rightZ * SPREAD_SPEED + (Math.random() - 0.5) * 0.2,
          speed
        );
      }
    } else {
      this._spawnTimer = 0;
    }

    // ─── Update all particles ───
    const p = this._positions;
    const v = this._velocities;
    const a = this._alphas;
    const s = this._sizes;
    const ages = this._ages;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (ages[i] > PARTICLE_LIFE) continue;

      ages[i] += dt;
      const life = ages[i] / PARTICLE_LIFE; // 0→1

      // Drift outward (slowing down)
      const drag = Math.pow(0.97, dt * 60);
      v[i * 3] *= drag;
      v[i * 3 + 2] *= drag;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;

      // Fade out
      a[i] = Math.max(0, 1 - life * life);

      // Scale up as it ages
      s[i] = 0.15 + life * 0.4;

      if (ages[i] > PARTICLE_LIFE) {
        a[i] = 0;
      }
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
    this.mesh.geometry.attributes.aSize.needsUpdate = true;
  }

  _spawnParticle(x, z, vx, vz, speed) {
    const i = this._writeIdx;
    this._writeIdx = (this._writeIdx + 1) % MAX_PARTICLES;

    this._positions[i * 3] = x;
    this._positions[i * 3 + 1] = WATER_Y;
    this._positions[i * 3 + 2] = z;

    // Speed affects spread intensity
    const speedMult = Math.min(speed / 4, 1.5);
    this._velocities[i * 3] = vx * speedMult;
    this._velocities[i * 3 + 1] = 0;
    this._velocities[i * 3 + 2] = vz * speedMult;

    this._ages[i] = 0;
    this._alphas[i] = 1;
    this._sizes[i] = 0.15;
  }
}